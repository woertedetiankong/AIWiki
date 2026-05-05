import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  cosineSimilarity,
  embeddingFromBuffer,
  embeddingToBuffer,
  EmbedderUnavailableError,
  loadEmbedder,
  resetEmbedderCacheForTesting,
  setTransformersLoaderForTesting,
  DEFAULT_EMBEDDING_MODEL
} from "../src/embedder.js";

interface CallRecord {
  inputs: string[];
  pooling: string;
  normalize: boolean;
}

interface FakeOptions {
  failOnLoad?: boolean;
  modelDimensions?: number;
  pipelineCalls?: CallRecord[];
  pipelineLoadCount?: { value: number };
  envCapture?: { cacheDir?: string };
}

function fakeTransformersLoader(options: FakeOptions = {}) {
  const dims = options.modelDimensions ?? 4;
  const calls = options.pipelineCalls ?? [];
  const loadCounter = options.pipelineLoadCount ?? { value: 0 };

  return async () => {
    if (options.failOnLoad) {
      throw new Error("synthetic transformers load failure");
    }

    const env = {
      cacheDir: undefined as string | undefined,
      allowLocalModels: false,
      allowRemoteModels: false,
      localModelPath: undefined as string | undefined
    };

    return {
      env,
      pipeline: async (
        _task: "feature-extraction",
        _model: string,
        opts?: Record<string, unknown>
      ) => {
        loadCounter.value += 1;
        if (options.envCapture) {
          options.envCapture.cacheDir = env.cacheDir ?? (opts?.cache_dir as string | undefined);
        }

        return async (
          texts: string[],
          pipelineOpts: { pooling: "mean" | "cls" | "none"; normalize: boolean }
        ) => {
          calls.push({
            inputs: [...texts],
            pooling: pipelineOpts.pooling,
            normalize: pipelineOpts.normalize
          });

          const data = new Float32Array(texts.length * dims);
          texts.forEach((text, rowIndex) => {
            // Deterministic per-text vector that is stable for the same input.
            const seed = Array.from(text).reduce(
              (sum, ch) => sum + ch.charCodeAt(0),
              0
            );
            let norm = 0;
            for (let col = 0; col < dims; col += 1) {
              const value = Math.sin(seed * (col + 1) * 0.13);
              data[rowIndex * dims + col] = value;
              norm += value * value;
            }
            norm = Math.sqrt(norm);
            if (norm > 0) {
              for (let col = 0; col < dims; col += 1) {
                data[rowIndex * dims + col] /= norm;
              }
            }
          });

          return {
            data,
            dims: [texts.length, dims]
          };
        };
      }
    };
  };
}

async function tempProject(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "aiwiki-embedder-"));
}

