import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { promisify } from "node:util";
import { generateAgentContext } from "./agent.js";
import type { AgentContextOptions } from "./agent.js";
import { AIWikiNotInitializedError, loadAIWikiConfig } from "./config.js";
import { changedGuardTargetsFromGitStatus } from "./git-guard-targets.js";
import type { OutputFormat } from "./output.js";
import { resolveProjectPath, toPosixPath } from "./paths.js";
import { representativeRiskFiles, semanticChangeRiskMessages } from "./risk-rules.js";
import { shellQuote } from "./shell-quote.js";

const execFileAsync = promisify(execFile);

export interface CodexRunbookOptions extends AgentContextOptions {
  format?: OutputFormat;
  team?: boolean;
  readOnly?: boolean;
}

export type CodexTeamRoleName = "Implementer" | "Reviewer" | "Memory Steward";

export interface CodexTeamRunbookRole {
  name: CodexTeamRoleName;
  purpose: string;
  commands: string[];
  mustNot: string[];
}

export interface CodexTeamRunbook {
  enabled: boolean;
  roles: CodexTeamRunbookRole[];
}

export interface CodexRunbook {
  task: string;
  projectName: string;
  initialized: boolean;
  guardTargets: string[];
  team?: CodexTeamRunbook;
  commands: {
    start: string[];
    beforeEditing: string[];
    afterEditing: string[];
    memoryReview: string[];
  };
  sections: Array<{
    title: string;
    items: string[];
  }>;
}

export interface CodexRunbookResult {
  runbook: CodexRunbook;
  markdown: string;
  json: string;
}

function taskSlug(task: string): string {
  const slug = task
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 48);
  if (slug.length > 0) {
    return slug;
  }

  let hash = 0;
  for (const char of task) {
    hash = (hash * 31 + char.charCodeAt(0)) % 100000;
  }

  return `task-${hash.toString().padStart(5, "0")}`;
}

function formatSection(title: string, items: string[]): string {
  return `## ${title}\n${items.map((item) => `- ${item}`).join("\n")}`;
}

function formatTeamSection(team: CodexTeamRunbook): string[] {
  const sections = [
    "## Team Mode",
    "- Treat this as a Codex operator checklist, not a manual command list for the human user.",
    "- Codex may delegate work to multiple agents, but AIWiki does not create or manage agents.",
    "- AIWiki provides shared memory, guardrails, reflect candidates, and handoff checks.",
    ""
  ];

  for (const role of team.roles) {
    sections.push(
      `## ${role.name} Agent`,
      `- Purpose: ${role.purpose}`,
      ...role.commands.map((command) => `- ${command}`),
      ...role.mustNot.map((item) => `- Must not: ${item}`),
      ""
    );
  }

  sections.push(
    "## Handoff Rules",
    "- Record checkpoints after meaningful progress without waiting for the user to ask.",
    "- Use checkpoint/resume for long tasks.",
    "- Final answer must report code changes, tests, and memory health."
  );

  return sections;
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

async function trackedFilesFromGit(rootDir: string): Promise<string[]> {
  let stdout = "";
  try {
    ({ stdout } = await execFileAsync("git", ["ls-files"], {
      cwd: rootDir,
      maxBuffer: 1024 * 1024
    }));
  } catch {
    return [];
  }

  return unique(
    stdout
      .split("\n")
      .map((file) => file.trim())
      .filter((file) => file.length > 0)
      .map((file) => toPosixPath(file).replace(/^\.\//u, ""))
  );
}

async function representativeGuardTargetsFromGit(rootDir: string): Promise<string[]> {
  const files = await trackedFilesFromGit(rootDir);
  const existingFiles: string[] = [];
  for (const file of files) {
    try {
      if ((await stat(resolveProjectPath(rootDir, file))).isFile()) {
        existingFiles.push(file);
      }
    } catch {
      // Sparse checkouts can list paths whose blobs are intentionally absent.
    }
  }

  const candidates = representativeRiskFiles(existingFiles, 80);
  const readableCandidates: string[] = [];
  const riskyTargets: string[] = [];

  for (const candidate of candidates) {
    try {
      const content = await readFile(resolveProjectPath(rootDir, candidate), "utf8");
      readableCandidates.push(candidate);
      if (semanticChangeRiskMessages({ filePath: candidate, content, files }).length > 0) {
        riskyTargets.push(candidate);
      }
    } catch {
      // Unreadable paths should not be suggested as guard targets.
    }
  }

  return unique([...riskyTargets, ...readableCandidates]).slice(0, 5);
}

async function isGitRepository(rootDir: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: rootDir,
      maxBuffer: 1024 * 1024
    });
    return stdout.trim() === "true";
  } catch {
    return false;
  }
}

