import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildHybridIndex } from "../src/hybrid-index.js";
import {
  EmbedderUnavailableError,
  type Embedder,
  type EmbeddingTextRole
} from "../src/embedder.js";
import { writeMarkdownFile } from "../src/markdown.js";
import { formatSearchResponse } from "../src/output.js";
import { searchWikiMemory } from "../src/search.js";

interface PathBiasedEmbedderOptions {
  modelId?: string;
  failure?: boolean;
  /**
   * Map from substring → axis index that should be activated for any text
   * containing that substring. Used to make hybrid retrieval deterministic.
   */
  axes: Array<{ match: string; axis: number }>;
  dimensions?: number;
  capturedQueries?: Array<{ texts: string[]; role: EmbeddingTextRole }>;
}

function createPathBiasedEmbedder(options: PathBiasedEmbedderOptions): Embedder {
  const dimensions = options.dimensions ?? 6;
  const modelId = options.modelId ?? "test/path-biased";
  return {
    modelId,
    dimensions,
    async embed(texts, role) {
      options.capturedQueries?.push({ texts: [...texts], role });
      if (options.failure) {
        throw new EmbedderUnavailableError("synthetic embedder failure");
      }
      return texts.map((text) => {
        const data = new Float32Array(dimensions);
        for (const axis of options.axes) {
          if (text.toLowerCase().includes(axis.match.toLowerCase())) {
            data[axis.axis] = 1;
          }
        }
        // Normalize so cosine equals dot product.
        let norm = 0;
        for (let i = 0; i < dimensions; i += 1) {
          norm += data[i] * data[i];
        }
        norm = Math.sqrt(norm);
        if (norm === 0) {
          // Provide a tiny default so the vector is non-zero but irrelevant.
          data[dimensions - 1] = 1;
        } else {
          for (let i = 0; i < dimensions; i += 1) {
            data[i] /= norm;
          }
        }
        return data;
      });
    }
  };
}

async function tempProject(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "aiwiki-search-"));
}

async function setupWiki(rootDir: string): Promise<void> {
  await mkdir(path.join(rootDir, ".aiwiki"), {
    recursive: true
  });
  await writeFile(
    path.join(rootDir, ".aiwiki", "config.json"),
    `${JSON.stringify({ projectName: "demo" }, null, 2)}\n`,
    "utf8"
  );
  await mkdir(path.join(rootDir, ".aiwiki", "wiki", "modules"), {
    recursive: true
  });
  await mkdir(path.join(rootDir, ".aiwiki", "wiki", "pitfalls"), {
    recursive: true
  });
  await mkdir(path.join(rootDir, ".aiwiki", "wiki", "decisions"), {
    recursive: true
  });

  await writeMarkdownFile(
    path.join(rootDir, ".aiwiki", "wiki", "modules", "payment.md"),
    {
      type: "module",
      title: "Payment",
      modules: ["payment"],
      files: ["src/lib/stripe.ts"]
    },
    "# Module: Payment\n\nStripe webhook and billing flows live here.\n"
  );

  await writeMarkdownFile(
    path.join(rootDir, ".aiwiki", "wiki", "pitfalls", "stripe-raw-body.md"),
    {
      type: "pitfall",
      title: "Stripe webhook raw body",
      modules: ["payment"],
      files: ["src/app/api/stripe/webhook/route.ts"],
      severity: "critical",
      encountered_count: 3
    },
    "# Pitfall: Stripe webhook raw body\n\nVerify the raw Stripe body before JSON parsing.\n"
  );

  await writeMarkdownFile(
    path.join(rootDir, ".aiwiki", "wiki", "decisions", "old-stripe.md"),
    {
      type: "decision",
      title: "Old Stripe handler",
      modules: ["payment"],
      status: "deprecated"
    },
    "# Decision: Old Stripe handler\n\nStripe webhook handling used an older route.\n"
  );
}

