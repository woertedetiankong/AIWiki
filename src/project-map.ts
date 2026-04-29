import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  GENERATED_FILE_CANDIDATES,
  IMPORTANT_DIRECTORY_CANDIDATES,
  PROJECT_MAP_PATH,
  PROJECT_SCAN_EXCLUDED_PATHS,
  RISK_FILE_KEYWORDS
} from "./constants.js";
import { loadAIWikiConfig } from "./config.js";
import { appendLogEntry } from "./log.js";
import { formatMarkdown } from "./markdown.js";
import { resolveProjectPath, toPosixPath } from "./paths.js";
import type { AIWikiConfig, WikiPage } from "./types.js";
import { regenerateIndex } from "./wiki-index.js";
import { scanWikiPages } from "./wiki-store.js";

export interface ProjectMapOptions {
  write?: boolean;
  force?: boolean;
}

export interface ProjectMap {
  projectName: string;
  stack: string[];
  modules: string[];
  importantDirectories: string[];
  highRiskFiles: string[];
  generatedFiles: string[];
  existingRules: string[];
  missingModulePages: string[];
  scannedFiles: number;
}

export interface ProjectMapResult {
  projectMap: ProjectMap;
  markdown: string;
  json: string;
  outputPath?: string;
}

interface PackageJson {
  scripts?: Record<string, unknown>;
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
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

  if (normalizedPattern.startsWith("*")) {
    const suffix = normalizedPattern.slice(1);
    return normalizedPath.endsWith(suffix) || basename.endsWith(suffix);
  }

  return (
    normalizedPath === normalizedPattern ||
    normalizedPath.startsWith(`${normalizedPattern}/`) ||
    normalizedPath.includes(`/${normalizedPattern}/`) ||
    pathSegments(normalizedPath).includes(normalizedPattern)
  );
}

function shouldIgnore(relativePath: string, ignorePatterns: readonly string[]): boolean {
  return ignorePatterns.some((pattern) => matchesPattern(relativePath, pattern));
}

async function walkProjectFiles(
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
      files.push(...(await walkProjectFiles(rootDir, ignorePatterns, fullPath)));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }

  return files.sort();
}