async function existingGuardTargets(
  rootDir: string,
  targets: string[]
): Promise<string[]> {
  const existing: string[] = [];
  for (const target of unique(targets)) {
    try {
      if ((await stat(resolveProjectPath(rootDir, target))).isFile()) {
        existing.push(target);
      }
    } catch {
      // Stale memory can reference files that no longer exist; do not turn those into guard commands.
    }
  }

  return existing;
}

export function formatCodexRunbookMarkdown(runbook: CodexRunbook): string {
  const formattedSections = runbook.sections.flatMap((section) => {
    const output = [
      formatSection(section.title, section.items),
      ""
    ];
    if (runbook.team && section.title === "Codex Contract") {
      output.push(...formatTeamSection(runbook.team), "");
    }
    return output;
  });

  return [
    `# Codex AIWiki Runbook: ${runbook.task}`,
    "",
    ...formattedSections
  ].join("\n").trimEnd() + "\n";
}

function codexRunbookToJson(runbook: CodexRunbook): string {
  return `${JSON.stringify(runbook, null, 2)}\n`;
}

function createTeamRunbook(
  task: string,
  initialized: boolean,
  readOnly: boolean
): CodexTeamRunbook {
  const agentCommand = `aiwiki agent ${shellQuote(task)}${readOnly ? " --read-only" : ""}`;
  return {
    enabled: true,
    roles: [
      {
        name: "Implementer",
        purpose: "Make the smallest safe code change with file-level guardrails.",
        commands: [
          "Translate the user's natural-language request into current scope and likely files.",
          "Run `aiwiki prime`.",
          readOnly
            ? "Read-only mode: skip task ready, task claim, and project-map bootstrapping commands."
            : initialized
            ? "Run `aiwiki task ready --format json` and claim ready work when the user wants task-graph coordination."
            : "If prime reports cold-start mode, skip task graph commands until after `aiwiki init` and `aiwiki map --write`.",
          readOnly
            ? "Use read-only agent context for handoff; do not claim or mutate task state."
            : initialized
            ? "Run `aiwiki task claim <id>` only for unblocked work unless the user explicitly approves `--force`."
            : "Use cold-start `aiwiki agent` and `aiwiki guard` output instead of claiming tasks.",
          `Run \`${agentCommand}\`.`,
          "Run `aiwiki guard <file>` before editing.",
          "Make the smallest safe implementation.",
          "Run focused tests."
        ],
        mustNot: [
          "skip guardrails before editing concrete files",
          "confirm long-term memory writes"
        ]
      },
      {
        name: "Reviewer",
        purpose: "Review changed files, risk signals, and memory health.",
        commands: [
          "Run `aiwiki prime`.",
          initialized
            ? "Check `aiwiki task status <id>` for claimed work."
            : "If AIWiki is not initialized, treat doctor output as setup guidance rather than memory health.",
          "Review changed files.",
          "Run `aiwiki guard <changed-file>`.",
          "Run `aiwiki doctor`.",
          "Check stale memory and high-risk files."
        ],
        mustNot: [
          "promote rules or rewrite durable memory without user approval",
          "treat doctor rule promotion candidates as automatic changes"
        ]
      },
      {
        name: "Memory Steward",
        purpose: "Convert useful finished-work lessons into reviewed candidate memory.",
        commands: [
          "Run `aiwiki reflect --from-git-diff --read-only`.",
          initialized
            ? "If useful, generate an output plan."
            : "If AIWiki is not initialized, report candidate lessons but do not generate an output plan yet.",
          initialized
            ? "Preview with `aiwiki apply <plan>`."
            : "Initialize AIWiki before previewing durable memory writes."
        ],
        mustNot: [
          "run `aiwiki apply <plan> --confirm` without user approval"
        ]
      }
    ]
  };
}

async function isAIWikiInitialized(rootDir: string): Promise<boolean> {
  try {
    await loadAIWikiConfig(rootDir);
    return true;
  } catch (error) {
    if (error instanceof AIWikiNotInitializedError) {
      return false;
    }

    throw error;
  }
}