describe("searchWikiMemory", () => {
  it("scores title, frontmatter, path, body, severity, and encountered count", async () => {
    const rootDir = await tempProject();
    await setupWiki(rootDir);

    const response = await searchWikiMemory(rootDir, "stripe webhook");

    expect(response.results[0]?.title).toBe("Stripe webhook raw body");
    expect(response.results[0]?.matchedFields).toContain("title");
    expect(response.results[0]?.matchedFields).toContain("frontmatter");
    expect(response.results[0]?.matchedFields).toContain("body");
    expect(response.results[0]?.score).toBeGreaterThan(
      response.results[1]?.score ?? 0
    );
  });

  it("filters by wiki page type", async () => {
    const rootDir = await tempProject();
    await setupWiki(rootDir);

    const response = await searchWikiMemory(rootDir, "stripe", {
      type: "decision"
    });

    expect(response.results).toHaveLength(1);
    expect(response.results[0]?.page.frontmatter.type).toBe("decision");
  });

  it("returns empty results for an empty wiki or no matches", async () => {
    const rootDir = await tempProject();

    const response = await searchWikiMemory(rootDir, "missing");

    expect(response).toEqual({
      query: "missing",
      results: [],
      source: "markdown"
    });
    expect(formatSearchResponse(response, "markdown")).toContain(
      "Search scope: `.aiwiki/wiki` memory only"
    );
  });

  it("formats markdown and json output", async () => {
    const rootDir = await tempProject();
    await setupWiki(rootDir);
    const response = await searchWikiMemory(rootDir, "stripe", { limit: 1 });

    expect(formatSearchResponse(response, "markdown")).toContain(
      "# AIWiki Search Results"
    );

    const json = JSON.parse(formatSearchResponse(response, "json")) as {
      query: string;
      results: Array<{ title: string }>;
    };

    expect(json.query).toBe("stripe");
    expect(json.results[0]?.title).toBe("Stripe webhook raw body");
  });

  it("makes indexed-search fallback explicit when the SQLite index is missing", async () => {
    const rootDir = await tempProject();
    await setupWiki(rootDir);

    const response = await searchWikiMemory(rootDir, "stripe", {
      useIndex: true
    });
    const markdown = formatSearchResponse(response, "markdown");

    expect(response.source).toBe("markdown");
    expect(response.indexStatus?.fresh).toBe(false);
    expect(markdown).toContain("Index usage: unavailable; scanned Markdown instead.");
  });

  it("preserves substring recall when indexed search uses FTS ranking", async () => {
    const rootDir = await tempProject();
    await mkdir(path.join(rootDir, ".aiwiki"), {
      recursive: true
    });
    await writeFile(
      path.join(rootDir, ".aiwiki", "config.json"),
      `${JSON.stringify({ projectName: "demo" }, null, 2)}\n`,
      "utf8"
    );
    await mkdir(path.join(rootDir, ".aiwiki", "wiki", "modules"), {
      recursive: true
    });
    await writeMarkdownFile(
      path.join(rootDir, ".aiwiki", "wiki", "modules", "auth.md"),
      {
        type: "module",
        title: "Authentication module",
        modules: ["auth"]
      },
      "# Authentication module\n\nSession login behavior.\n"
    );
    await buildHybridIndex(rootDir);

    const response = await searchWikiMemory(rootDir, "thenti", {
      useIndex: true
    });

    expect(response.source).toBe("sqlite");
    expect(response.indexStatus?.fresh).toBe(true);
    expect(response.results[0]?.title).toBe("Authentication module");
    expect(response.results[0]?.bm25).toBeUndefined();
  });

  it("matches Chinese titles, body text, and mixed Chinese/English queries", async () => {
    const rootDir = await tempProject();
    await mkdir(path.join(rootDir, ".aiwiki", "wiki", "modules"), {
      recursive: true
    });
    await writeMarkdownFile(
      path.join(rootDir, ".aiwiki", "wiki", "modules", "codex-workflow.md"),
      {
        type: "module",
        title: "Codex 编码工作流",
        modules: ["brief"],
        files: ["src/brief.ts"]
      },
      "# Codex 编码工作流\n\n这里记录中文任务、编码提示和本地 Markdown 工作流。\n"
    );

    const chinese = await searchWikiMemory(rootDir, "编码 工作流");
    const compactChinese = await searchWikiMemory(rootDir, "编码工作流");
    const mixed = await searchWikiMemory(rootDir, "Codex 编码 工作流");

    expect(chinese.results[0]?.title).toBe("Codex 编码工作流");
    expect(compactChinese.results[0]?.title).toBe("Codex 编码工作流");
    expect(chinese.results[0]?.matchedFields).toContain("title");
    expect(mixed.results[0]?.page.frontmatter.files).toContain("src/brief.ts");
    expect(formatSearchResponse(chinese, "markdown")).toContain("Codex 编码工作流");
    expect(formatSearchResponse(chinese, "json")).toContain("编码工作流");
  });

  it("normalizes Unicode width and ignores single-character CJK noise", async () => {
    const rootDir = await tempProject();
    await mkdir(path.join(rootDir, ".aiwiki", "wiki", "modules"), {
      recursive: true
    });
    await writeMarkdownFile(
      path.join(rootDir, ".aiwiki", "wiki", "modules", "ai-workflow.md"),
      {
        type: "module",
        title: "AI 编码工作流"
      },
      "# AI 编码工作流\n\nAI coding memory.\n"
    );

    const normalized = await searchWikiMemory(rootDir, "ＡＩ 编码");
    const singleCharacter = await searchWikiMemory(rootDir, "编");

    expect(normalized.results[0]?.title).toBe("AI 编码工作流");
    expect(singleCharacter.results).toHaveLength(0);
  });

  it("expands common Chinese product queries to existing English memory", async () => {
    const rootDir = await tempProject();
    await mkdir(path.join(rootDir, ".aiwiki", "wiki", "pitfalls"), {
      recursive: true
    });
    await writeMarkdownFile(
      path.join(rootDir, ".aiwiki", "wiki", "pitfalls", "command-noise.md"),
      {
        type: "pitfall",
        title: "Command output noise",
        modules: ["agent"],
        severity: "medium"
      },
      "# Pitfall: Command output noise\n\nDaily commands should stay compact and keep advanced command lists later.\n"
    );

    const response = await searchWikiMemory(rootDir, "命令表面需要隐藏高级入口");

    expect(response.results[0]?.title).toBe("Command output noise");
    expect(response.results[0]?.matchedFields).toContain("title");
  });

  it("expands Chinese stale-memory queries to maintenance memory", async () => {
    const rootDir = await tempProject();
    await mkdir(path.join(rootDir, ".aiwiki", "wiki", "patterns"), {
      recursive: true
    });
    await writeMarkdownFile(
      path.join(rootDir, ".aiwiki", "wiki", "patterns", "stale-memory.md"),
      {
        type: "pattern",
        title: "Stale memory maintenance",
        modules: ["maintain"]
      },
      "# Pattern: Stale memory maintenance\n\nUse maintain when `last_updated` freshness warnings show wiki pages may be stale.\n"
    );

    const response = await searchWikiMemory(rootDir, "记忆不同步怎么办");

    expect(response.results[0]?.title).toBe("Stale memory maintenance");
    expect(response.results[0]?.matchedFields).toContain("title");
  });

  it("keeps path-heavy English queries useful", async () => {
    const rootDir = await tempProject();
    await setupWiki(rootDir);

    const response = await searchWikiMemory(
      rootDir,
      "src/app/api/stripe/webhook/route.ts"
    );

    expect(response.results[0]?.title).toBe("Stripe webhook raw body");
    expect(response.results[0]?.matchedFields).toContain("frontmatter");
  });
});

