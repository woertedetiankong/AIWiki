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
import { ACTIVE_TASK_PATH, LOCAL_ARTIFACT_IGNORE, TASKS_DIR } from "./constants.js";
import { loadAIWikiConfig } from "./config.js";
import { collectProjectIgnoreRules, shouldIgnorePath } from "./ignore.js";
import type { IgnoreRule } from "./ignore.js";
import { appendLogEntry } from "./log.js";
import { resolveProjectPath, toPosixPath } from "./paths.js";
import type {
  RiskLevel,
  TaskCheckpoint,
  TaskDependency,
  TaskDependencyType,
  TaskMetadata,
  TaskStatus,
  TaskType
} from "./types.js";

const execFileAsync = promisify(execFile);

export interface TaskStartOptions {
  id?: string;
  prd?: string;
  type?: TaskType;
  priority?: number;
  assignee?: string;
}

export interface TaskCreateOptions {
  id?: string;
  prd?: string;
  type?: TaskType;
  priority?: number;
}

export interface TaskDiscoverOptions extends TaskCreateOptions {
  from?: string;
}

export interface TaskDependencyOptions {
  type?: TaskDependencyType;
}

export interface TaskClaimOptions {
  actor?: string;
  force?: boolean;
}

export interface TaskReadyOptions {
  limit?: number;
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
  readOnly?: boolean;
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

export interface EnsureActiveTaskResult {
  metadata: TaskMetadata;
  created: boolean;
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

export interface TaskReadyItem {
  metadata: TaskMetadata;
  blockedBy: string[];
}

export interface TaskReadyData {
  activeTaskId?: string;
  tasks: TaskReadyItem[];
}

export interface TaskResumeData extends TaskStatusData {
  resume: string;
  outputPath?: string;
}

export interface TaskDependencyData {
  task: TaskMetadata;
  dependency: TaskDependency;
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

const CLOSED_STATUSES: TaskStatus[] = ["done", "cancelled"];
const READY_STATUSES: TaskStatus[] = ["open"];
const BLOCKING_DEPENDENCY_TYPES: TaskDependencyType[] = ["blocks", "parent_child"];

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 48);
}

function validatePriority(priority: number | undefined): number | undefined {
  if (priority === undefined) {
    return undefined;
  }
  if (!Number.isInteger(priority) || priority < 0 || priority > 4) {
    throw new Error(`Task priority must be an integer from 0 to 4, received: ${priority}`);
  }

  return priority;
}

function defaultActor(): string {
  return process.env.AIWIKI_ACTOR ?? process.env.USER ?? process.env.USERNAME ?? "codex";
}

function taskTypeLabel(type: TaskType | undefined): string {
  return type ?? "task";
}

function priorityLabel(priority: number | undefined): string {
  return priority === undefined ? "P2" : `P${priority}`;
}

function normalizedDependencies(metadata: TaskMetadata): TaskDependency[] {
  return metadata.dependencies ?? [];
}

function isClosedStatus(status: TaskStatus): boolean {
  return CLOSED_STATUSES.includes(status);
}

function dependencyBlocksReady(dependency: TaskDependency): boolean {
  return BLOCKING_DEPENDENCY_TYPES.includes(dependency.type);
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

async function tryReadMetadata(rootDir: string, taskId: string): Promise<TaskMetadata | undefined> {
  try {
    return await readMetadata(rootDir, taskId);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}

async function loadAllTaskMetadata(rootDir: string): Promise<TaskMetadata[]> {
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

  return tasks;
}

function shortTaskId(taskId: string): string {
  return taskId.replace(/^\d{4}-\d{2}-\d{2}-/u, "");
}

function resolveTaskReferenceFromMetadata(
  tasks: TaskMetadata[],
  reference: string,
  label = "Task"
): string {
  const exact = tasks.find((task) => task.id === reference);
  if (exact) {
    return exact.id;
  }

  const matches = tasks.filter((task) => {
    return shortTaskId(task.id) === reference ||
      task.id.endsWith(`-${reference}`);
  });

  if (matches.length === 0) {
    throw new Error(`${label} not found: ${reference}`);
  }
  if (matches.length > 1) {
    throw new Error(
      `${label} reference is ambiguous: ${reference} matches ${matches.map((task) => task.id).join(", ")}`
    );
  }

  return matches[0].id;
}

async function resolveTaskId(rootDir: string, taskId?: string): Promise<string> {
  const id = taskId ?? (await activeTaskId(rootDir));
  if (!id) {
    throw new Error("No active AIWiki task. Run `aiwiki task start \"...\"` first.");
  }

  return taskId
    ? resolveTaskReferenceFromMetadata(await loadAllTaskMetadata(rootDir), id)
    : id;
}

async function uniqueTaskId(rootDir: string, title: string): Promise<string> {
  const base = taskIdFor(title);
  if (!(await pathExists(taskDir(rootDir, base)))) {
    return base;
  }

  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base}-${index}`;
    if (!(await pathExists(taskDir(rootDir, candidate)))) {
      return candidate;
    }
  }

  throw new Error(`Unable to create a unique task id for: ${title}`);
}

function taskById(tasks: TaskMetadata[]): Map<string, TaskMetadata> {
  return new Map(tasks.map((task) => [task.id, task]));
}

function blockingDependencyIds(task: TaskMetadata, tasksById: Map<string, TaskMetadata>): string[] {
  return normalizedDependencies(task)
    .filter(dependencyBlocksReady)
    .filter((dependency) => {
      const dependencyTask = tasksById.get(dependency.id);
      return !dependencyTask || !isClosedStatus(dependencyTask.status);
    })
    .map((dependency) => dependency.id)
    .sort();
}

function assertNoDependencyCycle(
  tasksById: Map<string, TaskMetadata>,
  childId: string,
  parentId: string
): void {
  if (childId === parentId) {
    throw new Error(`Task cannot depend on itself: ${childId}`);
  }

  const visit = (currentId: string, seen: Set<string>): boolean => {
    if (currentId === childId) {
      return true;
    }
    if (seen.has(currentId)) {
      return false;
    }

    seen.add(currentId);
    const current = tasksById.get(currentId);
    if (!current) {
      return false;
    }

    return normalizedDependencies(current)
      .filter(dependencyBlocksReady)
      .some((dependency) => visit(dependency.id, seen));
  };

  if (visit(parentId, new Set<string>())) {
    throw new Error(`Adding dependency ${childId} -> ${parentId} would create a cycle.`);
  }
}

function filterIgnoredFiles(files: string[], ignoreRules: readonly IgnoreRule[]): string[] {
  return files.filter((file) => !shouldIgnorePath(file, ignoreRules));
}

async function gitChangedFiles(rootDir: string, ignoreRules: readonly IgnoreRule[]): Promise<string[]> {
  const files = new Set<string>();
  try {
    const { stdout } = await execFileAsync("git", ["diff", "--name-only", "--", "."], {
      cwd: rootDir,
      maxBuffer: 1024 * 1024
    });
    for (const file of stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((file) => toPosixPath(file))) {
      files.add(file);
    }
  } catch {
    // Non-git projects can still checkpoint explicit notes.
  }

  try {
    const { stdout } = await execFileAsync("git", ["status", "--short"], {
      cwd: rootDir,
      maxBuffer: 1024 * 1024
    });
    for (const file of stdout
      .split("\n")
      .map(statusFile)
      .filter((file): file is string => Boolean(file))) {
      files.add(file);
    }
  } catch {
    // Ignore git status failures for cold-start or non-git workspaces.
  }

  return filterIgnoredFiles([...files].sort(), ignoreRules);
}

function statusFile(line: string): string | undefined {
  const trimmed = line.trim();
  if (!trimmed) {
    return undefined;
  }

  const renamed = /^R\s+(.+?)\s+->\s+(.+)$/u.exec(trimmed);
  if (renamed) {
    return toPosixPath(renamed[2] ?? "");
  }

  const match = /^(?:[ MADRCU?!]{2})\s+(.+)$/u.exec(line);
  return match?.[1] ? toPosixPath(match[1]) : undefined;
}

async function projectFileExists(rootDir: string, relativePath: string): Promise<boolean> {
  try {
    const fileStat = await stat(resolveProjectPath(rootDir, relativePath));
    return fileStat.isFile();
  } catch {
    return false;
  }
}

function directTestCandidate(file: string): string | undefined {
  const parsed = path.parse(file);
  if (!file.startsWith("src/") || !parsed.name) {
    return undefined;
  }
  return `tests/${parsed.name}.test.ts`;
}

async function suggestedTests(rootDir: string, files: string[]): Promise<string[]> {
  const commands: string[] = [];
  for (const file of files) {
    const candidate = directTestCandidate(file);
    if (candidate && await projectFileExists(rootDir, candidate)) {
      commands.push(`Suggested test command: npm run test -- ${candidate}`);
    }
  }

  if (commands.length === 0 && await projectFileExists(rootDir, "package.json")) {
    commands.push("Suggested test command: npm run test");
  }

  return [...new Set(commands)].slice(0, 3);
}

function inferredNextSteps(files: string[], tests: string[]): string[] {
  const steps: string[] = [];
  const firstSourceFile = files.find((file) =>
    !file.startsWith(".aiwiki/") &&
    !file.startsWith("docs/") &&
    !file.endsWith(".md")
  );
  if (firstSourceFile) {
    steps.push(`Run aiwiki guard ${firstSourceFile} before the next edit.`);
  }
  if (tests.length > 0) {
    steps.push(`Run ${tests[0].replace(/^Suggested test command: /u, "")}.`);
  }
  steps.push("Run aiwiki resume --read-only at the start of the next session.");
  return steps;
}

function splitList(values: string[] | undefined): string[] {
  return values?.flatMap((value) => value.split("\n")).map((value) => value.trim()).filter(Boolean) ?? [];
}

function bulletList(items: string[], fallback: string): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : `- ${fallback}`;
}

function taskMd(metadata: TaskMetadata): string {
  const dependencies = normalizedDependencies(metadata);
  return `# Task: ${metadata.title}

## Task ID
${metadata.id}

## Workflow
- Status: ${metadata.status}
- Type: ${taskTypeLabel(metadata.type)}
- Priority: ${priorityLabel(metadata.priority)}
- Assignee: ${metadata.assignee ?? "unclaimed"}

## Dependencies
${bulletList(
  dependencies.map((dependency) => `${dependency.id} (${dependency.type})`),
  "No dependencies recorded."
)}

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

  if (checkpoint.type === "task_claimed") {
    return [
      "Task claimed.",
      checkpoint.actor ? `Actor: ${checkpoint.actor}` : undefined
    ].filter(Boolean).join(" | ");
  }

  if (checkpoint.type === "dependency_added") {
    return [
      "Dependency added.",
      checkpoint.dependency_id ? `Dependency: ${checkpoint.dependency_id}` : undefined,
      checkpoint.dependency_type ? `Type: ${checkpoint.dependency_type}` : undefined
    ].filter(Boolean).join(" | ");
  }

  if (checkpoint.type === "task_discovered") {
    return [
      checkpoint.message ? `Discovered: ${checkpoint.message}` : "Task discovered.",
      checkpoint.from ? `From: ${checkpoint.from}` : undefined
    ].filter(Boolean).join(" | ");
  }

  if (checkpoint.type === "task_created") {
    return checkpoint.message ? `Task created: ${checkpoint.message}` : "Task created.";
  }

  if (checkpoint.type === "task_closed") {
    return [
      "Task closed.",
      checkpoint.status ? `Status: ${checkpoint.status}` : undefined
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
    event.type !== "blocker" &&
    event.type !== "task_created" &&
    event.type !== "task_claimed" &&
    event.type !== "dependency_added" &&
    event.type !== "task_discovered" &&
    event.type !== "task_closed"
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
  const latestNextCheckpoint = [...checkpointEvents]
    .reverse()
    .find((checkpoint) => checkpoint.next && checkpoint.next.length > 0);
  const next = latestNextCheckpoint?.next ?? [];

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
  const latestCheckpointWithFiles = [...checkpoints]
    .reverse()
    .find((checkpoint) =>
      checkpoint.type === "checkpoint" &&
      checkpoint.files &&
      checkpoint.files.length > 0
    );
  const files = [...new Set(latestCheckpointWithFiles?.files ?? [])].sort();
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
      if (
        item !== "None yet." &&
        item !== "None recorded." &&
        !item.startsWith("No ")
      ) {
        items.push(item);
      }
    }
  }

  return items;
}

function bulletItems(markdown: string): string[] {
  return markdown
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.replace(/^- /u, ""))
    .filter(
      (line) =>
        !line.startsWith("No ") &&
        line !== "None recorded." &&
        line !== "None yet."
    );
}

function limitItems(items: string[], limit: number): string[] {
  if (items.length <= limit) {
    return items;
  }

  return [
    ...items.slice(0, limit),
    `${items.length - limit} more item(s) omitted from markdown; use --format json for full task state.`
  ];
}

function resumeMarkdown(
  status: TaskStatusData,
  options: Pick<TaskResumeOptions, "readOnly"> = {}
): string {
  const completed = excerptList(status.progress, "Completed");
  const inProgress = excerptList(status.progress, "In Progress");
  const notStarted = excerptList(status.progress, "Not Started");
  const next = excerptList(status.progress, "Next Recommended Steps");
  const changed = bulletItems(status.changedFiles);
  const tests = bulletItems(status.tests);
  const decisions = bulletItems(status.decisions);
  const blockers = bulletItems(status.blockers);
  const continueFromHere = [
    next[0] ? `Next: ${next[0]}` : undefined,
    inProgress[0] ? `In progress: ${inProgress[0]}` : undefined,
    completed[0] && !next[0] && !inProgress[0]
      ? `Last completed: ${completed[0]}`
      : undefined
  ].filter((item): item is string => Boolean(item));
  const nextAction = next[0] ??
    inProgress[0] ??
    completed[0] ??
    "Inspect the current git diff before editing.";

  return `# Resume Brief for Codex

下一步做什么 / Next Action: ${nextAction}

## Mode Boundary
${options.readOnly
  ? "- Read-only mode: generated from task state only; no resume files or output files were written."
  : "- Write mode: this command refreshes the task resume file or the requested --output path."}
- To inspect task continuity without writes, run \`aiwiki resume --read-only\`.

## Continue From Here
${bulletList(continueFromHere, "No next step recorded. Inspect the current git diff before editing.")}

## Next Steps
${bulletList(limitItems(next, 5), "No next steps recorded.")}

## Current Status
- Task: ${status.metadata.title}
- Task ID: ${status.metadata.id}
- Status: ${status.metadata.status}
- Last Completed: ${completed.at(-1) ?? "No completed work recorded."}
- In Progress: ${inProgress[0] ?? "No in-progress work recorded."}

## Changed Files
${bulletList(limitItems(changed, 12), "No changed files recorded.")}

## Tests
${bulletList(limitItems(tests, 6), "No tests recorded.")}

## Decisions
${bulletList(limitItems(decisions, 5), "None recorded.")}

## Blockers
${bulletList(limitItems(blockers, 5), "None recorded.")}

## Codex Instructions
- Use this resume brief as the source of truth for the current task state.
- Do not restart from scratch.
- First inspect the changed files and current git diff.
- If this brief conflicts with the repository state, report the mismatch before editing.
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
  const dependencies = normalizedDependencies(status.metadata);
  const completed = excerptList(status.progress, "Completed");
  const inProgress = excerptList(status.progress, "In Progress");
  const next = excerptList(status.progress, "Next Recommended Steps");
  const changed = bulletItems(status.changedFiles);
  const tests = bulletItems(status.tests);
  const decisions = bulletItems(status.decisions);
  const blockers = bulletItems(status.blockers);
  return `# Task Status

## Active Task
- ${status.metadata.title}
- Task ID: ${status.metadata.id}
- Status: ${status.metadata.status}

## Workflow
- Type: ${taskTypeLabel(status.metadata.type)}
- Priority: ${priorityLabel(status.metadata.priority)}
- Assignee: ${status.metadata.assignee ?? "unclaimed"}
- Dependencies: ${dependencies.length > 0 ? dependencies.map((dependency) => `${dependency.id} (${dependency.type})`).join(", ") : "none"}

## Progress
- Last completed: ${completed.at(-1) ?? "No completed work recorded."}
- In progress: ${inProgress[0] ?? "No in-progress work recorded."}

## Next Steps
${bulletList(limitItems(next, 5), "No next steps recorded.")}

## Changed Files
${bulletList(limitItems(changed, 12), "No changed files recorded.")}

## Tests
${bulletList(limitItems(tests, 6), "No tests recorded.")}

## Decisions
${bulletList(limitItems(decisions, 5), "None recorded.")}

## Blockers
${bulletList(limitItems(blockers, 5), "None recorded.")}

## Checkpoints
${checkpointsMarkdown(status.checkpoints.slice(-8))}
`;
}

function listMarkdown(data: TaskListData): string {
  const active = data.tasks.find((task) => task.id === data.activeTaskId);
  return `# AIWiki Tasks

## Active
${active ? `- ${active.id} | ${active.title} | ${active.status} | ${priorityLabel(active.priority)}` : "- None"}

## Recent
${bulletList(
  data.tasks.map((task) => `${task.id} | ${task.title} | ${task.status} | ${priorityLabel(task.priority)} | ${taskTypeLabel(task.type)}`),
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

async function writeInitialTaskFiles(rootDir: string, metadata: TaskMetadata): Promise<void> {
  const dir = taskDir(rootDir, metadata.id);
  await mkdir(dir, { recursive: true });
  await writeMetadata(rootDir, metadata);
  await writeFile(taskFile(rootDir, metadata.id, "task.md"), taskMd(metadata), "utf8");
  await writeFile(taskFile(rootDir, metadata.id, "brief.md"), "# Brief\n\n- Not recorded.\n", "utf8");
  await writeFile(taskFile(rootDir, metadata.id, "plan.md"), "# Plan\n\n- Not recorded.\n", "utf8");
  await writeFile(taskFile(rootDir, metadata.id, "progress.md"), initialProgressMd(), "utf8");
  await writeFile(taskFile(rootDir, metadata.id, "decisions.md"), emptySection("Decisions"), "utf8");
  await writeFile(taskFile(rootDir, metadata.id, "blockers.md"), emptySection("Blockers"), "utf8");
  await writeFile(taskFile(rootDir, metadata.id, "changed-files.md"), emptySection("Changed Files"), "utf8");
  await writeFile(taskFile(rootDir, metadata.id, "tests.md"), emptySection("Tests"), "utf8");
  await writeFile(taskFile(rootDir, metadata.id, "checkpoints.jsonl"), "", "utf8");
  await writeFile(taskFile(rootDir, metadata.id, "resume.md"), "", "utf8");
  if (metadata.prd) {
    await writeFile(
      taskFile(rootDir, metadata.id, "prd-progress.md"),
      "# PRD Implementation Progress\n\n- Not generated in no-LLM mode.\n",
      "utf8"
    );
  }
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
    type: options.type ?? "task",
    priority: validatePriority(options.priority),
    assignee: options.assignee ?? defaultActor(),
    claimed_at: timestamp,
    created_at: timestamp,
    updated_at: timestamp,
    prd: options.prd
  };

  await writeInitialTaskFiles(rootDir, metadata);
  await mkdir(resolveProjectPath(rootDir, TASKS_DIR), { recursive: true });
  await writeFile(resolveProjectPath(rootDir, ACTIVE_TASK_PATH), id, "utf8");
  await appendTaskEvent(rootDir, id, {
    time: timestamp,
    type: "task_created",
    message: title,
    task_id: id
  });
  await appendTaskEvent(rootDir, id, {
    time: timestamp,
    type: "task_claimed",
    actor: metadata.assignee,
    task_id: id
  });
  await appendLogEntry(rootDir, {
    action: "task start",
    title,
    bullets: [`Task ID: ${id}`]
  });

  return {
    data: metadata,
    markdown: `# Task Started\n\n- Task ID: ${id}\n- Title: ${title}\n- Status: in_progress\n- Assignee: ${metadata.assignee}\n`,
    json: toJson(metadata)
  };
}

export async function ensureActiveTask(
  rootDir: string,
  title: string,
  options: TaskStartOptions = {}
): Promise<TaskCommandResult<EnsureActiveTaskResult>> {
  await loadAIWikiConfig(rootDir);

  const activeId = await activeTaskId(rootDir);
  if (activeId) {
    const metadata = await tryReadMetadata(rootDir, activeId);
    if (metadata && !isClosedStatus(metadata.status)) {
      return {
        data: { metadata, created: false },
        markdown: `# Active Task Ready\n\n- Task ID: ${metadata.id}\n- Title: ${metadata.title}\n- Status: ${metadata.status}\n`,
        json: toJson({ metadata, created: false })
      };
    }
  }

  const baseId = options.id ?? taskIdFor(title);
  const existing = await tryReadMetadata(rootDir, baseId);
  if (existing && !isClosedStatus(existing.status)) {
    const claimed = await claimTask(rootDir, existing.id, {
      actor: options.assignee
    });
    return {
      data: { metadata: claimed.data, created: false },
      markdown: `# Active Task Ready\n\n- Task ID: ${claimed.data.id}\n- Title: ${claimed.data.title}\n- Status: ${claimed.data.status}\n`,
      json: toJson({ metadata: claimed.data, created: false })
    };
  }

  const started = await startTask(rootDir, title, {
    ...options,
    id: options.id ?? (await uniqueTaskId(rootDir, title))
  });
  return {
    data: { metadata: started.data, created: true },
    markdown: `# Active Task Created\n\n- Task ID: ${started.data.id}\n- Title: ${started.data.title}\n- Status: ${started.data.status}\n`,
    json: toJson({ metadata: started.data, created: true })
  };
}

export async function listTasks(
  rootDir: string,
  options: TaskListOptions = {}
): Promise<TaskCommandResult<TaskListData>> {
  await loadAIWikiConfig(rootDir);
  const tasks = await loadAllTaskMetadata(rootDir);

  const filtered = tasks
    .filter((task) => (options.status ? task.status === options.status : true))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, options.recent);
  const data = { activeTaskId: await activeTaskId(rootDir), tasks: filtered };
  return { data, markdown: listMarkdown(data), json: toJson(data) };
}

export async function createTask(
  rootDir: string,
  title: string,
  options: TaskCreateOptions = {}
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
    status: "open",
    type: options.type ?? "task",
    priority: validatePriority(options.priority),
    created_at: timestamp,
    updated_at: timestamp,
    prd: options.prd
  };

  await writeInitialTaskFiles(rootDir, metadata);
  await appendTaskEvent(rootDir, id, {
    time: timestamp,
    type: "task_created",
    message: title,
    task_id: id
  });
  await appendLogEntry(rootDir, {
    action: "task create",
    title,
    bullets: [`Task ID: ${id}`, "Status: open"]
  });

  return {
    data: metadata,
    markdown: `# Task Created\n\n- Task ID: ${id}\n- Title: ${title}\n- Status: open\n`,
    json: toJson(metadata)
  };
}

export async function discoverTask(
  rootDir: string,
  title: string,
  options: TaskDiscoverOptions = {}
): Promise<TaskCommandResult<TaskMetadata>> {
  const from = options.from
    ? await resolveTaskId(rootDir, options.from)
    : await activeTaskId(rootDir);
  const created = await createTask(rootDir, title, options);
  const metadata = created.data;

  if (from) {
    const dependency: TaskDependency = {
      id: from,
      type: "discovered_from",
      created_at: now()
    };
    metadata.dependencies = [dependency];
    metadata.updated_at = dependency.created_at;
    await writeMetadata(rootDir, metadata);
    await writeFile(taskFile(rootDir, metadata.id, "task.md"), taskMd(metadata), "utf8");
    await appendTaskEvent(rootDir, metadata.id, {
      time: dependency.created_at,
      type: "task_discovered",
      message: title,
      task_id: metadata.id,
      from
    });
  }

  return {
    data: metadata,
    markdown: `# Task Discovered\n\n- Task ID: ${metadata.id}\n- Title: ${title}\n- Status: open\n${from ? `- Discovered From: ${from}\n` : ""}`,
    json: toJson(metadata)
  };
}

export async function addTaskDependency(
  rootDir: string,
  taskId: string,
  dependencyId: string,
  options: TaskDependencyOptions = {}
): Promise<TaskCommandResult<TaskDependencyData>> {
  await loadAIWikiConfig(rootDir);
  const tasks = await loadAllTaskMetadata(rootDir);
  const tasksById = taskById(tasks);
  const resolvedTaskId = resolveTaskReferenceFromMetadata(tasks, taskId);
  const resolvedDependencyId = resolveTaskReferenceFromMetadata(
    tasks,
    dependencyId,
    "Dependency task"
  );
  const task = tasksById.get(resolvedTaskId);
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }

