import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { generateCodexRunbook } from "../src/codex.js";
import { initAIWiki } from "../src/init.js";
import { writeMarkdownFile } from "../src/markdown.js";

const execFileAsync = promisify(execFile);

async function tempProject(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "aiwiki-codex-"));
}

async function addCodexMemory(rootDir: string): Promise<void> {
  await mkdir(path.join(rootDir, ".aiwiki", "wiki", "modules"), { recursive: true });
  await writeMarkdownFile(
    path.join(rootDir, ".aiwiki", "wiki", "modules", "search.md"),
    {
      type: "module",
      title: "Search",
      modules: ["search"],
      files: ["src/search.ts"]
    },
    "# Search\n\nSearch helps coding agents retrieve project memory.\n"
  );
}

describe("generateCodexRunbook", () => {
  it("generates a no-write Codex maintenance runbook", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await addCodexMemory(rootDir);
    await mkdir(path.join(rootDir, "src"), { recursive: true });
    await writeFile(path.join(rootDir, "src", "search.ts"), "export const search = true;\n", "utf8");
    const initialLog = await readFile(path.join(rootDir, ".aiwiki", "log.md"), "utf8");
    const initialEvals = await readFile(
      path.join(rootDir, ".aiwiki", "evals", "brief-cases.jsonl"),
      "utf8"
    );

    const result = await generateCodexRunbook(rootDir, "improve search memory");
    const parsed = JSON.parse(result.json) as {
      commands: { start: string[]; afterEditing: string[]; memoryReview: string[] };
      guardTargets: string[];
    };

    expect(result.markdown).toContain("# Codex AIWiki Runbook");
    expect(result.markdown).toContain("The user only needs to describe the requirement");
    expect(parsed.commands.start).toContain('aiwiki agent "improve search memory"');
    expect(parsed.guardTargets).toContain("src/search.ts");
    expect(parsed.commands.afterEditing).toContain("aiwiki reflect --from-git-diff --read-only");
    expect(parsed.commands.afterEditing).toContain("aiwiki doctor");
    expect(parsed.commands.memoryReview.join("\n")).toContain("Do not run apply --confirm");
    expect(result.markdown).toContain("Report `aiwiki doctor` next actions");
    expect(await readFile(path.join(rootDir, ".aiwiki", "log.md"), "utf8")).toBe(initialLog);
    expect(await readFile(path.join(rootDir, ".aiwiki", "evals", "brief-cases.jsonl"), "utf8")).toBe(initialEvals);
  });

  it("exposes the codex command through the CLI", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await addCodexMemory(rootDir);
    await mkdir(path.join(rootDir, "src"), { recursive: true });
    await writeFile(path.join(rootDir, "src", "search.ts"), "export const search = true;\n", "utf8");
    const cliPath = path.resolve("src", "cli.ts");
    const tsxLoader = pathToFileURL(
      path.resolve("node_modules", "tsx", "dist", "loader.mjs")
    ).href;

    const { stdout } = await execFileAsync(
      process.execPath,
      ["--import", tsxLoader, cliPath, "codex", "improve search memory"],
      { cwd: rootDir }
    );

    expect(stdout).toContain("# Codex AIWiki Runbook");
    expect(stdout).toContain("aiwiki guard src/search.ts");
    expect(stdout).toContain("Final Response Checklist");
  });
});
