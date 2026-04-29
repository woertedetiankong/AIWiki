import { execFile } from "node:child_process";
import {
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
  appendFile
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { ACTIVE_TASK_PATH, TASKS_DIR } from "./constants.js";
import { loadAIWikiConfig } from "./config.js";
import { appendLogEntry } from "./log.js";
import { resolveProjectPath, toPosixPath } from "./paths.js";
import type { RiskLevel, TaskCheckpoint, TaskMetadata, TaskStatus } from "./types.js";

const execFileAsync = promisify(execFile);

export interface TaskStartOptions {
  id?: string;
  prd?: string;
}

export interface TaskCheckpointOptions {
  message?: string;
  step?: string;
  status?: string;
  tests?: string[];
  next?: string[];
  fromGitDiff?: boolean;
}

export interface TaskListOptions {
  status?: TaskStatus;
  recent?: number;
}

export interface TaskCloseOptions {
  status?: TaskStatus;
}

export interface TaskResumeOptions {
  output?: string;
}

export interface TaskDecisionOptions {
  module?: string;
}

export interface TaskBlockerOptions {
  severity?: RiskLevel;
}

export interface TaskCommandResult<T> {
  data: T;
  markdown: string;
  json: string;
}

export interface TaskStatusData {
  metadata: TaskMetadata;
  progress: string;
  decisions: string;
  blockers: string;
  changedFiles: string;
  tests: string;
  checkpoints: TaskCheckpoint[];
}

export interface TaskListData {
  activeTaskId?: string;
  tasks: TaskMetadata[];
}

export interface TaskResumeData extends TaskStatusData {
  resume: string;
  outputPath?: string;
}

const TASK_FILES = [
  "task.md",
  "brief.md",
  "plan.md",
  "progress.md",
  "decisions.md",
  "blockers.md",
  "changed-files.md",
  "tests.md",
  "checkpoints.jsonl",
  "resume.md",
  "metadata.json"
] as const;

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 48);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function now(): string {
  return new Date().toISOString();
}

function taskIdFor(title: string): string {
  return `${today()}-${slug(title) || "task"}`;
}

function taskDir(rootDir: string, taskId: string): string {
  return resolveProjectPath(rootDir, TASKS_DIR, taskId);
}

function taskFile(rootDir: string, taskId: string, fileName: string): string {
  return path.join(taskDir(rootDir, taskId), fileName);
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      return false;
    }

    throw error;
  }
}

async function readText(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return "";
    }

    throw error;
  }
}

async function writeMetadata(rootDir: string, metadata: TaskMetadata): Promise<void> {
  await writeFile(
    taskFile(rootDir, metadata.id, "metadata.json"),
    `${JSON.stringify(metadata, null, 2)}\n`,
    "utf8"
  );
}

async function readMetadata(rootDir: string, taskId: string): Promise<TaskMetadata> {
  return JSON.parse(
    await readFile(taskFile(rootDir, taskId, "metadata.json"), "utf8")
  ) as TaskMetadata;
}

async function activeTaskId(rootDir: string): Promise<string | undefined> {
  const value = (await readText(resolveProjectPath(rootDir, ACTIVE_TASK_PATH))).trim();
  return value.length > 0 ? value : undefined;
}

async function resolveTaskId(rootDir: string, taskId?: string): Promise<string> {
  const id = taskId ?? (await activeTaskId(rootDir));
  if (!id) {
    throw new Error("No active AIWiki task. Run `aiwiki task start \"...\"` first.");
  }

  return id;
}

async function gitChangedFiles(rootDir: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync("git", ["diff", "--name-only", "--", "."], {
      cwd: rootDir,
      maxBuffer: 1024 * 1024
    });
    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((file) => toPosixPath(file))
      .sort();
  } catch {
    return [];
  }
}

function splitList(values: string[] | undefined): string[] {
  return values?.flatMap((value) => value.split("\n")).map((value) => value.trim()).filter(Boolean) ?? [];
}

function bulletList(items: string[], fallback: string): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : `- ${fallback}`;
}

function taskMd(metadata: TaskMetadata): string {
  return `# Task: ${metadata.title}

## Task ID
${metadata.id}

## Original Request
${metadata.title}

## Source Documents
${metadata.prd ? `- ${metadata.prd}` : "- None"}

## Scope
Current task scope only.

## Out of Scope
- Long-term wiki memory updates before reflect confirmation
- Agent rule changes without user confirmation

## Created At
${metadata.created_at}
`;
}