  const type = options.type ?? "blocks";
  if (dependencyBlocksReady({ id: resolvedDependencyId, type, created_at: now() })) {
    assertNoDependencyCycle(tasksById, resolvedTaskId, resolvedDependencyId);
  }

  const dependencies = normalizedDependencies(task);
  const existing = dependencies.find(
    (dependency) => dependency.id === resolvedDependencyId && dependency.type === type
  );
  if (existing) {
    return {
      data: { task, dependency: existing },
      markdown: `# Dependency Already Exists\n\n- Task ID: ${resolvedTaskId}\n- Dependency: ${resolvedDependencyId}\n- Type: ${type}\n`,
      json: toJson({ task, dependency: existing })
    };
  }

  const timestamp = now();
  const dependency: TaskDependency = {
    id: resolvedDependencyId,
    type,
    created_at: timestamp
  };
  task.dependencies = [...dependencies, dependency].sort((a, b) => a.id.localeCompare(b.id));
  task.updated_at = timestamp;
  await writeMetadata(rootDir, task);
  await writeFile(taskFile(rootDir, task.id, "task.md"), taskMd(task), "utf8");
  await appendTaskEvent(rootDir, task.id, {
    time: timestamp,
    type: "dependency_added",
    task_id: task.id,
    dependency_id: resolvedDependencyId,
    dependency_type: type
  });

