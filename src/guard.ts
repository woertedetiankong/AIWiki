import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  ARCHITECTURE_LARGE_FILE_LINE_THRESHOLD,
  ARCHITECTURE_SOURCE_FILE_EXTENSIONS,
  PROJECT_SCAN_EXCLUDED_PATHS,
  RISK_FILE_KEYWORDS
} from "./constants.js";
import { AIWikiNotInitializedError, createDefaultConfig, loadAIWikiConfig } from "./config.js";
import { loadGraphifyContext } from "./graphify.js";
import type { GraphifyContext } from "./graphify.js";
import {
  collectProjectIgnoreRules,
  shouldIgnorePath
} from "./ignore.js";
import type { IgnoreRule } from "./ignore.js";
import { resolveProjectPath, toPosixPath } from "./paths.js";
import { semanticChangeRiskMessages } from "./risk-rules.js";
import { searchWikiMemory } from "./search.js";
import {
  collectWikiStalenessWarnings,
  formatStalenessWarning
} from "./staleness.js";
import type { WikiStalenessWarning } from "./staleness.js";
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
  exactMatchedDocs: string[];
  contextualDocs: string[];
  suggestedFileNote: string;
  fileNoteRecommended: boolean;
  suggestedTests: string[];
  relatedFiles: string[];
  fileSignals: {
    exists: boolean;
    lines?: number;
    large: boolean;
    importedBy: string[];
    imports: string[];
  };
  changeRisks: string[];
  stalenessWarnings?: WikiStalenessWarning[];
  sections: FileGuardrailSection[];
}

export interface FileGuardrailsResult {
  guardrails: FileGuardrails;
  markdown: string;
  json: string;
}

const DEFAULT_GUARD_LIMIT = 10;
const MIN_GUARD_SEARCH_SCORE = 6;
const LOW_SIGNAL_PATH_TOKENS = new Set([
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
  "page",
  "file",
  "files",
  "missing",
  "unknown",
  "new",
  "temp",
  "tmp",
  "definitely"
]);

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

function isSourceFile(relativePath: string): boolean {
  const extension = path.posix.extname(toPosixPath(relativePath));
  return ARCHITECTURE_SOURCE_FILE_EXTENSIONS.includes(
    extension as (typeof ARCHITECTURE_SOURCE_FILE_EXTENSIONS)[number]
  );
}

