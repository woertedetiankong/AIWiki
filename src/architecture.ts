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
import { resolveProjectPath, toPosixPath } from "./paths.js";

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
    summaries.push({ path: file, lines: lineCount(content) });
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
