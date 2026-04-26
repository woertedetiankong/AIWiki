import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { INDEX_PATH, WIKI_DIR } from "./constants.js";
import { loadAIWikiConfig } from "./config.js";
import { parseMarkdown } from "./markdown.js";
import { resolveProjectPath, toPosixPath } from "./paths.js";
import type { WikiPage, WikiPageFrontmatter } from "./types.js";
import { wikiPageFrontmatterSchema } from "./wiki-frontmatter.js";

export type LintSeverity = "error" | "warning";

export interface LintIssue {
  severity: LintSeverity;
  code: string;
  message: string;
  path?: string;
}

export interface LintReport {
  issues: LintIssue[];
  summary: {
    errors: number;
    warnings: number;
    pagesChecked: number;
  };
}

export interface LintResult {
  report: LintReport;
  markdown: string;
  json: string;
}

interface PageReadResult {
  page?: WikiPage;
  issue?: LintIssue;
}

async function walkMarkdownFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }

  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkMarkdownFiles(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }

  return files.sort();
}

function docPath(page: WikiPage): string {
  return `wiki/${page.relativePath}`;
}

function normalizeDocRef(fromPage: WikiPage, value: string): string {
  const withoutHash = value.split("#")[0] ?? value;
  const normalized = toPosixPath(withoutHash.trim());

  if (normalized.startsWith("wiki/")) {
    return normalized;
  }

  if (normalized.startsWith(".") || normalized.includes("/")) {
    const base = path.posix.dirname(fromPage.relativePath);
    return `wiki/${path.posix.normalize(path.posix.join(base, normalized))}`;
  }

  if (normalized.endsWith(".md")) {
    return `wiki/${normalized}`;
  }

  return `wiki/${normalized}`;
}

