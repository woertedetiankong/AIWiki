import type { WikiPage, WikiPageType } from "./types.js";
import {
  getHybridIndexStatus,
  readIndexedWikiPages,
  searchIndexedWikiPages,
  type HybridIndexStatus
} from "./hybrid-index.js";
import {
  hybridSemanticSearch,
  type SemanticSearchConfig
} from "./semantic-search.js";
import type { Embedder } from "./embedder.js";
import { scanWikiPages } from "./wiki-store.js";

export type SearchMatchedField = "title" | "frontmatter" | "path" | "body";

export type SearchMode = "auto" | "bm25" | "hybrid" | "markdown";

export type SearchSource = "markdown" | "sqlite" | "hybrid";

export interface SearchResult {
  page: WikiPage;
  score: number;
  matchedFields: SearchMatchedField[];
  title: string;
  excerpt?: string;
  bm25?: number;
  cosine?: number;
}

export type EmbedderFactory = () =>
  | Promise<Embedder | undefined>
  | Embedder
  | undefined;

export interface SearchOptions {
  type?: WikiPageType;
  limit?: number;
  useIndex?: boolean;
  /**
   * Default `"auto"`. Forces the retrieval path:
   *   - `auto`     try hybrid → BM25 → markdown based on what is available
   *   - `hybrid`   require embedder + fresh embeddings; fall back if missing
   *   - `bm25`     skip semantic retrieval even when an embedder is available
   *   - `markdown` skip the SQLite index and scan Markdown directly
   */
  mode?: SearchMode;
  /**
   * Optional embedder factory. When provided and the on-disk embeddings are
   * fresh, hybrid retrieval is used. The factory may return `undefined` to
   * indicate semantic search should be skipped (e.g. config disabled it).
   */
  embedderFactory?: EmbedderFactory;
  semantic?: SemanticSearchConfig;
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
  source?: SearchSource;
  indexStatus?: HybridIndexStatus;
  semanticUnavailableReason?: string;
}

const DEFAULT_SEARCH_LIMIT = 10;

const SEVERITY_BONUS = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 2
} as const;

const CJK_PATTERN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const CJK_RUN_PATTERN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu;

const QUERY_SYNONYMS: Array<{
  match: RegExp;
  tokens: string[];
}> = [
  { match: /命令|指令|入口|命令行|cli/iu, tokens: ["command", "cli"] },
  { match: /命令面|命令表面|入口面|指令面/iu, tokens: ["command", "surface"] },
  { match: /帮助|help/iu, tokens: ["help"] },
  { match: /隐藏|收束|降噪|噪音|太多/iu, tokens: ["hide", "hidden", "noise", "compact"] },
  { match: /删除|移除|去掉|精简/iu, tokens: ["delete", "remove", "prune"] },
  { match: /合并|整合|别名|迁移/iu, tokens: ["merge", "alias", "migration"] },
  { match: /搜索|检索|召回|查询/iu, tokens: ["search", "retrieval", "query"] },
  { match: /中文|汉字|cjk|unicode|编码/iu, tokens: ["chinese", "cjk", "unicode"] },
  { match: /工作流|流程|路径/iu, tokens: ["workflow", "path"] },
  { match: /记忆|知识|上下文/iu, tokens: ["memory", "context"] },
  {
    match: /过期|陈旧|过时|失效|不同步|没同步|未同步|stale/iu,
    tokens: ["stale", "freshness", "last_updated", "maintain", "maintenance"]
  },
  { match: /规则|约束|护栏|风险|踩坑/iu, tokens: ["rule", "guard", "risk", "pitfall"] },
  { match: /维护|体检|健康|检查/iu, tokens: ["maintenance", "doctor", "lint"] },
  { match: /测试|验证|回归/iu, tokens: ["test", "verification", "regression"] },
  { match: /笔记|原始记录|复盘|反思/iu, tokens: ["notes", "raw", "reflect"] }
];

function normalizeText(value: string): string {
  return value.normalize("NFKC").toLowerCase();
}

function isSingleCjkToken(token: string): boolean {
  const chars = Array.from(token);
  return chars.length === 1 && CJK_PATTERN.test(chars[0] ?? "");
}

function cjkTokens(value: string): string[] {
  const runs = value.match(CJK_RUN_PATTERN) ?? [];
  return runs.flatMap((run) => {
    const chars = Array.from(run);
    if (chars.length < 2) {
      return [];
    }
    if (chars.length === 2) {
      return [run];
    }

    return [
      run,
      ...chars.slice(0, -1).map((_, index) => `${chars[index]}${chars[index + 1]}`)
    ];
  });
}

