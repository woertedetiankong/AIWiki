import { appendFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { generateArchitectureBriefContext } from "./architecture.js";
import {
  ARCHITECTURE_SOURCE_FILE_EXTENSIONS,
  BRIEF_EVALS_PATH,
  PROJECT_SCAN_EXCLUDED_PATHS,
  INDEX_PATH
} from "./constants.js";
import { AIWikiNotInitializedError, createDefaultConfig, loadAIWikiConfig } from "./config.js";
import { loadGraphifyContext } from "./graphify.js";
import type { GraphifyContext } from "./graphify.js";
import {
  collectProjectIgnoreRules,
  shouldIgnorePath
} from "./ignore.js";
import type { IgnoreRule } from "./ignore.js";
import { appendLogEntry } from "./log.js";
import type { OutputFormat } from "./output.js";
import { resolveProjectPath, toPosixPath } from "./paths.js";
import type { SearchResult } from "./search.js";
import { searchWikiMemory } from "./search.js";
import {
  collectWikiStalenessWarnings,
  formatStalenessWarning
} from "./staleness.js";
import type { WikiStalenessWarning } from "./staleness.js";
import type { AIWikiConfig } from "./types.js";

export interface BriefOptions {
  limit?: number;
  output?: string;
  force?: boolean;
  format?: OutputFormat;
  withGraphify?: boolean;
  architectureGuard?: boolean;
  readOnly?: boolean;
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
  stalenessWarnings?: WikiStalenessWarning[];
  sections: BriefSection[];
}

export interface BriefResult {
  brief: DevelopmentBrief;
  markdown: string;
  json: string;
  outputPath?: string;
}

const DEFAULT_BRIEF_LIMIT = 8;
const DISCOVERED_ENTRY_FILE_LIMIT = 10;
const ARCHITECTURE_FOCUS_FILE_LIMIT = 6;
const DISCOVERY_CONTENT_LIMIT = 12_000;
const DISCOVERED_DOC_LIMIT = 10;

interface DiscoveredEntryFile {
  path: string;
  score: number;
  matchedTokens: string[];
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function normalizePath(filePath: string): string {
  return toPosixPath(filePath).replace(/^\.\//u, "");
}

function isSourceFile(relativePath: string): boolean {
  const extension = path.posix.extname(normalizePath(relativePath));
  return ARCHITECTURE_SOURCE_FILE_EXTENSIONS.includes(
    extension as (typeof ARCHITECTURE_SOURCE_FILE_EXTENSIONS)[number]
  );
}

function isMarkdownFile(relativePath: string): boolean {
  return path.posix.extname(normalizePath(relativePath)).toLowerCase() === ".md";
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

async function walkSourceFiles(
  rootDir: string,
  ignoreRules: readonly IgnoreRule[],
  currentDir = rootDir
): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(currentDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }

  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    const relativePath = normalizePath(path.relative(rootDir, fullPath));

    if (shouldIgnorePath(relativePath, ignoreRules)) {
      continue;
    }

    if (entry.isDirectory()) {
      files.push(...(await walkSourceFiles(rootDir, ignoreRules, fullPath)));
    } else if (entry.isFile() && isSourceFile(relativePath)) {
      files.push(relativePath);
    }
  }

  return files.sort();
}

async function walkMarkdownFiles(
  rootDir: string,
  ignoreRules: readonly IgnoreRule[],
  currentDir = rootDir
): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(currentDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }

  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    const relativePath = normalizePath(path.relative(rootDir, fullPath));

    if (shouldIgnorePath(relativePath, ignoreRules)) {
      continue;
    }

    if (entry.isDirectory()) {
      files.push(...(await walkMarkdownFiles(rootDir, ignoreRules, fullPath)));
    } else if (entry.isFile() && isMarkdownFile(relativePath)) {
      files.push(relativePath);
    }
  }

  return files.sort();
}

function taskLooksDocumentFocused(task: string): boolean {
  return /doc|docs|document|markdown|readme|prd|requirement|handoff|progress|note|stale|outdated|obsolete|文档|过时|梳理|需求|交接|记录|说明|有用/iu.test(task);
}

function taskLooksTestFocused(task: string): boolean {
  return /\b(test|tests|testing|spec|specs|regression|coverage)\b/iu.test(task);
}

function nameTokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

async function readOptionalProjectFile(rootDir: string, filePath: string): Promise<string> {
  try {
    return await readFile(resolveProjectPath(rootDir, filePath), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return "";
    }

    throw error;
  }
}

async function projectIdentityTokens(rootDir: string): Promise<string[]> {
  const rootName = path.basename(path.resolve(rootDir));
  const pyproject = await readOptionalProjectFile(rootDir, "pyproject.toml");
  const pyprojectName = pyproject.match(/^\s*name\s*=\s*["']([^"']+)["']/mu)?.[1];
  const packageJson = await readOptionalProjectFile(rootDir, "package.json");
  let packageName: string | undefined;
  if (packageJson) {
    try {
      const parsed = JSON.parse(packageJson) as { name?: unknown };
      packageName = typeof parsed.name === "string" ? parsed.name : undefined;
    } catch {
      packageName = undefined;
    }
  }

  return unique([
    ...nameTokens(rootName),
    ...nameTokens(pyprojectName ?? ""),
    ...nameTokens(packageName ?? "")
  ]);
}

function taskDiscoveryTokens(task: string, extraLowSignalTokens: string[] = []): string[] {
  const normalized = task.toLowerCase();
  const tokens = normalized
    .split(/[^a-z0-9_./-]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);

  if (/\b(edit|editing|editor|wysiwyg|write|writing)\b/iu.test(task) || /编辑|写作|富文本/u.test(task)) {
    tokens.push("editor", "edit", "tiptap", "novel");
  }
  if (/\b(style|styles|theme|themes|appearance|design)\b/iu.test(task) || /风格|样式|主题|外观|排版/u.test(task)) {
    tokens.push("style", "theme", "appearance", "design");
  }
  if (/\b(markdown|md)\b/iu.test(task) || /马克down|文档/u.test(task)) {
    tokens.push("markdown", "doc", "docs");
  }
  if (/\b(requirement|requirements|prd|handoff|progress)\b/iu.test(task) || /需求|交接|进度|记录/u.test(task)) {
    tokens.push("requirement", "requirements", "prd", "handoff", "progress");
  }
  if (/\b(export|download|copy|clipboard|pdf)\b/iu.test(task) || /导出|下载|复制/u.test(task)) {
    tokens.push("export", "download", "copy", "clipboard", "pdf");
  }
  if (/\b(wechat|weixin)\b/iu.test(task) || /微信|公众号/u.test(task)) {
    tokens.push("wechat");
  }
  if (/\b(auth|login|permission|security)\b/iu.test(task) || /登录|权限|安全/u.test(task)) {
    tokens.push("auth", "login", "permission", "security");
  }

  if (/\b(connect|connection|configuration|config)\b/iu.test(task)) {
    tokens.push("connect", "connection", "config", "configuration");
  }
  if (/\b(notification|notify|message|messaging)\b/iu.test(task)) {
    tokens.push("notification", "notify", "message", "messaging");
  }
  if (/\b(maintenance|maintain)\b/iu.test(task)) {
    tokens.push("maintenance", "maintain", "maint");
  }

  const lowSignal = new Set([
    "the",
    "and",
    "for",
    "with",
    "whether",
    "check",
    "support",
    "supports",
    "different",
    "project",
    "feature",
    "markdown",
    "app",
    "web",
    "page",
    "pms"
  ]);
  for (const token of extraLowSignalTokens) {
    lowSignal.add(token);
  }

  return unique(tokens).filter((token) => !lowSignal.has(token));
}

