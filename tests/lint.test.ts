import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initAIWiki } from "../src/init.js";
import { lintWiki } from "../src/lint.js";
import { writeMarkdownFile } from "../src/markdown.js";
import type { AIWikiConfig } from "../src/types.js";

async function tempProject(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "aiwiki-lint-"));
}

async function updateConfig(
  rootDir: string,
  patch: Partial<AIWikiConfig>
): Promise<void> {
  const configPath = path.join(rootDir, ".aiwiki", "config.json");
  const config = JSON.parse(await readFile(configPath, "utf8")) as AIWikiConfig;
  await writeFile(configPath, JSON.stringify({ ...config, ...patch }, null, 2), "utf8");
}

async function addLintMemory(rootDir: string): Promise<void> {
  const wikiDir = path.join(rootDir, ".aiwiki", "wiki");
  await mkdir(path.join(wikiDir, "pitfalls"), { recursive: true });
  await mkdir(path.join(wikiDir, "modules"), { recursive: true });

  await writeMarkdownFile(
    path.join(wikiDir, "pitfalls", "duplicate-a.md"),
    {
      type: "pitfall",
      title: "Duplicate Stripe Pitfall",
      modules: ["payment"],
      related_decisions: ["../decisions/missing.md"]
    },
    "# Duplicate Stripe Pitfall\n\nSee [[../patterns/missing.md]].\n"
  );

  await writeMarkdownFile(
    path.join(wikiDir, "pitfalls", "duplicate-b.md"),
    {
      type: "pitfall",
      title: "Duplicate Stripe Pitfall",
      modules: ["payment"]
    },
    "# Duplicate Stripe Pitfall\n\nSame title.\n"
  );

  await writeFile(
    path.join(wikiDir, "modules", "bad.md"),
    "---\ntype: not-real\n---\n# Bad\n",
    "utf8"
  );
}

describe("lintWiki", () => {
  it("reports frontmatter, broken links, duplicate pitfalls, index gaps, and missing high-risk modules", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await updateConfig(rootDir, { highRiskModules: ["auth"] });
    await addLintMemory(rootDir);

    const result = await lintWiki(rootDir);
    const codes = result.report.issues.map((issue) => issue.code);

    expect(codes).toContain("invalid_frontmatter");
    expect(codes).toContain("broken_link");
    expect(codes).toContain("duplicate_pitfall");
    expect(codes).toContain("index_missing_page");
    expect(codes).toContain("missing_high_risk_module_page");
    expect(result.report.summary.errors).toBeGreaterThan(0);
    expect(result.markdown).toContain("# AIWiki Lint Report");
  });

  it("formats json output", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });

    const result = await lintWiki(rootDir);
    const parsed = JSON.parse(result.json) as {
      summary: { pagesChecked: number };
    };

    expect(parsed.summary.pagesChecked).toBe(0);
  });
});
