import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { loadAIWikiConfig } from "./config.js";
import { RISK_FILE_KEYWORDS } from "./constants.js";
import { resolveProjectPath, toPosixPath } from "./paths.js";
import { searchWikiMemory } from "./search.js";
import type { SearchResult } from "./search.js";

const execFileAsync = promisify(execFile);

export interface ReflectOptions {
  fromGitDiff?: boolean;
  notes?: string;
  limit?: number;
}

export interface ReflectSection {
  title: string;
  items: string[];
}

export interface ReflectPreview {
  projectName: string;
  fromGitDiff: boolean;
  notesPath?: string;
  changedFiles: string[];
  selectedDocs: string[];
  sections: ReflectSection[];
}

export interface ReflectResult {
  preview: ReflectPreview;
  markdown: string;
  json: string;
}

const DEFAULT_REFLECT_LIMIT = 8;
const MAX_QUERY_TEXT = 600;

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function normalizeChangedFile(filePath: string): string {
  return toPosixPath(filePath).replace(/^\.\//u, "");
}

function extractChangedFiles(diff: string): string[] {
  const files = diff
    .split("\n")
    .map((line) => {
      const match = /^diff --git a\/(.+) b\/(.+)$/u.exec(line);
      return match?.[2];
    })
    .filter((file): file is string => Boolean(file))
    .map(normalizeChangedFile);

  return unique(files).sort();
}

async function readGitDiff(rootDir: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["diff", "--", "."], {
      cwd: rootDir,
      maxBuffer: 10 * 1024 * 1024
    });
    return stdout;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read git diff in ${rootDir}: ${message}`);
  }
}

async function readNotes(rootDir: string, notesPath: string | undefined): Promise<string> {
  if (!notesPath) {
    return "";
  }

  return readFile(resolveProjectPath(rootDir, notesPath), "utf8");
}

function firstNonEmptyLine(value: string): string | undefined {
  const line = value
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  return line?.replace(/^#+\s*/u, "");
}

function pathModuleCandidates(files: string[]): string[] {
  return unique(
    files.flatMap((file) => {
      const parts = file.split("/");
      return [parts[0], parts[1]];
    })
  ).filter((part) => part !== "src" && part !== "app" && part !== "lib");
}

function relatedModules(results: SearchResult[], files: string[]): string[] {
  const memoryModules = results.flatMap((result) => {
    if (result.page.frontmatter.type === "module") {
      return [
        result.page.frontmatter.modules?.[0],
        result.page.frontmatter.title,
        result.title
      ];
    }

    return result.page.frontmatter.modules ?? [];
  });

  return unique([...memoryModules, ...pathModuleCandidates(files)]).sort();
}

function docs(results: SearchResult[]): string[] {
  return results.map((result) => `wiki/${result.page.relativePath}`);
}

function matchingTitles(results: SearchResult[], type: string): string[] {
  return results
    .filter((result) => result.page.frontmatter.type === type)
    .map((result) => `${result.title} (wiki/${result.page.relativePath})`);
}

function highRiskChangedFiles(files: string[]): string[] {
  return files.filter((file) => {
    const value = file.toLowerCase();
    return RISK_FILE_KEYWORDS.some((keyword) => value.includes(keyword));
  });
}

function searchQuery(changedFiles: string[], notes: string): string {
  return unique([...changedFiles, notes.slice(0, MAX_QUERY_TEXT).replace(/\s+/gu, " ")])
    .join(" ")
    .trim();
}

function fallback(items: string[], value: string): string[] {
  return items.length > 0 ? items : [value];
}

function section(title: string, items: string[]): ReflectSection {
  return { title, items };
}

function formatSection(value: ReflectSection): string {
  return `## ${value.title}\n${value.items.map((item) => `- ${item}`).join("\n")}`;
}

export function formatReflectPreviewMarkdown(preview: ReflectPreview): string {
  return [
    "# Reflect Preview",
    "",
    ...preview.sections.flatMap((value) => [formatSection(value), ""]),
    "## Safety",
    "- This preview does not write structured wiki pages.",
    "- Review and confirm reusable lessons before adding pitfalls, modules, decisions, patterns, or rules."
  ].join("\n").trimEnd() + "\n";
}

