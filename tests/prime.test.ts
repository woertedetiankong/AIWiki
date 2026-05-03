import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initAIWiki } from "../src/init.js";
import { writeMarkdownFile } from "../src/markdown.js";
import { generatePrimeContext } from "../src/prime.js";
import { createTask, startTask } from "../src/task.js";

async function tempProject(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "aiwiki-prime-"));
}

async function initGitProject(rootDir: string): Promise<void> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);
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

describe("AIWiki prime", () => {
  it("returns cold-start guidance before AIWiki is initialized", async () => {
    const rootDir = await tempProject();

    const result = await generatePrimeContext(rootDir);

    expect(result.context.projectName).toBe(path.basename(rootDir));
    expect(result.context.initialized).toBe(false);
    expect(result.context.readyTasks).toEqual([]);
    expect(result.context.actions.map((action) => action.kind)).toEqual([
      "initialize_memory",
      "build_project_map",
      "start_context"
    ]);
    expect(result.markdown).toContain("Cold-start mode");
    expect(result.markdown).toContain("aiwiki init --project-name");
  });

  it("summarizes active task, ready work, memory health, and next actions", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await startTask(rootDir, "Active work", { id: "active-work" });
    await createTask(rootDir, "Open follow-up", {
      id: "open-follow-up",
      priority: 1
    });

    const result = await generatePrimeContext(rootDir);

    expect(result.context.projectName).toBe("demo");
    expect(result.context.activeTask?.id).toBe("active-work");
    expect(result.context.readyTasks.map((task) => task.id)).toContain("open-follow-up");
    expect(result.context.actions.some((action) => action.command.includes("aiwiki resume active-work"))).toBe(true);
    expect(result.markdown).toContain("# AIWiki Prime");
    expect(result.markdown).toContain("aiwiki guard <file>");
  });

  it("names stale memory warnings without implying lint errors", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await mkdir(path.join(rootDir, "src"), { recursive: true });
    await writeFile(path.join(rootDir, "src", "example.ts"), "export const value = 1;\n", "utf8");
    await mkdir(path.join(rootDir, ".aiwiki", "wiki", "modules"), { recursive: true });
    await writeMarkdownFile(
      path.join(rootDir, ".aiwiki", "wiki", "modules", "example.md"),
      {
        type: "module",
        title: "Example",
        modules: ["example"],
        files: ["src/example.ts"],
        last_updated: "2000-01-01"
      },
      "# Example\n\nExample memory.\n"
    );

    const result = await generatePrimeContext(rootDir);

    expect(result.context.memoryHealth.lintErrors).toBe(0);
    expect(result.context.memoryHealth.staleWarnings).toBeGreaterThan(0);
    expect(result.markdown).toContain("aiwiki doctor (Doctor found stale memory warnings.)");
    expect(result.markdown).not.toContain("Doctor found lint errors or stale memory warnings.");
  });

  it("surfaces guard targets from active task checkpoints and git status", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await writeFile(path.join(rootDir, "README.md"), "# Demo\n", "utf8");
    await mkdir(path.join(rootDir, "src"), { recursive: true });
    await writeFile(path.join(rootDir, "src", "handoff.ts"), "export const value = 1;\n", "utf8");
    await initGitProject(rootDir);
    await startTask(rootDir, "Improve handoff", { id: "handoff-task" });
    await writeFile(path.join(rootDir, "src", "handoff.ts"), "export const value = 2;\n", "utf8");

    const result = await generatePrimeContext(rootDir);

    expect(result.context.guardTargets).toContain("src/handoff.ts");
    expect(result.markdown).toContain("## Guard Targets");
    expect(result.markdown).toContain("aiwiki guard src/handoff.ts");
    expect(result.context.actions.some((action) => action.kind === "guard_target")).toBe(true);
  });

  it("prioritizes source guard targets when many files are dirty", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await writeFile(path.join(rootDir, "README.md"), "# Demo\n", "utf8");
    await writeFile(path.join(rootDir, "package.json"), "{\"scripts\":{\"test\":\"vitest\"}}\n", "utf8");
    await mkdir(path.join(rootDir, "src"), { recursive: true });
    await mkdir(path.join(rootDir, "tests"), { recursive: true });
    for (const file of ["agent", "cli", "codex", "index", "risk-rules"]) {
      await writeFile(path.join(rootDir, "src", `${file}.ts`), `export const ${file.replace(/-/gu, "")} = true;\n`, "utf8");
      await writeFile(path.join(rootDir, "tests", `${file}.test.ts`), "export const testFile = true;\n", "utf8");
    }
    await initGitProject(rootDir);
    await writeFile(path.join(rootDir, "README.md"), "# Demo\n\nUpdated.\n", "utf8");
    await writeFile(path.join(rootDir, "package.json"), "{\"scripts\":{\"test\":\"vitest\",\"build\":\"tsc\"}}\n", "utf8");
    await writeFile(path.join(rootDir, "src", "agent.ts"), "export const agent = false;\n", "utf8");
    await writeFile(path.join(rootDir, "src", "cli.ts"), "export const cli = false;\n", "utf8");
    await writeFile(path.join(rootDir, "src", "codex.ts"), "export const codex = false;\n", "utf8");
    await writeFile(path.join(rootDir, "src", "index.ts"), "export const index = false;\n", "utf8");
    await writeFile(path.join(rootDir, "src", "risk-rules.ts"), "export const riskrules = false;\n", "utf8");
    await writeFile(path.join(rootDir, "src", "usability-eval.ts"), "export const usability = true;\n", "utf8");

    const result = await generatePrimeContext(rootDir);

    expect(result.context.guardTargets).toContain("src/usability-eval.ts");
    expect(result.context.guardTargets).toContain("src/risk-rules.ts");
    expect(result.context.guardTargets).not.toContain("README.md");
    expect(result.context.guardTargets).not.toContain("package.json");
  });

  it("reads Beads ready work when .beads exists without owning the task database", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await mkdir(path.join(rootDir, ".beads"), { recursive: true });
    const binDir = path.join(rootDir, "bin");
    await mkdir(binDir, { recursive: true });
    const bdPath = path.join(binDir, "bd");
    const bdScript = [
      "#!/usr/bin/env node",
      "if (process.argv.includes('ready')) {",
      "  console.log(JSON.stringify({ issues: [{ id: 'bd-a1b2', title: 'Wire handoff', priority: 1, status: 'open' }] }));",
      "} else if (process.argv.includes('status')) {",
      "  console.log(JSON.stringify({ open: 1, in_progress: 0, blocked: 0 }));",
      "}",
      ""
    ].join("\n");
    await writeFile(bdPath, bdScript, "utf8");
    await writeFile(path.join(binDir, "bd.cmd"), "@echo off\r\nnode \"%~dp0bd\" %*\r\n", "utf8");
    await chmod(bdPath, 0o755);
    const oldPath = process.env.PATH;
    process.env.PATH = `${binDir}${path.delimiter}${oldPath ?? ""}`;
    try {
      const result = await generatePrimeContext(rootDir);

      expect(result.context.beads?.detected).toBe(true);
      expect(result.context.beads?.available).toBe(true);
      expect(result.context.beads?.ready[0]?.id).toBe("bd-a1b2");
      expect(result.markdown).toContain("## Beads");
      expect(result.markdown).toContain("bd-a1b2 | Wire handoff | P1 | open");
      expect(result.context.actions.some((action) => action.kind === "beads_ready_work")).toBe(true);
    } finally {
      process.env.PATH = oldPath;
    }
  });
});
