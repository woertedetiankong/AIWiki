import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildHybridIndex } from "../src/hybrid-index.js";
import { writeMarkdownFile } from "../src/markdown.js";
import { formatSearchResponse } from "../src/output.js";
import { searchWikiMemory } from "../src/search.js";

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