describe("embedder", () => {
  afterEach(() => {
    setTransformersLoaderForTesting(undefined);
    resetEmbedderCacheForTesting();
  });

  it("returns a Float32Array per input text", async () => {
    const calls: CallRecord[] = [];
    setTransformersLoaderForTesting(fakeTransformersLoader({ pipelineCalls: calls }));

    const embedder = await loadEmbedder({ rootDir: await tempProject() });
    const out = await embedder.embed(["hello world", "another"], "passage");

    expect(out).toHaveLength(2);
    expect(out[0]).toBeInstanceOf(Float32Array);
    expect(out[0].length).toBe(4);
    expect(out[1].length).toBe(4);
    expect(calls).toHaveLength(1);
  });

  it("applies E5 query/passage prefixes", async () => {
    const calls: CallRecord[] = [];
    setTransformersLoaderForTesting(fakeTransformersLoader({ pipelineCalls: calls }));

    const embedder = await loadEmbedder({ rootDir: await tempProject() });
    await embedder.embed(["payment guard"], "query");
    await embedder.embed(["payment guard"], "passage");

    expect(calls[0]?.inputs[0]).toBe("query: payment guard");
    expect(calls[1]?.inputs[0]).toBe("passage: payment guard");
  });

  it("requests mean pooling with normalization (cosine equals dot)", async () => {
    const calls: CallRecord[] = [];
    setTransformersLoaderForTesting(fakeTransformersLoader({ pipelineCalls: calls }));

    const embedder = await loadEmbedder({ rootDir: await tempProject() });
    await embedder.embed(["x"], "passage");

    expect(calls[0]).toMatchObject({ pooling: "mean", normalize: true });
  });

  it("caches the underlying pipeline across embed calls", async () => {
    const loadCounter = { value: 0 };
    setTransformersLoaderForTesting(
      fakeTransformersLoader({ pipelineLoadCount: loadCounter })
    );
    const rootDir = await tempProject();

    const a = await loadEmbedder({ rootDir });
    const b = await loadEmbedder({ rootDir });
    await a.embed(["one"], "passage");
    await b.embed(["two"], "passage");

    expect(loadCounter.value).toBe(1);
    expect(a).toBe(b);
  });

  it("uses .aiwiki/cache/models as the default model cache dir", async () => {
    const envCapture: { cacheDir?: string } = {};
    setTransformersLoaderForTesting(fakeTransformersLoader({ envCapture }));

    const rootDir = await tempProject();
    const embedder = await loadEmbedder({ rootDir });
    await embedder.embed(["warm up"], "passage");

    expect(envCapture.cacheDir).toBe(
      path.join(rootDir, ".aiwiki", "cache", "models")
    );
  });

  it("wraps load failures in EmbedderUnavailableError", async () => {
    setTransformersLoaderForTesting(fakeTransformersLoader({ failOnLoad: true }));

    const embedder = await loadEmbedder({ rootDir: await tempProject() });
    await expect(embedder.embed(["anything"], "passage")).rejects.toBeInstanceOf(
      EmbedderUnavailableError
    );
  });

  it("does not surface as an unhandled rejection when load fails before embed is awaited", async () => {
    setTransformersLoaderForTesting(fakeTransformersLoader({ failOnLoad: true }));

    const captured: unknown[] = [];
    const onUnhandled = (reason: unknown) => captured.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const embedder = await loadEmbedder({ rootDir: await tempProject() });
      // Intentionally do not call embed() right away — give Node a few ticks to
      // surface any unhandled rejection from the eager pipeline-load promise.
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));

      // Calling embed afterwards must still surface the original failure.
      await expect(embedder.embed(["x"], "passage")).rejects.toBeInstanceOf(
        EmbedderUnavailableError
      );
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }

    expect(captured).toHaveLength(0);
  });

  it("returns an empty array when given no inputs", async () => {
    setTransformersLoaderForTesting(fakeTransformersLoader());
    const embedder = await loadEmbedder({ rootDir: await tempProject() });
    expect(await embedder.embed([], "query")).toEqual([]);
  });

  it("encodes CJK input through prefixing without throwing", async () => {
    const calls: CallRecord[] = [];
    setTransformersLoaderForTesting(fakeTransformersLoader({ pipelineCalls: calls }));

    const embedder = await loadEmbedder({ rootDir: await tempProject() });
    const out = await embedder.embed(["支付安全护栏"], "query");

    expect(out[0].length).toBe(4);
    expect(calls[0]?.inputs[0]).toBe("query: 支付安全护栏");
  });

  it("exposes the configured model id", async () => {
    setTransformersLoaderForTesting(fakeTransformersLoader());

    const embedder = await loadEmbedder({ rootDir: await tempProject() });
    expect(embedder.modelId).toBe(DEFAULT_EMBEDDING_MODEL);
  });
});

describe("cosineSimilarity", () => {
  it("returns 1 for identical normalized vectors", () => {
    const a = new Float32Array([1, 0, 0, 0]);
    const b = new Float32Array([1, 0, 0, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 6);
  });

  it("returns 0 for orthogonal vectors", () => {
    const a = new Float32Array([1, 0, 0, 0]);
    const b = new Float32Array([0, 1, 0, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 6);
  });

  it("rejects vectors of different dimensions", () => {
    expect(() =>
      cosineSimilarity(new Float32Array([1, 0]), new Float32Array([1, 0, 0]))
    ).toThrow(/different dimensions/);
  });
});

describe("embedding buffer round-trip", () => {
  it("preserves the float values across BLOB encode/decode", () => {
    const original = new Float32Array([0.5, -0.25, 0.125, -0.0625]);
    const buf = embeddingToBuffer(original);
    const restored = embeddingFromBuffer(buf);

    expect(restored.length).toBe(original.length);
    for (let i = 0; i < original.length; i += 1) {
      expect(restored[i]).toBeCloseTo(original[i], 6);
    }
  });

  it("decouples decoded buffer from the source bytes", () => {
    const original = new Float32Array([1, 2, 3, 4]);
    const buf = embeddingToBuffer(original);
    const restored = embeddingFromBuffer(buf);
    buf[0] = 0xff;
    expect(restored[0]).toBe(1);
  });
});
