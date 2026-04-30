import { generateAgentContext } from "./agent.js";
import type { AgentContextOptions } from "./agent.js";
import type { OutputFormat } from "./output.js";

export interface CodexRunbookOptions extends AgentContextOptions {
  format?: OutputFormat;
  team?: boolean;
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

function formatTeamSection(team: CodexTeamRunbook): string[] {
  const sections = [
    "## Team Mode",
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
    "- Use checkpoint/resume for long tasks.",
    "- Final answer must report code changes, tests, and memory health."
  );

  return sections;
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

function createTeamRunbook(task: string): CodexTeamRunbook {
  return {
    enabled: true,
    roles: [
      {
        name: "Implementer",
        purpose: "Make the smallest safe code change with file-level guardrails.",
        commands: [
          `Run \`aiwiki agent ${quote(task)}\`.`,
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
          "If useful, generate an output plan.",
          "Preview with `aiwiki apply <plan>`."
        ],
        mustNot: [
          "run `aiwiki apply <plan> --confirm` without user approval"
        ]
      }
    ]
  };
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
  const team = options.team ? createTeamRunbook(task) : undefined;

  const runbook: CodexRunbook = {
    task,
    projectName: agent.context.projectName,
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
