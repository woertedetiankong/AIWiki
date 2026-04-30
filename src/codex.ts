import { generateAgentContext } from "./agent.js";
import type { AgentContextOptions } from "./agent.js";
import type { OutputFormat } from "./output.js";

export interface CodexRunbookOptions extends AgentContextOptions {
  format?: OutputFormat;
}

export interface CodexRunbook {
  task: string;
  projectName: string;
  guardTargets: string[];
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

function quote(value: string): string {
  return `"${value.replace(/"/gu, '\\"')}"`;
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

export function formatCodexRunbookMarkdown(runbook: CodexRunbook): string {
  return [
    `# Codex AIWiki Runbook: ${runbook.task}`,
    "",
    ...runbook.sections.flatMap((section) => [
      formatSection(section.title, section.items),
      ""
    ])
  ].join("\n").trimEnd() + "\n";
}

function codexRunbookToJson(runbook: CodexRunbook): string {
  return `${JSON.stringify(runbook, null, 2)}\n`;
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
  const guardTargets = agent.context.guardTargets.slice(0, 3);
  const planPath = `.aiwiki/context-packs/${taskSlug(task)}-reflect-plan.json`;
  const start = [
    `aiwiki agent ${quote(task)}`,
    guardTargets.length > 0
      ? `aiwiki guard ${guardTargets[0]}`
      : "aiwiki brief \"<task>\" --read-only"
  ];
  const beforeEditing = guardTargets.map((target) => `aiwiki guard ${target}`);
  const afterEditing = [
    "Run the focused project tests for changed behavior.",
    "aiwiki reflect --from-git-diff --read-only",
    "aiwiki doctor",
    "aiwiki lint"
  ];
  const memoryReview = [
    `If reflect reports useful candidate memory, run: aiwiki reflect --from-git-diff --output-plan ${planPath}`,
    `Preview it with: aiwiki apply ${planPath}`,
    "Do not run apply --confirm unless the user explicitly approves the candidate memory."
  ];

  const runbook: CodexRunbook = {
    task,
    projectName: agent.context.projectName,
    guardTargets,
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
          "Use AIWiki before editing, before risky file changes, and after implementation.",
          "Never confirm long-term memory writes without explicit user approval."
        ]
      },
      {
        title: "Start",
        items: start
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
