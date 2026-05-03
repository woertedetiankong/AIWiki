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

async function initGitProject(rootDir: string): Promise<void> {
  await execFileAsync("git", ["init"], { cwd: rootDir });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], {
    cwd: rootDir
  });
  await execFileAsync("git", ["config", "user.name", "Test User"], {
    cwd: rootDir
  });
  await execFileAsync("git", ["add", "."], { cwd: rootDir });
  await execFileAsync("git", ["commit", "-m", "baseline"], { cwd: rootDir });
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
    expect(result.markdown).toContain("Do not ask the user to choose AIWiki commands");
    expect(parsed.commands.start).toContain("aiwiki prime");
    expect(parsed.commands.start).toContain("aiwiki agent 'improve search memory'");
    expect(result.markdown).toContain("Use `aiwiki task ready`");
    expect(parsed.guardTargets).toContain("src/search.ts");
    expect(parsed.commands.afterEditing).toContain("aiwiki reflect --from-git-diff --read-only");
    expect(parsed.commands.afterEditing).toContain("aiwiki doctor");
    expect(parsed.commands.memoryReview.join("\n")).toContain("Do not run apply --confirm");
    expect(result.markdown).toContain("Report `aiwiki doctor` next actions");
    expect(await readFile(path.join(rootDir, ".aiwiki", "log.md"), "utf8")).toBe(initialLog);
    expect(await readFile(path.join(rootDir, ".aiwiki", "evals", "brief-cases.jsonl"), "utf8")).toBe(initialEvals);
  });

  it("adds team-aware guidance without agent orchestration", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await addCodexMemory(rootDir);
    await mkdir(path.join(rootDir, "src"), { recursive: true });
    await writeFile(path.join(rootDir, "src", "search.ts"), "export const search = true;\n", "utf8");

    const result = await generateCodexRunbook(rootDir, "improve search memory", {
      team: true
    });
    const parsed = JSON.parse(result.json) as {
      team?: {
        enabled: boolean;
        roles: Array<{
          name: string;
          commands: string[];
          mustNot: string[];
        }>;
      };
    };

    expect(result.markdown).toContain("## Team Mode");
    expect(result.markdown).toContain("Codex operator checklist");
    expect(result.markdown).toContain("AIWiki does not create or manage agents");
    expect(result.markdown).toContain("## Implementer Agent");
    expect(result.markdown).toContain("Translate the user's natural-language request");
    expect(result.markdown).toContain("aiwiki task ready --format json");
    expect(result.markdown).toContain("blocked tasks require explicit `--force`");
    expect(result.markdown).toContain("## Reviewer Agent");
    expect(result.markdown).toContain("## Memory Steward Agent");
    expect(result.markdown).toContain("## Handoff Rules");
    expect(result.markdown).toContain("Record checkpoints after meaningful progress");
    expect(parsed.team?.enabled).toBe(true);
    expect(parsed.team?.roles.map((role) => role.name)).toEqual([
      "Implementer",
      "Reviewer",
      "Memory Steward"
    ]);
    expect(parsed.team?.roles.flatMap((role) => role.mustNot).join("\n")).toContain(
      "without user approval"
    );
  });

  it("shell-quotes task text in runbook commands", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });

    const result = await generateCodexRunbook(rootDir, "fix $(echo unsafe) and don't break quotes", {
      team: true
    });
    const commands = [
      ...result.runbook.commands.start,
      ...result.runbook.team!.roles.flatMap((role) => role.commands)
    ].join("\n");

    expect(commands).toContain(
      "aiwiki agent 'fix $(echo unsafe) and don'\\''t break quotes'"
    );
    expect(commands).not.toContain('aiwiki agent "fix $(echo unsafe)');
  });

  it("prioritizes dirty git files as guard targets", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await addCodexMemory(rootDir);
    await mkdir(path.join(rootDir, "src"), { recursive: true });
    await writeFile(path.join(rootDir, "src", "search.ts"), "export const search = true;\n", "utf8");
    await writeFile(path.join(rootDir, "src", "layout.tsx"), "export const layout = true;\n", "utf8");
    await initGitProject(rootDir);
    await writeFile(path.join(rootDir, "src", "layout.tsx"), "export const layout = false;\n", "utf8");
    await writeFile(path.join(rootDir, "src", "new-widget.tsx"), "export const widget = true;\n", "utf8");

    const result = await generateCodexRunbook(rootDir, "评估当前项目改动", {
      team: true
    });

    expect(result.runbook.guardTargets.slice(0, 2)).toEqual([
      "src/new-widget.tsx",
      "src/layout.tsx"
    ]);
    expect(result.markdown).toContain("aiwiki guard src/layout.tsx");
    expect(result.markdown).toContain("aiwiki guard src/new-widget.tsx");
  });

  it("keeps cold-start team runbooks on commands that can run before init", async () => {
    const rootDir = await tempProject();
    await writeFile(path.join(rootDir, "README.md"), "# Demo\n", "utf8");
    await initGitProject(rootDir);
    await writeFile(path.join(rootDir, "README.md"), "# Demo\n\nUpdated.\n", "utf8");

    const result = await generateCodexRunbook(rootDir, "评估当前项目改动", {
      team: true
    });

    expect(result.runbook.initialized).toBe(false);
    expect(result.runbook.commands.afterEditing).not.toContain("aiwiki lint");
    expect(result.runbook.commands.memoryReview.join("\n")).toContain("output plans require initialized AIWiki memory");
    expect(result.markdown).toContain("Task graph commands require initialized AIWiki memory");
    expect(result.markdown).not.toContain("Use `aiwiki task ready`");
    expect(result.markdown).toContain("aiwiki guard README.md");
  });

  it("falls back to representative language guard targets in cold-start projects", async () => {
    const rootDir = await tempProject();
    await mkdir(path.join(rootDir, "include", "project"), { recursive: true });
    await mkdir(path.join(rootDir, "lib"), { recursive: true });
    await writeFile(path.join(rootDir, "Makefile"), "all:\n\tcc lib/memdebug.c\n", "utf8");
    await writeFile(path.join(rootDir, "include", "project", "api.h"), "void copy(char *dst, char *src);\n", "utf8");
    await writeFile(path.join(rootDir, "lib", "memdebug.c"), "void *p = malloc(10);\n", "utf8");
    await initGitProject(rootDir);

    const result = await generateCodexRunbook(rootDir, "assess representative code change", {
      team: true
    });

    expect(result.runbook.initialized).toBe(false);
    expect(result.runbook.guardTargets).toEqual(
      expect.arrayContaining(["include/project/api.h", "lib/memdebug.c"])
    );
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

  it("exposes team mode through the CLI", async () => {
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
      ["--import", tsxLoader, cliPath, "codex", "improve search memory", "--team", "--format", "json"],
      { cwd: rootDir }
    );
    const parsed = JSON.parse(stdout) as {
      team?: {
        enabled: boolean;
        roles: Array<{ name: string }>;
      };
    };

    expect(parsed.team?.enabled).toBe(true);
    expect(parsed.team?.roles).toHaveLength(3);
  });
});