function initialProgressMd(): string {
  return `# Progress

## Completed
- None yet.

## In Progress
- Task started.

## Not Started
- Record checkpoints as work progresses.

## Next Recommended Steps
- Capture the first checkpoint after making meaningful progress.
`;
}

function emptySection(title: string): string {
  return `# ${title}

- None recorded.
`;
}

function checkpointLine(checkpoint: TaskCheckpoint): string {
  if (checkpoint.type === "decision") {
    return [
      checkpoint.message ? `Decision: ${checkpoint.message}` : "Decision recorded.",
      checkpoint.module ? `Module: ${checkpoint.module}` : undefined
    ].filter(Boolean).join(" | ");
  }

  if (checkpoint.type === "blocker") {
    return [
      checkpoint.message ? `Blocker: ${checkpoint.message}` : "Blocker recorded.",
      checkpoint.severity ? `Severity: ${checkpoint.severity}` : undefined
    ].filter(Boolean).join(" | ");
  }

  const parts = [
    checkpoint.message,
    checkpoint.step ? `Step: ${checkpoint.step}` : undefined,
    checkpoint.status ? `Status: ${checkpoint.status}` : undefined
  ].filter(Boolean);

  return parts.join(" | ") || "Checkpoint recorded.";
}

function validateCheckpointEvent(value: unknown, taskId: string, lineNumber: number): TaskCheckpoint {
  if (!value || typeof value !== "object") {
    throw new Error(
      `Corrupt task event log for ${taskId}: line ${lineNumber} is not a JSON object.`
    );
  }

  const event = value as Partial<TaskCheckpoint>;
  if (typeof event.time !== "string" || event.time.trim().length === 0) {
    throw new Error(
      `Corrupt task event log for ${taskId}: line ${lineNumber} is missing string field time.`
    );
  }
  if (
    event.type !== "checkpoint" &&
    event.type !== "decision" &&
    event.type !== "blocker"
  ) {
    throw new Error(
      `Corrupt task event log for ${taskId}: line ${lineNumber} has unsupported event type.`
    );
  }

  return event as TaskCheckpoint;
}

