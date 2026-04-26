import path from "node:path";
import { loadAIWikiConfig } from "./config.js";
import { resolveProjectPath, toPosixPath } from "./paths.js";
import { searchWikiMemory } from "./search.js";
import type { RiskLevel, WikiPage, WikiPageType } from "./types.js";
import { findWikiPages } from "./wiki-store.js";

export interface FileGuardrailsOptions {
  limit?: number;
}

export interface FileGuardrailSection {
  title: string;
  items: string[];
}

export interface FileGuardrails {
  filePath: string;
  matchedDocs: string[];
  suggestedFileNote: string;
  sections: FileGuardrailSection[];
}

export interface FileGuardrailsResult {
  guardrails: FileGuardrails;
  markdown: string;
  json: string;
}

const DEFAULT_GUARD_LIMIT = 10;

const SEVERITY_RANK: Record<RiskLevel, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4
};

function normalizeTargetFile(rootDir: string, filePath: string): string {
  const absolutePath = path.isAbsolute(filePath)
    ? filePath
    : resolveProjectPath(rootDir, filePath);
  const root = path.resolve(rootDir);
  const relativePath = path.relative(root, absolutePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`Refusing to guard a file outside project root: ${filePath}`);
  }

  return toPosixPath(relativePath).replace(/^\.\//, "");
}