function synonymTokens(query: string): string[] {
  return QUERY_SYNONYMS.flatMap((entry) =>
    entry.match.test(query) ? entry.tokens : []
  );
}

function tokenize(query: string): string[] {
  const normalizedQuery = normalizeText(query);
  const pathFriendlyTokens = normalizedQuery
    .split(/[^\p{Letter}\p{Number}_./-]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length > 0 && !isSingleCjkToken(token));

  return [...new Set([
    ...pathFriendlyTokens,
    ...cjkTokens(normalizedQuery),
    ...synonymTokens(normalizedQuery)
  ])];
}

function normalized(value: string): string {
  return normalizeText(value);
}

function extractTitle(page: WikiPage): string {
  if (page.frontmatter.title && page.frontmatter.title.trim().length > 0) {
    return page.frontmatter.title;
  }

  const heading = page.body
    .split("\n")
    .find((line) => line.trim().startsWith("#"));

  if (heading) {
    return heading.replace(/^#+\s*/, "").trim();
  }

  return page.relativePath;
}

function firstMatchingExcerpt(body: string, tokens: string[]): string | undefined {
  const lines = body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

  const match = lines.find((line) => {
    const value = normalized(line);
    return tokens.some((token) => value.includes(token));
  });

  return match ?? lines[0];
}

function addField(
  fields: Set<SearchMatchedField>,
  field: SearchMatchedField,
  haystack: string,
  tokens: string[],
  points: number
): number {
  const value = normalized(haystack);
  const matches = tokens.filter((token) => value.includes(token));
  if (matches.length === 0) {
    return 0;
  }

  fields.add(field);
  return points * matches.length;
}

function scorePage(
  page: WikiPage,
  tokens: string[],
  bm25?: number,
  cosine?: number
): SearchResult | undefined {
  const matchedFields = new Set<SearchMatchedField>();
  const title = extractTitle(page);
  const frontmatterText = JSON.stringify(page.frontmatter);
  let score = 0;

  score += addField(matchedFields, "title", title, tokens, 5);
  score += addField(matchedFields, "frontmatter", frontmatterText, tokens, 4);
  score += addField(matchedFields, "path", page.relativePath, tokens, 4);
  score += addField(matchedFields, "body", page.body, tokens, 2);

  if (score <= 0) {
    return undefined;
  }

  if (page.frontmatter.severity) {
    score += SEVERITY_BONUS[page.frontmatter.severity];
  }

  if (page.frontmatter.status === "deprecated") {
    score -= 5;
  }

  if (page.frontmatter.encountered_count) {
    score += Math.min(page.frontmatter.encountered_count, 3);
  }

  return {
    page,
    score,
    matchedFields: [...matchedFields],
    title,
    excerpt: firstMatchingExcerpt(page.body, tokens),
    bm25,
    cosine
  };
}

function rankMarkdownResults(results: SearchResult[], limit: number): SearchResult[] {
  return results
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      return a.page.relativePath.localeCompare(b.page.relativePath);
    })
    .slice(0, limit);
}

function searchMarkdownPages(
  pages: WikiPage[],
  tokens: string[],
  limit: number
): SearchResult[] {
  return rankMarkdownResults(
    pages
      .map((page) => scorePage(page, tokens))
      .filter((result): result is SearchResult => result !== undefined),
    limit
  );
}

function rankIndexedResults(results: SearchResult[], limit: number): SearchResult[] {
  return results
    .sort((a, b) => {
      if (a.bm25 !== undefined && b.bm25 === undefined) {
        return -1;
      }
      if (a.bm25 === undefined && b.bm25 !== undefined) {
        return 1;
      }
      if (a.bm25 !== undefined && b.bm25 !== undefined && a.bm25 !== b.bm25) {
        return a.bm25 - b.bm25;
      }

      if (b.score !== a.score) {
        return b.score - a.score;
      }

      return a.page.relativePath.localeCompare(b.page.relativePath);
    })
    .slice(0, limit);
}

async function resolveEmbedder(
  factory?: EmbedderFactory
): Promise<Embedder | undefined> {
  if (!factory) {
    return undefined;
  }
  try {
    return await Promise.resolve(factory());
  } catch {
    return undefined;
  }
}

interface HybridAttemptOutcome {
  response?: SearchResponse;
  reason?: string;
}