async function readCheckpoints(rootDir: string, taskId: string): Promise<TaskCheckpoint[]> {
  const raw = await readText(taskFile(rootDir, taskId, "checkpoints.jsonl"));
  const events: TaskCheckpoint[] = [];
  const lines = raw.split("\n");
  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Corrupt task event log for ${taskId}: line ${index + 1} is not valid JSON (${message}).`
      );
    }
    events.push(validateCheckpointEvent(parsed, taskId, index + 1));
  }

  return events;
}

function renderProgress(checkpoints: TaskCheckpoint[]): string {
  const checkpointEvents = checkpoints.filter((checkpoint) => checkpoint.type === "checkpoint");
  const completed = checkpointEvents
    .filter((checkpoint) => checkpoint.status === "done" || checkpoint.status === "completed")
    .map(checkpointLine);
  const inProgress = checkpointEvents
    .filter((checkpoint) => checkpoint.status && !["done", "completed"].includes(checkpoint.status))
    .map(checkpointLine);
  const next = checkpointEvents.flatMap((checkpoint) => checkpoint.next ?? []);

  return `# Progress

## Completed
${bulletList(completed, "No completed checkpoints recorded.")}

## In Progress
${bulletList(inProgress, "No in-progress checkpoint recorded.")}

## Not Started
- Unknown. Add checkpoint --next entries to track remaining work.

## Next Recommended Steps
${bulletList(next, "No next steps recorded.")}
`;
}

function renderChangedFiles(checkpoints: TaskCheckpoint[]): string {
  const files = [...new Set(
    checkpoints
      .filter((checkpoint) => checkpoint.type === "checkpoint")
      .flatMap((checkpoint) => checkpoint.files ?? [])
  )].sort();
  return `# Changed Files

${bulletList(files, "No changed files recorded.")}
`;
}

function renderTests(checkpoints: TaskCheckpoint[]): string {
  const tests = checkpoints
    .filter((checkpoint) => checkpoint.type === "checkpoint")
    .flatMap((checkpoint) => checkpoint.tests ?? []);
  return `# Tests

${bulletList(tests, "No tests recorded.")}
`;
}

function renderDecisions(checkpoints: TaskCheckpoint[]): string {
  const decisions = checkpoints
    .filter((checkpoint) => checkpoint.type === "decision")
    .map((checkpoint) => {
      return [
        checkpoint.message ? `Decision: ${checkpoint.message}` : "Decision recorded.",
        checkpoint.module ? `Module: ${checkpoint.module}` : undefined,
        "Potential long-term wiki update: yes"
      ].filter(Boolean).join(" | ");
    });

  return `# Decisions

${bulletList(decisions, "None recorded.")}
`;
}

function renderBlockers(checkpoints: TaskCheckpoint[]): string {
  const blockers = checkpoints
    .filter((checkpoint) => checkpoint.type === "blocker")
    .map((checkpoint) => {
      return [
        checkpoint.message ? `Blocker: ${checkpoint.message}` : "Blocker recorded.",
        checkpoint.severity ? `Severity: ${checkpoint.severity}` : undefined
      ].filter(Boolean).join(" | ");
    });

  return `# Blockers

${bulletList(blockers, "None recorded.")}
`;
}

async function loadStatus(rootDir: string, taskId: string): Promise<TaskStatusData> {
  const metadata = await readMetadata(rootDir, taskId);
  const checkpoints = await readCheckpoints(rootDir, taskId);
  return {
    metadata,
    progress: renderProgress(checkpoints),
    decisions: renderDecisions(checkpoints),
    blockers: renderBlockers(checkpoints),
    changedFiles: renderChangedFiles(checkpoints),
    tests: renderTests(checkpoints),
    checkpoints
  };
}

function excerptList(markdown: string, heading: string): string[] {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start < 0) {
    return [];
  }

  const items: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("## ")) {
      break;
    }
    if (line.trim().startsWith("- ")) {
      const item = line.trim().replace(/^- /u, "");
      if (item !== "None yet." && item !== "None recorded.") {
        items.push(item);
      }
    }
  }

  return items;
}

function resumeMarkdown(status: TaskStatusData): string {
  const completed = excerptList(status.progress, "Completed");
  const inProgress = excerptList(status.progress, "In Progress");
  const notStarted = excerptList(status.progress, "Not Started");
  const next = excerptList(status.progress, "Next Recommended Steps");
  const changed = status.changedFiles
    .split("\n")
    .filter((line) => line.trim().startsWith("- "))
    .map((line) => line.trim().replace(/^- /u, ""))
    .filter((line) => !line.startsWith("No changed files"));
  const tests = status.tests
    .split("\n")
    .filter((line) => line.trim().startsWith("- "))
    .map((line) => line.trim().replace(/^- /u, ""))
    .filter((line) => !line.startsWith("No tests"));

  return `# Resume Brief for Codex

## Task
${status.metadata.title}

## Task ID
${status.metadata.id}

## Current Status
${status.metadata.status}

## Completed
${bulletList(completed, "No completed work recorded.")}

## In Progress
${bulletList(inProgress, "No in-progress work recorded.")}

## Not Yet Done
${bulletList(notStarted, "No not-started items recorded.")}

## Important Decisions
${status.decisions.trim() || "- None recorded."}

## Changed Files
${bulletList(changed, "No changed files recorded.")}

## Tests
${bulletList(tests, "No tests recorded.")}

## Known Issues
${status.blockers.trim() || "- None recorded."}

## Next Recommended Steps
${bulletList(next, "No next steps recorded.")}

## Instructions for Codex
Use this resume brief as the source of truth for the current task state. Do not restart from scratch. First inspect the changed files and current git diff, then continue from the Next Recommended Steps. If you find a mismatch between this resume brief and the actual repository state, report it before editing code.
`;
}

function checkpointsMarkdown(checkpoints: TaskCheckpoint[]): string {
  if (checkpoints.length === 0) {
    return "- No checkpoints recorded.";
  }

  return checkpoints
    .map((checkpoint) => `- ${checkpoint.time} | ${checkpoint.type} | ${checkpointLine(checkpoint)}`)
    .join("\n");
}

function statusMarkdown(status: TaskStatusData): string {
  return `# Task Status

## Active Task
${status.metadata.title}

## Task ID
${status.metadata.id}

## Status
${status.metadata.status}

${status.progress.trim()}

## Decisions
${status.decisions.trim() || "- None recorded."}

${status.changedFiles.trim()}

${status.tests.trim()}

## Checkpoints
${checkpointsMarkdown(status.checkpoints)}

${status.blockers.trim()}
`;
}

function listMarkdown(data: TaskListData): string {
  const active = data.tasks.find((task) => task.id === data.activeTaskId);
  return `# AIWiki Tasks

## Active
${active ? `- ${active.id} | ${active.title} | ${active.status}` : "- None"}

## Recent
${bulletList(
  data.tasks.map((task) => `${task.id} | ${task.title} | ${task.status}`),
  "No tasks found."
)}
`;
}

function toJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function syncTaskDerivedFiles(rootDir: string, taskId: string): Promise<TaskStatusData> {
  const status = await loadStatus(rootDir, taskId);
  await writeFile(taskFile(rootDir, taskId, "progress.md"), status.progress, "utf8");
  await writeFile(taskFile(rootDir, taskId, "decisions.md"), status.decisions, "utf8");
  await writeFile(taskFile(rootDir, taskId, "blockers.md"), status.blockers, "utf8");
  await writeFile(taskFile(rootDir, taskId, "changed-files.md"), status.changedFiles, "utf8");
  await writeFile(taskFile(rootDir, taskId, "tests.md"), status.tests, "utf8");
  await writeFile(taskFile(rootDir, taskId, "resume.md"), resumeMarkdown(status), "utf8");
  return status;
}

async function appendTaskEvent(
  rootDir: string,
  taskId: string,
  event: TaskCheckpoint
): Promise<void> {
  await appendFile(
    taskFile(rootDir, taskId, "checkpoints.jsonl"),
    `${JSON.stringify(event)}\n`,
    "utf8"
  );
  const metadata = await readMetadata(rootDir, taskId);
  metadata.updated_at = event.time;
  await writeMetadata(rootDir, metadata);
  await syncTaskDerivedFiles(rootDir, taskId);
}

export async function startTask(
  rootDir: string,
  title: string,
  options: TaskStartOptions = {}
): Promise<TaskCommandResult<TaskMetadata>> {
  await loadAIWikiConfig(rootDir);
  const id = options.id ?? taskIdFor(title);
  const dir = taskDir(rootDir, id);
  if (await pathExists(dir)) {
    throw new Error(`Task already exists: ${id}`);
  }

  const timestamp = now();
  const metadata: TaskMetadata = {
    id,
    title,
    status: "in_progress",
    created_at: timestamp,
    updated_at: timestamp,
    prd: options.prd
  };

  await mkdir(dir, { recursive: true });
  await writeMetadata(rootDir, metadata);
  await writeFile(taskFile(rootDir, id, "task.md"), taskMd(metadata), "utf8");
  await writeFile(taskFile(rootDir, id, "brief.md"), "# Brief\n\n- Not recorded.\n", "utf8");
  await writeFile(taskFile(rootDir, id, "plan.md"), "# Plan\n\n- Not recorded.\n", "utf8");
  await writeFile(taskFile(rootDir, id, "progress.md"), initialProgressMd(), "utf8");
  await writeFile(taskFile(rootDir, id, "decisions.md"), emptySection("Decisions"), "utf8");
  await writeFile(taskFile(rootDir, id, "blockers.md"), emptySection("Blockers"), "utf8");
  await writeFile(taskFile(rootDir, id, "changed-files.md"), emptySection("Changed Files"), "utf8");
  await writeFile(taskFile(rootDir, id, "tests.md"), emptySection("Tests"), "utf8");
  await writeFile(taskFile(rootDir, id, "checkpoints.jsonl"), "", "utf8");
  await writeFile(taskFile(rootDir, id, "resume.md"), "", "utf8");
  if (options.prd) {
    await writeFile(
      taskFile(rootDir, id, "prd-progress.md"),
      "# PRD Implementation Progress\n\n- Not generated in no-LLM mode.\n",
      "utf8"
    );
  }
  await mkdir(resolveProjectPath(rootDir, TASKS_DIR), { recursive: true });
  await writeFile(resolveProjectPath(rootDir, ACTIVE_TASK_PATH), id, "utf8");
  await appendLogEntry(rootDir, {
    action: "task start",
    title,
    bullets: [`Task ID: ${id}`]
  });

  return {
    data: metadata,
    markdown: `# Task Started\n\n- Task ID: ${id}\n- Title: ${title}\n- Status: in_progress\n`,
    json: toJson(metadata)
  };
}