function slugForFileNote(filePath: string): string {
  return filePath
    .replace(/\.[^.]+$/u, "")
    .replace(/[^a-zA-Z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .toLowerCase();
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

function firstBodyLine(page: WikiPage): string | undefined {
  return page.body
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("#"));
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function docPath(page: WikiPage): string {
  return `wiki/${page.relativePath}`;
}

function pageKey(page: WikiPage): string {
  return page.relativePath;
}

function severityScore(page: WikiPage): number {
  const severity = page.frontmatter.severity ?? page.frontmatter.risk;
  return severity ? SEVERITY_RANK[severity] : 0;
}

function statusScore(page: WikiPage): number {
  return page.frontmatter.status === "deprecated" ? -10 : 0;
}

function sortPages(pages: WikiPage[]): WikiPage[] {
  return [...pages].sort((a, b) => {
    const scoreDelta =
      severityScore(b) + statusScore(b) - (severityScore(a) + statusScore(a));
    if (scoreDelta !== 0) {
      return scoreDelta;
    }

    return a.relativePath.localeCompare(b.relativePath);
  });
}

function pagesOfType(pages: WikiPage[], type: WikiPageType): WikiPage[] {
  return sortPages(pages.filter((page) => page.frontmatter.type === type));
}

function pageBullet(page: WikiPage): string {
  const details = [
    docPath(page),
    page.frontmatter.severity ? `severity ${page.frontmatter.severity}` : undefined,
    page.frontmatter.risk ? `risk ${page.frontmatter.risk}` : undefined,
    page.frontmatter.status ? `status ${page.frontmatter.status}` : undefined
  ].filter(Boolean);
  const excerpt = firstBodyLine(page);
  return `${titleForPage(page)} (${details.join(", ")})${
    excerpt ? ` - ${excerpt}` : ""
  }`;
}

function fallback(items: string[], value: string): string[] {
  return items.length > 0 ? items : [value];
}

function pathSearchQuery(filePath: string): string {
  const parsed = path.posix.parse(filePath);
  const lowSignalTokens = new Set([
    "src",
    "app",
    "api",
    "lib",
    "server",
    "client",
    "components",
    "pages",
    "index",
    "route",
    "page"
  ]);
  const tokens = [parsed.name, ...filePath.split(/[/.\\_-]+/u)]
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 3 && !lowSignalTokens.has(token));

  return unique(tokens).join(" ");
}

function relatedModules(pages: WikiPage[]): string[] {
  return unique(
    pages.flatMap((page) => {
      if (page.frontmatter.type === "module") {
        return [page.frontmatter.modules?.[0], page.frontmatter.title, titleForPage(page)];
      }

      return page.frontmatter.modules ?? [];
    })
  );
}

function requiredChecks(filePath: string, pages: WikiPage[]): string[] {
  if (pages.length === 0) {
    return [
      `No existing AIWiki guardrails matched ${filePath}.`,
      "If this edit uncovers reusable constraints or pitfalls, capture them after the task."
    ];
  }

  const checks = [`Review matched AIWiki memory before editing ${filePath}.`];
  if (pagesOfType(pages, "rule").length > 0) {
    checks.push("Confirm the listed rules still hold after the change.");
  }
  if (pagesOfType(pages, "pitfall").length > 0) {
    checks.push("Verify known pitfalls are covered by the implementation and tests.");
  }
  checks.push("Do not overwrite user-owned AIWiki notes while applying fixes.");
  return checks;
}

function suggestedTests(filePath: string, pages: WikiPage[]): string[] {
  if (pages.length === 0) {
    return [
      `Run the relevant project tests after editing ${filePath}.`,
      "Add a focused regression test if this file gains behavior with lasting constraints."
    ];
  }

  const modules = relatedModules(pages);
  return [
    `Run tests covering ${filePath}${modules.length > 0 ? ` and modules: ${modules.join(", ")}` : ""}.`,
    "Add or update focused regression tests for any listed high-severity pitfall touched by the edit."
  ];
}

function formatSection(section: FileGuardrailSection): string {
  return `## ${section.title}\n${section.items.map((item) => `- ${item}`).join("\n")}`;
}

export function formatFileGuardrailsMarkdown(guardrails: FileGuardrails): string {
  return [
    `# File Guardrails: ${guardrails.filePath}`,
    "",
    ...guardrails.sections.flatMap((section) => [formatSection(section), ""]),
    `Suggested file note: ${guardrails.suggestedFileNote}`
  ].join("\n").trimEnd() + "\n";
}

function guardrailsToJson(guardrails: FileGuardrails): string {
  return `${JSON.stringify(guardrails, null, 2)}\n`;
}

export async function generateFileGuardrails(
  rootDir: string,
  filePath: string,
  options: FileGuardrailsOptions = {}
): Promise<FileGuardrailsResult> {
  await loadAIWikiConfig(rootDir);
  const normalizedFile = normalizeTargetFile(rootDir, filePath);
  const exactPages = await findWikiPages(rootDir, { file: normalizedFile });
  const search = await searchWikiMemory(rootDir, pathSearchQuery(normalizedFile), {
    limit: options.limit ?? DEFAULT_GUARD_LIMIT
  });

  const pagesByPath = new Map<string, WikiPage>();
  for (const page of exactPages) {
    pagesByPath.set(pageKey(page), page);
  }
  for (const result of search.results) {
    pagesByPath.set(pageKey(result.page), result.page);
  }

  const pages = sortPages([...pagesByPath.values()]);
  const modules = relatedModules(pages);
  const rulePages = pagesOfType(pages, "rule");
  const pitfallPages = pagesOfType(pages, "pitfall");
  const decisionPages = pagesOfType(pages, "decision");
  const suggestedFileNote = `wiki/files/${slugForFileNote(normalizedFile)}.md`;

  const guardrails: FileGuardrails = {
    filePath: normalizedFile,
    matchedDocs: pages.map(docPath),
    suggestedFileNote,
    sections: [
      {
        title: "Related Modules",
        items: fallback(modules, "No related module pages found.")
      },
      {
        title: "Critical Rules",
        items: fallback(rulePages.map(pageBullet), "No matching rule pages found.")
      },
      {
        title: "Known Pitfalls",
        items: fallback(pitfallPages.map(pageBullet), "No matching pitfall pages found.")
      },
      {
        title: "Required Checks",
        items: requiredChecks(normalizedFile, pages)
      },
      {
        title: "Related Decisions",
        items: fallback(
          decisionPages.map(pageBullet),
          "No matching decision pages found."
        )
      },
      {
        title: "Suggested Tests",
        items: suggestedTests(normalizedFile, pages)
      }
    ]
  };

  const markdown = formatFileGuardrailsMarkdown(guardrails);
  const json = guardrailsToJson(guardrails);
  return { guardrails, markdown, json };
}
