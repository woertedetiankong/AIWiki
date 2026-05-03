import { execFile } from "node:child_process";
import { appendFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  AIWikiNotInitializedError,
  createDefaultConfig,
  loadAIWikiConfig
} from "./config.js";
import {
  AIWIKI_VERSION,
  LOCAL_ARTIFACT_IGNORE,
  REFLECT_EVALS_PATH,
  RISK_FILE_KEYWORDS
} from "./constants.js";
import { collectProjectIgnoreRules, shouldIgnorePath } from "./ignore.js";
import type { IgnoreRule } from "./ignore.js";
import { resolveProjectPath, toPosixPath } from "./paths.js";
import { saveRawNote } from "./raw-notes.js";
import { diffRiskLessonsFromChanges } from "./risk-rules.js";
import { searchWikiMemory } from "./search.js";
import type { SearchResult } from "./search.js";
import type { WikiUpdatePlan, WikiUpdatePlanEntry } from "./apply.js";
import type { WikiPage } from "./types.js";
import { scanWikiPages } from "./wiki-store.js";

const execFileAsync = promisify(execFile);

export interface ReflectOptions {
  fromGitDiff?: boolean;
  notes?: string;
  limit?: number;
  outputPlan?: string;
  force?: boolean;
  readOnly?: boolean;
  saveRaw?: boolean;
}

export interface ReflectSection {
  title: string;
  items: string[];
}