  return {
    data: { task, dependency },
    markdown: `# Dependency Added\n\n- Task ID: ${resolvedTaskId}\n- Dependency: ${resolvedDependencyId}\n- Type: ${type}\n`,
    json: toJson({ task, dependency })
  };
}

export async function claimTask(
  rootDir: string,
  taskId?: string,
  options: TaskClaimOptions = {}
): Promise<TaskCommandResult<TaskMetadata>> {
  await loadAIWikiConfig(rootDir);
  const id = await resolveTaskId(rootDir, taskId);
  const metadata = await readMetadata(rootDir, id);
  if (isClosedStatus(metadata.status)) {
    throw new Error(`Cannot claim closed task: ${id}`);
  }
  if (!options.force) {
    const blockers = blockingDependencyIds(metadata, taskById(await loadAllTaskMetadata(rootDir)));
    if (blockers.length > 0) {
      throw new Error(
        `Task ${id} is blocked by unfinished dependencies: ${blockers.join(", ")}. Use --force to claim anyway.`
      );
    }
  }

  const timestamp = now();
  metadata.status = "in_progress";
  metadata.assignee = options.actor ?? defaultActor();
  metadata.claimed_at = timestamp;
  metadata.updated_at = timestamp;
  await writeMetadata(rootDir, metadata);
  await writeFile(taskFile(rootDir, id, "task.md"), taskMd(metadata), "utf8");
  await mkdir(resolveProjectPath(rootDir, TASKS_DIR), { recursive: true });
  await writeFile(resolveProjectPath(rootDir, ACTIVE_TASK_PATH), id, "utf8");
  await appendTaskEvent(rootDir, id, {
    time: timestamp,
    type: "task_claimed",
    actor: metadata.assignee,
    task_id: id
  });

  return {
    data: metadata,
    markdown: `# Task Claimed\n\n- Task ID: ${id}\n- Status: in_progress\n- Assignee: ${metadata.assignee}\n`,
    json: toJson(metadata)
  };
}

