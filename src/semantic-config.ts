import {
  loadEmbedder,
  type Embedder
} from "./embedder.js";
import type { EmbedderFactory } from "./search.js";
import type { SemanticSearchConfig } from "./semantic-search.js";
import type { AIWikiConfig } from "./types.js";

/**
 * Translate the AIWiki user config into the tuning knobs accepted by
 * `searchWikiMemory`. Returns `undefined` when semantic retrieval is disabled
 * so the caller can skip wiring an embedder factory entirely.
 */
export function semanticConfigFromAIWikiConfig(
  config: AIWikiConfig
): SemanticSearchConfig | undefined {
  if (!config.semantic.enabled) {
    return undefined;
  }
  return {
    vectorWeight: config.semantic.vectorWeight,
    bm25Weight: config.semantic.bm25Weight,
    minScore: config.semantic.minScore,
    lengthNormAnchor: config.semantic.lengthNormAnchor,
    dedupThreshold: config.semantic.dedupThreshold
  };
}

/**
 * Build an `EmbedderFactory` from the user config. Returns `undefined` when
 * semantic retrieval is disabled. The factory itself memoizes the embedder so
 * repeated `searchWikiMemory` calls in the same process pay the model load
 * cost only once.
 */
export function makeEmbedderFactory(
  rootDir: string,
  config: AIWikiConfig
): EmbedderFactory | undefined {
  if (!config.semantic.enabled) {
    return undefined;
  }
  let cached: Promise<Embedder> | undefined;
  return () => {
    if (!cached) {
      cached = loadEmbedder({
        rootDir,
        model: config.semantic.model,
        cacheDir: config.semantic.cacheDir,
        remoteHost: config.semantic.remoteHost
      });
    }
    return cached;
  };
}

/**
 * Resolve a concrete embedder for the index-building path. Unlike search,
 * `index build` should fail-soft: when semantic is disabled or the model
 * cannot be loaded, return `undefined` and let the caller build a BM25-only
 * index.
 */
export async function resolveIndexEmbedder(
  rootDir: string,
  config: AIWikiConfig
): Promise<Embedder | undefined> {
  if (!config.semantic.enabled) {
    return undefined;
  }
  try {
    return await loadEmbedder({
      rootDir,
      model: config.semantic.model,
      cacheDir: config.semantic.cacheDir,
      remoteHost: config.semantic.remoteHost
    });
  } catch {
    return undefined;
  }
}
