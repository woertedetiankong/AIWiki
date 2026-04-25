import { mkdir, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { writeMarkdownFile } from "../src/markdown.js";
import { formatSearchResponse } from "../src/output.js";
import { searchWikiMemory } from "../src/search.js";

async function tempProject(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "aiwiki-search-"));
}

async function setupWiki(rootDir: string): Promise<void> {
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

    await expect(searchWikiMemory(rootDir, "missing")).resolves.toEqual({
      query: "missing",
      results: []
    });
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
});