async function walkProjectFiles(
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
    const relativePath = toPosixPath(path.relative(rootDir, fullPath)).replace(/^\.\//u, "");
    if (shouldIgnorePath(relativePath, ignoreRules)) {
      continue;
    }

    if (entry.isDirectory()) {
      files.push(...(await walkProjectFiles(rootDir, ignoreRules, fullPath)));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }

  return files.sort();
}

function lineCount(content: string): number {
  return content.length === 0 ? 0 : content.split("\n").length;
}

function basenameWithoutExtension(filePath: string): string {
  return path.posix.basename(filePath, path.posix.extname(filePath)).toLowerCase();
}

function isTestFile(filePath: string): boolean {
  const normalized = filePath.toLowerCase();
  return normalized.startsWith("tests/") ||
    normalized.includes("/tests/") ||
    /(?:^|\/)(?:test_|.+\.(?:test|spec)\.)/u.test(normalized);
}

function likelyTestFiles(filePath: string, files: string[]): string[] {
  const base = basenameWithoutExtension(filePath);
  return files
    .filter(isTestFile)
    .filter((candidate) => basenameWithoutExtension(candidate).includes(base))
    .slice(0, 5);
}

function importTargetCandidates(filePath: string): string[] {
  const withoutExtension = filePath.replace(/\.[^.]+$/u, "");
  return [withoutExtension, `../${withoutExtension}`, `./${path.posix.basename(withoutExtension)}`];
}

async function fileContent(rootDir: string, filePath: string): Promise<string> {
  return readFile(resolveProjectPath(rootDir, filePath), "utf8");
}

async function importingFiles(
  rootDir: string,
  filePath: string,
  files: string[]
): Promise<string[]> {
  const candidates = importTargetCandidates(filePath);
  const importers: string[] = [];
  for (const candidate of files.filter(isSourceFile)) {
    if (candidate === filePath) {
      continue;
    }

    const content = await fileContent(rootDir, candidate);
    if (candidates.some((target) => content.includes(target))) {
      importers.push(candidate);
    }
  }

  return importers.slice(0, 8);
}

function importedPathsFromContent(content: string): string[] {
  const imports = [...content.matchAll(/\bfrom\s+["']([^"']+)["']|import\(["']([^"']+)["']\)/gu)]
    .map((match) => match[1] ?? match[2])
    .filter((value): value is string => Boolean(value));
  return unique(imports).slice(0, 8);
}

async function fileSignals(
  rootDir: string,
  filePath: string,
  files: string[]
): Promise<FileGuardrails["fileSignals"]> {
  try {
    const fileStat = await stat(resolveProjectPath(rootDir, filePath));
    if (!fileStat.isFile()) {
      return { exists: false, large: false, importedBy: [], imports: [] };
    }

    const content = await fileContent(rootDir, filePath);
    const lines = lineCount(content);
    return {
      exists: true,
      lines,
      large: lines >= ARCHITECTURE_LARGE_FILE_LINE_THRESHOLD,
      importedBy: await importingFiles(rootDir, filePath, files),
      imports: importedPathsFromContent(content)
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { exists: false, large: false, importedBy: [], imports: [] };
    }

    throw error;
  }
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
  const tokens = [parsed.name, ...filePath.split(/[/.\\_-]+/u)]
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 3 && !LOW_SIGNAL_PATH_TOKENS.has(token));

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

function suggestedTests(filePath: string, pages: WikiPage[], detectedTests: string[]): string[] {
  const exactTestItems = detectedTests.map((testFile) => `Run \`npm run test -- ${testFile}\`.`);
  if (pages.length === 0) {
    return [
      ...exactTestItems,
      `Run the relevant project tests after editing ${filePath}.`,
      "Add a focused regression test if this file gains behavior with lasting constraints."
    ];
  }

  const modules = relatedModules(pages);
  return [
    ...exactTestItems,
    `Run tests covering ${filePath}${modules.length > 0 ? ` and modules: ${modules.join(", ")}` : ""}.`,
    "Add or update focused regression tests for any listed high-severity pitfall touched by the edit."
  ];
}

function relatedImplementationFiles(filePath: string, pages: WikiPage[], fileImports: string[]): string[] {
  const pageFiles = pages.flatMap((page) => page.frontmatter.files ?? []);
  return unique([...pageFiles, ...fileImports])
    .filter((file) => file !== filePath)
    .slice(0, 10);
}

function fileSignalItems(signals: FileGuardrails["fileSignals"]): string[] {
  if (!signals.exists) {
    return ["Target file does not exist yet; treat guard output as creation guidance."];
  }

  return [
    signals.lines !== undefined ? `Target file has ${signals.lines} line(s).` : undefined,
    signals.large ? "Target file is large; prefer narrow edits or extraction over adding broad responsibilities." : undefined,
    signals.importedBy.length > 0
      ? `Imported by: ${signals.importedBy.join(", ")}.`
      : "No importing source files detected from static scan."
  ].filter((item): item is string => Boolean(item));
}

function matchingProjectFiles(files: string[], candidates: string[]): string[] {
  return candidates.filter((candidate) => files.includes(candidate));
}

async function readOptionalFile(rootDir: string, filePath: string): Promise<string> {
  try {
    return await fileContent(rootDir, filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return "";
    }

    throw error;
  }
}

function shouldRecommendFileNote(filePath: string, pages: WikiPage[], signals: FileGuardrails["fileSignals"]): boolean {
  if (pages.length > 0) {
    return false;
  }

  return signals.large || isSourceFile(filePath);
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
    matchedRiskKeywords.some((keyword) => ["checkout", "charge", "amount", "invoice", "subscription"].includes(keyword))
      ? "checkout, charge/amount handling, currency math, and idempotency"
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

function memoryCoverageItems(input: {
  initialized: boolean;
  exactMatchedDocs: string[];
  contextualDocs: string[];
  fileSignals: FileGuardrails["fileSignals"];
}): string[] {
  if (!input.initialized) {
    return [
      "No durable .aiwiki memory was loaded; this guard is based on project file signals only.",
      "Treat this output as cold-start guidance, not learned file-specific memory."
    ];
  }

  if (input.exactMatchedDocs.length > 0) {
    return [
      `Found ${input.exactMatchedDocs.length} file-specific AIWiki page(s).`,
      input.contextualDocs.length > 0
        ? `Also retrieved ${input.contextualDocs.length} contextual page(s) from path search; verify relevance before treating them as constraints.`
        : "No additional path-search context was needed.",
      "Review file-specific memory before editing, then verify it against the current source and tests."
    ];
  }

  if (input.contextualDocs.length > 0) {
    return [
      "No file-specific AIWiki memory matched this file.",
      `Retrieved ${input.contextualDocs.length} contextual page(s) from path search; treat them as advisory until source/tests confirm relevance.`
    ];
  }

  if (!input.fileSignals.exists) {
    return [
      "No file-specific AIWiki memory matched this new or missing file.",
      "Treat this output as creation guidance; inspect nearby source and tests before choosing an implementation."
    ];
  }

  return [
    "No file-specific AIWiki memory matched this file.",
    "Use the current source, tests, and user request as the source of truth; treat generic checks as advisory."
  ];
}

function doNotItems(guardrails: FileGuardrails): string[] {
  const coverageSpecific = guardrails.exactMatchedDocs.length > 0
    ? [`Do not edit ${guardrails.filePath} before reviewing matched rules and pitfalls.`]
    : guardrails.contextualDocs.length > 0
      ? [
          `Do not treat search-only context for ${guardrails.filePath} as file-specific project memory.`,
          "Do not skip source and test inspection just because contextual guardrails were generated."
        ]
    : [
        `Do not infer project-specific constraints for ${guardrails.filePath} from empty AIWiki matches.`,
        "Do not skip source and test inspection just because generic guardrails were generated."
      ];

  return [
    ...coverageSpecific,
    "Do not overwrite user-owned AIWiki notes while applying fixes.",
    "Do not promote new rules from this edit without user confirmation."
  ];
}

export function formatFileGuardrailsMarkdown(guardrails: FileGuardrails): string {
  const setup = sectionItems(guardrails, "AIWiki Setup");
  const memoryCoverage = sectionItems(guardrails, "Memory Coverage");
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
  const stalenessWarnings = guardrails.stalenessWarnings ?? [];
  const decisions = withoutFallback(
    sectionItems(guardrails, "Related Decisions"),
    "No matching decision pages found."
  );
  const fileSignals = sectionItems(guardrails, "File Signals");
  const changeRisks = sectionItems(guardrails, "Change Risks");
  const relatedFiles = withoutFallback(
    sectionItems(guardrails, "Related Files"),
    "No related implementation files detected."
  );
  const sections: FileGuardrailSection[] = [
    {
      title: "Do Not",
      items: doNotItems(guardrails)
    },
    ...(setup.length > 0
      ? [{ title: "Setup", items: setup }]
      : []),
    {
      title: "Memory Coverage",
      items: stableItems(
        memoryCoverage,
        "No memory coverage information was generated."
      )
    },
    {
      title: "Rules",
      items: stableItems(rules, "No matching rules found.")
    },
    {
      title: "Pitfalls",
      items: stableItems(pitfalls, "No matching pitfalls found.")
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
          : guardrails.matchedDocs.length > 0
            ? ["No stale wiki memory warnings for matched context."]
            : ["No matched AIWiki pages to check for staleness."]
    },
    {
      title: "Required Checks",
      items: stableItems(sectionItems(guardrails, "Required Checks"), "Run relevant project checks after editing.")
    },
    {
      title: "Change Risks",
      items: stableItems(changeRisks, "No semantic change risks detected from path or file content.")
    },
    {
      title: "Suggested Tests",
      items: stableItems(sectionItems(guardrails, "Suggested Tests"), "Run relevant project tests.")
    },
    {
      title: "File Signals",
      items: stableItems(fileSignals, "No file signals detected.")
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
      items: stableItems(
        [
          ...relatedModules.map((item) => `Module: ${item}`),
          ...relatedFiles.map((item) => `Related file: ${item}`)
        ],
        "No related modules found."
      )
    }
  ];

  return [
    `# File Guardrails: ${guardrails.filePath}`,
    "",
    ...sections.flatMap((section) => [formatSection(section), ""]),
    guardrails.fileNoteRecommended
      ? `Suggested file note: ${guardrails.suggestedFileNote}`
      : "Suggested file note: not recommended for this target."
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
  const ignoreRules = await collectProjectIgnoreRules(
    rootDir,
    PROJECT_SCAN_EXCLUDED_PATHS,
    config.ignore
  );
  const projectFiles = await walkProjectFiles(rootDir, ignoreRules);
  const exactPages = await findWikiPages(rootDir, { file: normalizedFile });
  const search = await searchWikiMemory(rootDir, pathSearchQuery(normalizedFile), {
    limit: options.limit ?? DEFAULT_GUARD_LIMIT
  });

  const pagesByPath = new Map<string, WikiPage>();
  for (const page of exactPages) {
    pagesByPath.set(pageKey(page), page);
  }
  const contextualPages: WikiPage[] = [];
  for (const result of search.results.filter((item) => item.score >= MIN_GUARD_SEARCH_SCORE)) {
    if (!pagesByPath.has(pageKey(result.page))) {
      contextualPages.push(result.page);
    }
    pagesByPath.set(pageKey(result.page), result.page);
  }

  const pages = sortPages([...pagesByPath.values()]);
  const sortedExactPages = sortPages(exactPages);
  const sortedContextualPages = sortPages(contextualPages);
  const stalenessWarnings = await collectWikiStalenessWarnings(rootDir, pages);
  const modules = relatedModules(pages);
  const rulePages = pagesOfType(pages, "rule");
  const pitfallPages = pagesOfType(pages, "pitfall");
  const decisionPages = pagesOfType(pages, "decision");
  const suggestedFileNote = `wiki/files/${slugForFileNote(normalizedFile)}.md`;
  const detectedTests = likelyTestFiles(normalizedFile, projectFiles);
  const signals = await fileSignals(rootDir, normalizedFile, projectFiles);
  const relatedFiles = relatedImplementationFiles(normalizedFile, pages, signals.imports);
  const changeRisks = semanticChangeRiskMessages({
    filePath: normalizedFile,
    content: signals.exists ? await readOptionalFile(rootDir, normalizedFile) : "",
    files: projectFiles
  });
  const testSuggestions = suggestedTests(normalizedFile, pages, detectedTests);
  const fileNoteRecommended = shouldRecommendFileNote(normalizedFile, pages, signals);
  const graphify = options.withGraphify
    ? await loadGraphifyContext(rootDir)
    : undefined;

  const guardrails: FileGuardrails = {
    filePath: normalizedFile,
    matchedDocs: pages.map(docPath),
    exactMatchedDocs: sortedExactPages.map(docPath),
    contextualDocs: sortedContextualPages.map(docPath),
    suggestedFileNote,
    fileNoteRecommended,
    suggestedTests: testSuggestions,
    relatedFiles,
    fileSignals: signals,
    changeRisks,
    stalenessWarnings,
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
        title: "Memory Coverage",
        items: memoryCoverageItems({
          initialized,
          exactMatchedDocs: sortedExactPages.map(docPath),
          contextualDocs: sortedContextualPages.map(docPath),
          fileSignals: signals
        })
      },
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
        title: "Change Risks",
        items: fallback(changeRisks, "No semantic change risks detected from path or file content.")
      },
      {
        title: "File Signals",
        items: fileSignalItems(signals)
      },
      {
        title: "Related Files",
        items: fallback(relatedFiles, "No related implementation files detected.")
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
        items: testSuggestions
      }
    ]
  };

  const markdown = formatFileGuardrailsMarkdown(guardrails);
  const json = guardrailsToJson(guardrails);
  return { guardrails, markdown, json };
}