export async function generateCodexRunbook(
  rootDir: string,
  task: string,
  options: CodexRunbookOptions = {}
): Promise<CodexRunbookResult> {
  const agent = await generateAgentContext(rootDir, task, {
    limit: options.limit,
    withGraphify: options.withGraphify,
    architectureGuard: options.architectureGuard,
    format: options.format
  });
  const initialized = await isAIWikiInitialized(rootDir);
  const gitRepository = await isGitRepository(rootDir);
  const dirtyGuardTargets = await changedGuardTargetsFromGitStatus(rootDir);
  const representativeGuardTargets = await representativeGuardTargetsFromGit(rootDir);
  const guardTargets = (await existingGuardTargets(rootDir, [
    ...dirtyGuardTargets,
    ...agent.context.guardTargets,
    ...representativeGuardTargets
  ])).slice(0, 5);
  const planPath = `.aiwiki/context-packs/${taskSlug(task)}-reflect-plan.json`;
  const agentCommand = `aiwiki agent ${shellQuote(task)}${options.readOnly ? " --read-only" : ""}`;
  const start = [
    "aiwiki prime",
    agentCommand,
    guardTargets.length > 0
      ? `aiwiki guard ${guardTargets[0]}`
      : "aiwiki brief \"<task>\" --read-only"
  ];
  const beforeEditing = guardTargets.map((target) => `aiwiki guard ${target}`);
  const afterEditing = [
    "Run the focused project tests for changed behavior.",
    gitRepository
      ? "aiwiki reflect --from-git-diff --read-only"
      : "No git repository detected; use `aiwiki reflect --notes <path> --read-only` for explicit handoff/docs, or skip git-diff reflection.",
    "aiwiki doctor",
    initialized ? "aiwiki lint" : undefined
  ].filter((item): item is string => Boolean(item));
  const memoryReview = initialized
    ? gitRepository
      ? [
        `If reflect reports useful candidate memory, run: aiwiki reflect --from-git-diff --output-plan ${planPath}`,
        `Preview it with: aiwiki apply ${planPath}`,
        "Do not run apply --confirm unless the user explicitly approves the candidate memory."
      ]
      : [
          `For durable memory from explicit notes, run: aiwiki reflect --notes <path> --save-raw --output-plan ${planPath}`,
          `Preview it with: aiwiki apply ${planPath}`,
          "Do not run apply --confirm unless the user explicitly approves the candidate memory."
        ]
    : [
        "Reflect can summarize changed files in cold-start mode, but output plans require initialized AIWiki memory.",
        "Run `aiwiki init --project-name <name>` and `aiwiki map --write` before creating durable memory update plans.",
        "Do not run apply --confirm unless the user explicitly approves the candidate memory."
  ];
  const team = options.team
    ? createTeamRunbook(task, initialized, options.readOnly ?? false)
    : undefined;

  const runbook: CodexRunbook = {
    task,
    projectName: agent.context.projectName,
    initialized,
    guardTargets,
    team,
    commands: {
      start,
      beforeEditing,
      afterEditing,
      memoryReview
    },
    sections: [
      {
        title: "Codex Contract",
        items: [
          "The user only needs to describe the requirement; Codex is responsible for using AIWiki.",
          "Do not ask the user to choose AIWiki commands; translate the request into the right local memory, guard, checkpoint, and reflect steps.",
          "Use AIWiki before editing, before risky file changes, and after implementation.",
          options.readOnly
            ? "Read-only agent mode does not create or claim tasks and does not bootstrap the project map."
            : "Default agent mode may prepare Codex-owned task state and a project map before returning context.",
          "Never confirm long-term memory writes without explicit user approval."
        ]
      },
      {
        title: "Start",
        items: start
      },
      {
        title: "Work Graph",
        items: options.readOnly
          ? [
              "Read-only mode skips task creation, task claiming, and project-map bootstrapping.",
              "Use this output for context lookup only; run agent without `--read-only` when Codex should prepare workflow state.",
              "Resume files are also write-protected when `aiwiki resume --read-only` is used."
            ]
          : initialized
          ? [
              "Use `aiwiki task ready` to see unblocked open work.",
              "Use `aiwiki task claim <id>` to claim ready work; blocked tasks require explicit `--force`.",
              "Use `aiwiki task discover \"<follow-up>\"` for new work found mid-task instead of burying it in chat."
            ]
          : [
              "Task graph commands require initialized AIWiki memory.",
              "Use `aiwiki prime`, `agent`, `brief --read-only`, `guard`, `reflect --read-only`, and `doctor` during cold-start.",
              "Initialize with `aiwiki init --project-name <name>` and `aiwiki map --write` before creating or claiming tasks."
            ]
      },
      {
        title: "Before Editing",
        items: beforeEditing.length > 0
          ? beforeEditing
          : ["If you identify a concrete file to edit, run `aiwiki guard <file>` before changing it."]
      },
      {
        title: "After Editing",
        items: afterEditing
      },
      {
        title: "Memory Review",
        items: memoryReview
      },
      {
        title: "Final Response Checklist",
        items: [
          "Summarize code changes.",
          "Report tests/checks run.",
          "Report whether AIWiki memory is current, stale, or has candidate updates awaiting review.",
          "Report `aiwiki doctor` next actions when memory governance needs follow-up."
        ]
      }
    ]
  };

  const markdown = formatCodexRunbookMarkdown(runbook);
  const json = codexRunbookToJson(runbook);
  return { runbook, markdown, json };
}