function readyMarkdown(data: TaskReadyData): string {
  return `# Ready AIWiki Tasks

## Active
${data.activeTaskId ? `- ${data.activeTaskId}` : "- None"}

## Ready
${bulletList(
  data.tasks.map(({ metadata }) => {
    const details = [
      priorityLabel(metadata.priority),
      taskTypeLabel(metadata.type),
      metadata.assignee ? `assignee ${metadata.assignee}` : "unclaimed"
    ];
    return `${metadata.id} | ${metadata.title} | ${details.join(" | ")}`;
  }),
  "No open tasks are ready."
)}
`;
}

export async function readyTasks(
  rootDir: string,
  options: TaskReadyOptions = {}
): Promise<TaskCommandResult<TaskReadyData>> {
  await loadAIWikiConfig(rootDir);
  const tasks = await loadAllTaskMetadata(rootDir);
  const tasksById = taskById(tasks);
  const ready = tasks
    .filter((task) => READY_STATUSES.includes(task.status))
    .map((metadata) => ({
      metadata,
      blockedBy: blockingDependencyIds(metadata, tasksById)
    }))
    .filter((item) => item.blockedBy.length === 0)
    .sort((a, b) => {
      const priorityA = a.metadata.priority ?? 2;
      const priorityB = b.metadata.priority ?? 2;
      if (priorityA !== priorityB) {
        return priorityA - priorityB;
      }

      return a.metadata.updated_at.localeCompare(b.metadata.updated_at);
    })
    .slice(0, options.limit);
  const data = { activeTaskId: await activeTaskId(rootDir), tasks: ready };

  return {
    data,
    markdown: readyMarkdown(data),
    json: toJson(data)
  };
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
  const config = await loadAIWikiConfig(rootDir);
  const id = await resolveTaskId(rootDir);
  const ignoreRules = await collectProjectIgnoreRules(
    rootDir,
    LOCAL_ARTIFACT_IGNORE,
    config.ignore
  );
  const files = options.fromGitDiff === false
    ? []
    : await gitChangedFiles(rootDir, ignoreRules);
  const explicitTests = splitList(options.tests);
  const tests = explicitTests.length > 0
    ? explicitTests
    : await suggestedTests(rootDir, files);
  const explicitNext = splitList(options.next);
  const next = explicitNext.length > 0
    ? explicitNext
    : inferredNextSteps(files, tests);
  const checkpoint: TaskCheckpoint = {
    time: now(),
    type: "checkpoint",
    message: options.message,
    step: options.step,
    status: options.status,
    tests,
    next,
    files
  };

  await appendTaskEvent(rootDir, id, checkpoint);

  return {
    data: checkpoint,
    markdown: `# Checkpoint Recorded

- Task ID: ${id}
- ${checkpointLine(checkpoint)}

## Changed Files
${bulletList(files, "No changed files captured.")}

## Tests
${bulletList(tests, "No tests or suggested tests recorded.")}

## Next Actions
${bulletList(next, "No next action recorded.")}
`,
    json: toJson(checkpoint)
  };
}

export async function resumeTask(
  rootDir: string,
  taskId?: string,
  options: TaskResumeOptions = {}
): Promise<TaskCommandResult<TaskResumeData>> {
  if (options.readOnly && options.output) {
    throw new Error("Cannot use --read-only with --output because --output writes a file.");
  }

  await loadAIWikiConfig(rootDir);
  const id = await resolveTaskId(rootDir, taskId);
  const status = await loadStatus(rootDir, id);
  const resume = resumeMarkdown(status, { readOnly: options.readOnly });
  const outputPath = options.readOnly
    ? undefined
    : options.output
      ? resolveProjectPath(rootDir, options.output)
      : taskFile(rootDir, id, "resume.md");
  if (outputPath) {
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, resume, "utf8");
  }
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
  await appendTaskEvent(rootDir, id, {
    time: timestamp,
    type: "task_closed",
    task_id: id,
    status: metadata.status
  });
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
