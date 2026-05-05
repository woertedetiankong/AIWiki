import { generateDevelopmentBrief } from "./brief.js";
import type { BriefOptions, DevelopmentBrief } from "./brief.js";
import type { OutputFormat } from "./output.js";
import { shellQuote } from "./shell-quote.js";

export interface AgentContextOptions {
  limit?: number;
  withGraphify?: boolean;
  architectureGuard?: boolean;
  format?: OutputFormat;
  readOnly?: boolean;
}

export interface AgentContext {
  task: string;
  projectName: string;
  selectedDocs: string[];
  guardTargets: string[];
  nextCommands: string[];
  sections: Array<{
    title: string;
    items: string[];
  }>;
}

export interface AgentContextResult {
  context: AgentContext;
  markdown: string;
  json: string;
}

function sectionItems(brief: DevelopmentBrief, title: string): string[] {
  return brief.sections.find((section) => section.title === title)?.items ?? [];
}

function stripDiscoverySuffix(value: string): string {
  return value.replace(/\s+\(matched:.*\)$/u, "");
}

function isGuardTarget(value: string): boolean {
  const clean = stripDiscoverySuffix(value);
  return clean.length > 0 &&
    !clean.startsWith("wiki/") &&
    !clean.endsWith(".md") &&
    !clean.startsWith("No ");
}

function guardTargetTokens(task: string): string[] {
  const tokens = task
    .toLowerCase()
    .split(/[^a-z0-9_./-]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);

  if (/语音|录音|听写|识别|转文本|输入法/u.test(task)) {
    tokens.push("voice", "speech", "audio", "asr", "transcription", "typing");
  }
  if (/润色|整理|改写|修饰/u.test(task)) {
    tokens.push("cleanup", "clean", "polish", "rewrite", "format");
  }
  if (/词典|字典|术语/u.test(task)) {
    tokens.push("dictionary", "vocabulary", "glossary");
  }

  return [...new Set(tokens)];
}

function guardTargetScore(target: string, tokens: string[], discovered: Set<string>): number {
  const normalized = target.toLowerCase();
  let score = discovered.has(target) ? 100 : 0;
  for (const token of tokens) {
    if (normalized.includes(token)) {
      score += 12;
    }
  }
  if (/\.(?:ts|tsx|js|jsx|mjs|cjs|py|c|h|java|rs|go|sql)$/u.test(normalized)) {
    score += 5;
  }
  if (normalized.startsWith("docs/") || normalized.endsWith(".md")) {
    score -= 20;
  }

  return score;
}

function guardTargetsFromBrief(brief: DevelopmentBrief, task: string): string[] {
  const discoveredEntryFiles = sectionItems(brief, "Discovered Entry Files")
    .map(stripDiscoverySuffix)
    .filter(isGuardTarget);
  const mustReadFiles = sectionItems(brief, "Suggested Must-Read Files")
    .map(stripDiscoverySuffix)
    .filter(isGuardTarget);
  const discovered = new Set(discoveredEntryFiles);
  const tokens = guardTargetTokens(task);
  const candidates = [...discoveredEntryFiles, ...mustReadFiles];
  const scored = candidates
    .map((target, index) => ({
      target,
      index,
      score: guardTargetScore(target, tokens, discovered)
    }))
    .filter((item) =>
      discovered.size === 0 ||
      discovered.has(item.target) ||
      item.score > 5
    )
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((item) => item.target);

  return [...new Set(scored)].slice(0, 3);
}

function compactSection(items: string[], fallback: string, limit = 4): string[] {
  const values = items.filter((item) => !item.startsWith("No "));
  return values.length > 0 ? values.slice(0, limit) : [fallback];
}

function nextCommands(task: string, guardTargets: string[]): string[] {
  const commands = guardTargets.slice(0, 2).map((target) => `aiwiki guard ${target}`);
  return [
    ...commands,
    `aiwiki reflect --from-git-diff --read-only`,
    `aiwiki brief ${shellQuote(task)} --read-only`
  ].slice(0, 3);
}

function formatSection(title: string, items: string[]): string {
  return `## ${title}\n${items.map((item) => `- ${item}`).join("\n")}`;
}

export function formatAgentContextMarkdown(context: AgentContext): string {
  return [
    `# AIWiki Agent Context: ${context.task}`,
    "",
    ...context.sections.flatMap((section) => [
      formatSection(section.title, section.items),
      ""
    ])
  ].join("\n").trimEnd() + "\n";
}

function agentContextToJson(context: AgentContext): string {
  return `${JSON.stringify(context, null, 2)}\n`;
}

export async function generateAgentContext(
  rootDir: string,
  task: string,
  options: AgentContextOptions = {}
): Promise<AgentContextResult> {
  const briefOptions: BriefOptions = {
    limit: options.limit,
    withGraphify: options.withGraphify,
    architectureGuard: options.architectureGuard,
    readOnly: true
  };
  const briefResult = await generateDevelopmentBrief(rootDir, task, briefOptions);
  const brief = briefResult.brief;
  const guardTargets = guardTargetsFromBrief(brief, task);
  const commands = nextCommands(task, guardTargets);
  const context: AgentContext = {
    task,
    projectName: brief.projectName,
    selectedDocs: brief.selectedDocs,
    guardTargets,
    nextCommands: commands,
    sections: [
      {
        title: "Start Here",
        items: [
          `Task: ${task}`,
          `Project: ${brief.projectName}`,
          "Codex chooses the AIWiki commands; the user does not need to memorize this sequence."
        ]
      },
      {
        title: "Mode Boundary",
        items: [
          options.readOnly
            ? "Read-only mode: skipped task creation, task claiming, project-map bootstrapping, output files, and long-term memory writes."
            : "Default workflow mode: the CLI may prepare Codex-owned task state and project-map memory before returning this context.",
          "Context lookup does not confirm long-term memory writes."
        ]
      },
      {
        title: "Memory",
        items: compactSection(
          sectionItems(brief, "Relevant Project Memory"),
          "No matching wiki memory found."
        )
      },
      {
        title: "Rules",
        items: compactSection(
          sectionItems(brief, "Project Rules and Constraints"),
          "No matching rules found."
        )
      },
      {
        title: "Pitfalls",
        items: compactSection(
          sectionItems(brief, "Known Pitfalls"),
          "No matching pitfalls found."
        )
      },
      {
        title: "Guard Next",
        items: guardTargets.length > 0
          ? guardTargets.map((target) => `Run \`aiwiki guard ${target}\`.`)
          : ["No focused guard target found; inspect the brief if the task is broad."]
      },
      {
        title: "Next Commands",
        items: commands
      }
    ]
  };

  const markdown = formatAgentContextMarkdown(context);
  const json = agentContextToJson(context);
  return { context, markdown, json };
}