describe("searchWikiMemory hybrid mode", () => {
  it("returns hybrid results when an embedder is supplied and the index is fresh", async () => {
    const rootDir = await tempProject();
    await setupWiki(rootDir);

    const embedder = createPathBiasedEmbedder({
      axes: [
        { match: "raw body", axis: 0 },
        { match: "verify", axis: 0 },
        { match: "billing", axis: 1 },
        { match: "stripe", axis: 2 },
        { match: "webhook", axis: 2 }
      ]
    });

    await buildHybridIndex(rootDir, { embedder });

    // Query intentionally biases toward "raw body" so the cosine path lifts
    // the dedicated pitfall page above the broader payment module page.
    const response = await searchWikiMemory(rootDir, "stripe raw body verification", {
      useIndex: true,
      embedderFactory: () => embedder
    });

    expect(response.source).toBe("hybrid");
    expect(response.results[0]?.title).toBe("Stripe webhook raw body");
    expect(response.results[0]?.cosine).toBeGreaterThan(0.5);
    expect(response.indexStatus?.embeddingsFresh).toBe(true);
  });

  it("recalls memory by semantic similarity even with no keyword overlap", async () => {
    const rootDir = await tempProject();
    await mkdir(path.join(rootDir, ".aiwiki"), { recursive: true });
    await writeFile(
      path.join(rootDir, ".aiwiki", "config.json"),
      `${JSON.stringify({ projectName: "demo" }, null, 2)}\n`,
      "utf8"
    );
    await mkdir(path.join(rootDir, ".aiwiki", "wiki", "modules"), {
      recursive: true
    });
    await writeMarkdownFile(
      path.join(rootDir, ".aiwiki", "wiki", "modules", "auth.md"),
      {
        type: "module",
        title: "Authentication",
        summary: "Session storage and login flow.",
        modules: ["auth"],
        files: ["src/auth/session.ts"]
      },
      "# Module: Authentication\n\nSession storage and login flow live here.\n"
    );
    await writeMarkdownFile(
      path.join(rootDir, ".aiwiki", "wiki", "modules", "billing.md"),
      {
        type: "module",
        title: "Billing",
        summary: "Stripe integration.",
        modules: ["billing"],
        files: ["src/billing/stripe.ts"]
      },
      "# Module: Billing\n\nStripe integration lives here.\n"
    );

    const embedder = createPathBiasedEmbedder({
      axes: [
        { match: "auth", axis: 0 },
        { match: "session", axis: 0 },
        { match: "login", axis: 0 },
        { match: "权限", axis: 0 },
        { match: "登录", axis: 0 },
        { match: "billing", axis: 1 },
        { match: "stripe", axis: 1 }
      ]
    });

    await buildHybridIndex(rootDir, { embedder });

    // Pure Chinese query that has zero lexical overlap with the wiki pages.
    const response = await searchWikiMemory(rootDir, "用户登录与权限会话管理", {
      useIndex: true,
      embedderFactory: () => embedder
    });

    expect(response.source).toBe("hybrid");
    expect(response.results[0]?.title).toBe("Authentication");
    expect(response.results[0]?.cosine).toBeGreaterThan(0.5);
  });

  it("falls back to BM25 when the embedder fails", async () => {
    const rootDir = await tempProject();
    await setupWiki(rootDir);

    const embedderForIndex = createPathBiasedEmbedder({
      axes: [
        { match: "stripe", axis: 0 },
        { match: "webhook", axis: 0 }
      ]
    });
    await buildHybridIndex(rootDir, { embedder: embedderForIndex });

    const failingEmbedder = createPathBiasedEmbedder({
      failure: true,
      axes: []
    });

    const response = await searchWikiMemory(rootDir, "stripe webhook", {
      useIndex: true,
      embedderFactory: () => failingEmbedder
    });

    expect(response.source).toBe("sqlite");
    expect(response.results[0]?.title).toBe("Stripe webhook raw body");
    expect(response.semanticUnavailableReason).toBeDefined();
  });

  it("falls back to BM25 when embeddings are missing from the index", async () => {
    const rootDir = await tempProject();
    await setupWiki(rootDir);
    // Build without an embedder → no embeddings on disk.
    await buildHybridIndex(rootDir);

    const embedder = createPathBiasedEmbedder({
      axes: [{ match: "stripe", axis: 0 }]
    });

    const response = await searchWikiMemory(rootDir, "stripe webhook", {
      useIndex: true,
      embedderFactory: () => embedder
    });

    expect(response.source).toBe("sqlite");
    expect(response.results[0]?.title).toBe("Stripe webhook raw body");
    expect(response.semanticUnavailableReason).toContain("fresh embeddings");
  });

  it("refuses hybrid retrieval when the index uses a different model", async () => {
    const rootDir = await tempProject();
    await setupWiki(rootDir);

    const oldModelEmbedder = createPathBiasedEmbedder({
      modelId: "test/old-model",
      axes: [{ match: "stripe", axis: 0 }]
    });
    await buildHybridIndex(rootDir, { embedder: oldModelEmbedder });

    const newModelEmbedder = createPathBiasedEmbedder({
      modelId: "test/new-model",
      axes: [{ match: "stripe", axis: 0 }]
    });

    const response = await searchWikiMemory(rootDir, "stripe", {
      useIndex: true,
      embedderFactory: () => newModelEmbedder
    });

    expect(response.source).toBe("sqlite");
    expect(response.semanticUnavailableReason).toBeDefined();
  });

  it("respects mode=bm25 even when an embedder is available", async () => {
    const rootDir = await tempProject();
    await setupWiki(rootDir);
    const embedder = createPathBiasedEmbedder({
      axes: [{ match: "stripe", axis: 0 }]
    });
    await buildHybridIndex(rootDir, { embedder });

    const response = await searchWikiMemory(rootDir, "stripe", {
      useIndex: true,
      mode: "bm25",
      embedderFactory: () => embedder
    });

    expect(response.source).toBe("sqlite");
    expect(response.results[0]?.cosine).toBeUndefined();
  });

  it("respects mode=markdown to bypass the SQLite index entirely", async () => {
    const rootDir = await tempProject();
    await setupWiki(rootDir);
    await buildHybridIndex(rootDir);

    const response = await searchWikiMemory(rootDir, "stripe", {
      mode: "markdown"
    });

    expect(response.source).toBe("markdown");
    expect(response.indexStatus).toBeUndefined();
  });

  it("dedups near-identical pages using vector similarity", async () => {
    const rootDir = await tempProject();
    await mkdir(path.join(rootDir, ".aiwiki"), { recursive: true });
    await writeFile(
      path.join(rootDir, ".aiwiki", "config.json"),
      `${JSON.stringify({ projectName: "demo" }, null, 2)}\n`,
      "utf8"
    );
    await mkdir(path.join(rootDir, ".aiwiki", "wiki", "modules"), {
      recursive: true
    });
    // Three module pages with near-identical embeddings (same axis activation),
    // so a sane hybrid implementation should not return all three on top.
    for (const id of ["a", "b", "c"]) {
      await writeMarkdownFile(
        path.join(rootDir, ".aiwiki", "wiki", "modules", `dup-${id}.md`),
        {
          type: "module",
          title: `Stripe webhook handler ${id}`,
          modules: ["payment"],
          files: [`src/lib/stripe-${id}.ts`]
        },
        `# Module: Stripe webhook ${id}\n\nDuplicate stripe webhook content body.\n`
      );
    }

    const embedder = createPathBiasedEmbedder({
      axes: [
        { match: "stripe", axis: 0 },
        { match: "webhook", axis: 0 }
      ]
    });
    await buildHybridIndex(rootDir, { embedder });

    const response = await searchWikiMemory(rootDir, "stripe webhook", {
      useIndex: true,
      embedderFactory: () => embedder,
      limit: 3
    });

    // With a 0.92 dedup threshold the three near-identical embeddings collapse
    // to a single representative result.
    expect(response.source).toBe("hybrid");
    expect(response.results.length).toBeLessThan(3);
    expect(response.results.length).toBeGreaterThanOrEqual(1);
  });
});