export async function listTasks(
  rootDir: string,
  options: TaskListOptions = {}
): Promise<TaskCommandResult<TaskListData>> {
  await loadAIWikiConfig(rootDir);
  const tasksRoot = resolveProjectPath(rootDir, TASKS_DIR);
  let entries: string[] = [];
  try {
    entries = await readdir(tasksRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  const tasks: TaskMetadata[] = [];
  for (const entry of entries) {
    const metadataPath = taskFile(rootDir, entry, "metadata.json");
    if (await pathExists(metadataPath)) {
      tasks.push(await readMetadata(rootDir, entry));
    }
  }

  const filtered = tasks
    .filter((task) => (options.status ? task.status === options.status : true))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, options.recent);
  const data = { activeTaskId: await activeTaskId(rootDir), tasks: filtered };
  return { data, markdown: listMarkdown(data), json: toJson(data) };
}

export async function getTaskStatus(
  rootDir: string,
  taskId?: string
): Promise<TaskCommandResult<TaskStatusData>> {
  await loadAIWikiConfig(rootDir);
  const id = await resolveTaskId(rootDir, taskId);
  const data = await loadStatus(rootDir, id);
  return { data, markdown: statusMarkdown(data), json: toJson(data) };
}

export async function checkpointTask(
  rootDir: string,
  options: TaskCheckpointOptions = {}
): Promise<TaskCommandResult<TaskCheckpoint>> {
  await loadAIWikiConfig(rootDir);
  const id = await resolveTaskId(rootDir);
  const files = options.fromGitDiff ? await gitChangedFiles(rootDir) : [];
  const checkpoint: TaskCheckpoint = {
    time: now(),
    type: "checkpoint",
    message: options.message,
    step: options.step,
    status: options.status,
    tests: splitList(options.tests),
    next: splitList(options.next),
    files
  };

  await appendTaskEvent(rootDir, id, checkpoint);

  return {
    data: checkpoint,
    markdown: `# Checkpoint Recorded\n\n- Task ID: ${id}\n- ${checkpointLine(checkpoint)}\n`,
    json: toJson(checkpoint)
  };
}

export async function resumeTask(
  rootDir: string,
  taskId?: string,
  options: TaskResumeOptions = {}
): Promise<TaskCommandResult<TaskResumeData>> {
  await loadAIWikiConfig(rootDir);
  const id = await resolveTaskId(rootDir, taskId);
  const status = await loadStatus(rootDir, id);
  const resume = resumeMarkdown(status);
  const outputPath = options.output
    ? resolveProjectPath(rootDir, options.output)
    : taskFile(rootDir, id, "resume.md");
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, resume, "utf8");
  const data: TaskResumeData = { ...status, resume, outputPath };
  return { data, markdown: resume, json: toJson(data) };
}

