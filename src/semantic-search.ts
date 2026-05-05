import {
  cosineSimilarity,
  EmbedderUnavailableError,
  type Embedder
} from "./embedder.js";
import {
  getHybridIndexStatus,
  readAllPageEmbeddings,
  readIndexedWikiPages,
  searchIndexedWikiPages,
  type HybridIndexStatus,
  type IndexedPageEmbedding
} from "./hybrid-index.js";
import type { WikiPage, WikiPageType } from "./types.js";

/**
 * Hybrid retrieval defaults. Tunable via `aiwiki config` (see PR 4) and through
 * the `semantic` option on `searchWikiMemory`.
 */
export const DEFAULT_VECTOR_WEIGHT = 0.7;
export const DEFAULT_BM25_WEIGHT = 0.3;
export const DEFAULT_MIN_SCORE = 0.35;
export const DEFAULT_LENGTH_NORM_ANCHOR = 500;
/** MMR-style diversity: skip a candidate if its embedding is this close to any already-kept result. */
export const DEFAULT_DEDUP_THRESHOLD = 0.92;

export interface SemanticSearchConfig {
  vectorWeight?: number;
  bm25Weight?: number;
  minScore?: number;
  lengthNormAnchor?: number;
  dedupThreshold?: number;
}

export interface SemanticSearchOptions {
  type?: WikiPageType;
  limit: number;
  tokens: string[];
  embedder: Embedder;
  semantic?: SemanticSearchConfig;
}

export interface SemanticSearchResult {
  page: WikiPage;
  cosine: number;
  bm25?: number;
  fusedScore: number;
}

export interface SemanticSearchResponse {
  results: SemanticSearchResult[];
  indexStatus: HybridIndexStatus;
  candidatePool: number;
}

function clampNonNegative(value: number): number {
  return value < 0 ? 0 : value;
}

/** Map a raw BM25 rank (lower is better) into a [0, 1] relevance score. */
function bm25ToScore(bm25: number | undefined): number {
  if (bm25 === undefined) {
    return 0;
  }
  // SQLite FTS5 bm25() returns negative-or-zero for matches, with more
  // negative meaning more relevant. Convert via 1 / (1 + |rank|) so the most
  // relevant hit approaches 1 and barely-matching hits approach 0.
  return 1 / (1 + Math.abs(bm25));
}

function lengthNormalizationFactor(
  bodyLength: number,
  anchor: number
): number {
  if (bodyLength <= anchor) {
    return 1;
  }
  return anchor / bodyLength;
}

/**
 * Greedy MMR-style dedup: walk results in fused-score order and skip any
 * candidate whose embedding is too similar to a result that was already kept.
 */
function dedupByEmbedding(
  candidates: Array<SemanticSearchResult & { embedding: Float32Array }>,
  threshold: number
): SemanticSearchResult[] {
  const kept: Array<SemanticSearchResult & { embedding: Float32Array }> = [];
  for (const candidate of candidates) {
    const tooSimilar = kept.some(
      (existing) =>
        cosineSimilarity(existing.embedding, candidate.embedding) >= threshold
    );
    if (!tooSimilar) {
      kept.push(candidate);
    }
  }
  return kept.map(({ embedding: _embedding, ...rest }) => rest);
}

/**
 * Hybrid (vector + BM25) retrieval over the SQLite-derived index.
 *
 * Returns `undefined` when prerequisites are missing (no index, no embeddings,
 * embedding model mismatch, or embedder failure). The caller is expected to
 * fall back to a non-semantic search path.
 */
