import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { generateAgentContext } from "../src/agent.js";
import { initAIWiki } from "../src/init.js";
import { writeMarkdownFile } from "../src/markdown.js";

const execFileAsync = promisify(execFile);

async function tempProject(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "aiwiki-agent-"));
}

async function addAgentMemory(rootDir: string): Promise<void> {
  await mkdir(path.join(rootDir, ".aiwiki", "wiki", "modules"), { recursive: true });
  await writeMarkdownFile(
    path.join(rootDir, ".aiwiki", "wiki", "modules", "brief.md"),
    {
      type: "module",
      title: "Brief",
      modules: ["brief"],
      files: ["src/brief.ts"]
    },
    "# Brief\n\nBrief builds compact context for coding agents.\n"
  );
}

describe("generateAgentContext", () => {
  it("generates compact read-only agent context without log or eval writes", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await addAgentMemory(rootDir);
    await mkdir(path.join(rootDir, "src"), { recursive: true });
    await writeFile(path.join(rootDir, "src", "brief.ts"), "export const brief = true;\n", "utf8");
    const initialLog = await readFile(path.join(rootDir, ".aiwiki", "log.md"), "utf8");
    const initialEvals = await readFile(
      path.join(rootDir, ".aiwiki", "evals", "brief-cases.jsonl"),
      "utf8"
    );

    const result = await generateAgentContext(rootDir, "improve brief workflow");
    const parsed = JSON.parse(result.json) as {
      guardTargets: string[];
      nextCommands: string[];
    };

    expect(result.markdown).toContain("# AIWiki Agent Context");
    expect(result.markdown).toContain("Context lookup is read-only");
    expect(parsed.guardTargets).toContain("src/brief.ts");
    expect(parsed.nextCommands.join("\n")).toContain("aiwiki guard src/brief.ts");
    expect(await readFile(path.join(rootDir, ".aiwiki", "log.md"), "utf8")).toBe(initialLog);
    expect(await readFile(path.join(rootDir, ".aiwiki", "evals", "brief-cases.jsonl"), "utf8")).toBe(initialEvals);
  });

  it("exposes the agent command through the CLI", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await addAgentMemory(rootDir);
    await mkdir(path.join(rootDir, "src"), { recursive: true });
    await writeFile(path.join(rootDir, "src", "brief.ts"), "export const brief = true;\n", "utf8");
    const cliPath = path.resolve("src", "cli.ts");
    const tsxLoader = pathToFileURL(
      path.resolve("node_modules", "tsx", "dist", "loader.mjs")
    ).href;

    const { stdout } = await execFileAsync(
      process.execPath,
      ["--import", tsxLoader, cliPath, "agent", "improve brief workflow"],
      { cwd: rootDir }
    );

    expect(stdout).toContain("# AIWiki Agent Context");
    expect(stdout).toContain("aiwiki guard src/brief.ts");
  });

  it("exposes runbook mode through the agent command", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await addAgentMemory(rootDir);
    await mkdir(path.join(rootDir, "src"), { recursive: true });
    await writeFile(path.join(rootDir, "src", "brief.ts"), "export const brief = true;\n", "utf8");
    const cliPath = path.resolve("src", "cli.ts");
    const tsxLoader = pathToFileURL(
      path.resolve("node_modules", "tsx", "dist", "loader.mjs")
    ).href;

    const { stdout } = await execFileAsync(
      process.execPath,
      ["--import", tsxLoader, cliPath, "agent", "improve brief workflow", "--runbook"],
      { cwd: rootDir }
    );

    expect(stdout).toContain("# Codex AIWiki Runbook");
    expect(stdout).toContain("aiwiki guard src/brief.ts");
    expect(
      await readFile(path.join(rootDir, ".aiwiki", "tasks", "active-task"), "utf8")
    ).toContain("improve-brief-workflow");
    expect(
      await readFile(path.join(rootDir, ".aiwiki", "wiki", "project-map.md"), "utf8")
    ).toContain("# Project Map");
  });

  it("exposes team runbook mode through the agent command", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await addAgentMemory(rootDir);
    await mkdir(path.join(rootDir, "src"), { recursive: true });
    await writeFile(path.join(rootDir, "src", "brief.ts"), "export const brief = true;\n", "utf8");
    const cliPath = path.resolve("src", "cli.ts");
    const tsxLoader = pathToFileURL(
      path.resolve("node_modules", "tsx", "dist", "loader.mjs")
    ).href;

    const { stdout } = await execFileAsync(
      process.execPath,
      [
        "--import",
        tsxLoader,
        cliPath,
        "agent",
        "improve brief workflow",
        "--runbook",
        "--team",
        "--format",
        "json"
      ],
      { cwd: rootDir }
    );
    const parsed = JSON.parse(stdout) as {
      team?: { enabled: boolean };
    };

    expect(parsed.team?.enabled).toBe(true);
  });
});