function scoreEntryFile(
  filePath: string,
  content: string,
  tokens: string[],
  task: string
): DiscoveredEntryFile | undefined {
  const normalizedPath = filePath.toLowerCase();
  const basename = path.posix.basename(normalizedPath, path.posix.extname(normalizedPath));
  const normalizedContent = content.toLowerCase();
  const matchedTokens = new Set<string>();
  let score = 0;

  for (const token of tokens) {
    if (basename.includes(token)) {
      score += 8;
      matchedTokens.add(token);
    }
    if (normalizedPath.includes(token)) {
      score += 5;
      matchedTokens.add(token);
    }
    if (normalizedContent.includes(token)) {
      score += 1;
      matchedTokens.add(token);
    }
  }

  if (matchedTokens.size === 0 || score <= 0) {
    return undefined;
  }

  if (
    path.posix.extname(normalizedPath) === ".vue" &&
    matchedTokens.size >= 2 &&
    /\b(web|frontend|front-end|ui|page)\b/iu.test(task)
  ) {
    score += 12;
  }

  const entrypointBoosts = [
    "page.",
    "route.",
    "layout.",
    "client.",
    "manager.",
    "editor.",
    "config.",
    "settings."
  ];
  if (entrypointBoosts.some((signal) => normalizedPath.includes(signal))) {
    score += 3;
  }
  if (normalizedPath.startsWith("components/") || normalizedPath.startsWith("app/")) {
    score += 2;
  }

  const taskText = task.toLowerCase();
  if (normalizedPath.startsWith("apps/") && !/\b(app|apps|application|deepresearch|harbor|swebench)\b/iu.test(taskText)) {
    score -= 16;
  }
  if (normalizedPath.startsWith("cli/") && !/\b(cli|command|terminal|interactive|picker)\b/iu.test(taskText)) {
    score -= 10;
  }
  if (normalizedPath.startsWith("examples/") && !/\b(example|examples|demo|sample)\b/iu.test(taskText)) {
    score -= 16;
  }
  if (normalizedPath.includes("/skills/") && !/\b(skill|skills)\b/iu.test(taskText)) {
    score -= 10;
  }
  if (normalizedPath.includes("/plan/") && !/\b(plan|planning)\b/iu.test(taskText)) {
    score -= 8;
  }
  if (
    (normalizedPath.startsWith("tests/") ||
      normalizedPath.includes("/tests/") ||
      /(?:^|\/)(test_|.+\.test\.|.+\.spec\.)/u.test(normalizedPath)) &&
    !taskLooksTestFocused(task)
  ) {
    score -= 8;
  }

  if (score <= 0) {
    return undefined;
  }

  return {
    path: filePath,
    score,
    matchedTokens: [...matchedTokens].sort()
  };
}

