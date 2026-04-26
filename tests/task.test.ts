import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { initAIWiki } from "../src/init.js";
import {
  checkpointTask,
  closeTask,
  getTaskStatus,
  listTasks,
  recordTaskBlocker,
  recordTaskDecision,
  resumeTask,
  startTask
} from "../src/task.js";

const execFileAsync = promisify(execFile);

async function tempProject(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "aiwiki-task-"));
}

async function writeProjectFile(
  rootDir: string,
  relativePath: string,
  content: string
): Promise<void> {
  const filePath = path.join(rootDir, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
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

describe("AIWiki task continuity", () => {
  it("starts a task and initializes task files", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });

    const result = await startTask(rootDir, "Implement task continuity", {
      id: "task-continuity",
      prd: "prd.md"
    });

    expect(result.data.id).toBe("task-continuity");
    expect(result.markdown).toContain("# Task Started");
    expect(
      await readFile(path.join(rootDir, ".aiwiki", "tasks", "active-task"), "utf8")
    ).toBe("task-continuity");
    expect(
      await readFile(
        path.join(rootDir, ".aiwiki", "tasks", "task-continuity", "task.md"),
        "utf8"
      )
    ).toContain("Implement task continuity");
    expect(
      await readFile(
        path.join(rootDir, ".aiwiki", "tasks", "task-continuity", "prd-progress.md"),
        "utf8"
      )
    ).toContain("PRD Implementation Progress");
  });

  it("records checkpoints and updates status and resume", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await startTask(rootDir, "Implement checkpoint", { id: "checkpoint-task" });

    await checkpointTask(rootDir, {
      message: "Finished task start",
      step: "Task start",
      status: "done",
      tests: ["npm run test passing"],
      next: ["Implement resume"]
    });

    const status = await getTaskStatus(rootDir);
    expect(status.markdown).toContain("Finished task start");
    expect(status.markdown).toContain("npm run test passing");

    const resume = await resumeTask(rootDir);
    expect(resume.markdown).toContain("# Resume Brief for Codex");
    expect(resume.markdown).toContain("Finished task start");
    expect(resume.markdown).toContain("Implement resume");
  });

  it("records git diff changed files in a checkpoint", async () => {
    const rootDir = await tempProject();
    await writeProjectFile(rootDir, "src/index.ts", "export const value = 1;\n");
    await initAIWiki({ rootDir, projectName: "demo" });
    await initGitProject(rootDir);
    await startTask(rootDir, "Track changed files", { id: "changed-files" });
    await writeProjectFile(rootDir, "src/index.ts", "export const value = 2;\n");

    await checkpointTask(rootDir, {
      message: "Changed index",
      fromGitDiff: true
    });

    const changedFiles = await readFile(
      path.join(rootDir, ".aiwiki", "tasks", "changed-files", "changed-files.md"),
      "utf8"
    );
    expect(changedFiles).toContain("src/index.ts");
  });

  it("lists tasks and closes the active task", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await startTask(rootDir, "First task", { id: "first-task" });

    const list = await listTasks(rootDir);
    expect(list.markdown).toContain("first-task | First task | in_progress");

    const closed = await closeTask(rootDir, { status: "paused" });
    expect(closed.data.status).toBe("paused");
    expect(closed.markdown).toContain("aiwiki reflect --from-git-diff");

    await expect(
      readFile(path.join(rootDir, ".aiwiki", "tasks", "active-task"), "utf8")
    ).rejects.toThrow();

    const paused = await listTasks(rootDir, { status: "paused" });
    expect(paused.data.tasks).toHaveLength(1);
    expect(paused.data.tasks[0]?.id).toBe("first-task");
  });

  it("records decisions and blockers into task state and resume", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await startTask(rootDir, "Record task context", { id: "context-task" });

    const decision = await recordTaskDecision(
      rootDir,
      "MVP keeps task state separate from long-term wiki memory",
      { module: "tasks" }
    );
    const blocker = await recordTaskBlocker(
      rootDir,
      "Need user confirmation before writing agent rules",
      { severity: "high" }
    );

    expect(decision.data.type).toBe("decision");
    expect(blocker.data.type).toBe("blocker");

    const decisions = await readFile(
      path.join(rootDir, ".aiwiki", "tasks", "context-task", "decisions.md"),
      "utf8"
    );
    const blockers = await readFile(
      path.join(rootDir, ".aiwiki", "tasks", "context-task", "blockers.md"),
      "utf8"
    );
    const events = await readFile(
      path.join(rootDir, ".aiwiki", "tasks", "context-task", "checkpoints.jsonl"),
      "utf8"
    );

    expect(decisions).toContain("MVP keeps task state separate");
    expect(decisions).toContain("Module: tasks");
    expect(blockers).toContain("Need user confirmation");
    expect(blockers).toContain("Severity: high");
    expect(events).toContain("\"type\":\"decision\"");
    expect(events).toContain("\"type\":\"blocker\"");

    const resume = await resumeTask(rootDir);
    expect(resume.markdown).toContain("MVP keeps task state separate");
    expect(resume.markdown).toContain("Need user confirmation");
  });
});
