import { appendFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { BRIEF_EVALS_PATH, INDEX_PATH } from "./constants.js";
import { loadAIWikiConfig } from "./config.js";
import { appendLogEntry } from "./log.js";
import type { OutputFormat } from "./output.js";
import { resolveProjectPath } from "./paths.js";
import type { SearchResult } from "./search.js";
import { searchWikiMemory } from "./search.js";

export interface BriefOptions {
  limit?: number;
  output?: string;
  force?: boolean;
  format?: OutputFormat;
}

export interface BriefSection {
  title: string;
  items: string[];
}

export interface DevelopmentBrief {
  task: string;
  projectName: string;
  tokenBudget: number;
  indexSummary: string;
  selectedDocs: string[];
  sections: BriefSection[];
}

export interface BriefResult {
  brief: DevelopmentBrief;
  markdown: string;
  json: string;
  outputPath?: string;
}

const DEFAULT_BRIEF_LIMIT = 8;

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function pageDocPath(result: SearchResult): string {
  return `wiki/${result.page.relativePath}`;
}

function pageTitle(result: SearchResult): string {
  return result.title;
}

function bulletOrFallback(items: string[], fallback: string): string[] {
  return items.length > 0 ? items : [fallback];
}

async function readIndexSummary(rootDir: string): Promise<string> {
  try {
    const raw = await readFile(resolveProjectPath(rootDir, INDEX_PATH), "utf8");
    return raw.trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return "";
    }

    throw error;
  }
}

function relatedModules(results: SearchResult[]): string[] {
  return unique(
    results.flatMap((result) => {
      if (result.page.frontmatter.type === "module") {
        return [
          result.page.frontmatter.modules?.[0],
          result.page.frontmatter.title,
          pageTitle(result)
        ];
      }

      return result.page.frontmatter.modules ?? [];
    })
  );
}

function highRiskFiles(results: SearchResult[], configuredRiskFiles: string[]): string[] {
  const memoryRiskFiles = results.flatMap((result) => {
    const severity = result.page.frontmatter.severity;
    const risk = result.page.frontmatter.risk;
    const isHighRisk =
      severity === "high" ||
      severity === "critical" ||
      risk === "high" ||
      risk === "critical";

    return isHighRisk ? result.page.frontmatter.files ?? [] : [];
  });

  return unique([...configuredRiskFiles, ...memoryRiskFiles]);
}

function mustReadFiles(results: SearchResult[], riskFiles: string[]): string[] {
  const wikiDocs = results.map(pageDocPath);
  const relatedFiles = results.flatMap((result) => result.page.frontmatter.files ?? []);
  return unique([...wikiDocs, ...riskFiles, ...relatedFiles]);
}

function memoryBullets(results: SearchResult[]): string[] {
  return results.map((result) => {
    const bits = [
      result.page.frontmatter.type,
      `score ${result.score}`,
      result.page.frontmatter.severity
        ? `severity ${result.page.frontmatter.severity}`
        : undefined
    ].filter(Boolean);

    return `${pageTitle(result)} (${pageDocPath(result)}; ${bits.join(", ")})`;
  });
}

function pitfallBullets(results: SearchResult[]): string[] {
  return results
    .filter((result) => result.page.frontmatter.type === "pitfall")
    .map((result) => {
      const severity = result.page.frontmatter.severity ?? "unspecified";
      const excerpt = result.excerpt ? ` - ${result.excerpt}` : "";
      return `${pageTitle(result)} (${severity})${excerpt}`;
    });
}

function ruleBullets(results: SearchResult[]): string[] {
  return results
    .filter((result) => result.page.frontmatter.type === "rule")
    .map((result) => {
      const status = result.page.frontmatter.status ?? "active";
      const excerpt = result.excerpt ? ` - ${result.excerpt}` : "";
      return `${pageTitle(result)} (${status})${excerpt}`;
    });
}

function formatSection(section: BriefSection): string {
  const body = section.items.map((item) => `- ${item}`).join("\n");
  return `## ${section.title}\n${body}`;
}

export function formatDevelopmentBriefMarkdown(brief: DevelopmentBrief): string {
  const title = `# Development Brief: ${brief.task}`;
  const sections = brief.sections.map(formatSection).join("\n\n");
  return `${title}\n\n${sections}\n`;
}

function briefToJson(brief: DevelopmentBrief): string {
  return `${JSON.stringify(brief, null, 2)}\n`;
}

async function outputPathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