export interface ReflectPreview {
  projectName: string;
  initialized: boolean;
  fromGitDiff: boolean;
  notesPath?: string;
  rawNotePath?: string;
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

interface DiffLesson {
  title: string;
  summary: string;
  type: WikiUpdatePlanEntry["type"];
  modules: string[];
  files: string[];
  status?: WikiUpdatePlanEntry["status"];
  severity?: WikiUpdatePlanEntry["severity"];
  tags?: string[];
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

function normalizeProjectChangedFile(rootDir: string, filePath: string): string {
  const root = path.resolve(rootDir);
  const absolutePath = path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(root, filePath);
  const relativePath = path.relative(root, absolutePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return normalizeChangedFile(filePath);
  }

  return normalizeChangedFile(relativePath);
}

function defaultProjectName(rootDir: string): string {
  return path.basename(path.resolve(rootDir)) || "project";
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

function extractStatusChangedFiles(status: string): string[] {
  const files = status
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return undefined;
      }

      const renamed = /^R\s+(.+?)\s+->\s+(.+)$/u.exec(trimmed);
      if (renamed) {
        return renamed[2];
      }

      const match = /^(?:[ MADRCU?!]{2})\s+(.+)$/u.exec(line);
      return match?.[1];
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

async function readGitStatus(rootDir: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["status", "--short"], {
      cwd: rootDir,
      maxBuffer: 1024 * 1024
    });
    return stdout;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read git status in ${rootDir}: ${message}`);
  }
}

async function walkChangedDirectory(
  rootDir: string,
  relativeDir: string,
  ignoreRules: readonly IgnoreRule[]
): Promise<string[]> {
  const directory = resolveProjectPath(rootDir, relativeDir);
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const relativePath = normalizeChangedFile(path.posix.join(relativeDir, entry.name));
    if (entry.name === ".git" || shouldIgnorePath(relativePath, ignoreRules)) {
      continue;
    }

    if (entry.isDirectory()) {
      files.push(...(await walkChangedDirectory(rootDir, relativePath, ignoreRules)));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }

  return files;
}

async function filterChangedFileList(
  rootDir: string,
  files: string[],
  ignoreRules: readonly IgnoreRule[]
): Promise<string[]> {
  const filtered: string[] = [];
  for (const file of files) {
    if (shouldIgnorePath(file, ignoreRules)) {
      continue;
    }

    try {
      const fileStat = await stat(resolveProjectPath(rootDir, file));
      if (fileStat.isFile()) {
        filtered.push(file);
      } else if (fileStat.isDirectory()) {
        filtered.push(...(await walkChangedDirectory(rootDir, file, ignoreRules)));
      }
    } catch {
      // Keep deleted files from git status/diff so memory can still be refreshed.
      filtered.push(file);
    }
  }

  return unique(filtered).sort();
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

function inferredModuleSummary(moduleName: string): string | undefined {
  if (moduleName === "beads") {
    return "AIWiki can surface optional Beads context by reading `bd ready --json` and `bd status --json` when `.beads/` exists, without writing to Beads or reimplementing its task database.";
  }

  if (moduleName === "ingest") {
    return "`ingest` is a compatibility path; durable note capture should flow through `reflect --notes --save-raw` and the shared raw-notes service.";
  }

  if (moduleName === "notes") {
    return "Raw note persistence belongs in a shared service so notes can be preserved for review without mixing one-off source notes into curated wiki pages.";
  }

  return undefined;
}

function highRiskModuleSummary(moduleName: string, files: string[], riskyFiles: string[]): string | undefined {
  const matchedRiskFiles = files.filter((file) => riskyFiles.includes(file));
  if (matchedRiskFiles.length === 0) {
    return undefined;
  }

  return `High-risk ${moduleName} changes touched ${matchedRiskFiles.join(", ")}; review whether this introduced durable module boundaries, checks, or pitfalls before confirming memory.`;
}

function relatedModules(
  results: SearchResult[],
  files: string[],
  options: { includePathCandidates?: boolean } = {}
): string[] {
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

  const pathModules = options.includePathCandidates === false
    ? []
    : pathModuleCandidates(files);
  return unique([...memoryModules, ...pathModules]).sort();
}

function docs(results: SearchResult[]): string[] {
  return results.map((result) => `wiki/${result.page.relativePath}`);
}

function pageDoc(page: WikiPage): string {
  return `wiki/${page.relativePath}`;
}

function normalizeWikiFileRef(filePath: string): string {
  return toPosixPath(filePath).replace(/^\.\//u, "");
}

async function pagesReferencingChangedFiles(
  rootDir: string,
  changedFiles: string[]
): Promise<WikiPage[]> {
  if (changedFiles.length === 0) {
    return [];
  }

  const changed = new Set(changedFiles.map(normalizeWikiFileRef));
  const pages = await scanWikiPages(rootDir);
  return pages.filter((page) =>
    (page.frontmatter.files ?? []).some((fileRef) => changed.has(normalizeWikiFileRef(fileRef)))
  );
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

function addedLinesByFile(diff: string, allowedFiles: readonly string[]): Map<string, string[]> {
  const linesByFile = new Map<string, string[]>();
  const allowed = new Set(allowedFiles.map(normalizeChangedFile));
  let currentFile: string | undefined;

  for (const line of diff.split("\n")) {
    const fileMatch = /^diff --git a\/(.+) b\/(.+)$/u.exec(line);
    if (fileMatch) {
      const nextFile = normalizeChangedFile(fileMatch[2]);
      currentFile = allowed.has(nextFile) ? nextFile : undefined;
      if (currentFile && !linesByFile.has(currentFile)) {
        linesByFile.set(currentFile, []);
      }
      continue;
    }

    if (currentFile && line.startsWith("+") && !line.startsWith("+++")) {
      linesByFile.get(currentFile)?.push(line.slice(1));
    }
  }

  return linesByFile;
}

function lessonFiles(changedFiles: string[], suffixes: string[]): string[] {
  const matches = unique(
    suffixes.flatMap((suffix) =>
      changedFiles.filter((file) => file === suffix || file.endsWith(`/${suffix}`))
    )
  );

  return matches.length > 0 ? matches : changedFiles.slice(0, 5);
}

function lessonTextForFiles(linesByFile: Map<string, string[]>, files: string[]): string {
  return files
    .flatMap((file) => linesByFile.get(file) ?? [])
    .join("\n");
}

function lessonFrom(
  lesson: Omit<DiffLesson, "files">,
  changedFiles: string[],
  suffixes: string[]
): DiffLesson {
  return {
    ...lesson,
    files: lessonFiles(changedFiles, suffixes)
  };
}

function extractDiffLessons(diff: string, changedFiles: string[]): DiffLesson[] {
  if (!diff.trim() || changedFiles.length === 0) {
    return [];
  }

  const lessons: DiffLesson[] = [];
  const seen = new Set<string>();
  const linesByFile = addedLinesByFile(diff, changedFiles);
  const allAddedText = [...linesByFile.values()].flat().join("\n");
  const taskFiles = lessonFiles(changedFiles, [
    "src/task.ts",
    "src/types.ts",
    "src/cli.ts",
    "src/codex.ts",
    "tests/task.test.ts",
    "SPEC.md",
    "README.md"
  ]);
  const taskText = lessonTextForFiles(linesByFile, taskFiles);
  const primeFiles = lessonFiles(changedFiles, [
    "src/prime.ts",
    "src/cli.ts",
    "tests/prime.test.ts",
    "SPEC.md",
    "README.md"
  ]);
  const primeText = lessonTextForFiles(linesByFile, primeFiles);
  const schemaFiles = lessonFiles(changedFiles, [
    "src/schema.ts",
    "src/cli.ts",
    "tests/schema.test.ts",
    "SPEC.md",
    "README.md"
  ]);
  const schemaText = lessonTextForFiles(linesByFile, schemaFiles);
  const addLesson = (lesson: DiffLesson): void => {
    const key = `${lesson.type}:${lesson.title}`;
    if (!seen.has(key)) {
      seen.add(key);
      lessons.push(lesson);
    }
  };

  if (includesAny(taskText, ["task ready", "readytasks", "unfinished blocking dependencies", "blocking dependency"])) {
    addLesson(lessonFrom({
      type: "module",
      title: "Task",
      modules: ["task"],
      summary: "`task ready` exposes open work with no unfinished `blocks` dependencies; `related` and `discovered_from` links should not block readiness.",
      tags: ["work-graph", "codex"]
    }, changedFiles, taskFiles));
  }

  if (includesAny(taskText, ["coordination hints", "not locks", "claimed_at", "task_claimed"])) {
    addLesson(lessonFrom({
      type: "decision",
      title: "Task claims are coordination hints, not locks",
      modules: ["task"],
      summary: "`task claim` records active ownership for agent coordination, but it should not be treated as an exclusive distributed lock.",
      tags: ["work-graph", "coordination"]
    }, changedFiles, taskFiles));
  }

  if (includesAny(taskText, ["--force"]) && includesAny(taskText, ["blocked", "blocking dependencies", "blockers"])) {
    addLesson(lessonFrom({
      type: "rule",
      title: "Blocked task claims require explicit force",
      status: "proposed",
      severity: "high",
      modules: ["task"],
      summary: "Blocked tasks should reject normal claims; `task claim --force` is the explicit human-approved override.",
      tags: ["work-graph", "safety"]
    }, changedFiles, taskFiles));
  }

  if (includesAny(taskText, ["next action", "下一步做什么", "suggested test command", "--no-from-git-diff"])) {
    addLesson(lessonFrom({
      type: "pattern",
      title: "Task checkpoints feed resume handoffs",
      modules: ["task"],
      summary: "`checkpoint` should capture changed files, suggested tests, and next actions so `resume` can start with the concrete next step for a fresh agent session.",
      tags: ["handoff", "cross-session"]
    }, changedFiles, taskFiles));
  }

  if (includesAny(primeText, ["aiwiki prime", "generateprimecontext", "active task", "ready work", "memory health"])) {
    addLesson(lessonFrom({
      type: "module",
      title: "Prime",
      modules: ["prime"],
      summary: "`aiwiki prime` is the Codex startup dashboard for active task, ready work, guard targets, memory health, optional Beads context, and next commands.",
      tags: ["codex", "startup"]
    }, changedFiles, primeFiles));
  }

  if (includesAny(allAddedText, ["readbeadscontext", ".beads", "bd ready", "bd status", "beads_ready_work"])) {
    addLesson(lessonFrom({
      type: "module",
      title: "Beads",
      modules: ["beads"],
      summary: "AIWiki can surface optional Beads context by reading `bd ready --json` and `bd status --json` when `.beads/` exists, without writing to Beads or reimplementing its task database.",
      tags: ["beads", "integration", "read-only"]
    }, changedFiles, ["src/beads.ts", "src/prime.ts", "tests/prime.test.ts", "README.md", "SPEC.md"]));
  }

  if (includesAny(allAddedText, ["saverawnote", "raw-notes", "reflect --notes --save-raw", "compatibility path; prefer reflect --notes --save-raw"])) {
    addLesson(lessonFrom({
      type: "module",
      title: "Ingest",
      modules: ["ingest", "reflect"],
      summary: "`ingest` is a compatibility path; durable note capture should flow through `reflect --notes --save-raw` and the shared raw-notes service.",
      tags: ["notes", "compatibility", "reflect"]
    }, changedFiles, ["src/ingest.ts", "src/raw-notes.ts", "src/reflect.ts", "tests/ingest.test.ts", "README.md"]));
  }

  if (includesAny(schemaText, ["task-event", "agent-facing", "schema name", "aiwiki prime context"])) {
    addLesson(lessonFrom({
      type: "module",
      title: "Schema",
      modules: ["schema"],
      summary: "`aiwiki schema` is the agent-facing contract surface for task, task-event, and prime JSON data.",
      tags: ["contracts", "agents"]
    }, changedFiles, schemaFiles));
  }

  if (includesAny(allAddedText, ["tostructuredclierror", "wantsjsonerror", "structured cli errors", "structured json"])) {
    addLesson(lessonFrom({
      type: "pattern",
      title: "Structured JSON errors for agent output",
      modules: ["errors", "cli"],
      summary: "When a command is asked for JSON, failures should be emitted as structured JSON errors with actionable hints.",
      tags: ["agents", "errors"]
    }, changedFiles, ["src/errors.ts", "src/cli.ts", "tests/errors.test.ts"]));
  }

  if (includesAny(allAddedText, ["codex --team", "task ready", "blocked tasks require explicit", "task claim <id>"])) {
    addLesson(lessonFrom({
      type: "pattern",
      title: "Codex team runbooks include work graph guidance",
      modules: ["codex", "task"],
      summary: "`codex --team` should point agents to `prime`, `task ready`, `task claim`, and blocked-task `--force` guidance.",
      tags: ["codex", "work-graph"]
    }, changedFiles, ["src/codex.ts", "tests/codex.test.ts", "README.md", "SPEC.md"]));
  }

  for (const riskLesson of diffRiskLessonsFromChanges(changedFiles, linesByFile)) {
    addLesson(riskLesson);
  }

  return lessons;
}

function appendEntryForPage(
  page: WikiPage,
  noteSummary: string | undefined,
  changedFiles: string[],
  rawNotePath?: string
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
          rawNotePath ? `Source note: ${rawNotePath}.` : undefined,
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
  riskyFiles: string[],
  refreshPages: WikiPage[],
  diffLessons: DiffLesson[],
  rawNotePath?: string
): WikiUpdatePlan | undefined {
  const entries: WikiUpdatePlanEntry[] = [];
  for (const lesson of diffLessons.slice(0, 8)) {
    entries.push({
      type: lesson.type,
      title: lesson.title,
      slug: safeSlug(lesson.title, lesson.type),
      source: "reflect",
      status: lesson.status,
      modules: lesson.modules,
      files: lesson.files,
      tags: lesson.tags,
      severity: lesson.severity,
      summary: lesson.summary
    });
  }

  const hasExplicitNotes = notes.trim().length > 0 || Boolean(rawNotePath);
  const matchedPages = hasExplicitNotes
    ? pagesOfType(results, "pitfall")
      .concat(pagesOfType(results, "decision"))
      .concat(pagesOfType(results, "pattern"))
      .slice(0, 3)
    : [];

  for (const page of matchedPages) {
    entries.push(appendEntryForPage(page, noteSummary, changedFiles, rawNotePath));
  }

  const existingModulePages = [
    ...pagesOfType(results, "module"),
    ...refreshPages.filter((page) => page.frontmatter.type === "module")
  ];
  const existingModuleNames = new Set(
    existingModulePages.flatMap((page) => [
      ...(page.frontmatter.modules ?? []),
      page.frontmatter.title,
      pageTitle(page)
    ])
  );

  const shouldInferNewModules =
    Boolean(noteSummary) ||
    diffLessons.length > 0 ||
    riskyFiles.length > 0 ||
    Boolean(rawNotePath);
  const newModuleCandidates = shouldInferNewModules
    ? modules
        .filter((moduleName) => !existingModuleNames.has(moduleName))
        .map((moduleName) => ({
          moduleName,
          files: moduleFiles(moduleName, changedFiles),
          summary: noteSummary
            ? `Reflection candidate from recent work: ${noteSummary}.`
            : inferredModuleSummary(moduleName) ??
              highRiskModuleSummary(moduleName, moduleFiles(moduleName, changedFiles), riskyFiles)
        }))
        .filter((candidate) => candidate.summary)
        .sort((a, b) => {
          if (b.files.length !== a.files.length) {
            return b.files.length - a.files.length;
          }

          return a.moduleName.localeCompare(b.moduleName);
        })
        .slice(0, 3)
    : [];

  for (const candidate of newModuleCandidates) {
    entries.push({
      type: "module",
      title: titleCase(candidate.moduleName),
      slug: safeSlug(candidate.moduleName, "module"),
      source: "reflect",
      modules: [candidate.moduleName],
      files: candidate.files,
      frontmatter: rawNotePath ? { source_notes: [rawNotePath] } : undefined,
      summary: candidate.summary!
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
      frontmatter: rawNotePath ? { source_notes: [rawNotePath] } : undefined,
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
      frontmatter: rawNotePath ? { source_notes: [rawNotePath] } : undefined,
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
      frontmatter: rawNotePath ? { source_notes: [rawNotePath] } : undefined,
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
      frontmatter: rawNotePath ? { source_notes: [rawNotePath] } : undefined,
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

  const lessonTitle = diffLessons.length > 0
    ? `Reflect: ${diffLessons.slice(0, 3).map((lesson) => lesson.title).join("; ")}`
    : undefined;

  return {
    version: AIWIKI_VERSION,
    title: noteSummary ? `Reflect: ${noteSummary}` : lessonTitle ?? "Reflect update candidates",
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
    ...reflectSectionItems(preview, "Freshness Refreshes"),
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
        "An update plan is a reviewable JSON draft of candidate wiki writes; reflect creates the draft, but does not apply it.",
        "Preview the plan with `aiwiki apply <plan.json>` and only add `--confirm` after the operations look right.",
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
      notesPath: preview.notesPath,
      rawNotePath: preview.rawNotePath
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
  if (options.readOnly && options.outputPlan) {
    throw new Error("Cannot use --read-only with --output-plan because --output-plan writes a file.");
  }
  if (options.readOnly && options.saveRaw) {
    throw new Error("Cannot use --read-only with --save-raw because --save-raw writes a raw note copy.");
  }
  if (options.saveRaw && !options.notes) {
    throw new Error("reflect --save-raw requires --notes <path>.");
  }

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

  if (!initialized && options.outputPlan) {
    throw new Error("Cannot use --output-plan before AIWiki is initialized. Run aiwiki init --project-name <name> first.");
  }
  if (!initialized && options.saveRaw) {
    throw new Error("Cannot use --save-raw before AIWiki is initialized. Run aiwiki init --project-name <name> first.");
  }

  const ignoreRules = await collectProjectIgnoreRules(
    rootDir,
    LOCAL_ARTIFACT_IGNORE,
    config.ignore
  );
  const notes = await readNotes(rootDir, options.notes);
  const savedRawNote = options.saveRaw && options.notes
    ? await saveRawNote(rootDir, options.notes, notes, { force: options.force })
    : undefined;
  if (options.fromGitDiff && !(await isGitRepository(rootDir))) {
    throw new Error(
      "reflect --from-git-diff requires a Git repository. Run git init, use --notes <path>, or skip reflect until code changes are tracked."
    );
  }
  const diff = options.fromGitDiff ? await readGitDiff(rootDir) : "";
  const status = options.fromGitDiff ? await readGitStatus(rootDir) : "";
  const ignoredChangedFiles = new Set(
    [
      options.outputPlan ? normalizeProjectChangedFile(rootDir, options.outputPlan) : undefined,
      savedRawNote?.rawNotePath
    ].filter((file): file is string => Boolean(file))
  );
  const changedFiles = await filterChangedFileList(rootDir, unique([
    ...extractChangedFiles(diff),
    ...extractStatusChangedFiles(status)
  ])
    .filter((file) => !ignoredChangedFiles.has(file))
    .sort(), ignoreRules);
  const diffLessons = extractDiffLessons(diff, changedFiles);
  const query = searchQuery(changedFiles, notes);
  const search = query.length > 0
    ? await searchWikiMemory(rootDir, query, {
        limit: options.limit ?? DEFAULT_REFLECT_LIMIT
      })
    : { query: "", results: [] };
  const results = search.results;
  const refreshPages = await pagesReferencingChangedFiles(rootDir, changedFiles);
  const selectedDocs = unique([...docs(results), ...refreshPages.map(pageDoc)]);
  const riskyFiles = highRiskChangedFiles(changedFiles);
  const noteSummary = firstNonEmptyLine(notes);
  const includePathModuleCandidates =
    Boolean(noteSummary) ||
    diffLessons.length > 0 ||
    riskyFiles.length > 0 ||
    Boolean(savedRawNote?.rawNotePath);
  const modules = relatedModules(results, changedFiles, {
    includePathCandidates: includePathModuleCandidates
  });
  const matchingPitfalls = matchingTitles(results, "pitfall");
  const matchingDecisions = matchingTitles(results, "decision");
  const matchingPatterns = matchingTitles(results, "pattern");
  const matchingRules = matchingTitles(results, "rule");
  const updatePlanDraft = initialized
    ? buildReflectUpdatePlanDraft(
        noteSummary,
        notes,
        changedFiles,
        results,
        modules,
        riskyFiles,
        refreshPages,
        diffLessons,
        savedRawNote?.rawNotePath
      )
    : undefined;

  const preview: ReflectPreview = {
    projectName: config.projectName,
    initialized,
    fromGitDiff: options.fromGitDiff ?? false,
    notesPath: options.notes,
    rawNotePath: savedRawNote?.rawNotePath,
    changedFiles,
    selectedDocs,
    updatePlanDraft,
    sections: [
      section(
        "Task Summary",
        fallback(
          [
            noteSummary ? `Notes summary: ${noteSummary}` : undefined,
            savedRawNote ? `Raw note copied to ${savedRawNote.rawNotePath}.` : undefined,
            initialized
              ? undefined
              : "Cold-start mode: no .aiwiki memory was loaded and no AIWiki files were written.",
            options.fromGitDiff
              ? `Git diff changed ${changedFiles.length} file(s). Includes untracked files from git status.`
              : "No git diff was requested."
          ].filter((item): item is string => Boolean(item)),
          "No notes or git diff input was provided."
        )
      ),
      section(
        "New Lessons",
        [
          ...diffLessons.map((lesson) => `${lesson.title}: ${lesson.summary}`),
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
          [
            ...modules.map((moduleName) => `Review module summary for ${moduleName}.`),
            ...refreshPages
              .filter((page) => page.frontmatter.type === "module")
              .map((page) => `Refresh existing module memory: ${pageTitle(page)} (${pageDoc(page)}).`)
          ],
          "No matching module updates detected."
        )
      ),
      section(
        "Freshness Refreshes",
        fallback(
          refreshPages.map((page) =>
            `Refresh ${pageTitle(page)} (${pageDoc(page)}) because referenced files changed.`
          ),
          "No wiki pages reference the changed files."
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
          : !initialized
            ? [
                "No structured wiki writes are planned because AIWiki is not initialized.",
                "Run aiwiki init --project-name <name> and aiwiki map --write before generating output plans."
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

  if (initialized && !options.readOnly) {
    await appendReflectEvalCase(rootDir, preview);
  }

  const markdown = formatReflectPreviewMarkdown(preview);
  const json = reflectToJson(preview);
  return { preview, markdown, json };
}