function reflectToJson(preview: ReflectPreview): string {
  return `${JSON.stringify(preview, null, 2)}\n`;
}

export async function generateReflectPreview(
  rootDir: string,
  options: ReflectOptions = {}
): Promise<ReflectResult> {
  const config = await loadAIWikiConfig(rootDir);
  const notes = await readNotes(rootDir, options.notes);
  const diff = options.fromGitDiff ? await readGitDiff(rootDir) : "";
  const changedFiles = extractChangedFiles(diff);
  const query = searchQuery(changedFiles, notes);
  const search = query.length > 0
    ? await searchWikiMemory(rootDir, query, {
        limit: options.limit ?? DEFAULT_REFLECT_LIMIT
      })
    : { query: "", results: [] };
  const results = search.results;
  const selectedDocs = docs(results);
  const modules = relatedModules(results, changedFiles);
  const riskyFiles = highRiskChangedFiles(changedFiles);
  const matchingPitfalls = matchingTitles(results, "pitfall");
  const matchingDecisions = matchingTitles(results, "decision");
  const matchingPatterns = matchingTitles(results, "pattern");
  const matchingRules = matchingTitles(results, "rule");
  const noteSummary = firstNonEmptyLine(notes);

  const preview: ReflectPreview = {
    projectName: config.projectName,
    fromGitDiff: options.fromGitDiff ?? false,
    notesPath: options.notes,
    changedFiles,
    selectedDocs,
    sections: [
      section(
        "Task Summary",
        fallback(
          [
            noteSummary ? `Notes summary: ${noteSummary}` : undefined,
            options.fromGitDiff
              ? `Git diff changed ${changedFiles.length} file(s).`
              : "No git diff was requested."
          ].filter((item): item is string => Boolean(item)),
          "No notes or git diff input was provided."
        )
      ),
      section(
        "New Lessons",
        [
          "Extract only reusable lessons from the notes and diff before writing long-term memory.",
          "Keep one-off implementation details in raw notes or session logs unless they affect future work."
        ]
      ),
      section(
        "Pitfalls to Add or Update",
        fallback(
          [
            ...matchingPitfalls.map((item) => `Review existing pitfall for update: ${item}`),
            ...riskyFiles.map((file) => `Consider whether changes to ${file} introduced a reusable pitfall.`)
          ],
          "No matching pitfalls or high-risk changed files detected."
        )
      ),
      section(
        "Modules to Update",
        fallback(
          modules.map((moduleName) => `Review module summary for ${moduleName}.`),
          "No matching module updates detected."
        )
      ),
      section(
        "Decisions to Add or Deprecate",
        fallback(
          matchingDecisions.map((item) => `Review existing decision for update: ${item}`),
          "No decision changes detected. Do not deprecate decisions without explicit confirmation."
        )
      ),
      section(
        "Patterns to Add or Update",
        fallback(
          matchingPatterns.map((item) => `Review existing pattern for update: ${item}`),
          "No matching patterns detected."
        )
      ),
      section(
        "Rules to Promote",
        fallback(
          matchingRules.map((item) => `Review whether this rule still applies: ${item}`),
          "No rule promotion candidates detected. Do not promote rules without user confirmation."
        )
      ),
      section(
        "Files Changed in .aiwiki",
        [
          "No structured wiki writes are planned by this preview.",
          "Future confirmed writes should update wiki pages, index, log, and graph consistently."
        ]
      ),
      section(
        "Confirmed Apply Workflow",
        [
          "Convert accepted lessons into a WikiUpdatePlan JSON file.",
          "Run `aiwiki apply <plan.json>` to preview exact file operations.",
          "Run `aiwiki apply <plan.json> --confirm` only after reviewing the preview."
        ]
      )
    ]
  };

  const markdown = formatReflectPreviewMarkdown(preview);
  const json = reflectToJson(preview);
  return { preview, markdown, json };
}
