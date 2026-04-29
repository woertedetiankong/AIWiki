import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveProjectPath, toPosixPath } from "./paths.js";

export interface IgnoreRule {
  pattern: string;
  negate: boolean;
}

function normalizePath(filePath: string): string {
  return toPosixPath(filePath).replace(/^\.\//u, "");
}

function escapeRegex(value: string): string {
  return value.replace(/[.+^${}()|[\]\\]/gu, "\\$&");
}

function patternSegmentToRegex(segment: string): string {
  return escapeRegex(segment).replace(/\*/gu, "[^/]*");
}

function globToRegex(pattern: string, anchored: boolean): RegExp {
  const segments = pattern.split("/").filter((segment) => segment.length > 0);
  const body = segments
    .map((segment) => (segment === "**" ? ".*" : patternSegmentToRegex(segment)))
    .join("/");
  const prefix = anchored ? "^" : "(?:^|.*/)";
  return new RegExp(`${prefix}${body}(?:/.*)?$`, "u");
}

function parseIgnoreLine(line: string): IgnoreRule | undefined {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return undefined;
  }

  const negate = trimmed.startsWith("!");
  const pattern = normalizePath(negate ? trimmed.slice(1) : trimmed);
  if (!pattern) {
    return undefined;
  }

  return { pattern, negate };
}

export function parseIgnoreRules(content: string): IgnoreRule[] {
  return content
    .split(/\r?\n/u)
    .map(parseIgnoreLine)
    .filter((rule): rule is IgnoreRule => Boolean(rule));
}

export function createIgnoreRules(patterns: readonly string[]): IgnoreRule[] {
  return patterns
    .map(parseIgnoreLine)
    .filter((rule): rule is IgnoreRule => Boolean(rule));
}

export async function readGitignoreRules(rootDir: string): Promise<IgnoreRule[]> {
  try {
    return parseIgnoreRules(await readFile(resolveProjectPath(rootDir, ".gitignore"), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

function ruleMatches(relativePath: string, rule: IgnoreRule): boolean {
  const normalizedPath = normalizePath(relativePath);
  const rawPattern = normalizePath(rule.pattern);
  const directoryPattern = rawPattern.endsWith("/");
  const pattern = rawPattern.replace(/^\/+/u, "").replace(/\/+$/u, "");
  const anchored = rawPattern.startsWith("/") || pattern.includes("/");
  const basename = path.posix.basename(normalizedPath);

  if (!pattern) {
    return false;
  }

  if (!pattern.includes("*")) {
    if (!anchored) {
      return (
        basename === pattern ||
        normalizedPath === pattern ||
        normalizedPath.startsWith(`${pattern}/`) ||
        normalizedPath.includes(`/${pattern}/`)
      );
    }

    return normalizedPath === pattern || normalizedPath.startsWith(`${pattern}/`);
  }

  if (!anchored && !directoryPattern && !pattern.includes("/")) {
    return new RegExp(`^${patternSegmentToRegex(pattern)}$`, "u").test(basename);
  }

  return globToRegex(pattern, anchored).test(normalizedPath);
}

export function shouldIgnorePath(
  relativePath: string,
  rules: readonly IgnoreRule[]
): boolean {
  let ignored = false;
  for (const rule of rules) {
    if (ruleMatches(relativePath, rule)) {
      ignored = !rule.negate;
    }
  }

  return ignored;
}

export async function collectProjectIgnoreRules(
  rootDir: string,
  defaultPatterns: readonly string[],
  configPatterns: readonly string[] = []
): Promise<IgnoreRule[]> {
  return [
    ...createIgnoreRules(defaultPatterns),
    ...(await readGitignoreRules(rootDir)),
    ...createIgnoreRules(configPatterns)
  ];
}