async function attemptHybridSearch(
  rootDir: string,
  query: string,
  tokens: string[],
  limit: number,
  options: SearchOptions
): Promise<HybridAttemptOutcome> {
  const embedder = await resolveEmbedder(options.embedderFactory);
  if (!embedder) {
    return { reason: "No embedder configured" };
  }

  let semanticResponse;
  try {
    semanticResponse = await hybridSemanticSearch(rootDir, query, {
      type: options.type,
      limit,
      tokens,
      embedder,
      semantic: options.semantic
    });
  } catch (error) {
    return {
      reason: error instanceof Error ? error.message : String(error)
    };
  }

  if (!semanticResponse) {
    return { reason: "Index is missing fresh embeddings" };
  }

  const results = semanticResponse.results
    .map((entry) => {
      const lex = scorePage(entry.page, tokens, entry.bm25, entry.cosine);
      if (lex) {
        return lex;
      }
      // No keyword overlap, but vector said it is relevant. Surface it with a
      // cosine-derived score so callers see a useful row instead of dropping.
      const title = extractTitle(entry.page);
      return {
        page: entry.page,
        score: Math.max(1, Math.round(entry.fusedScore * 10)),
        matchedFields: [],
        title,
        excerpt: firstMatchingExcerpt(entry.page.body, tokens),
        bm25: entry.bm25,
        cosine: entry.cosine
      } satisfies SearchResult;
    })
    .slice(0, limit);

  return {
    response: {
      query,
      results,
      source: "hybrid",
      indexStatus: semanticResponse.indexStatus
    }
  };
}

export async function searchWikiMemory(
  rootDir: string,
  query: string,
  options: SearchOptions = {}
): Promise<SearchResponse> {
  const tokens = tokenize(query);
  const limit = options.limit ?? DEFAULT_SEARCH_LIMIT;
  const mode: SearchMode = options.mode ?? "auto";

  if (tokens.length === 0 || limit <= 0) {
    return { query, results: [] };
  }

  if (mode === "markdown") {
    const pages = (await scanWikiPages(rootDir)).filter((page) =>
      options.type ? page.frontmatter.type === options.type : true
    );
    return {
      query,
      results: searchMarkdownPages(pages, tokens, limit),
      source: "markdown"
    };
  }

  // Backwards-compatible default: only consult the SQLite index when the
  // caller opts in (explicit useIndex / mode / embedderFactory). Old callers
  // without those signals get the same Markdown-scan behavior as before.
  const wantsIndex =
    options.useIndex === true ||
    mode === "hybrid" ||
    (mode === "auto" &&
      options.useIndex !== false &&
      options.embedderFactory !== undefined);

  let indexStatus = wantsIndex
    ? await getHybridIndexStatus(rootDir)
    : undefined;
  let semanticUnavailableReason: string | undefined;

  if (
    wantsIndex &&
    indexStatus?.fresh &&
    (mode === "auto" || mode === "hybrid")
  ) {
    const outcome = await attemptHybridSearch(
      rootDir,
      query,
      tokens,
      limit,
      options
    );
    if (outcome.response) {
      return outcome.response;
    }
    semanticUnavailableReason = outcome.reason;
  }

  if (wantsIndex && indexStatus?.fresh) {
    try {
      const indexedResults = await searchIndexedWikiPages(rootDir, {
        type: options.type,
        limit: Math.max(limit * 4, limit),
        tokens
      });
      const indexedPages = await readIndexedWikiPages(rootDir);

      if (indexedResults && indexedPages) {
        const bm25ByPath = new Map(
          indexedResults.map((result) => [result.page.relativePath, result.bm25])
        );
        const pages = indexedPages.filter((page) => {
          return options.type ? page.frontmatter.type === options.type : true;
        });
        return {
          query,
          results: rankIndexedResults(
            pages
              .map((page) => scorePage(page, tokens, bm25ByPath.get(page.relativePath)))
              .filter((result): result is SearchResult => result !== undefined),
            limit
          ),
          source: "sqlite",
          indexStatus,
          semanticUnavailableReason
        };
      }
    } catch (error) {
      indexStatus = {
        ...indexStatus,
        fresh: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  const pages = (await scanWikiPages(rootDir)).filter((page) => {
    return options.type ? page.frontmatter.type === options.type : true;
  });

  const results = searchMarkdownPages(pages, tokens, limit);

  return {
    query,
    results,
    source: "markdown",
    indexStatus,
    semanticUnavailableReason
  };
}
