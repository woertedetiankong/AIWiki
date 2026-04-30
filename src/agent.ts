import { generateDevelopmentBrief } from "./brief.js";
import type { BriefOptions, DevelopmentBrief } from "./brief.js";
import type { OutputFormat } from "./output.js";

export interface AgentContextOptions {
  limit?: number;
  withGraphify?: boolean;
  architectureGuard?: boolean;
  format?: OutputFormat;
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

function guardTargetsFromBrief(brief: DevelopmentBrief): string[] {
  const candidates = [
    ...sectionItems(brief, "Suggested Must-Read Files"),
    ...sectionItems(brief, "Discovered Entry Files")
  ]
    .map(stripDiscoverySuffix)
    .filter(isGuardTarget);

  return [...new Set(candidates)].slice(0, 3);
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
    `aiwiki brief "${task}" --read-only`
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
  const guardTargets = guardTargetsFromBrief(brief);
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
          "Read-only context only; no AIWiki logs, evals, or files were written."
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