export async function hybridSemanticSearch(
  rootDir: string,
  query: string,
  options: SemanticSearchOptions
): Promise<SemanticSearchResponse | undefined> {
  const trimmed = query.trim();
  if (trimmed.length === 0 || options.limit <= 0) {
    return undefined;
  }

  const indexStatus = await getHybridIndexStatus(rootDir);
  if (!indexStatus.fresh || !indexStatus.embeddingsFresh) {
    return undefined;
  }

  if (
    indexStatus.embeddingModelId &&
    indexStatus.embeddingModelId !== options.embedder.modelId
  ) {
    // The on-disk embeddings were produced by a different model. Refuse to
    // mix-and-match; force the caller to rebuild or fall back.
    return undefined;
  }

  const [pageEmbeddings, pages] = await Promise.all([
    readAllPageEmbeddings(rootDir),
    readIndexedWikiPages(rootDir)
  ]);
  if (!pageEmbeddings || pageEmbeddings.length === 0 || !pages) {
    return undefined;
  }

  let queryEmbedding: Float32Array;
  try {
    const [vector] = await options.embedder.embed([trimmed], "query");
    queryEmbedding = vector;
  } catch (error) {
    if (error instanceof EmbedderUnavailableError) {
      return undefined;
    }
    throw error;
  }

  if (queryEmbedding.length !== options.embedder.dimensions) {
    // Dimension mismatch (model swap mid-flight); fall back.
    return undefined;
  }

  const config: Required<SemanticSearchConfig> = {
    vectorWeight: options.semantic?.vectorWeight ?? DEFAULT_VECTOR_WEIGHT,
    bm25Weight: options.semantic?.bm25Weight ?? DEFAULT_BM25_WEIGHT,
    minScore: options.semantic?.minScore ?? DEFAULT_MIN_SCORE,
    lengthNormAnchor:
      options.semantic?.lengthNormAnchor ?? DEFAULT_LENGTH_NORM_ANCHOR,
    dedupThreshold:
      options.semantic?.dedupThreshold ?? DEFAULT_DEDUP_THRESHOLD
  };

  const pageByPath = new Map<string, WikiPage>();
  for (const page of pages) {
    pageByPath.set(page.relativePath, page);
  }

  const embeddingByPath = new Map<string, IndexedPageEmbedding>();
  for (const item of pageEmbeddings) {
    embeddingByPath.set(item.relativePath, item);
  }

  const cosines = new Map<string, number>();
  for (const item of pageEmbeddings) {
    const cos = cosineSimilarity(queryEmbedding, item.embedding);
    cosines.set(item.relativePath, cos);
  }

  // Run BM25 in parallel with embedding; we need a wide candidate pool so that
  // pages that match by keyword but not vector (and vice versa) all surface.
  const candidatePoolSize = Math.max(options.limit * 4, 24);
  const bm25Results = await searchIndexedWikiPages(rootDir, {
    type: options.type,
    limit: candidatePoolSize,
    tokens: options.tokens
  });
  const bm25ByPath = new Map<string, number>();
  if (bm25Results) {
    for (const result of bm25Results) {
      bm25ByPath.set(result.page.relativePath, result.bm25);
    }
  }

  const filteredPages = options.type
    ? pages.filter((page) => page.frontmatter.type === options.type)
    : pages;

  const scored = filteredPages
    .map((page) => {
      const cosine = cosines.get(page.relativePath) ?? 0;
      const semScore = clampNonNegative(cosine);
      const bm25 = bm25ByPath.get(page.relativePath);
      const lexScore = bm25ToScore(bm25);
      const raw =
        config.vectorWeight * semScore + config.bm25Weight * lexScore;
      const norm = lengthNormalizationFactor(
        page.body.length,
        config.lengthNormAnchor
      );
      const fusedScore = raw * norm;
      const embedding = embeddingByPath.get(page.relativePath)?.embedding;

      return {
        page,
        cosine,
        bm25,
        fusedScore,
        embedding
      };
    })
    .filter((entry): entry is typeof entry & { embedding: Float32Array } =>
      Boolean(entry.embedding)
    )
    .filter((entry) => entry.fusedScore >= config.minScore)
    .sort((a, b) => {
      if (b.fusedScore !== a.fusedScore) {
        return b.fusedScore - a.fusedScore;
      }
      return a.page.relativePath.localeCompare(b.page.relativePath);
    });

  const deduped = dedupByEmbedding(scored, config.dedupThreshold);
  const limited = deduped.slice(0, options.limit);

  return {
    results: limited,
    indexStatus,
    candidatePool: scored.length
  };
}
