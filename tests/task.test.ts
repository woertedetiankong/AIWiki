import { execFile } from "node:child_process";
import { appendFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { initAIWiki } from "../src/init.js";
import {
  addTaskDependency,
  checkpointTask,
  claimTask,
  closeTask,
  createTask,
  discoverTask,
  ensureActiveTask,
  getTaskStatus,
  listTasks,
  readyTasks,
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

  it("ensures an active task for agent workflows without duplicate starts", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });

    const created = await ensureActiveTask(rootDir, "Implement agent workflow", {
      assignee: "codex-test"
    });
    const reused = await ensureActiveTask(rootDir, "Implement agent workflow", {
      assignee: "codex-test"
    });

    expect(created.data.created).toBe(true);
    expect(reused.data.created).toBe(false);
    expect(reused.data.metadata.id).toBe(created.data.metadata.id);
    expect(
      await readFile(path.join(rootDir, ".aiwiki", "tasks", "active-task"), "utf8")
    ).toBe(created.data.metadata.id);
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
    expect(resume.markdown).toContain("## Mode Boundary");
    expect(resume.markdown).toContain("Write mode");
    expect(resume.markdown).toContain("## Continue From Here");
    expect(resume.markdown).toContain("## Next Steps");
    expect(resume.markdown).toContain("## Current Status");
    expect(resume.markdown.indexOf("## Continue From Here")).toBeLessThan(
      resume.markdown.indexOf("## Next Steps")
    );
    expect(resume.markdown.indexOf("## Next Steps")).toBeLessThan(
      resume.markdown.indexOf("## Current Status")
    );
    expect(resume.markdown).toContain("Finished task start");
    expect(resume.markdown).toContain("Implement resume");
  });

  it("keeps task status compact instead of embedding derived markdown files", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await startTask(rootDir, "Compact status", { id: "compact-status" });

    const status = await getTaskStatus(rootDir);

    expect(status.markdown).toContain("## Progress");
    expect(status.markdown).toContain("## Checkpoints");
    expect(status.markdown).not.toContain("\n# Progress");
    expect(status.markdown).not.toContain("\n# Decisions");
  });

  it("writes resume files by default", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await startTask(rootDir, "Default resume write", { id: "default-resume" });
    await checkpointTask(rootDir, {
      step: "core work",
      status: "done",
      next: ["ship it"]
    });
    const resumePath = path.join(
      rootDir,
      ".aiwiki",
      "tasks",
      "default-resume",
      "resume.md"
    );
    await writeFile(resumePath, "stale resume\n", "utf8");

    await resumeTask(rootDir);

    const resumeFile = await readFile(resumePath, "utf8");
    expect(resumeFile).toContain("# Resume Brief for Codex");
    expect(resumeFile).toContain("ship it");
    expect(resumeFile).not.toContain("stale resume");
  });

  it("supports read-only resume output without rewriting resume files", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await startTask(rootDir, "Read-only resume", { id: "readonly-resume" });
    await checkpointTask(rootDir, {
      step: "core work",
      status: "done",
      next: ["continue safely"]
    });
    const resumePath = path.join(
      rootDir,
      ".aiwiki",
      "tasks",
      "readonly-resume",
      "resume.md"
    );
    await writeFile(resumePath, "custom user resume\n", "utf8");

    const result = await resumeTask(rootDir, undefined, { readOnly: true });

    expect(result.markdown).toContain("continue safely");
    expect(result.markdown).toContain("Read-only mode");
    expect(result.data.outputPath).toBeUndefined();
    expect(await readFile(resumePath, "utf8")).toBe("custom user resume\n");
  });

  it("rejects read-only resume output paths", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await startTask(rootDir, "Read-only output", { id: "readonly-output" });

    await expect(
      resumeTask(rootDir, undefined, {
        readOnly: true,
        output: ".aiwiki/context-packs/resume.md"
      })
    ).rejects.toThrow("Cannot use --read-only with --output");

    await expect(
      readFile(path.join(rootDir, ".aiwiki", "context-packs", "resume.md"), "utf8")
    ).rejects.toThrow();
  });

  it("uses the latest checkpoint next steps in resume output", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await startTask(rootDir, "Latest next step", { id: "latest-next" });

    await checkpointTask(rootDir, {
      step: "first step",
      status: "done",
      next: ["stale next step"]
    });
    await checkpointTask(rootDir, {
      step: "second step",
      status: "done",
      next: ["current next step"]
    });

    const resume = await resumeTask(rootDir);

    expect(resume.markdown).toContain("current next step");
    expect(resume.markdown).not.toContain("stale next step");
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

  it("auto-captures changed files, suggested tests, and next action hints", async () => {
    const rootDir = await tempProject();
    await writeProjectFile(rootDir, "src/task.ts", "export const value = 1;\n");
    await writeProjectFile(rootDir, "tests/task.test.ts", "export const test = true;\n");
    await writeProjectFile(
      rootDir,
      "package.json",
      `${JSON.stringify({ scripts: { test: "vitest run" } }, null, 2)}\n`
    );
    await initAIWiki({ rootDir, projectName: "demo" });
    await initGitProject(rootDir);
    await startTask(rootDir, "Auto checkpoint", { id: "auto-checkpoint" });
    await writeProjectFile(rootDir, "src/task.ts", "export const value = 2;\n");
    await writeProjectFile(
      rootDir,
      ".aiwiki/context-packs/local-plan.json",
      "{\"local\":true}\n"
    );
    await writeProjectFile(rootDir, ".venv/cache.py", "print('cache')\n");
    await writeProjectFile(rootDir, "node_modules/demo/index.js", "module.exports = true;\n");
    await writeProjectFile(rootDir, "package-lock.json", "{\"lockfileVersion\":3}\n");

    const checkpoint = await checkpointTask(rootDir, {
      message: "Captured handoff context"
    });
    const resume = await resumeTask(rootDir, undefined, { readOnly: true });

    expect(checkpoint.data.files).toContain("src/task.ts");
    expect(checkpoint.data.files?.some((file) => file.startsWith(".aiwiki/"))).toBe(false);
    expect(checkpoint.data.files?.some((file) => file.startsWith(".venv/"))).toBe(false);
    expect(checkpoint.data.files?.some((file) => file.startsWith("node_modules/"))).toBe(false);
    expect(checkpoint.data.files).not.toContain("package-lock.json");
    expect(checkpoint.data.tests).toContain(
      "Suggested test command: npm run test -- tests/task.test.ts"
    );
    expect(checkpoint.data.next?.[0]).toBe(
      "Run aiwiki guard src/task.ts before the next edit."
    );
    expect(checkpoint.markdown).toContain("## Changed Files");
    expect(checkpoint.markdown).toContain("## Next Actions");
    expect(resume.markdown.split("\n")[2]).toContain("下一步做什么 / Next Action:");
    expect(resume.markdown).toContain("Run aiwiki guard src/task.ts before the next edit.");
  });

  it("uses latest changed-file checkpoint for handoff summaries", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await startTask(rootDir, "Latest changed files", { id: "latest-files" });

    await appendFile(
      path.join(rootDir, ".aiwiki", "tasks", "latest-files", "checkpoints.jsonl"),
      `${JSON.stringify({
        time: new Date().toISOString(),
        type: "checkpoint",
        message: "Temp file captured",
        files: ["agent-second.out"],
        task_id: "latest-files"
      })}\n`,
      "utf8"
    );
    await appendFile(
      path.join(rootDir, ".aiwiki", "tasks", "latest-files", "checkpoints.jsonl"),
      `${JSON.stringify({
        time: new Date().toISOString(),
        type: "checkpoint",
        message: "Clean handoff",
        files: ["src/index.ts"],
        task_id: "latest-files"
      })}\n`,
      "utf8"
    );

    const status = await getTaskStatus(rootDir);

    expect(status.markdown).toContain("src/index.ts");
    expect(status.markdown).not.toContain("agent-second.out");
  });

  it("accepts checkpoint --summary as a CLI alias for --message", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await startTask(rootDir, "Summary checkpoint", { id: "summary-checkpoint" });
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
        "checkpoint",
        "--summary",
        "Finished summary alias",
        "--no-from-git-diff"
      ],
      { cwd: rootDir }
    );

    expect(stdout).toContain("# Checkpoint Recorded");
    expect(stdout).toContain("Finished summary alias");
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

    const status = await getTaskStatus(rootDir);
    expect(status.markdown).toContain("## Decisions");
    expect(status.markdown).toContain("MVP keeps task state separate");
    expect(status.markdown).toContain("## Checkpoints");
    expect(status.markdown).toContain("decision");
    expect(status.markdown).toContain("blocker");
  });

  it("derives status and resume from checkpoint events instead of edited markdown summaries", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await startTask(rootDir, "Event source task", { id: "event-source-task" });

    await checkpointTask(rootDir, {
      message: "Event-backed checkpoint",
      status: "done",
      tests: ["event test passed"],
      next: ["continue from event log"]
    });
    await recordTaskDecision(rootDir, "Use JSONL as task source of truth");
    await writeFile(
      path.join(rootDir, ".aiwiki", "tasks", "event-source-task", "progress.md"),
      "# Progress\n\n## Completed\n- User edited stale progress\n",
      "utf8"
    );
    await writeFile(
      path.join(rootDir, ".aiwiki", "tasks", "event-source-task", "decisions.md"),
      "# Decisions\n\n- User edited stale decision\n",
      "utf8"
    );

    const status = await getTaskStatus(rootDir);
    const resume = await resumeTask(rootDir);

    expect(status.markdown).toContain("Event-backed checkpoint");
    expect(status.markdown).toContain("Use JSONL as task source of truth");
    expect(status.markdown).not.toContain("User edited stale");
    expect(resume.markdown).toContain("event test passed");
    expect(resume.markdown).toContain("continue from event log");
    expect(resume.markdown).not.toContain("User edited stale");
  });

  it("tracks open ready work, blocking dependencies, and claims", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });

    await createTask(rootDir, "Set up schema", {
      id: "schema-task",
      type: "task",
      priority: 1
    });
    await createTask(rootDir, "Implement auth", {
      id: "auth-task",
      type: "feature",
      priority: 0
    });
    await addTaskDependency(rootDir, "auth-task", "schema-task");

    const readyBefore = await readyTasks(rootDir);
    expect(readyBefore.data.tasks.map((item) => item.metadata.id)).toEqual([
      "schema-task"
    ]);
    expect(readyBefore.markdown).toContain("schema-task | Set up schema | P1");
    await expect(
      claimTask(rootDir, "auth-task", { actor: "reviewer" })
    ).rejects.toThrow("blocked by unfinished dependencies");

    await claimTask(rootDir, "schema-task", { actor: "codex-test" });
    await closeTask(rootDir, { status: "done" });

    const readyAfter = await readyTasks(rootDir);
    expect(readyAfter.data.tasks.map((item) => item.metadata.id)).toEqual([
      "auth-task"
    ]);

    const claimed = await claimTask(rootDir, "auth-task", { actor: "reviewer" });
    expect(claimed.data.status).toBe("in_progress");
    expect(claimed.data.assignee).toBe("reviewer");
    expect(
      await readFile(path.join(rootDir, ".aiwiki", "tasks", "active-task"), "utf8")
    ).toBe("auth-task");
  });

  it("allows unique short task ids for claim, status, and dependencies", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });

    const schema = await createTask(rootDir, "Set up schema", {
      type: "task",
      priority: 1
    });
    const auth = await createTask(rootDir, "Implement auth", {
      type: "feature",
      priority: 0
    });

    await addTaskDependency(rootDir, "implement-auth", "set-up-schema");
    await claimTask(rootDir, "set-up-schema", { actor: "codex-test" });

    const status = await getTaskStatus(rootDir, "set-up-schema");
    expect(status.data.metadata.id).toBe(schema.data.id);
    expect(
      await readFile(path.join(rootDir, ".aiwiki", "tasks", "active-task"), "utf8")
    ).toBe(schema.data.id);

    const authStatus = await getTaskStatus(rootDir, auth.data.id);
    expect(authStatus.data.metadata.dependencies?.[0]?.id).toBe(schema.data.id);
  });

  it("rejects ambiguous short task ids", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await createTask(rootDir, "Implement auth", { id: "2026-05-01-implement-auth" });
    await createTask(rootDir, "Retry auth", { id: "2026-05-02-implement-auth" });

    await expect(claimTask(rootDir, "implement-auth")).rejects.toThrow(
      "Task reference is ambiguous"
    );
  });

  it("records discovered work as an open non-blocking task", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await startTask(rootDir, "Current implementation", { id: "current-task" });

    const discovered = await discoverTask(rootDir, "Reflect output is too broad", {
      id: "reflect-broad",
      priority: 2,
      type: "bug"
    });

    expect(discovered.data.status).toBe("open");
    expect(discovered.data.dependencies?.[0]).toMatchObject({
      id: "current-task",
      type: "discovered_from"
    });
    const ready = await readyTasks(rootDir);
    expect(ready.data.tasks.map((item) => item.metadata.id)).toContain("reflect-broad");

    const taskMarkdown = await readFile(
      path.join(rootDir, ".aiwiki", "tasks", "reflect-broad", "task.md"),
      "utf8"
    );
    expect(taskMarkdown).toContain("current-task (discovered_from)");
  });

  it("rejects dependency cycles", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await createTask(rootDir, "Task A", { id: "task-a" });
    await createTask(rootDir, "Task B", { id: "task-b" });
    await addTaskDependency(rootDir, "task-b", "task-a");

    await expect(addTaskDependency(rootDir, "task-a", "task-b")).rejects.toThrow(
      "would create a cycle"
    );
    await expect(addTaskDependency(rootDir, "task-a", "task-a")).rejects.toThrow(
      "cannot depend on itself"
    );
  });

  it("reports corrupt task event logs with task id and line number", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await startTask(rootDir, "Corrupt events", { id: "corrupt-events" });
    await writeFile(
      path.join(rootDir, ".aiwiki", "tasks", "corrupt-events", "checkpoints.jsonl"),
      "{\"time\":\"2026-04-29T00:00:00.000Z\",\"type\":\"checkpoint\"}\n{not json}\n",
      "utf8"
    );

    await expect(getTaskStatus(rootDir)).rejects.toThrow(
      "Corrupt task event log for corrupt-events: line 2"
    );
  });
});
