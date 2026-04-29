import { execFile } from "node:child_process";
import { appendFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { loadAIWikiConfig } from "./config.js";
import { REFLECT_EVALS_PATH, RISK_FILE_KEYWORDS } from "./constants.js";
import { resolveProjectPath, toPosixPath } from "./paths.js";
import { searchWikiMemory } from "./search.js";
import type { SearchResult } from "./search.js";
import type { WikiUpdatePlan, WikiUpdatePlanEntry } from "./apply.js";
import type { WikiPage } from "./types.js";

const execFileAsync = promisify(execFile);

export interface ReflectOptions {
  fromGitDiff?: boolean;
  notes?: string;
  limit?: number;
  outputPlan?: string;
  force?: boolean;
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
  outputPlanPath?: string;
  updatePlanDraft?: WikiUpdatePlan;
  sections: ReflectSection[];
}

export interface ReflectResult {
  preview: ReflectPreview;
  markdown: string;
  json: string;
}

const DEFAULT_REFLECT_LIMIT = 8;
const MAX_QUERY_TEXT = 600;

async function pathExists(filePath: string): Promise<boolean> {
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

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function safeSlug(value: string, fallbackValue: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");
  if (slug.length > 0) {
    return slug;
  }

  let hash = 0;
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) % 100000;
  }

  return `${fallbackValue}-${hash}`;
}

function titleCase(value: string): string {
  return value
    .split(/[-_\s]+/u)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
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
  const lowSignalParts = new Set([
    "src",
    "app",
    "api",
    "lib",
    "route",
    "page",
    "index",
    "server",
    "client",
    "components",
    "test",
    "tests",
    "spec",
    "docs",
    "doc",
    "readme",
    "prd",
    "package"
  ]);
  return unique(
    files
      .map((file) => moduleNameForChangedFile(file, lowSignalParts))
      .filter((moduleName): moduleName is string => Boolean(moduleName))
  );
}

function moduleNameForChangedFile(
  file: string,
  lowSignalParts = new Set<string>()
): string | undefined {
  const parsed = toPosixPath(file)
    .replace(/\.[^.]+$/u, "")
    .split(/[/.\\_-]+/u)
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 2 && !lowSignalParts.has(part));

  return parsed.at(-1);
}

