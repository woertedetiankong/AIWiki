import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  buildHybridIndex,
  formatHybridIndexStatusMarkdown,
  getHybridIndexStatus,
  readIndexedWikiPages
} from "../src/hybrid-index.js";
import { writeMarkdownFile } from "../src/markdown.js";
import { formatSearchResponse } from "../src/output.js";
import { searchWikiMemory } from "../src/search.js";

async function tempProject(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "aiwiki-hybrid-index-"));
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

  await writeMarkdownFile(
    path.join(rootDir, ".aiwiki", "wiki", "modules", "payment.md"),
    {
      type: "module",
      title: "Payment",
      modules: ["payment"],
      files: ["src/lib/stripe.ts"],
      tags: ["billing"]
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
}

describe("hybrid wiki index", () => {
  it("refuses to build before AIWiki is initialized", async () => {
    const rootDir = await tempProject();
    await mkdir(path.join(rootDir, ".aiwiki", "wiki", "modules"), {
      recursive: true
    });

    await expect(buildHybridIndex(rootDir)).rejects.toThrow("AIWiki is not initialized");
    const status = await getHybridIndexStatus(rootDir);

    expect(status.initialized).toBe(false);
    expect(formatHybridIndexStatusMarkdown(status)).toContain(
      "aiwiki init --project-name <name>"
    );
  });

  it("builds a SQLite index and JSONL snapshot from Markdown wiki pages", async () => {
    const rootDir = await tempProject();
    await setupWiki(rootDir);

    const result = await buildHybridIndex(rootDir);

    const dbStat = await stat(result.dbPath);
    expect(dbStat.size).toBeGreaterThan(0);
    expect(result.jsonlPath).toBeDefined();
    expect(result.pageCount).toBe(2);

    const jsonl = await readFile(result.jsonlPath ?? "", "utf8");
    expect(jsonl).toContain("\"relativePath\":\"modules/payment.md\"");
    expect(jsonl).toContain("\"relativePath\":\"pitfalls/stripe-raw-body.md\"");

    const status = await getHybridIndexStatus(rootDir);
    expect(status.dbExists).toBe(true);
    expect(status.jsonlExists).toBe(true);
    expect(status.initialized).toBe(true);
    expect(status.fresh).toBe(true);
    expect(status.pageCount).toBe(2);
    expect(status.sourcePageCount).toBe(2);
    expect(status.schemaVersion).toBe("1");
  });

  it("can hydrate indexed pages and search from the SQLite index", async () => {
    const rootDir = await tempProject();
    await setupWiki(rootDir);
    await buildHybridIndex(rootDir);

    const pages = await readIndexedWikiPages(rootDir);
    expect(pages?.map((page) => page.relativePath)).toEqual([
      "modules/payment.md",
      "pitfalls/stripe-raw-body.md"
    ]);

    const response = await searchWikiMemory(rootDir, "stripe webhook", {
      useIndex: true
    });

    expect(response.source).toBe("sqlite");
    expect(response.indexStatus?.fresh).toBe(true);
    expect(response.results[0]?.title).toBe("Stripe webhook raw body");
    expect(response.results[0]?.bm25).toEqual(expect.any(Number));
    expect(formatSearchResponse(response, "markdown")).toContain("Index fresh: yes");
  });

  it("falls back to Markdown search when the SQLite index is stale", async () => {
    const rootDir = await tempProject();
    await setupWiki(rootDir);
    await buildHybridIndex(rootDir);

    await writeMarkdownFile(
      path.join(rootDir, ".aiwiki", "wiki", "modules", "payment.md"),
      {
        type: "module",
        title: "Payment",
        modules: ["payment"],
        files: ["src/lib/stripe.ts"],
        tags: ["billing"]
      },
      "# Module: Payment\n\nACH payouts are documented after the index was built.\n"
    );

    const response = await searchWikiMemory(rootDir, "ACH payouts", {
      useIndex: true
    });

    expect(response.source).toBe("markdown");
    expect(response.indexStatus?.fresh).toBe(false);
    expect(response.results[0]?.title).toBe("Payment");
    expect(response.results[0]?.bm25).toBeUndefined();
  });

  it("falls back to Markdown search when the SQLite index is corrupt", async () => {
    const rootDir = await tempProject();
    await setupWiki(rootDir);
    const result = await buildHybridIndex(rootDir);
    await writeFile(result.dbPath, "not a sqlite database", "utf8");

    const response = await searchWikiMemory(rootDir, "stripe webhook", {
      useIndex: true
    });

    expect(response.source).toBe("markdown");
    expect(response.indexStatus?.fresh).toBe(false);
    expect(response.indexStatus?.error).toBeDefined();
    expect(response.results[0]?.title).toBe("Stripe webhook raw body");
  });

  it("falls back to Markdown search when the SQLite FTS table drifts", async () => {
    const rootDir = await tempProject();
    await setupWiki(rootDir);
    const result = await buildHybridIndex(rootDir);
    const db = new Database(result.dbPath);
    try {
      db.prepare("DELETE FROM wiki_pages_fts").run();
    } finally {
      db.close();
    }

    const status = await getHybridIndexStatus(rootDir);
    const response = await searchWikiMemory(rootDir, "stripe webhook", {
      useIndex: true
    });

    expect(status.fresh).toBe(false);
    expect(status.error).toContain("SQLite FTS table drift");
    expect(response.source).toBe("markdown");
    expect(response.results[0]?.title).toBe("Stripe webhook raw body");
  });

  it("reports stale, missing, and extra index pages", async () => {
    const rootDir = await tempProject();
    await setupWiki(rootDir);
    await buildHybridIndex(rootDir);

    await writeMarkdownFile(
      path.join(rootDir, ".aiwiki", "wiki", "modules", "payment.md"),
      {
        type: "module",
        title: "Payment",
        modules: ["payment"],
        files: ["src/lib/stripe.ts"]
      },
      "# Module: Payment\n\nUpdated payment memory.\n"
    );
    await mkdir(path.join(rootDir, ".aiwiki", "wiki", "decisions"), {
      recursive: true
    });
    await writeMarkdownFile(
      path.join(rootDir, ".aiwiki", "wiki", "decisions", "new-choice.md"),
      {
        type: "decision",
        title: "New Choice",
        modules: ["payment"]
      },
      "# Decision: New Choice\n\nNew decision body.\n"
    );
    await rm(
      path.join(rootDir, ".aiwiki", "wiki", "pitfalls", "stripe-raw-body.md")
    );

    const status = await getHybridIndexStatus(rootDir);

    expect(status.fresh).toBe(false);
    expect(status.stalePages).toEqual(["modules/payment.md"]);
    expect(status.missingPages).toEqual(["decisions/new-choice.md"]);
    expect(status.extraPages).toEqual(["pitfalls/stripe-raw-body.md"]);
    expect(status.stalePageCount).toBe(1);
    expect(status.missingPageCount).toBe(1);
    expect(status.extraPageCount).toBe(1);
  });

  it("can skip JSONL export for local cache-only rebuilds", async () => {
    const rootDir = await tempProject();
    await setupWiki(rootDir);

    const result = await buildHybridIndex(rootDir, { exportJsonl: false });

    expect(result.exportedJsonl).toBe(false);
    expect(result.jsonlPath).toBeUndefined();
    const status = await getHybridIndexStatus(rootDir);
    expect(status.dbExists).toBe(true);
    expect(status.jsonlExists).toBe(false);
    expect(status.fresh).toBe(true);
  });
});