function scoreMarkdownDoc(
  filePath: string,
  content: string,
  tokens: string[]
): DiscoveredEntryFile | undefined {
  const normalizedPath = filePath.toLowerCase();
  const basename = path.posix.basename(normalizedPath, ".md");
  const firstHeading = content
    .split("\n")
    .find((line) => line.trim().startsWith("#"))
    ?.replace(/^#+\s*/u, "")
    .toLowerCase() ?? "";
  const normalizedContent = content.slice(0, DISCOVERY_CONTENT_LIMIT).toLowerCase();
  const matchedTokens = new Set<string>();
  let score = 0;

  const docSignals = [
    "readme",
    "agents",
    "prd",
    "requirement",
    "requirements",
    "start",
    "progress",
    "handoff",
    "pitfall",
    "guide",
    "checklist",
    "需求",
    "业务",
    "交接",
    "进度",
    "指南"
  ];

  for (const signal of docSignals) {
    if (normalizedPath.includes(signal) || firstHeading.includes(signal)) {
      score += 4;
    }
  }

  for (const token of tokens) {
    if (basename.includes(token) || firstHeading.includes(token)) {
      score += 8;
      matchedTokens.add(token);
    }
    if (normalizedPath.includes(token)) {
      score += 5;
      matchedTokens.add(token);
    }
    if (normalizedContent.includes(token)) {
      score += 1;
      matchedTokens.add(token);
    }
  }

  if (normalizedPath.startsWith("docs/") || normalizedPath.startsWith("sheet/")) {
    score += 3;
  }
  if (!normalizedPath.includes("/")) {
    score += 2;
  }

  if (score <= 0) {
    return undefined;
  }

  return {
    path: filePath,
    score,
    matchedTokens: [...matchedTokens].sort()
  };
}

async function discoverEntryFiles(
  rootDir: string,
  task: string,
  ignoreRules: readonly IgnoreRule[],
  extraLowSignalTokens: string[] = []
): Promise<string[]> {
  const tokens = taskDiscoveryTokens(task, extraLowSignalTokens);
  if (tokens.length === 0) {
    return [];
  }

  const files = await walkSourceFiles(rootDir, ignoreRules);
  const scored: DiscoveredEntryFile[] = [];
  for (const filePath of files) {
    const content = (await readFile(resolveProjectPath(rootDir, filePath), "utf8")).slice(
      0,
      DISCOVERY_CONTENT_LIMIT
    );
    const score = scoreEntryFile(filePath, content, tokens, task);
    if (score) {
      scored.push(score);
    }
  }

  return selectDiverseEntryFiles(
    scored.sort((left, right) => right.score - left.score || left.path.localeCompare(right.path)),
    tokens
  )
    .map((item) => `${item.path} (matched: ${item.matchedTokens.join(", ")})`);
}

async function discoverMarkdownDocs(
  rootDir: string,
  task: string,
  ignoreRules: readonly IgnoreRule[],
  extraLowSignalTokens: string[] = []
): Promise<string[]> {
  if (!taskLooksDocumentFocused(task)) {
    return [];
  }

  const tokens = taskDiscoveryTokens(task, extraLowSignalTokens);
  const files = await walkMarkdownFiles(rootDir, ignoreRules);
  const scored: DiscoveredEntryFile[] = [];
  for (const filePath of files) {
    const content = await readFile(resolveProjectPath(rootDir, filePath), "utf8");
    const score = scoreMarkdownDoc(filePath, content, tokens);
    if (score) {
      scored.push(score);
    }
  }

  return scored
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
    .slice(0, DISCOVERED_DOC_LIMIT)
    .map((item) =>
      item.matchedTokens.length > 0
        ? `${item.path} (matched: ${item.matchedTokens.join(", ")})`
        : item.path
    );
}

function selectDiverseEntryFiles(
  scored: DiscoveredEntryFile[],
  tokens: string[]
): DiscoveredEntryFile[] {
  const selected = new Map<string, DiscoveredEntryFile>();
  const preferredTokens = [
    "editor",
    "theme",
    "appearance",
    "style",
    "markdown",
    "wechat",
    "export",
    "auth",
    "schema"
  ].filter((token) => tokens.includes(token));

  for (const token of preferredTokens) {
    const candidate = scored.find((item) => item.path.toLowerCase().includes(token));
    if (candidate) {
      selected.set(candidate.path, candidate);
    }
  }

  for (const item of scored) {
    selected.set(item.path, item);
    if (selected.size >= DISCOVERED_ENTRY_FILE_LIMIT) {
      break;
    }
  }

  return [...selected.values()]
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
    .slice(0, DISCOVERED_ENTRY_FILE_LIMIT);
}

function discoveredPath(item: string): string {
  return item.replace(/\s+\(matched:.*\)$/u, "");
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

function isHighConfidenceBriefResult(result: SearchResult): boolean {
  const structuralMatch = result.matchedFields.some((field) =>
    field === "title" || field === "frontmatter" || field === "path"
  );
  return structuralMatch && result.score >= 8;
}

function highConfidenceResults(results: SearchResult[]): SearchResult[] {
  return results.filter(isHighConfidenceBriefResult);
}

function memoryHintResults(results: SearchResult[]): SearchResult[] {
  return results.filter((result) => !isHighConfidenceBriefResult(result));
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

function memoryHintBullets(results: SearchResult[]): string[] {
  return results.map((result) => {
    const fields = result.matchedFields.join(", ");
    const excerpt = result.excerpt ? ` - ${result.excerpt}` : "";
    return `${pageTitle(result)} (${pageDocPath(result)}; score ${result.score}; matched ${fields})${excerpt}`;
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

function graphifyBullets(context: GraphifyContext | undefined): string[] {
  if (!context) {
    return [];
  }

  const items = [
    `Available: ${context.available ? "yes" : "no"}.`,
    ...context.warnings.map((warning) => `Warning: ${warning}`),
    context.graphPath ? `Graph JSON: ${context.graphPath}.` : undefined,
    context.reportPath ? `Report: ${context.reportPath}.` : undefined,
    context.nodes.length > 0 ? `Parsed nodes: ${context.nodes.length}.` : undefined,
    context.edges.length > 0 ? `Parsed edges: ${context.edges.length}.` : undefined,
    ...context.files.slice(0, 8).map((file) => `Graphify file reference: ${file}.`),
    ...context.reportSummary.slice(0, 4)
  ].filter((item): item is string => Boolean(item));

  return items.length > 0
    ? items
    : ["Graphify context requested, but no Graphify output was found."];
}

function architectureGuardBullets(
  task: string,
  modules: string[],
  riskFiles: string[]
): string[] {
  const taskText = task.toLowerCase();
  const testHints = [
    taskText.includes("webhook") ? "webhook event parsing and idempotency" : undefined,
    taskText.includes("auth") || taskText.includes("permission") ? "auth and permission boundaries" : undefined,
    taskText.includes("migration") || taskText.includes("schema") ? "migration rollback and schema compatibility" : undefined,
    taskText.includes("billing") || taskText.includes("payment") || taskText.includes("stripe") ? "billing/payment state transitions" : undefined
  ].filter((item): item is string => Boolean(item));

  return [
    modules.length > 0
      ? `Likely modules: ${modules.join(", ")}.`
      : "Likely modules: none detected from current wiki search.",
    riskFiles.length > 0
      ? `High-risk files to review: ${riskFiles.join(", ")}.`
      : "High-risk files: none detected from config or matched memory.",
    testHints.length > 0
      ? `Focused tests should cover ${testHints.join(", ")}.`
      : "Focused tests should cover state transitions, auth, webhooks, migrations, or billing if this task touches those domains.",
    "Keep route/controller files thin; move business logic into module services or adapters when this task adds durable behavior.",
    "This guard is advisory and must not automatically refactor code or block the task."
  ];
}

function formatSection(section: BriefSection): string {
  const body = section.items.map((item) => `- ${item}`).join("\n");
  return `## ${section.title}\n${body}`;
}

function sectionItems(brief: DevelopmentBrief, title: string): string[] {
  return brief.sections.find((section) => section.title === title)?.items ?? [];
}

function compactItems(items: string[], fallback: string): string[] {
  return items.length > 0 ? items : [fallback];
}

function memoryCoverageItems(
  initialized: boolean,
  selectedDocs: string[],
  discoveredDocs: string[],
  discoveredEntryFiles: string[]
): string[] {
  if (!initialized) {
    return [
      "No durable .aiwiki memory was loaded; this brief is based on a cold project scan.",
      "Treat discovered files and docs as navigation hints, not learned project constraints."
    ];
  }

  if (selectedDocs.length > 0) {
    return [
      `Retrieved ${selectedDocs.length} candidate AIWiki memory page(s).`,
      "Retrieval is not proof that the target code area has memory coverage; only treat clearly target-matching pages as project-specific constraints.",
      "Treat built-in generic guardrails as advisory checks.",
      "Before editing concrete files, run `aiwiki guard <file>` to confirm file-level coverage."
    ];
  }

  const discoveredHints = discoveredDocs.length + discoveredEntryFiles.length;
  return [
    "No task-specific AIWiki memory pages matched this request.",
    discoveredHints > 0
      ? "Discovered files and docs are search hints only; inspect them directly before planning edits."
      : "No task-matching source files or docs were discovered; inspect the repository directly before planning edits.",
    "Do not infer project-specific constraints from generic guardrails when memory coverage is empty."
  ];
}

function recommendedDirectionItems(hasMatchedMemory: boolean): string[] {
  return [
    hasMatchedMemory
      ? "Use only clearly relevant matched AIWiki pages as project memory and constraints."
      : "No matching AIWiki pages were found; use source code, tests, and the user's request as the source of truth.",
    "Keep the implementation plan inside the coding agent session; this brief should not be treated as exact edit instructions.",
    "Prefer existing project conventions and local Markdown workflow before adding new infrastructure."
  ];
}

function acceptanceCriteriaItems(hasMatchedMemory: boolean): string[] {
  return [
    hasMatchedMemory
      ? "The requested behavior is implemented without violating clearly relevant project memory above."
      : "The requested behavior is implemented against the current source, tests, and user request; generic AIWiki guardrails remain advisory.",
    "Relevant existing tests pass, and new focused tests are added where behavior changes.",
    "User-owned AIWiki data is not overwritten or deleted by default."
  ];
}

function notesForCodexItems(hasMatchedMemory: boolean): string[] {
  return [
    hasMatchedMemory
      ? "Use clearly relevant matched pages as project memory and constraints."
      : "When memory coverage is empty or only loosely related, do not infer constraints that are not present in source, tests, or the user request.",
    "Create your own implementation plan before editing code.",
    "Do not treat this brief as exact code instructions."
  ];
}

function removeItem(items: string[], value: string): string[] {
  return items.filter((item) => item !== value);
}

function firstMatchingItem(items: string[], pattern: RegExp): string | undefined {
  return items.find((item) => pattern.test(item));
}

const MARKDOWN_SECTION_LIMITS: ReadonlyMap<string, number> = new Map([
  ["Must Read", 8],
  ["Memory Hints", 6],
  ["Rules", 8],
  ["Pitfalls", 8],
  ["Architecture Guard", 6],
  ["Built-In Generic Guardrails", 8],
  ["Graphify Context", 8],
  ["Other Context", 8]
] as const);

function limitMarkdownSection(section: BriefSection): BriefSection {
  const limit = MARKDOWN_SECTION_LIMITS.get(section.title);
  if (!limit || section.items.length <= limit) {
    return section;
  }

  return {
    ...section,
    items: [
      ...section.items.slice(0, limit),
      `${section.items.length - limit} more item(s) omitted from markdown; use --format json for full context.`
    ]
  };
}

export function formatDevelopmentBriefMarkdown(brief: DevelopmentBrief): string {
  const setup = sectionItems(brief, "AIWiki Setup");
  const mustRead = sectionItems(brief, "Suggested Must-Read Files");
  const discoveredDocs = removeItem(
    sectionItems(brief, "Discovered Markdown Docs"),
    "No task-matching Markdown docs discovered."
  );
  const discoveredEntryFiles = removeItem(
    sectionItems(brief, "Discovered Entry Files"),
    "No task-matching source entry files discovered."
  );
  const rules = removeItem(
    sectionItems(brief, "Project Rules and Constraints"),
    "No matching rule pages found."
  );
  const pitfalls = removeItem(
    sectionItems(brief, "Known Pitfalls"),
    "No matching pitfall pages found."
  );
  const stalenessWarnings = brief.stalenessWarnings ?? [];
  const acceptance = sectionItems(brief, "Acceptance Criteria");
  const memoryCoverage = sectionItems(brief, "Memory Coverage");
  const memoryHints = removeItem(
    sectionItems(brief, "Memory Hints"),
    "No low-confidence memory hints found."
  );
  const architectureGuard = sectionItems(brief, "Architecture Guard");
  const graphify = sectionItems(brief, "Graphify Structural Context");
  const modules = removeItem(
    sectionItems(brief, "Relevant Modules"),
    "No matching module pages found."
  );
  const highRiskFiles = removeItem(
    sectionItems(brief, "High-Risk Files"),
    "No high-risk files matched this task."
  );
  const tests = [
    firstMatchingItem(acceptance, /tests? pass|regression tests?/i),
    firstMatchingItem(architectureGuard, /Focused tests/i)
  ].filter((item): item is string => Boolean(item));
  const otherContext = [
    ...modules.map((item) => `Module: ${item}`),
    ...highRiskFiles.map((item) => `High-risk file: ${item}`)
  ];
  const genericGuardrails = [
    ...sectionItems(brief, "Architecture Boundaries"),
    ...sectionItems(brief, "Hardcoding and Configuration Risks"),
    ...sectionItems(brief, "Portability Checklist"),
    ...sectionItems(brief, "Module Memory to Maintain")
  ];
  const sections: BriefSection[] = [
    {
      title: "Must Read",
      items: [
        `Task: ${brief.task}`,
        ...compactItems(
          [...mustRead, ...discoveredDocs, ...discoveredEntryFiles],
          "No specific must-read files matched this task."
        )
      ]
    },
    ...(setup.length > 0
      ? [{ title: "Setup", items: setup }]
      : []),
    {
      title: "Do Not",
      items: [
        "Do not treat this brief as exact code instructions.",
        "Do not overwrite, delete, or promote user-owned AIWiki memory by default.",
        "Do not add remote services, Web UI, MCP, or heavy retrieval unless the task explicitly asks for it."
      ]
    },
    {
      title: "Memory Coverage",
      items: compactItems(
        memoryCoverage,
        "No memory coverage information was generated."
      )
    },
    ...(memoryHints.length > 0
      ? [{ title: "Memory Hints", items: memoryHints }]
      : []),
    {
      title: "Rules",
      items: compactItems(rules, "No matching rules found.")
    },
    {
      title: "Pitfalls",
      items: compactItems(pitfalls, "No matching pitfalls found.")
    },
    {
      title: "Staleness Warnings",
      items:
        stalenessWarnings.length > 0
          ? [
              ...stalenessWarnings.slice(0, 3).map(formatStalenessWarning),
              ...(stalenessWarnings.length > 3
                ? [
                    `${stalenessWarnings.length - 3} more staleness warning(s) omitted from markdown; use --format json for full context.`
                  ]
                : [])
            ]
          : brief.selectedDocs.length > 0
            ? ["No stale wiki memory warnings for selected context."]
            : ["No selected AIWiki pages to check for staleness."]
    },
    {
      title: "Suggested Tests",
      items: compactItems(tests, "Run relevant project checks and add focused regression tests for changed behavior.")
    },
    ...(architectureGuard.length > 0
      ? [{ title: "Architecture Guard", items: architectureGuard }]
      : []),
    {
      title: "Built-In Generic Guardrails",
      items: compactItems(
        genericGuardrails,
        "No built-in generic guardrails matched this task."
      )
    },
    ...(graphify.length > 0
      ? [{ title: "Graphify Context", items: graphify }]
      : []),
    {
      title: "Other Context",
      items: compactItems(otherContext, "No additional context matched this task.")
    }
  ];

  return [
    `# Development Brief: ${brief.task}`,
    "",
    ...sections
      .map(limitMarkdownSection)
      .flatMap((section) => [formatSection(section), ""])
  ].join("\n").trimEnd() + "\n";
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

function defaultProjectName(rootDir: string): string {
  return path.basename(path.resolve(rootDir)) || "project";
}

export async function generateDevelopmentBrief(
  rootDir: string,
  task: string,
  options: BriefOptions = {}
): Promise<BriefResult> {
  if (options.readOnly && options.output) {
    throw new Error("Cannot use --read-only with --output because --output writes a file.");
  }

  let initialized = true;
  let config: AIWikiConfig;
  try {
    config = await loadAIWikiConfig(rootDir);
  } catch (error) {
    if (!(error instanceof AIWikiNotInitializedError)) {
      throw error;
    }

    initialized = false;
    config = createDefaultConfig(defaultProjectName(rootDir));
  }

  const indexSummary = await readIndexSummary(rootDir);
  const ignoreRules = await collectProjectIgnoreRules(
    rootDir,
    PROJECT_SCAN_EXCLUDED_PATHS,
    config.ignore
  );
  const search = await searchWikiMemory(rootDir, task, {
    limit: options.limit ?? DEFAULT_BRIEF_LIMIT
  });
  const results = search.results;
  const strongResults = highConfidenceResults(results);
  const hintResults = memoryHintResults(results);
  const stalenessWarnings = await collectWikiStalenessWarnings(
    rootDir,
    strongResults.map((result) => result.page)
  );
  const selectedDocs = strongResults.map(pageDocPath);
  const modules = relatedModules(strongResults);
  const riskFiles = highRiskFiles(strongResults, config.riskFiles);
  const readFiles = mustReadFiles(strongResults, riskFiles);
  const documentFocused = taskLooksDocumentFocused(task);
  const identityTokens = await projectIdentityTokens(rootDir);
  const discoveredDocs = await discoverMarkdownDocs(
    rootDir,
    task,
    ignoreRules,
    identityTokens
  );
  const discoveredEntryFiles = documentFocused
    ? []
    : await discoverEntryFiles(rootDir, task, ignoreRules, identityTokens);
  const architecture = await generateArchitectureBriefContext(rootDir, task, {
    modules,
    highRiskFiles: riskFiles,
    ignorePatterns: config.ignore,
    focusFiles: [
      ...readFiles.filter((file) => !file.startsWith("wiki/")),
      ...discoveredEntryFiles.slice(0, ARCHITECTURE_FOCUS_FILE_LIMIT).map(discoveredPath),
      ...discoveredDocs.slice(0, ARCHITECTURE_FOCUS_FILE_LIMIT).map(discoveredPath)
    ]
  });
  const graphify = options.withGraphify
    ? await loadGraphifyContext(rootDir)
    : undefined;

  const brief: DevelopmentBrief = {
    task,
    projectName: config.projectName,
    tokenBudget: config.tokenBudget.brief,
    indexSummary,
    selectedDocs,
    stalenessWarnings,
    sections: [
      {
        title: "Task",
        items: [task]
      },
      {
        title: "Goal",
        items: [
          !initialized
            ? `Prepare for ${config.projectName} with a read-only cold scan because AIWiki memory is not initialized yet.`
            : results.length > 0
              ? `Complete the requested task for ${config.projectName} while treating high-confidence memory as constraints and low-confidence hints as advisory.`
              : `Complete the requested task for ${config.projectName}; no task-specific AIWiki memory matched, so treat generic guardrails as advisory.`
        ]
      },
      ...(!initialized
        ? [
            {
              title: "AIWiki Setup",
              items: [
                "Cold-start mode: no .aiwiki memory was loaded and no AIWiki files were written.",
                "Run aiwiki init --project-name <name> when you are ready to keep project memory.",
                "Then run aiwiki map --write so future briefs can use durable local context."
              ]
            }
          ]
        : []),
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
        items: recommendedDirectionItems(strongResults.length > 0)
      },
      {
        title: "Memory Coverage",
        items: memoryCoverageItems(
          initialized,
          selectedDocs,
          discoveredDocs,
          discoveredEntryFiles
        )
      },
      {
        title: "Architecture Boundaries",
        items: architecture.architectureBoundaries
      },
      {
        title: "Hardcoding and Configuration Risks",
        items: architecture.hardcodingRisks
      },
      {
        title: "Portability Checklist",
        items: architecture.portabilityChecklist
      },
      {
        title: "Module Memory to Maintain",
        items: architecture.moduleMemoryToMaintain
      },
      ...(options.architectureGuard
        ? [
            {
              title: "Architecture Guard",
              items: architectureGuardBullets(task, modules, riskFiles)
            }
          ]
        : []),
      ...(options.withGraphify
        ? [
            {
              title: "Graphify Structural Context",
              items: graphifyBullets(graphify)
            }
          ]
        : []),
      {
        title: "Relevant Modules",
        items: bulletOrFallback(modules, "No matching module pages found.")
      },
      {
        title: "Relevant Project Memory",
        items: bulletOrFallback(memoryBullets(strongResults), "No high-confidence wiki pages matched.")
      },
      {
        title: "Memory Hints",
        items: bulletOrFallback(
          memoryHintBullets(hintResults),
          "No low-confidence memory hints found."
        )
      },
      {
        title: "Known Pitfalls",
        items: bulletOrFallback(pitfallBullets(strongResults), "No high-confidence pitfall pages matched.")
      },
      {
        title: "Project Rules and Constraints",
        items: bulletOrFallback(ruleBullets(strongResults), "No high-confidence rule pages matched.")
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
        title: "Discovered Markdown Docs",
        items: bulletOrFallback(
          discoveredDocs,
          "No task-matching Markdown docs discovered."
        )
      },
      {
        title: "Discovered Entry Files",
        items: bulletOrFallback(
          discoveredEntryFiles,
          "No task-matching source entry files discovered."
        )
      },
      {
        title: "Acceptance Criteria",
        items: acceptanceCriteriaItems(strongResults.length > 0)
      },
      {
        title: "Notes for Codex",
        items: notesForCodexItems(strongResults.length > 0)
      }
    ]
  };

  const markdown = formatDevelopmentBriefMarkdown(brief);
  const json = briefToJson(brief);
  const content = options.format === "json" ? json : markdown;
  const outputPath = options.output
    ? await writeOutputFile(rootDir, options.output, content, options.force ?? false)
    : undefined;

  if (initialized && !options.readOnly) {
    await appendLogEntry(rootDir, {
      action: "brief",
      title: task,
      bullets: selectedDocs.map((doc) => `Selected: [[${doc}]]`)
    });
    await appendBriefEvalCase(rootDir, task, outputPath, selectedDocs);
  }

  return { brief, markdown, json, outputPath };
}