export async function closeTask(
  rootDir: string,
  options: TaskCloseOptions = {}
): Promise<TaskCommandResult<TaskMetadata>> {
  await loadAIWikiConfig(rootDir);
  const id = await resolveTaskId(rootDir);
  const metadata = await readMetadata(rootDir, id);
  const timestamp = now();
  metadata.status = options.status ?? "done";
  metadata.updated_at = timestamp;
  metadata.closed_at = timestamp;
  await writeMetadata(rootDir, metadata);
  await resumeTask(rootDir, id);

  if ((await activeTaskId(rootDir)) === id) {
    await rm(resolveProjectPath(rootDir, ACTIVE_TASK_PATH), { force: true });
  }

  await appendLogEntry(rootDir, {
    action: "task close",
    title: metadata.title,
    bullets: [
      `Task ID: ${id}`,
      `Status: ${metadata.status}`,
      "Suggested: run `aiwiki reflect --from-git-diff` before long-term wiki updates."
    ]
  });

  return {
    data: metadata,
    markdown: `# Task Closed\n\n- Task ID: ${id}\n- Status: ${metadata.status}\n- Suggested: run \`aiwiki reflect --from-git-diff\` before long-term wiki updates.\n`,
    json: toJson(metadata)
  };
}

export async function recordTaskDecision(
  rootDir: string,
  decision: string,
  options: TaskDecisionOptions = {}
): Promise<TaskCommandResult<TaskCheckpoint>> {
  await loadAIWikiConfig(rootDir);
  const id = await resolveTaskId(rootDir);
  const event: TaskCheckpoint = {
    time: now(),
    type: "decision",
    message: decision,
    module: options.module
  };
  await appendTaskEvent(rootDir, id, event);

  return {
    data: event,
    markdown: `# Decision Recorded\n\n- Task ID: ${id}\n- Decision: ${decision}\n${options.module ? `- Module: ${options.module}\n` : ""}`,
    json: toJson(event)
  };
}

export async function recordTaskBlocker(
  rootDir: string,
  blocker: string,
  options: TaskBlockerOptions = {}
): Promise<TaskCommandResult<TaskCheckpoint>> {
  await loadAIWikiConfig(rootDir);
  const id = await resolveTaskId(rootDir);
  const event: TaskCheckpoint = {
    time: now(),
    type: "blocker",
    message: blocker,
    severity: options.severity
  };
  await appendTaskEvent(rootDir, id, event);

  return {
    data: event,
    markdown: `# Blocker Recorded\n\n- Task ID: ${id}\n- Blocker: ${blocker}\n${options.severity ? `- Severity: ${options.severity}\n` : ""}`,
    json: toJson(event)
  };
}

export { TASK_FILES };