async function readJsonFile<T>(rootDir: string, relativePath: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(resolveProjectPath(rootDir, relativePath), "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}

function hasDependency(packageJson: PackageJson | undefined, name: string): boolean {
  return Boolean(
    packageJson?.dependencies?.[name] ?? packageJson?.devDependencies?.[name]
  );
}

function detectStack(files: string[], packageJson: PackageJson | undefined): string[] {
  const stack: string[] = [];
  if (packageJson) {
    stack.push("Node.js");
  }
  if (files.some((file) => path.posix.basename(file) === "pom.xml")) {
    stack.push("Java", "Maven");
  }
  if (files.includes("tsconfig.json") || hasDependency(packageJson, "typescript")) {
    stack.push("TypeScript");
  }
  if (hasDependency(packageJson, "commander")) {
    stack.push("Commander CLI");
  }
  if (hasDependency(packageJson, "vitest")) {
    stack.push("Vitest");
  }
  if (hasDependency(packageJson, "zod")) {
    stack.push("Zod");
  }
  if (hasDependency(packageJson, "gray-matter")) {
    stack.push("Markdown frontmatter");
  }
  if (hasDependency(packageJson, "next")) {
    stack.push("Next.js");
  }
  if (hasDependency(packageJson, "react")) {
    stack.push("React");
  }
  if (
    files.some((file) => file.endsWith(".vue")) ||
    hasDependency(packageJson, "vue")
  ) {
    stack.push("Vue");
  }
  if (files.some((file) => file.includes("uni_modules/") || file.endsWith("manifest.json"))) {
    stack.push("uni-app");
  }

  return unique(stack);
}

function detectImportantDirectories(files: string[]): string[] {
  const directories = new Set<string>();
  for (const file of files) {
    const segments = pathSegments(file);
    for (const candidate of IMPORTANT_DIRECTORY_CANDIDATES) {
      if (segments.includes(candidate)) {
        directories.add(candidate);
      }
    }
  }

  return [...directories].sort();
}

function detectGeneratedFiles(files: string[]): string[] {
  return files
    .filter((file) => {
      return GENERATED_FILE_CANDIDATES.some((candidate) => matchesPattern(file, candidate));
    })
    .sort();
}

function isHighRiskWikiPage(page: WikiPage): boolean {
  return (
    page.frontmatter.severity === "high" ||
    page.frontmatter.severity === "critical" ||
    page.frontmatter.risk === "high" ||
    page.frontmatter.risk === "critical"
  );
}

function detectKeywordRiskFiles(files: string[]): string[] {
  return files.filter((file) => {
    const value = file.toLowerCase();
    return RISK_FILE_KEYWORDS.some((keyword) => value.includes(keyword));
  });
}

function titleForPage(page: WikiPage): string {
  if (page.frontmatter.title && page.frontmatter.title.trim().length > 0) {
    return page.frontmatter.title;
  }

  const heading = page.body
    .split("\n")
    .find((line) => line.trim().startsWith("#"));

  if (heading) {
    return heading.replace(/^#+\s*/u, "").trim();
  }

  return page.relativePath;
}

function moduleNames(pages: WikiPage[]): string[] {
  return unique(
    pages
      .filter((page) => page.frontmatter.type === "module")
      .map((page) => {
        return page.frontmatter.title ?? page.frontmatter.modules?.[0] ?? titleForPage(page);
      })
  ).sort();
}

function existingRules(pages: WikiPage[]): string[] {
  return pages
    .filter((page) => page.frontmatter.type === "rule")
    .map(titleForPage)
    .sort();
}

function detectMissingModulePages(
  config: AIWikiConfig,
  importantDirectories: string[],
  existingModules: string[]
): string[] {
  const known = new Set(existingModules.map((moduleName) => moduleName.toLowerCase()));
  return unique([...config.highRiskModules, ...importantDirectories])
    .filter((moduleName) => !known.has(moduleName.toLowerCase()))
    .sort();
}

function detectHighRiskFiles(
  files: string[],
  pages: WikiPage[],
  config: AIWikiConfig
): string[] {
  const wikiRiskFiles = pages
    .filter(isHighRiskWikiPage)
    .flatMap((page) => page.frontmatter.files ?? []);

  return unique([
    ...config.riskFiles,
    ...wikiRiskFiles,
    ...detectKeywordRiskFiles(files)
  ]).sort();
}

function formatList(items: string[], fallback: string): string {
  if (items.length === 0) {
    return `- ${fallback}`;
  }

  return items.map((item) => `- ${item}`).join("\n");
}

export function formatProjectMapMarkdown(projectMap: ProjectMap): string {
  return `# Project Map: ${projectMap.projectName}

## Stack
${formatList(projectMap.stack, "No stack signals detected.")}

## Modules
${formatList(projectMap.modules, "No module pages found.")}

## Important Directories
${formatList(projectMap.importantDirectories, "No important directories detected.")}

## High-Risk Files
${formatList(projectMap.highRiskFiles, "No high-risk files detected.")}

## Generated Files / Do-Not-Edit Candidates
${formatList(projectMap.generatedFiles, "No generated file candidates detected.")}

## Existing Rules
${formatList(projectMap.existingRules, "No rule pages found.")}

## Missing Module Pages
${formatList(projectMap.missingModulePages, "No missing module page candidates detected.")}
`;
}

function projectMapToJson(projectMap: ProjectMap): string {
  return `${JSON.stringify(projectMap, null, 2)}\n`;
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

async function writeProjectMap(
  rootDir: string,
  projectMap: ProjectMap,
  markdown: string,
  force: boolean
): Promise<string> {
  const outputPath = resolveProjectPath(rootDir, PROJECT_MAP_PATH);
  if (!force && (await outputPathExists(outputPath))) {
    throw new Error(`Refusing to overwrite existing project map: ${PROJECT_MAP_PATH}`);
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    formatMarkdown(
      {
        type: "project_map",
        title: "Project Map",
        status: "active",
        last_updated: new Date().toISOString().slice(0, 10)
      },
      markdown
    ),
    "utf8"
  );
  return outputPath;
}

export async function generateProjectMap(
  rootDir: string,
  options: ProjectMapOptions = {}
): Promise<ProjectMapResult> {
  const config = await loadAIWikiConfig(rootDir);
  const ignorePatterns = unique([
    ...PROJECT_SCAN_EXCLUDED_PATHS,
    ...config.ignore
  ]);
  const files = await walkProjectFiles(rootDir, ignorePatterns);
  const packageJson = await readJsonFile<PackageJson>(rootDir, "package.json");
  const pages = await scanWikiPages(rootDir);
  const modules = moduleNames(pages);
  const importantDirectories = detectImportantDirectories(files);

  const projectMap: ProjectMap = {
    projectName: config.projectName,
    stack: detectStack(files, packageJson),
    modules,
    importantDirectories,
    highRiskFiles: detectHighRiskFiles(files, pages, config),
    generatedFiles: detectGeneratedFiles(files),
    existingRules: existingRules(pages),
    missingModulePages: detectMissingModulePages(
      config,
      importantDirectories,
      modules
    ),
    scannedFiles: files.length
  };

  const markdown = formatProjectMapMarkdown(projectMap);
  const json = projectMapToJson(projectMap);
  const outputPath = options.write
    ? await writeProjectMap(rootDir, projectMap, markdown, options.force ?? false)
    : undefined;

  if (outputPath) {
    await regenerateIndex(rootDir, config);
    await appendLogEntry(rootDir, {
      action: "map",
      title: "Project Map",
      bullets: [`Updated: [[${PROJECT_MAP_PATH.replace(/^\.aiwiki\//u, "")}]]`]
    });
  }

  return { projectMap, markdown, json, outputPath };
}
