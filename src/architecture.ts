import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  ARCHITECTURE_HARDCODING_TOPICS,
  ARCHITECTURE_LARGE_FILE_LINE_THRESHOLD,
  ARCHITECTURE_PORTABILITY_CHECKS,
  ARCHITECTURE_SCAN_EXCLUDED_PATHS,
  ARCHITECTURE_SOURCE_FILE_EXTENSIONS,
  RISK_FILE_KEYWORDS
} from "./constants.js";
import { loadAIWikiConfig } from "./config.js";
import { resolveProjectPath, toPosixPath } from "./paths.js";
import { scanWikiPages } from "./wiki-store.js";

export interface ArchitectureBriefOptions {
  modules?: string[];
  highRiskFiles?: string[];
  ignorePatterns?: string[];
}

export interface ArchitectureBriefContext {
  architectureBoundaries: string[];
  hardcodingRisks: string[];
  portabilityChecklist: string[];
  moduleMemoryToMaintain: string[];
}

interface SourceFileSummary {
  path: string;
  lines: number;
  content: string;
}

export type ArchitectureAuditSeverity = "low" | "medium" | "high";

export type ArchitectureAuditIssueCode =
  | "large_file"
  | "hardcoded_literal"
  | "high_risk_file"
  | "missing_module_memory";

export interface ArchitectureAuditIssue {
  severity: ArchitectureAuditSeverity;
  code: ArchitectureAuditIssueCode;
  title: string;
  message: string;
  path?: string;
}

export interface ArchitectureAudit {
  projectName: string;
  summary: {
    totalIssues: number;
    high: number;
    medium: number;
    low: number;
    scannedFiles: number;
  };
  issues: ArchitectureAuditIssue[];
}

export interface ArchitectureAuditResult {
  audit: ArchitectureAudit;
  markdown: string;
  json: string;
}

function normalizePath(filePath: string): string {
  return toPosixPath(filePath).replace(/^\.\//u, "");
}

function pathSegments(filePath: string): string[] {
  return normalizePath(filePath).split("/");
}

function matchesPattern(relativePath: string, pattern: string): boolean {
  const normalizedPattern = normalizePath(pattern).replace(/\/$/u, "");
  const normalizedPath = normalizePath(relativePath);
  const basename = path.posix.basename(normalizedPath);

  if (normalizedPattern.endsWith("*")) {
    const prefix = normalizedPattern.slice(0, -1);
    return normalizedPath.startsWith(prefix) || basename.startsWith(prefix);
  }

  return (
    normalizedPath === normalizedPattern ||
    normalizedPath.startsWith(`${normalizedPattern}/`) ||
    pathSegments(normalizedPath).includes(normalizedPattern)
  );
}

function shouldIgnore(relativePath: string, ignorePatterns: readonly string[]): boolean {
  return ignorePatterns.some((pattern) =>
    matchesPattern(relativePath, pattern)
  );
}

function isSourceFile(relativePath: string): boolean {
  const extension = path.posix.extname(normalizePath(relativePath));
  return ARCHITECTURE_SOURCE_FILE_EXTENSIONS.includes(
    extension as (typeof ARCHITECTURE_SOURCE_FILE_EXTENSIONS)[number]
  );
}

async function walkSourceFiles(
  rootDir: string,
  ignorePatterns: readonly string[],
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

    if (shouldIgnore(relativePath, ignorePatterns)) {
      continue;
    }

    if (entry.isDirectory()) {
      files.push(...(await walkSourceFiles(rootDir, ignorePatterns, fullPath)));
    } else if (entry.isFile() && isSourceFile(relativePath)) {
      files.push(relativePath);
    }
  }

  return files.sort();
}

function lineCount(content: string): number {
  if (content.length === 0) {
    return 0;
  }

  return content.split("\n").length;
}

