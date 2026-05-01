import path from "node:path";
import { doctorWiki } from "./doctor.js";
import {
  AIWikiNotInitializedError,
  createDefaultConfig,
  loadAIWikiConfig
} from "./config.js";
import { listTasks, readyTasks } from "./task.js";
import type { TaskMetadata } from "./types.js";

export interface PrimeOptions {
  limit?: number;
}

export interface PrimeAction {
  kind:
    | "resume_task"
    | "claim_ready_task"
    | "memory_health"
    | "start_context"
    | "initialize_memory"
    | "build_project_map";
  title: string;
  reason: string;
  command: string;
}

export interface PrimeContext {
  projectName: string;
  initialized: boolean;
  activeTask?: TaskMetadata;
  readyTasks: TaskMetadata[];
  memoryHealth: {
    lintErrors: number;
    lintWarnings: number;
    staleWarnings: number;
    nextActions: string[];
  };
  actions: PrimeAction[];
}

export interface PrimeResult {
  context: PrimeContext;
  markdown: string;
  json: string;
}

function bulletList(items: string[], fallback: string): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : `- ${fallback}`;
}

function taskLine(task: TaskMetadata): string {
  const priority = task.priority === undefined ? "P2" : `P${task.priority}`;
  const type = task.type ?? "task";
  const assignee = task.assignee ? `assignee ${task.assignee}` : "unclaimed";
  return `${task.id} | ${task.title} | ${priority} | ${type} | ${assignee}`;
}

function memoryHealthReason(memoryHealth: PrimeContext["memoryHealth"]): string {
  if (memoryHealth.lintErrors > 0 && memoryHealth.staleWarnings > 0) {
    return "Doctor found lint errors and stale memory warnings.";
  }
  if (memoryHealth.lintErrors > 0) {
    return "Doctor found lint errors.";
  }

  return "Doctor found stale memory warnings.";
}

function defaultProjectName(rootDir: string): string {
  return path.basename(path.resolve(rootDir)) || "project";
}

function buildActions(context: Omit<PrimeContext, "actions">): PrimeAction[] {
  const actions: PrimeAction[] = [];
  if (!context.initialized) {
    actions.push(
      {
        kind: "initialize_memory",
        title: "Initialize AIWiki memory",
        reason: "Project has no durable AIWiki memory yet.",
        command: `aiwiki init --project-name ${context.projectName}`
      },
      {
        kind: "build_project_map",
        title: "Seed project map",
        reason: "Create the first local map after initialization.",
        command: "aiwiki map --write"
      },
      {
        kind: "start_context",
        title: "Prepare Codex task context",
        reason: "Cold-start commands still work before initialization.",
        command: "aiwiki agent \"<task>\""
      }
    );
    return actions;
  }

  if (context.activeTask) {
    actions.push({
      kind: "resume_task",
      title: context.activeTask.title,
      reason: "Active task is already claimed in this workspace.",
      command: `aiwiki resume ${context.activeTask.id} --read-only`
    });
  }

  for (const task of context.readyTasks.slice(0, context.activeTask ? 2 : 3)) {
    actions.push({
      kind: "claim_ready_task",
      title: task.title,
      reason: "Open task has no unfinished blocking dependencies.",
      command: `aiwiki task claim ${task.id}`
    });
  }

  if (
    context.memoryHealth.lintErrors > 0 ||
    context.memoryHealth.staleWarnings > 0
  ) {
    actions.push({
      kind: "memory_health",
      title: "Review AIWiki memory health",
      reason: memoryHealthReason(context.memoryHealth),
      command: "aiwiki doctor"
    });
  }

  actions.push({
    kind: "start_context",
    title: "Prepare Codex task context",
    reason: "Run this for any new user request before editing files.",
    command: "aiwiki agent \"<task>\""
  });

  return actions.slice(0, 5);
}

function formatPrimeMarkdown(context: PrimeContext): string {
  return [
    "# AIWiki Prime",
    "",
    "## Setup",
    context.initialized
      ? "- AIWiki memory initialized."
      : "- Cold-start mode: no .aiwiki memory was loaded and no AIWiki files were written.",
    ...(context.initialized
      ? []
      : [
          "- Run `aiwiki init --project-name <name>` when you are ready to keep project memory.",
          "- Then run `aiwiki map --write` so future commands can use durable local context."
        ]),
    "",
    "## Active Task",
    context.activeTask
      ? `- ${taskLine(context.activeTask)}`
      : "- None",
    "",
    "## Ready Work",
    bulletList(context.readyTasks.map(taskLine), "No open unblocked tasks."),
    "",
    "## Memory Health",
    `- Lint errors: ${context.memoryHealth.lintErrors}`,
    `- Lint warnings: ${context.memoryHealth.lintWarnings}`,
    `- Stale warnings: ${context.memoryHealth.staleWarnings}`,
    "",
    "## Next Actions",
    bulletList(
      context.actions.map((action) => `${action.command} (${action.reason})`),
      "No next actions found."
    ),
    "",
    "## Operating Rules",
    "- Run `aiwiki agent \"<task>\"` or `aiwiki brief \"<task>\" --read-only` before editing.",
    "- Run `aiwiki guard <file>` before risky or concrete file edits.",
    "- Use `checkpoint`, `decision`, `blocker`, and `resume` for long tasks.",
    "- Use `reflect` then `apply` preview; do not confirm long-term memory writes without user approval."
  ].join("\n").trimEnd() + "\n";
}

export async function generatePrimeContext(
  rootDir: string,
  options: PrimeOptions = {}
): Promise<PrimeResult> {
  let initialized = true;
  let config;
  try {
    config = await loadAIWikiConfig(rootDir);
  } catch (error) {
    if (!(error instanceof AIWikiNotInitializedError)) {
      throw error;
    }

    initialized = false;
    config = createDefaultConfig(defaultProjectName(rootDir));
  }

  const taskList = initialized ? await listTasks(rootDir, { recent: 30 }) : undefined;
  const ready = initialized
    ? await readyTasks(rootDir, { limit: options.limit ?? 5 })
    : undefined;
  const doctor = initialized ? await doctorWiki(rootDir) : undefined;
  const activeTask = taskList?.data.tasks.find(
    (task) => task.id === taskList.data.activeTaskId
  );
  const baseContext: Omit<PrimeContext, "actions"> = {
    projectName: config.projectName,
    initialized,
    activeTask,
    readyTasks: ready?.data.tasks.map((item) => item.metadata) ?? [],
    memoryHealth: {
      lintErrors: doctor?.report.summary.lintErrors ?? 0,
      lintWarnings: doctor?.report.summary.lintWarnings ?? 0,
      staleWarnings: doctor?.report.summary.staleWarnings ?? 0,
      nextActions: doctor?.report.nextActions ?? [
        "Run `aiwiki init --project-name <name>` to create local project memory.",
        "Run `aiwiki map --write` after initialization to seed durable project context."
      ]
    }
  };
  const context: PrimeContext = {
    ...baseContext,
    actions: buildActions(baseContext)
  };

  return {
    context,
    markdown: formatPrimeMarkdown(context),
    json: `${JSON.stringify(context, null, 2)}\n`
  };
}
