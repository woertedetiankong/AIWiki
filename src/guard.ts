import path from "node:path";
import { RISK_FILE_KEYWORDS } from "./constants.js";
import { AIWikiNotInitializedError, createDefaultConfig, loadAIWikiConfig } from "./config.js";
import { loadGraphifyContext } from "./graphify.js";
import type { GraphifyContext } from "./graphify.js";
import { resolveProjectPath, toPosixPath } from "./paths.js";
import { searchWikiMemory } from "./search.js";
import type { AIWikiConfig, RiskLevel, WikiPage, WikiPageType } from "./types.js";
import { findWikiPages } from "./wiki-store.js";

export interface FileGuardrailsOptions {
  limit?: number;
  withGraphify?: boolean;
  architectureGuard?: boolean;
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

function defaultProjectName(rootDir: string): string {
  return path.basename(path.resolve(rootDir)) || "project";
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

function graphifyItems(
  filePath: string,
  context: GraphifyContext | undefined
): string[] {
  if (!context) {
    return [];
  }

  const relatedFiles = context.files.filter((file) => {
    return file === filePath || file.endsWith(`/${filePath}`) || filePath.endsWith(file);
  });
  const relatedEdges = context.edges
    .filter((edge) => edge.from.includes(filePath) || edge.to.includes(filePath))
    .slice(0, 8)
    .map((edge) => {
      const details = [
        edge.type ? `type ${edge.type}` : undefined,
        edge.confidence ? `confidence ${edge.confidence}` : undefined
      ].filter(Boolean);
      return `${edge.from} -> ${edge.to}${details.length > 0 ? ` (${details.join(", ")})` : ""}`;
    });

  const items = [
    `Available: ${context.available ? "yes" : "no"}.`,
    ...context.warnings.map((warning) => `Warning: ${warning}`),
    ...relatedFiles.map((file) => `Related file reference: ${file}.`),
    ...relatedEdges.map((edge) => `Related relation: ${edge}.`)
  ];

  return items.length > 1 || context.available
    ? items
    : ["Graphify context requested, but no Graphify output was found."];
}

function architectureGuardItems(
  filePath: string,
  modules: string[],
  configuredRiskFiles: string[]
): string[] {
  const normalized = filePath.toLowerCase();
  const matchedRiskKeywords = RISK_FILE_KEYWORDS.filter((keyword) =>
    normalized.includes(keyword)
  );
  const isRouteOrController = /(^|\/)(route|controller|handler|api)(\.|\/|-)/u.test(
    normalized
  );
  const isConfiguredRiskFile = configuredRiskFiles.some((riskFile) => {
    const risk = riskFile.toLowerCase();
    return normalized === risk || normalized.endsWith(`/${risk}`) || risk.endsWith(normalized);
  });
  const testHints = [
    matchedRiskKeywords.some((keyword) => ["webhook", "payment", "billing", "stripe"].includes(keyword))
      ? "webhooks, billing/payment state transitions, and idempotency"
      : undefined,
    matchedRiskKeywords.some((keyword) => ["auth", "permission", "rbac", "role", "security"].includes(keyword))
      ? "auth, permission, and security boundaries"
      : undefined,
    matchedRiskKeywords.some((keyword) => ["migration", "schema"].includes(keyword))
      ? "migration rollback and schema compatibility"
      : undefined
  ].filter((item): item is string => Boolean(item));

  return [
    modules.length > 0
      ? `Likely modules: ${modules.join(", ")}.`
      : "Likely modules: none detected from matched memory.",
    matchedRiskKeywords.length > 0 || isConfiguredRiskFile
      ? `High-risk signals: ${[
          ...matchedRiskKeywords,
          isConfiguredRiskFile ? "configured risk file" : undefined
        ].filter(Boolean).join(", ")}.`
      : "High-risk signals: none detected from path or config.",
    isRouteOrController
      ? "Route/controller boundary: keep request parsing and response mapping here; move durable business logic into services or adapters."
      : "Boundary check: keep this file focused and avoid mixing provider calls, persistence, UI, and configuration concerns.",
    testHints.length > 0
      ? `Focused tests should cover ${testHints.join(", ")}.`
      : "Focused tests should cover state transitions, webhooks, auth, migrations, or billing if this file touches those domains.",
    "This architecture guard is advisory and must not automatically refactor code or block the task."
  ];
}

function formatSection(section: FileGuardrailSection): string {
  return `## ${section.title}\n${section.items.map((item) => `- ${item}`).join("\n")}`;
}

function sectionItems(
  guardrails: FileGuardrails,
  title: string
): string[] {
  return guardrails.sections.find((section) => section.title === title)?.items ?? [];
}

function stableItems(items: string[], fallback: string): string[] {
  return items.length > 0 ? items : [fallback];
}

function withoutFallback(items: string[], fallback: string): string[] {
  return items.filter((item) => item !== fallback);
}

export function formatFileGuardrailsMarkdown(guardrails: FileGuardrails): string {
  const setup = sectionItems(guardrails, "AIWiki Setup");
  const architectureGuard = sectionItems(guardrails, "Architecture Guard");
  const graphify = sectionItems(guardrails, "Graphify Structural Context");
  const relatedModules = sectionItems(guardrails, "Related Modules").filter(
    (item) => item !== "No related module pages found."
  );
  const rules = withoutFallback(
    sectionItems(guardrails, "Critical Rules"),
    "No matching rule pages found."
  );
  const pitfalls = withoutFallback(
    sectionItems(guardrails, "Known Pitfalls"),
    "No matching pitfall pages found."
  );
  const decisions = withoutFallback(
    sectionItems(guardrails, "Related Decisions"),
    "No matching decision pages found."
  );
  const sections: FileGuardrailSection[] = [
    {
      title: "Do Not",
      items: [
        `Do not edit ${guardrails.filePath} before reviewing matched rules and pitfalls.`,
        "Do not overwrite user-owned AIWiki notes while applying fixes.",
        "Do not promote new rules from this edit without user confirmation."
      ]
    },
    ...(setup.length > 0
      ? [{ title: "Setup", items: setup }]
      : []),
    {
      title: "Rules",
      items: stableItems(rules, "No matching rules found.")
    },
    {
      title: "Pitfalls",
      items: stableItems(pitfalls, "No matching pitfalls found.")
    },
    {
      title: "Required Checks",
      items: stableItems(sectionItems(guardrails, "Required Checks"), "Run relevant project checks after editing.")
    },
    {
      title: "Suggested Tests",
      items: stableItems(sectionItems(guardrails, "Suggested Tests"), "Run relevant project tests.")
    },
    {
      title: "Related Decisions",
      items: stableItems(decisions, "No matching decisions found.")
    },
    ...(architectureGuard.length > 0
      ? [{ title: "Architecture Guard", items: architectureGuard }]
      : []),
    ...(graphify.length > 0
      ? [{ title: "Graphify Context", items: graphify }]
      : []),
    {
      title: "Other Context",
      items: stableItems(relatedModules, "No related modules found.")
    }
  ];

  return [
    `# File Guardrails: ${guardrails.filePath}`,
    "",
    ...sections.flatMap((section) => [formatSection(section), ""]),
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
  const graphify = options.withGraphify
    ? await loadGraphifyContext(rootDir)
    : undefined;

  const guardrails: FileGuardrails = {
    filePath: normalizedFile,
    matchedDocs: pages.map(docPath),
    suggestedFileNote,
    sections: [
      ...(!initialized
        ? [
            {
              title: "AIWiki Setup",
              items: [
                "Cold-start mode: no .aiwiki memory was loaded and no AIWiki files were written.",
                "Run aiwiki init --project-name <name> and aiwiki map --write when you are ready to keep project memory."
              ]
            }
          ]
        : []),
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
      ...(options.withGraphify
        ? [
            {
              title: "Graphify Structural Context",
              items: graphifyItems(normalizedFile, graphify)
            }
          ]
        : []),
      ...(options.architectureGuard
        ? [
            {
              title: "Architecture Guard",
              items: architectureGuardItems(normalizedFile, modules, config.riskFiles)
            }
          ]
        : []),
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