async function summarizeSourceFiles(
  rootDir: string,
  ignorePatterns: readonly string[]
): Promise<SourceFileSummary[]> {
  const files = await walkSourceFiles(rootDir, ignorePatterns);
  const summaries: SourceFileSummary[] = [];

  for (const file of files) {
    const content = await readFile(resolveProjectPath(rootDir, file), "utf8");
    summaries.push({ path: file, lines: lineCount(content), content });
  }

  return summaries;
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function taskMentionsAny(task: string, values: readonly string[]): boolean {
  const normalized = task.toLowerCase();
  return values.some((value) => normalized.includes(value.toLowerCase()));
}

function moduleLabel(modules: string[]): string {
  return modules.length > 0 ? modules.join(", ") : "the affected feature";
}

function largeFileWarnings(files: SourceFileSummary[]): string[] {
  return files
    .filter((file) => file.lines >= ARCHITECTURE_LARGE_FILE_LINE_THRESHOLD)
    .sort((left, right) => right.lines - left.lines || left.path.localeCompare(right.path))
    .slice(0, 5)
    .map(
      (file) =>
        `Large file warning: ${file.path} has ${file.lines} lines; keep new responsibilities split into focused module, service, adapter, and test files.`
    );
}

function riskKeywordFiles(files: SourceFileSummary[], configuredRiskFiles: string[]): string[] {
  return unique([
    ...configuredRiskFiles,
    ...files
      .map((file) => file.path)
      .filter((filePath) => {
        const value = filePath.toLowerCase();
        return RISK_FILE_KEYWORDS.some((keyword) => value.includes(keyword));
      })
  ]).sort();
}

function issue(
  severity: ArchitectureAuditSeverity,
  code: ArchitectureAuditIssueCode,
  title: string,
  message: string,
  filePath?: string
): ArchitectureAuditIssue {
  return { severity, code, title, message, path: filePath };
}

function largeFileIssues(files: SourceFileSummary[]): ArchitectureAuditIssue[] {
  return files
    .filter((file) => file.lines >= ARCHITECTURE_LARGE_FILE_LINE_THRESHOLD)
    .sort((left, right) => right.lines - left.lines || left.path.localeCompare(right.path))
    .map((file) =>
      issue(
        file.lines >= ARCHITECTURE_LARGE_FILE_LINE_THRESHOLD * 2 ? "high" : "medium",
        "large_file",
        "Large file",
        `${file.path} has ${file.lines} lines. Split new responsibilities into focused module, service, adapter, and test files before the file becomes harder to migrate.`,
        file.path
      )
    );
}

function hardcodedLiteralIssues(files: SourceFileSummary[]): ArchitectureAuditIssue[] {
  const issues: ArchitectureAuditIssue[] = [];
  const secretPattern = /['"`](?:sk_(?:test|live)_[^'"`]+|pk_(?:test|live)_[^'"`]+|[^'"`]*(?:secret|api[_-]?key|token)[^'"`]*)['"`]/giu;
  const urlPattern = /['"`]https?:\/\/[^'"`]+['"`]/giu;

  for (const file of files) {
    if (secretPattern.test(file.content)) {
      issues.push(
        issue(
          "high",
          "hardcoded_literal",
          "Potential secret-like literal",
          `${file.path} contains a secret-like literal. Move secrets, tokens, and provider keys behind environment/config boundaries.`,
          file.path
        )
      );
    }
    secretPattern.lastIndex = 0;

    if (urlPattern.test(file.content)) {
      issues.push(
        issue(
          "medium",
          "hardcoded_literal",
          "Potential hardcoded URL",
          `${file.path} contains a URL literal. Confirm whether URLs, webhook endpoints, and provider hosts should be configurable for reuse in another project.`,
          file.path
        )
      );
    }
    urlPattern.lastIndex = 0;
  }

  return issues;
}

function highRiskFileIssues(
  files: SourceFileSummary[],
  configuredRiskFiles: string[]
): ArchitectureAuditIssue[] {
  return riskKeywordFiles(files, configuredRiskFiles).map((filePath) =>
    issue(
      "medium",
      "high_risk_file",
      "High-risk file",
      `${filePath} matches configured or keyword-based high-risk paths. Review module boundaries, tests, and configuration before editing.`,
      filePath
    )
  );
}

async function missingModuleMemoryIssues(rootDir: string): Promise<ArchitectureAuditIssue[]> {
  const config = await loadAIWikiConfig(rootDir);
  const pages = await scanWikiPages(rootDir);
  const knownModules = new Set(
    pages
      .filter((page) => page.frontmatter.type === "module")
      .flatMap((page) => [
        ...(page.frontmatter.modules ?? []),
        page.frontmatter.title
      ])
      .filter((value): value is string => Boolean(value))
      .map((value) => value.toLowerCase())
  );

  return config.highRiskModules
    .filter((moduleName) => !knownModules.has(moduleName.toLowerCase()))
    .map((moduleName) =>
      issue(
        "medium",
        "missing_module_memory",
        "Missing module memory",
        `${moduleName} is configured as high-risk but has no module page. Add module memory so future brief, guard, reflect, and migration workflows have a stable boundary to reuse.`
      )
    );
}

function summarizeIssues(issues: ArchitectureAuditIssue[], scannedFiles: number): ArchitectureAudit["summary"] {
  return {
    totalIssues: issues.length,
    high: issues.filter((item) => item.severity === "high").length,
    medium: issues.filter((item) => item.severity === "medium").length,
    low: issues.filter((item) => item.severity === "low").length,
    scannedFiles
  };
}

function formatIssueList(
  issues: ArchitectureAuditIssue[],
  fallback: string
): string {
  if (issues.length === 0) {
    return `- ${fallback}`;
  }

  return issues
    .map((item) => {
      const target = item.path ? `${item.path}: ` : "";
      return `- [${item.severity}] ${target}${item.message}`;
    })
    .join("\n");
}

export function formatArchitectureAuditMarkdown(audit: ArchitectureAudit): string {
  const byCode = (code: ArchitectureAuditIssueCode): ArchitectureAuditIssue[] =>
    audit.issues.filter((item) => item.code === code);

  return `# Architecture Audit: ${audit.projectName}

## Summary
- Files scanned: ${audit.summary.scannedFiles}
- Total issues: ${audit.summary.totalIssues}
- High: ${audit.summary.high}
- Medium: ${audit.summary.medium}
- Low: ${audit.summary.low}

## Large Files
${formatIssueList(byCode("large_file"), "No large files detected.")}

## Hardcoding Risks
${formatIssueList(byCode("hardcoded_literal"), "No hardcoding risks detected.")}

## High-Risk Files
${formatIssueList(byCode("high_risk_file"), "No high-risk files detected.")}

## Missing Module Memory
${formatIssueList(byCode("missing_module_memory"), "No missing module memory detected.")}
`;
}

function architectureAuditToJson(audit: ArchitectureAudit): string {
  return `${JSON.stringify(audit, null, 2)}\n`;
}

export async function generateArchitectureAudit(
  rootDir: string
): Promise<ArchitectureAuditResult> {
  const config = await loadAIWikiConfig(rootDir);
  const ignorePatterns = unique([
    ...ARCHITECTURE_SCAN_EXCLUDED_PATHS,
    ...config.ignore
  ]);
  const sourceFiles = await summarizeSourceFiles(rootDir, ignorePatterns);
  const issues = [
    ...largeFileIssues(sourceFiles),
    ...hardcodedLiteralIssues(sourceFiles),
    ...highRiskFileIssues(sourceFiles, config.riskFiles),
    ...(await missingModuleMemoryIssues(rootDir))
  ];
  const audit: ArchitectureAudit = {
    projectName: config.projectName,
    summary: summarizeIssues(issues, sourceFiles.length),
    issues
  };
  const markdown = formatArchitectureAuditMarkdown(audit);
  const json = architectureAuditToJson(audit);

  return { audit, markdown, json };
}

export async function generateArchitectureBriefContext(
  rootDir: string,
  task: string,
  options: ArchitectureBriefOptions = {}
): Promise<ArchitectureBriefContext> {
  const modules = unique(options.modules ?? []);
  const ignorePatterns = unique([
    ...ARCHITECTURE_SCAN_EXCLUDED_PATHS,
    ...(options.ignorePatterns ?? [])
  ]);
  const sourceFiles = await summarizeSourceFiles(rootDir, ignorePatterns);
  const largeFiles = largeFileWarnings(sourceFiles);
  const riskFiles = riskKeywordFiles(sourceFiles, options.highRiskFiles ?? []);
  const relevantRiskFiles = riskFiles.slice(0, 6);
  const moduleName = moduleLabel(modules);
  const taskLooksProviderBacked = taskMentionsAny(task, [
    "payment",
    "stripe",
    "provider",
    "webhook",
    "auth",
    "billing",
    "email",
    "storage",
    "subscription"
  ]);

  return {
    architectureBoundaries: [
      `Keep ${moduleName} behind explicit module boundaries; do not mix provider SDK calls, API/webhook handling, persistence, UI, and configuration in one file.`,
      taskLooksProviderBacked
        ? "Route provider-specific code through a small adapter or service boundary so another provider or project can replace it later."
        : "Prefer small module, service, adapter, and UI boundaries over adding unrelated responsibilities to an existing file.",
      ...(
        largeFiles.length > 0
          ? largeFiles
          : ["No large-file structure warnings detected."]
      )
    ],
    hardcodingRisks: [
      `Do not hardcode ${ARCHITECTURE_HARDCODING_TOPICS.join(", ")} in business logic; put them behind configuration, constants, or module-owned adapters.`,
      "For payment or provider work, keep secrets server-side and keep pricing, webhook endpoints, and provider names configurable.",
      ...(
        relevantRiskFiles.length > 0
          ? relevantRiskFiles.map((file) => `Review hardcoding and boundary risk in ${file}.`)
          : ["No high-risk files matched hardcoding checks."]
      )
    ],
    portabilityChecklist: [
      `Before implementation, identify ${ARCHITECTURE_PORTABILITY_CHECKS.join(", ")} for ${moduleName}.`,
      "Keep the module usable from a future project by documenting its public entry points, required environment, external services, and tests.",
      "Avoid coupling reusable module behavior directly to one route, page, CLI command, or framework-specific global."
    ],
    moduleMemoryToMaintain: [
      "Record reusable module decisions after implementation.",
      "After the task, run reflect and preserve module boundaries, patterns, pitfalls, decisions, and rules that would help future migrations.",
      modules.length > 0
        ? `Update or create module memory for: ${modules.join(", ")}.`
        : "If this creates a reusable feature area, add or update a module page instead of leaving the knowledge only in chat history."
    ]
  };
}