function moduleFiles(moduleName: string, files: string[]): string[] {
  const normalizedModule = moduleName.toLowerCase();
  return files.filter((file) => {
    const inferredModule = moduleNameForChangedFile(
      file,
      new Set([
        "src",
        "app",
        "api",
        "lib",
        "route",
        "page",
        "index",
        "server",
        "client",
        "components",
        "test",
        "tests",
        "spec",
        "docs",
        "doc",
        "readme",
        "prd",
        "package"
      ])
    );

    return inferredModule === normalizedModule;
  });
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

function pagesOfType(results: SearchResult[], type: string): WikiPage[] {
  return results
    .filter((result) => result.page.frontmatter.type === type)
    .map((result) => result.page);
}

function pageTitle(page: WikiPage): string {
  if (page.frontmatter.title && page.frontmatter.title.trim().length > 0) {
    return page.frontmatter.title;
  }

  const heading = page.body
    .split("\n")
    .find((line) => line.trim().startsWith("#"));

  return heading ? heading.replace(/^#+\s*/u, "").trim() : page.relativePath;
}

function pageSlug(page: WikiPage): string {
  return page.relativePath.split("/").at(-1)?.replace(/\.md$/u, "") ?? safeSlug(pageTitle(page), "page");
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

function includesAny(value: string, words: string[]): boolean {
  const normalizedValue = value.toLowerCase();
  return words.some((word) => normalizedValue.includes(word));
}

function appendEntryForPage(
  page: WikiPage,
  noteSummary: string | undefined,
  changedFiles: string[]
): WikiUpdatePlanEntry {
  const summary = noteSummary ?? "Reflect reviewed recent changes for this existing memory page.";
  return {
    type: page.frontmatter.type as WikiUpdatePlanEntry["type"],
    title: pageTitle(page),
    slug: pageSlug(page),
    source: "reflect",
    append: [
      {
        heading: "Recent Reflection",
        body: [
          summary,
          changedFiles.length > 0
            ? `Changed files reviewed: ${changedFiles.join(", ")}.`
            : undefined,
          "Review this append section before confirming the wiki update."
        ].filter(Boolean).join("\n\n")
      }
    ]
  };
}

function buildReflectUpdatePlanDraft(
  noteSummary: string | undefined,
  notes: string,
  changedFiles: string[],
  results: SearchResult[],
  modules: string[],
  riskyFiles: string[]
): WikiUpdatePlan | undefined {
  const entries: WikiUpdatePlanEntry[] = [];
  const matchedPages = pagesOfType(results, "pitfall")
    .concat(pagesOfType(results, "decision"))
    .concat(pagesOfType(results, "pattern"))
    .slice(0, 3);

  for (const page of matchedPages) {
    entries.push(appendEntryForPage(page, noteSummary, changedFiles));
  }

  const existingModuleNames = new Set(
    pagesOfType(results, "module").flatMap((page) => [
      ...(page.frontmatter.modules ?? []),
      page.frontmatter.title,
      pageTitle(page)
    ])
  );

  const newModuleCandidates = modules
    .filter((moduleName) => !existingModuleNames.has(moduleName))
    .map((moduleName) => ({
      moduleName,
      files: moduleFiles(moduleName, changedFiles)
    }))
    .sort((a, b) => {
      if (b.files.length !== a.files.length) {
        return b.files.length - a.files.length;
      }

      return a.moduleName.localeCompare(b.moduleName);
    })
    .slice(0, 3);

  for (const candidate of newModuleCandidates) {
    entries.push({
      type: "module",
      title: titleCase(candidate.moduleName),
      slug: safeSlug(candidate.moduleName, "module"),
      source: "reflect",
      modules: [candidate.moduleName],
      files: candidate.files,
      summary: noteSummary
        ? `Reflection candidate from recent work: ${noteSummary}.`
        : candidate.files.length > 0
          ? `Reflection candidate for ${candidate.moduleName} from changed files: ${candidate.files.join(", ")}.`
          : `Reflection candidate for ${candidate.moduleName} from recent changed files.`
    });
  }

  if (riskyFiles.length > 0 && pagesOfType(results, "pitfall").length === 0) {
    const baseTitle = noteSummary ?? `${titleCase(modules[0] ?? "Project")} high-risk file change`;
    entries.push({
      type: "pitfall",
      title: baseTitle,
      slug: safeSlug(baseTitle, "pitfall"),
      source: "reflect",
      modules,
      files: riskyFiles,
      severity: "high",
      summary: "Review whether this high-risk file change introduced a reusable pitfall before confirming."
    });
  }

  if (noteSummary && includesAny(notes, ["decision", "decided", "choose", "chose", "use ", "使用", "决定"])) {
    entries.push({
      type: "decision",
      title: noteSummary,
      slug: safeSlug(noteSummary, "decision"),
      source: "reflect",
      modules,
      files: changedFiles,
      summary: "Review whether this note records a durable product or architecture decision."
    });
  }

  if (noteSummary && includesAny(notes, ["pattern", "reuse", "reusable", "步骤", "模式", "复用"])) {
    entries.push({
      type: "pattern",
      title: noteSummary,
      slug: safeSlug(noteSummary, "pattern"),
      source: "reflect",
      modules,
      files: changedFiles,
      summary: "Review whether this note describes a reusable implementation pattern."
    });
  }

  if (noteSummary && includesAny(notes, ["must", "never", "always", "required", "必须", "不要", "总是"])) {
    entries.push({
      type: "rule",
      title: noteSummary,
      slug: safeSlug(noteSummary, "rule"),
      source: "reflect",
      status: "proposed",
      modules,
      files: changedFiles,
      severity: riskyFiles.length > 0 ? "high" : "medium",
      summary: "Review whether this lesson is stable enough to become a proposed project rule."
    });
  }

  const dedupedEntries = entries.filter((entry, index, allEntries) => {
    const key = `${entry.type}:${entry.slug ?? entry.title}`;
    return allEntries.findIndex((candidate) => `${candidate.type}:${candidate.slug ?? candidate.title}` === key) === index;
  });

  if (dedupedEntries.length === 0) {
    return undefined;
  }

  return {
    version: "0.1.0",
    title: noteSummary ? `Reflect: ${noteSummary}` : "Reflect update candidates",
    entries: dedupedEntries
  };
}

function section(title: string, items: string[]): ReflectSection {
  return { title, items };
}

function formatSection(value: ReflectSection): string {
  return `## ${value.title}\n${value.items.map((item) => `- ${item}`).join("\n")}`;
}

function reflectSectionItems(preview: ReflectPreview, title: string): string[] {
  return preview.sections.find((section) => section.title === title)?.items ?? [];
}

function limitItems(items: string[], limit: number): string[] {
  if (items.length <= limit) {
    return items;
  }

  return [
    ...items.slice(0, limit),
    `${items.length - limit} more item(s) omitted from markdown; use --format json for full context.`
  ];
}

function isLowSignalReflectFallback(item: string): boolean {
  return (
    item.startsWith("No matching ") ||
    item.startsWith("No decision changes ") ||
    item.startsWith("No rule promotion candidates ")
  );
}

function formatDraftEntry(entry: WikiUpdatePlanEntry): string {
  const files = entry.files && entry.files.length > 0
    ? ` (${entry.files.slice(0, 3).join(", ")}${entry.files.length > 3 ? ", ..." : ""})`
    : "";
  return `${entry.type}: ${entry.title}${files}`;
}

export function formatReflectPreviewMarkdown(preview: ReflectPreview): string {
  const draftLine = preview.updatePlanDraft
    ? preview.outputPlanPath
      ? `- Update plan draft entries: ${preview.updatePlanDraft.entries.length}. Saved to ${preview.outputPlanPath}. Run \`aiwiki apply "${preview.outputPlanPath}"\`, then \`aiwiki apply "${preview.outputPlanPath}" --confirm\` after review.`
      : `- Update plan draft entries: ${preview.updatePlanDraft.entries.length}. Save with \`--output-plan <path>\` or save the JSON output, then run \`aiwiki apply <plan.json>\` before \`--confirm\`.`
    : "- No update plan draft was generated.";
  const changedFiles = preview.changedFiles.length > 0
    ? preview.changedFiles
    : ["No changed files detected."];
  const candidateWrites = preview.updatePlanDraft
    ? preview.updatePlanDraft.entries.map(formatDraftEntry)
    : [];
  const lessons = [
    ...reflectSectionItems(preview, "New Lessons"),
    ...reflectSectionItems(preview, "Pitfalls to Add or Update"),
    ...reflectSectionItems(preview, "Modules to Update"),
    ...reflectSectionItems(preview, "Decisions to Add or Deprecate"),
    ...reflectSectionItems(preview, "Patterns to Add or Update"),
    ...reflectSectionItems(preview, "Rules to Promote")
  ].filter((item) => !isLowSignalReflectFallback(item));
  const sections: ReflectSection[] = [
    {
      title: "Review First",
      items: reflectSectionItems(preview, "Task Summary")
    },
    {
      title: "Update Plan Draft",
      items: [
        draftLine.replace(/^- /u, ""),
        ...limitItems(candidateWrites, 5)
      ]
    },
    {
      title: "Changed Files",
      items: limitItems(changedFiles, 10)
    },
    {
      title: "Lessons to Capture",
      items: limitItems(lessons, 8)
    },
    {
      title: "Apply Safely",
      items: [
        ...reflectSectionItems(preview, "Files Changed in .aiwiki"),
        ...reflectSectionItems(preview, "Confirmed Apply Workflow"),
        "Review and confirm reusable lessons before adding pitfalls, modules, decisions, patterns, or rules."
      ]
    }
  ];
  return [
    "# Reflect Preview",
    "",
    ...sections.flatMap((value) => [formatSection(value), ""])
  ].join("\n").trimEnd() + "\n";
}

function reflectToJson(preview: ReflectPreview): string {
  return `${JSON.stringify(preview, null, 2)}\n`;
}

async function writeOutputPlanFile(
  rootDir: string,
  outputPlan: string,
  plan: WikiUpdatePlan,
  force: boolean
): Promise<string> {
  const outputPath = resolveProjectPath(rootDir, outputPlan);
  if (!force && (await pathExists(outputPath))) {
    throw new Error(`Refusing to overwrite existing output plan: ${outputPlan}`);
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  return outputPath;
}

async function appendReflectEvalCase(
  rootDir: string,
  preview: ReflectPreview
): Promise<void> {
  const evalPath = resolveProjectPath(rootDir, REFLECT_EVALS_PATH);
  await mkdir(path.dirname(evalPath), { recursive: true });
  const event = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    time: new Date().toISOString(),
    command: "reflect",
    input: {
      fromGitDiff: preview.fromGitDiff,
      notesPath: preview.notesPath
    },
    changedFiles: preview.changedFiles,
    selectedDocs: preview.selectedDocs,
    outputPlanPath: preview.outputPlanPath,
    updatePlanDraftEntries: preview.updatePlanDraft?.entries.length ?? 0,
    outcome: "unknown"
  };
  await appendFile(evalPath, `${JSON.stringify(event)}\n`, "utf8");
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
  const updatePlanDraft = buildReflectUpdatePlanDraft(
    noteSummary,
    notes,
    changedFiles,
    results,
    modules,
    riskyFiles
  );

  const preview: ReflectPreview = {
    projectName: config.projectName,
    fromGitDiff: options.fromGitDiff ?? false,
    notesPath: options.notes,
    changedFiles,
    selectedDocs,
    updatePlanDraft,
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
        updatePlanDraft
          ? [
              `Update plan draft contains ${updatePlanDraft.entries.length} candidate wiki write(s).`,
              "No wiki pages are written until apply --confirm.",
              "Future confirmed writes should update wiki pages, index, log, and graph consistently."
            ]
          : [
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

  if (options.outputPlan && preview.updatePlanDraft) {
    preview.outputPlanPath = await writeOutputPlanFile(
      rootDir,
      options.outputPlan,
      preview.updatePlanDraft,
      options.force ?? false
    );
  }

  await appendReflectEvalCase(rootDir, preview);

  const markdown = formatReflectPreviewMarkdown(preview);
  const json = reflectToJson(preview);
  return { preview, markdown, json };
}
