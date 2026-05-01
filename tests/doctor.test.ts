import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { doctorWiki } from "../src/doctor.js";
import { initAIWiki } from "../src/init.js";
import { writeMarkdownFile } from "../src/markdown.js";

const execFileAsync = promisify(execFile);

async function tempProject(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "aiwiki-doctor-"));
}

async function writeProjectFile(rootDir: string, relativePath: string, content: string): Promise<void> {
  const filePath = path.join(rootDir, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

describe("doctorWiki", () => {
  it("returns cold-start health guidance before AIWiki is initialized", async () => {
    const rootDir = await tempProject();

    const result = await doctorWiki(rootDir);

    expect(result.report.summary.pagesChecked).toBe(0);
    expect(result.report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "not_initialized" })
      ])
    );
    expect(result.markdown).toContain("aiwiki init --project-name");
  });

  it("summarizes memory health, stale pages, statuses, and promotion candidates", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await writeProjectFile(rootDir, "src/search.ts", "export const search = true;\n");
    await utimes(
      path.join(rootDir, "src", "search.ts"),
      new Date("2026-04-01T00:00:00Z"),
      new Date("2026-04-01T00:00:00Z")
    );
    await mkdir(path.join(rootDir, ".aiwiki", "wiki", "modules"), { recursive: true });
    await mkdir(path.join(rootDir, ".aiwiki", "wiki", "pitfalls"), { recursive: true });
    await writeMarkdownFile(
      path.join(rootDir, ".aiwiki", "wiki", "modules", "search.md"),
      {
        type: "module",
        title: "Search",
        status: "uncertain",
        modules: ["search"],
        files: ["src/search.ts"],
        last_updated: "2026-03-01"
      },
      "# Search\n\nSearch memory.\n"
    );
    await writeMarkdownFile(
      path.join(rootDir, ".aiwiki", "wiki", "pitfalls", "tokenizer.md"),
      {
        type: "pitfall",
        title: "Tokenizer misses Chinese",
        modules: ["search"],
        files: ["src/search.ts"],
        severity: "high",
        encountered_count: 3
      },
      "# Tokenizer misses Chinese\n\nKeep Unicode tokenization tested.\n"
    );

    const result = await doctorWiki(rootDir);

    expect(result.markdown).toContain("# AIWiki Doctor Report");
    expect(result.markdown).toContain("stale_referenced_file");
    expect(result.markdown).toContain("rule_promotion_candidate");
    expect(result.markdown).toContain("Review proposed or uncertain pages");
    const staleFindings = result.report.findings.filter(
      (finding) =>
        finding.code === "stale_referenced_file" &&
        finding.path === "wiki/modules/search.md"
    );
    expect(staleFindings).toHaveLength(1);
    expect(staleFindings[0]?.message).toContain("1 stale");
    expect(staleFindings[0]?.message).toContain("src/search.ts");
    expect(result.report.summary.staleWarnings).toBeGreaterThanOrEqual(1);
    expect(result.report.summary.rulePromotionCandidates).toBe(1);
    expect(result.report.summary.uncertainPages).toBe(1);
  });

  it("exposes doctor through the CLI", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    const cliPath = path.resolve("src", "cli.ts");
    const tsxLoader = pathToFileURL(
      path.resolve("node_modules", "tsx", "dist", "loader.mjs")
    ).href;

    const { stdout } = await execFileAsync(
      process.execPath,
      ["--import", tsxLoader, cliPath, "doctor"],
      { cwd: rootDir }
    );

    expect(stdout).toContain("# AIWiki Doctor Report");
    expect(stdout).toContain("Memory health looks clean");
    expect(await readFile(path.join(rootDir, ".aiwiki", "log.md"), "utf8")).toContain("# AIWiki Log");
  });
});
