import path from "node:path";
import { CACHE_DIR } from "./constants.js";
import { resolveProjectPath } from "./paths.js";

export const DEFAULT_EMBEDDING_MODEL = "Xenova/multilingual-e5-small";
export const DEFAULT_EMBEDDING_DIMENSIONS = 384;

export type EmbeddingTextRole = "query" | "passage";

export interface EmbedderOptions {
  rootDir: string;
  model?: string;
  cacheDir?: string;
  /**
   * Override the Hugging Face Hub host. Defaults to https://huggingface.co/.
   * Useful for users behind networks where the default endpoint is blocked or
   * throttled; common alternative is https://hf-mirror.com/.
   */
  remoteHost?: string;
}

export interface Embedder {
  readonly modelId: string;
  readonly dimensions: number;
  embed(texts: string[], role: EmbeddingTextRole): Promise<Float32Array[]>;
}

export class EmbedderUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "EmbedderUnavailableError";
    if (options?.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

interface FeatureExtractionPipeline {
  (
    texts: string[],
    options: { pooling: "mean" | "cls" | "none"; normalize: boolean }
  ): Promise<{
    data: Float32Array;
    dims: number[];
    tolist?: () => number[][];
  }>;
}

interface TransformersModule {
  pipeline: (
    task: "feature-extraction",
    model: string,
    options?: Record<string, unknown>
  ) => Promise<FeatureExtractionPipeline>;
  env: {
    cacheDir?: string;
    allowLocalModels?: boolean;
    allowRemoteModels?: boolean;
    localModelPath?: string;
    remoteHost?: string;
  };
}

type TransformersLoader = () => Promise<TransformersModule>;

interface EmbedderInstance extends Embedder {
  pipelinePromise: Promise<FeatureExtractionPipeline>;
}

const cachedEmbedders = new Map<string, EmbedderInstance>();

let transformersLoaderOverride: TransformersLoader | undefined;

/** Test seam: replace the module loader. Restore by calling with `undefined`. */
export function setTransformersLoaderForTesting(
  loader: TransformersLoader | undefined
): void {
  transformersLoaderOverride = loader;
  cachedEmbedders.clear();
}

/** Test seam: drop singleton state between cases. */
export function resetEmbedderCacheForTesting(): void {
  cachedEmbedders.clear();
}

async function importTransformers(): Promise<TransformersModule> {
  try {
    if (transformersLoaderOverride) {
      return await transformersLoaderOverride();
    }

    const mod = (await import("@huggingface/transformers")) as TransformersModule;
    return mod;
  } catch (error) {
    throw new EmbedderUnavailableError(
      "Failed to load @huggingface/transformers. Reinstall dependencies or disable semantic retrieval with `aiwiki config` (semantic.enabled = false).",
      { cause: error }
    );
  }
}

function makeCacheKey(rootDir: string, model: string): string {
  return `${path.resolve(rootDir)}::${model}`;
}

function modelCacheDir(rootDir: string, override?: string): string {
  if (override && override.trim().length > 0) {
    return path.resolve(override);
  }
  return resolveProjectPath(rootDir, CACHE_DIR, "models");
}

function applyE5Prefix(text: string, role: EmbeddingTextRole): string {
  const trimmed = text.trim();
  return role === "query" ? `query: ${trimmed}` : `passage: ${trimmed}`;
}

function tensorToFloat32Arrays(
  output: { data: Float32Array; dims: number[] },
  expectedCount: number
): Float32Array[] {
  const dims = output.dims ?? [];
  const total = output.data.length;
  const perRow = expectedCount > 0 ? Math.floor(total / expectedCount) : total;
  if (perRow <= 0 || perRow * expectedCount !== total) {
    throw new EmbedderUnavailableError(
      `Embedding output shape mismatch: data length ${total}, expected ${expectedCount} rows. Dims: ${JSON.stringify(dims)}.`
    );
  }
  const rows: Float32Array[] = [];
  for (let i = 0; i < expectedCount; i += 1) {
    const start = i * perRow;
    rows.push(output.data.slice(start, start + perRow));
  }
  return rows;
}

/**
 * Load (or reuse) a feature-extraction embedder. The pipeline is loaded lazily
 * on first call and cached per (rootDir, modelId) pair so repeated commands in
 * the same process do not pay the model-load cost twice.
 */
export async function loadEmbedder(options: EmbedderOptions): Promise<Embedder> {
  const modelId = options.model ?? DEFAULT_EMBEDDING_MODEL;
  const cacheKey = makeCacheKey(options.rootDir, modelId);
  const cached = cachedEmbedders.get(cacheKey);
  if (cached) {
    return cached;
  }

  const cacheDir = modelCacheDir(options.rootDir, options.cacheDir);

  const remoteHost = options.remoteHost?.trim();

  const pipelinePromise = (async () => {
    const transformers = await importTransformers();
    transformers.env.cacheDir = cacheDir;
    transformers.env.allowLocalModels = true;
    transformers.env.allowRemoteModels = true;
    if (remoteHost && remoteHost.length > 0) {
      // Allow users behind restrictive networks to point at a mirror such as
      // https://hf-mirror.com/ without changing code. Empty/undefined keeps
      // the upstream default of https://huggingface.co/.
      transformers.env.remoteHost = remoteHost.endsWith("/")
        ? remoteHost
        : `${remoteHost}/`;
    }

    try {
      return await transformers.pipeline("feature-extraction", modelId, {
        cache_dir: cacheDir
      });
    } catch (error) {
      const hostHint = remoteHost
        ? `Tried mirror "${remoteHost}". `
        : "Default endpoint is https://huggingface.co/. ";
      throw new EmbedderUnavailableError(
        `Failed to load embedding model "${modelId}". ${hostHint}If your network blocks Hugging Face Hub, set semantic.remoteHost in .aiwiki/config.json (for example, "https://hf-mirror.com/") or set semantic.enabled=false to skip semantic retrieval.`,
        { cause: error }
      );
    }
  })();

  // Attach a noop catch so an early rejection (before any caller awaits embed)
  // does not surface as an unhandled-rejection process crash. The real
  // rejection is still propagated through the original pipelinePromise.
  pipelinePromise.catch(() => {
    /* swallow; embed() will rethrow when called */
  });

  const instance: EmbedderInstance = {
    modelId,
    dimensions: DEFAULT_EMBEDDING_DIMENSIONS,
    pipelinePromise,
    async embed(texts, role) {
      if (texts.length === 0) {
        return [];
      }
      const pipeline = await pipelinePromise;
      const inputs = texts.map((text) => applyE5Prefix(text, role));
      const output = await pipeline(inputs, {
        pooling: "mean",
        normalize: true
      });
      return tensorToFloat32Arrays(output, inputs.length);
    }
  };

  cachedEmbedders.set(cacheKey, instance);
  return instance;
}

/**
 * Cosine similarity for two L2-normalized vectors. The embedder is configured
 * to produce normalized output, so this collapses to a dot product.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(
      `Cannot compare embeddings of different dimensions: ${a.length} vs ${b.length}.`
    );
  }
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
  }
  return dot;
}

/** Pack a Float32Array embedding into a SQLite BLOB-friendly Buffer. */
export function embeddingToBuffer(embedding: Float32Array): Buffer {
  return Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
}

/** Read a Float32Array embedding back from a SQLite BLOB. */
export function embeddingFromBuffer(buffer: Buffer): Float32Array {
  const copy = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(copy).set(new Uint8Array(buffer));
  return new Float32Array(copy);
}