function extractMarkdownDocRefs(page: WikiPage): string[] {
  const refs = new Set<string>();
  const wikiLinkPattern = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/gu;
  const markdownLinkPattern = /\[[^\]]+\]\(([^)]+\.md(?:#[^)]+)?)\)/gu;

  for (const match of page.body.matchAll(wikiLinkPattern)) {
    if (match[1]) {
      refs.add(normalizeDocRef(page, match[1]));
    }
  }

  for (const match of page.body.matchAll(markdownLinkPattern)) {
    if (match[1]) {
      refs.add(normalizeDocRef(page, match[1]));
    }
  }

  return [...refs].sort();
}

function frontmatterRefs(page: WikiPage): string[] {
  const refs = [
    ...(page.frontmatter.related_pitfalls ?? []),
    ...(page.frontmatter.related_decisions ?? []),
    ...(page.frontmatter.related_patterns ?? []),
    ...(page.frontmatter.supersedes ?? []),
    ...(page.frontmatter.conflicts_with ?? [])
  ];
  const sourcePitfalls = page.frontmatter.source_pitfalls;
  if (Array.isArray(sourcePitfalls)) {
    refs.push(
      ...sourcePitfalls.filter((item): item is string => typeof item === "string")
    );
  }

  return refs.map((ref) => normalizeDocRef(page, ref));
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

function pitfallFingerprint(page: WikiPage): string {
  return titleForPage(page)
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}

async function readPage(filePath: string, wikiRoot: string): Promise<PageReadResult> {
  const relativePath = toPosixPath(path.relative(wikiRoot, filePath));
  try {
    const parsed = parseMarkdown<WikiPageFrontmatter>(
      await readFile(filePath, "utf8")
    );
    const frontmatter = wikiPageFrontmatterSchema.safeParse(parsed.frontmatter);
    if (!frontmatter.success) {
      return {
        issue: {
          severity: "error",
          code: "invalid_frontmatter",
          message: frontmatter.error.issues
            .map((issue) => `${issue.path.join(".") || "frontmatter"}: ${issue.message}`)
            .join("; "),
          path: `wiki/${relativePath}`
        }
      };
    }

    return {
      page: {
        path: filePath,
        relativePath,
        frontmatter: frontmatter.data,
        body: parsed.body
      }
    };
  } catch (error) {
    return {
      issue: {
        severity: "error",
        code: "markdown_parse_error",
        message: error instanceof Error ? error.message : String(error),
        path: `wiki/${relativePath}`
      }
    };
  }
}

function issue(severity: LintSeverity, code: string, message: string, path?: string): LintIssue {
  return { severity, code, message, path };
}

function indexIssues(indexContent: string, pages: WikiPage[]): LintIssue[] {
  return pages
    .filter((page) => !indexContent.includes(docPath(page)))
    .map((page) =>
      issue(
        "warning",
        "index_missing_page",
        `Index does not mention ${docPath(page)}.`,
        docPath(page)
      )
    );
}

function brokenLinkIssues(pages: WikiPage[], pageIds: Set<string>): LintIssue[] {
  const issues: LintIssue[] = [];
  for (const page of pages) {
    const refs = [...frontmatterRefs(page), ...extractMarkdownDocRefs(page)];
    for (const ref of refs) {
      if (ref.endsWith(".md") && !pageIds.has(ref)) {
        issues.push(
          issue("error", "broken_link", `Reference target does not exist: ${ref}.`, docPath(page))
        );
      }
    }
  }

  return issues;
}

function orphanIssues(pages: WikiPage[]): LintIssue[] {
  const incoming = new Set<string>();
  const outgoing = new Map<string, string[]>();
  for (const page of pages) {
    const id = docPath(page);
    const refs = [...frontmatterRefs(page), ...extractMarkdownDocRefs(page)];
    outgoing.set(id, refs);
    for (const ref of refs) {
      incoming.add(ref);
    }
  }

  return pages
    .filter((page) => page.frontmatter.type !== "project_map")
    .filter((page) => {
      const id = docPath(page);
      return !incoming.has(id) && (outgoing.get(id)?.length ?? 0) === 0;
    })
    .map((page) =>
      issue("warning", "orphan_page", "Page has no incoming or outgoing wiki links.", docPath(page))
    );
}

function duplicatePitfallIssues(pages: WikiPage[]): LintIssue[] {
  const byFingerprint = new Map<string, WikiPage[]>();
  for (const page of pages.filter((candidate) => candidate.frontmatter.type === "pitfall")) {
    const fingerprint = pitfallFingerprint(page);
    byFingerprint.set(fingerprint, [...(byFingerprint.get(fingerprint) ?? []), page]);
  }

  return [...byFingerprint.values()]
    .filter((group) => group.length > 1)
    .flatMap((group) =>
      group.map((page) =>
        issue(
          "warning",
          "duplicate_pitfall",
          `Pitfall title appears duplicated across ${group.length} pages.`,
          docPath(page)
        )
      )
    );
}

function missingHighRiskModuleIssues(
  highRiskModules: string[],
  pages: WikiPage[]
): LintIssue[] {
  const modulePages = new Set(
    pages
      .filter((page) => page.frontmatter.type === "module")
      .flatMap((page) => page.frontmatter.modules ?? [])
  );

  return highRiskModules
    .filter((moduleName) => !modulePages.has(moduleName))
    .map((moduleName) =>
      issue(
        "warning",
        "missing_high_risk_module_page",
        `High-risk module has no module page: ${moduleName}.`
      )
    );
}

function formatIssue(value: LintIssue): string {
  const location = value.path ? ` (${value.path})` : "";
  return `- [${value.severity}] ${value.code}${location}: ${value.message}`;
}

export function formatLintReportMarkdown(report: LintReport): string {
  const lines = [
    "# AIWiki Lint Report",
    "",
    `- Pages checked: ${report.summary.pagesChecked}`,
    `- Errors: ${report.summary.errors}`,
    `- Warnings: ${report.summary.warnings}`,
    "",
    "## Issues"
  ];

  if (report.issues.length === 0) {
    lines.push("- No issues found.");
  } else {
    lines.push(...report.issues.map(formatIssue));
  }

  return `${lines.join("\n")}\n`;
}

function lintToJson(report: LintReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export async function lintWiki(rootDir: string): Promise<LintResult> {
  const config = await loadAIWikiConfig(rootDir);
  const wikiRoot = resolveProjectPath(rootDir, WIKI_DIR);
  const files = await walkMarkdownFiles(wikiRoot);
  const readResults = await Promise.all(
    files.map((filePath) => readPage(filePath, wikiRoot))
  );
  const pages = readResults
    .map((result) => result.page)
    .filter((page): page is WikiPage => Boolean(page));
  const issues = readResults
    .map((result) => result.issue)
    .filter((value): value is LintIssue => Boolean(value));
  const pageIds = new Set(pages.map(docPath));

  let indexContent = "";
  try {
    indexContent = await readFile(resolveProjectPath(rootDir, INDEX_PATH), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      issues.push(
        issue("error", "missing_index", `Missing ${INDEX_PATH}.`, INDEX_PATH)
      );
    } else {
      throw error;
    }
  }

  issues.push(...indexIssues(indexContent, pages));
  issues.push(...brokenLinkIssues(pages, pageIds));
  issues.push(...orphanIssues(pages));
  issues.push(...duplicatePitfallIssues(pages));
  issues.push(...missingHighRiskModuleIssues(config.highRiskModules, pages));

  const report: LintReport = {
    issues: issues.sort((a, b) => {
      if (a.severity !== b.severity) {
        return a.severity === "error" ? -1 : 1;
      }

      return `${a.code}:${a.path ?? ""}`.localeCompare(`${b.code}:${b.path ?? ""}`);
    }),
    summary: {
      errors: issues.filter((value) => value.severity === "error").length,
      warnings: issues.filter((value) => value.severity === "warning").length,
      pagesChecked: pages.length
    }
  };

  return {
    report,
    markdown: formatLintReportMarkdown(report),
    json: lintToJson(report)
  };
}