async function writeOutputFile(
  rootDir: string,
  output: string,
  content: string,
  force: boolean
): Promise<string> {
  const outputPath = resolveProjectPath(rootDir, output);
  if (!force && (await outputPathExists(outputPath))) {
    throw new Error(`Refusing to overwrite existing output file: ${output}`);
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, content, "utf8");
  return outputPath;
}

async function appendBriefEvalCase(
  rootDir: string,
  task: string,
  outputPath: string | undefined,
  selectedDocs: string[]
): Promise<void> {
  const evalPath = resolveProjectPath(rootDir, BRIEF_EVALS_PATH);
  await mkdir(path.dirname(evalPath), { recursive: true });
  const event = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    time: new Date().toISOString(),
    task,
    generatedBriefPath: outputPath,
    selectedDocs,
    outcome: "unknown"
  };
  await appendFile(evalPath, `${JSON.stringify(event)}\n`, "utf8");
}

export async function generateDevelopmentBrief(
  rootDir: string,
  task: string,
  options: BriefOptions = {}
): Promise<BriefResult> {
  const config = await loadAIWikiConfig(rootDir);
  const indexSummary = await readIndexSummary(rootDir);
  const search = await searchWikiMemory(rootDir, task, {
    limit: options.limit ?? DEFAULT_BRIEF_LIMIT
  });
  const results = search.results;
  const selectedDocs = results.map(pageDocPath);
  const modules = relatedModules(results);
  const riskFiles = highRiskFiles(results, config.riskFiles);
  const readFiles = mustReadFiles(results, riskFiles);

  const brief: DevelopmentBrief = {
    task,
    projectName: config.projectName,
    tokenBudget: config.tokenBudget.brief,
    indexSummary,
    selectedDocs,
    sections: [
      {
        title: "Task",
        items: [task]
      },
      {
        title: "Goal",
        items: [
          `Complete the requested task for ${config.projectName} while respecting the relevant project memory below.`
        ]
      },
      {
        title: "Product Questions to Confirm",
        items: [
          "Confirm the expected user-facing behavior and any important edge cases before editing.",
          "Confirm whether the task affects user-owned data, permissions, billing, authentication, or migrations.",
          "Confirm the acceptance criteria if the requested behavior is broader than the current brief can infer."
        ]
      },
      {
        title: "Recommended Direction",
        items: [
          "Use the matching AIWiki pages as project memory and constraints.",
          "Keep the implementation plan inside the coding agent session; this brief should not be treated as exact edit instructions.",
          "Prefer existing project conventions and local Markdown workflow before adding new infrastructure."
        ]
      },
      {
        title: "Relevant Modules",
        items: bulletOrFallback(modules, "No matching module pages found.")
      },
      {
        title: "Relevant Project Memory",
        items: bulletOrFallback(memoryBullets(results), "No matching wiki pages found.")
      },
      {
        title: "Known Pitfalls",
        items: bulletOrFallback(pitfallBullets(results), "No matching pitfall pages found.")
      },
      {
        title: "Project Rules and Constraints",
        items: bulletOrFallback(ruleBullets(results), "No matching rule pages found.")
      },
      {
        title: "High-Risk Files",
        items: bulletOrFallback(riskFiles, "No high-risk files matched this task.")
      },
      {
        title: "Suggested Must-Read Files",
        items: bulletOrFallback(readFiles, "No specific must-read files matched this task.")
      },
      {
        title: "Acceptance Criteria",
        items: [
          "The requested behavior is implemented without violating the project memory above.",
          "Relevant existing tests pass, and new focused tests are added where behavior changes.",
          "User-owned AIWiki data is not overwritten or deleted by default."
        ]
      },
      {
        title: "Notes for Codex",
        items: [
          "Use this brief as project memory and constraints.",
          "Create your own implementation plan before editing code.",
          "Do not treat this brief as exact code instructions."
        ]
      }
    ]
  };

  const markdown = formatDevelopmentBriefMarkdown(brief);
  const json = briefToJson(brief);
  const content = options.format === "json" ? json : markdown;
  const outputPath = options.output
    ? await writeOutputFile(rootDir, options.output, content, options.force ?? false)
    : undefined;

  await appendLogEntry(rootDir, {
    action: "brief",
    title: task,
    bullets: selectedDocs.map((doc) => `Selected: [[${doc}]]`)
  });
  await appendBriefEvalCase(rootDir, task, outputPath, selectedDocs);

  return { brief, markdown, json, outputPath };
}
