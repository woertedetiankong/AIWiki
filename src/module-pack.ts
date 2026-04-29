import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { generateArchitectureBriefContext } from "./architecture.js";
import type { WikiUpdatePlan, WikiUpdatePlanEntry } from "./apply.js";
import {
  AIWIKI_VERSION,
  MODULE_PACKS_DIR
} from "./constants.js";
import { loadAIWikiConfig } from "./config.js";
import { resolveProjectPath, toPosixPath } from "./paths.js";
import type { WikiPageFrontmatter, WikiPageType } from "./types.js";
import { scanWikiPages } from "./wiki-store.js";

const portablePageTypes = [
  "module",
  "decision",
  "pattern",
  "pitfall",
  "rule"
] as const;

const modulePackPageSchema = z.object({
  type: z.enum(portablePageTypes),
  title: z.string().min(1),
  relativePath: z.string().min(1),
  frontmatter: z.record(z.string(), z.unknown()),
  body: z.string()
});

export const modulePackSchema = z.object({
  version: z.string(),
  sourceProject: z.string(),
  module: z.string().min(1),
  exportedAt: z.string(),
  files: z.array(z.string()),
  pages: z.array(modulePackPageSchema),
  portability: z.object({
    architectureBoundaries: z.array(z.string()),
    hardcodingRisks: z.array(z.string()),
    portabilityChecklist: z.array(z.string()),
    moduleMemoryToMaintain: z.array(z.string())
  })
});

export type ModulePackPage = z.infer<typeof modulePackPageSchema>;
export type ModulePack = z.infer<typeof modulePackSchema>;

export interface ModuleMemoryPage {
  type: ModulePackPage["type"] | "file";
  title: string;
  relativePath: string;
  frontmatter: WikiPageFrontmatter;
  body: string;
}

export interface ModulePackExportOptions {
  output?: string;
  force?: boolean;
}

export interface ModulePackExportResult {
  pack: ModulePack;
  markdown: string;
  json: string;
  outputPath?: string;
}

export interface ModulePackImportOptions {
  as?: string;
  targetStack?: string;
  outputPlan?: string;
  force?: boolean;
}

export interface ModuleImportPreview {
  sourceProject: string;
  targetProject: string;
  sourceModule: string;
  targetModule: string;
  module: string;
  targetStack?: string;
  pages: ModulePackPage[];
  files: string[];
  guidance: string[];
  risks: ModuleImportRisk[];
  updatePlanDraft: WikiUpdatePlan;
}

export type ModuleImportRiskSeverity = "warning" | "info";

export type ModuleImportRiskCode =
  | "existing_page"
  | "similar_module"
  | "possible_rule_conflict"
  | "source_specific_assumption";

export interface ModuleImportRisk {
  severity: ModuleImportRiskSeverity;
  code: ModuleImportRiskCode;
  message: string;
  source?: string;
  target?: string;
}

export interface ModulePackImportResult {
  preview: ModuleImportPreview;
  markdown: string;
  json: string;
  outputPlanPath?: string;
}

export interface ModuleMemoryBriefOptions {
  format?: "markdown" | "json";
}

export interface ModuleMemoryBrief {
  module: string;
  task: string;
  projectName: string;
  pages: ModuleMemoryPage[];
  files: string[];
  guidance: string[];
  sections: Array<{
    title: string;
    items: string[];
  }>;
}

export interface ModuleMemoryBriefResult {
  brief: ModuleMemoryBrief;
  markdown: string;
  json: string;
}

export type ModuleLintSeverity = "warning" | "info";

export type ModuleLintIssueCode =
  | "no_module_memory"
  | "missing_portability_notes"
  | "missing_file_refs"
  | "missing_tests"
  | "source_specific_assumption"
  | "active_imported_rule";

export interface ModuleLintIssue {
  severity: ModuleLintSeverity;
  code: ModuleLintIssueCode;
  message: string;
  page?: string;
}

export interface ModuleLintReport {
  module: string;
  summary: {
    pages: number;
    warnings: number;
    info: number;
  };
  issues: ModuleLintIssue[];
}

export interface ModuleLintResult {
  report: ModuleLintReport;
  markdown: string;
  json: string;
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function normalizeModuleName(moduleName: string): string {
  return moduleName.trim().toLowerCase();
}

function safeSlug(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");

  if (!slug) {
    throw new Error(`Unable to derive a safe slug from: ${value}`);
  }

  return slug;
}

function parseTargetModuleName(value: string): string {
  const trimmed = value.trim();
  const slug = safeSlug(trimmed);
  if (trimmed !== slug || !/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u.test(trimmed)) {
    throw new Error(
      `Unsafe module name for --as: ${value}. Use lowercase kebab-case, such as billing or user-auth.`
    );
  }

  return trimmed;
}

function defaultPackPath(moduleName: string): string {
  return `${MODULE_PACKS_DIR}/${safeSlug(moduleName)}.aiwiki-pack.json`;
}

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

function pageTitle(page: {
  relativePath: string;
  frontmatter: WikiPageFrontmatter;
  body: string;
}): string {
  if (page.frontmatter.title && page.frontmatter.title.trim().length > 0) {
    return page.frontmatter.title;
  }

  const heading = page.body
    .split("\n")
    .find((line) => line.trim().startsWith("#"));

  return heading ? heading.replace(/^#+\s*/u, "").trim() : page.relativePath;
}

function isPortablePageType(type: WikiPageType): type is ModulePackPage["type"] {
  return portablePageTypes.includes(type as ModulePackPage["type"]);
}

function isModuleBriefPageType(type: WikiPageType): boolean {
  return [...portablePageTypes, "file"].includes(type as ModulePackPage["type"] | "file");
}

function pageMatchesModule(
  page: { frontmatter: WikiPageFrontmatter; body: string; relativePath: string },
  moduleName: string
): boolean {
  const normalized = normalizeModuleName(moduleName);
  const modules = page.frontmatter.modules ?? [];
  return (
    modules.some((item) => normalizeModuleName(item) === normalized) ||
    normalizeModuleName(page.frontmatter.title ?? "") === normalized ||
    normalizeModuleName(pageTitle(page)) === normalized
  );
}

function sortPages(pages: ModulePackPage[]): ModulePackPage[] {
  const order: Record<ModulePackPage["type"], number> = {
    decision: 0,
    module: 1,
    pattern: 2,
    pitfall: 3,
    rule: 4
  };

  return [...pages].sort(
    (left, right) =>
      order[left.type] - order[right.type] ||
      left.title.localeCompare(right.title) ||
      left.relativePath.localeCompare(right.relativePath)
  );
}

function sortMemoryPages(pages: ModuleMemoryPage[]): ModuleMemoryPage[] {
  const order: Record<ModuleMemoryPage["type"], number> = {
    decision: 0,
    module: 1,
    pattern: 2,
    pitfall: 3,
    rule: 4,
    file: 5
  };

  return [...pages].sort(
    (left, right) =>
      order[left.type] - order[right.type] ||
      left.title.localeCompare(right.title) ||
      left.relativePath.localeCompare(right.relativePath)
  );
}

function packFiles(pages: Array<{ frontmatter: Record<string, unknown> }>): string[] {
  return unique(
    pages.flatMap((page) => {
      const files = page.frontmatter.files;
      return Array.isArray(files)
        ? files.filter((item): item is string => typeof item === "string")
        : [];
    })
  ).sort();
}

async function writeProjectOutput(
  rootDir: string,
  outputPath: string,
  content: string,
  force: boolean,
  overwriteMessage: string
): Promise<string> {
  const resolved = resolveProjectPath(rootDir, outputPath);
  if (!force && (await pathExists(resolved))) {
    throw new Error(overwriteMessage);
  }

  await mkdir(path.dirname(resolved), { recursive: true });
  await writeFile(resolved, content, "utf8");
  return resolved;
}

function formatList(items: string[], fallback: string): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : `- ${fallback}`;
}

function pagesForModule(
  pages: Array<{ frontmatter: WikiPageFrontmatter; body: string; relativePath: string }>,
  moduleName: string
): ModuleMemoryPage[] {
  return sortMemoryPages(
    pages
      .filter((page) => isModuleBriefPageType(page.frontmatter.type))
      .filter((page) => pageMatchesModule(page, moduleName))
      .map((page) => ({
        type: page.frontmatter.type as ModuleMemoryPage["type"],
        title: pageTitle(page),
        relativePath: page.relativePath,
        frontmatter: page.frontmatter,
        body: page.body
      }))
  );
}

export function formatModulePackExportMarkdown(pack: ModulePack, outputPath?: string): string {
  return `# Module Pack Export: ${pack.module}

## Source
- Project: ${pack.sourceProject}
- Version: ${pack.version}
- Pages: ${pack.pages.length}
- Files: ${pack.files.length}
${outputPath ? `- Output: ${outputPath}` : ""}

## Pages
${formatList(
  pack.pages.map((page) => `${page.title} (${page.type}; wiki/${page.relativePath})`),
  "No module pages matched this export."
)}

## Portability Notes
${formatList(pack.portability.portabilityChecklist, "No portability notes generated.")}
`;
}

export function formatModuleImportPreviewMarkdown(preview: ModuleImportPreview): string {
  return `# Module Import Preview: ${preview.module}

## Source and Target
- Source project: ${preview.sourceProject}
- Target project: ${preview.targetProject}
- Source module: ${preview.sourceModule}
- Target module: ${preview.targetModule}
${preview.targetStack ? `- Target stack: ${preview.targetStack}` : "- Target stack: not specified"}

## Porting Mode
- Cross-stack porting: ${preview.targetStack ? "assume the target stack may differ from the source implementation." : "treat this as a knowledge transfer unless the user confirms the source and target stacks match."}
- Do not copy source code directly; port module contracts, rules, pitfalls, configuration needs, and tests into the target project.

## Included Memory
${formatList(
  preview.pages.map((page) => `${page.title} (${page.type})`),
  "No pages included."
)}

## Files From Source Project
${formatList(preview.files, "No source files were referenced by the pack.")}

## Guidance
${formatList(preview.guidance, "No guidance generated.")}

## Import Risks
${formatList(
  preview.risks.map((risk) => {
    const details = [
      risk.source ? `source ${risk.source}` : undefined,
      risk.target ? `target ${risk.target}` : undefined
    ].filter(Boolean);
    return `[${risk.severity}] ${risk.message}${details.length > 0 ? ` (${details.join("; ")})` : ""}`;
  }),
  "No import risks detected."
)}

## Update Plan Draft
- Entries: ${preview.updatePlanDraft.entries.length}
- Review this draft before running \`aiwiki apply --confirm\`.
`;
}

function packToJson(pack: ModulePack): string {
  return `${JSON.stringify(pack, null, 2)}\n`;
}

function importPreviewToJson(preview: ModuleImportPreview): string {
  return `${JSON.stringify(preview, null, 2)}\n`;
}

function moduleBriefToJson(brief: ModuleMemoryBrief): string {
  return `${JSON.stringify(brief, null, 2)}\n`;
}

function moduleLintToJson(report: ModuleLintReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

function pageList(pages: ModuleMemoryPage[], type: ModuleMemoryPage["type"]): string[] {
  return pages
    .filter((page) => page.type === type)
    .map((page) => `${page.title} (wiki/${page.relativePath})`);
}

function formatModuleMemoryBriefMarkdown(brief: ModuleMemoryBrief): string {
  const sections = brief.sections
    .map((section) => `## ${section.title}\n${formatList(section.items, "None found.")}`)
    .join("\n\n");

  return `# Module Brief: ${brief.module}

## Task
- ${brief.task}

${sections}
`;
}

function lintIssue(
  severity: ModuleLintSeverity,
  code: ModuleLintIssueCode,
  message: string,
  page?: string
): ModuleLintIssue {
  return { severity, code, message, page };
}

function pageHasPortabilityNotes(page: ModuleMemoryPage): boolean {
  return /portability|portable|porting|migration|migrate|cross-project|cross stack/iu.test(
    page.body
  );
}

function pageHasTestNotes(page: ModuleMemoryPage): boolean {
  return /test|tests|acceptance|check|verification|regression/iu.test(page.body);
}

function sourceSpecificMatches(page: ModuleMemoryPage): string[] {
  const matches = new Set<string>();
  const patterns: Array<[RegExp, string]> = [
    [/\b(?:localhost|127\.0\.0\.1)\b/iu, "local host URL"],
    [/[A-Za-z]:\\/u, "absolute Windows path"],
    [/(?:^|\s)\/(?:Users|home|var|etc)\//u, "absolute Unix path"],
    [/\b(?:production|staging|vercel|netlify)\b/iu, "environment-specific wording"],
    [/\b(?:stripe|supabase|firebase|postgres|mysql|sqlite|redis)\b/iu, "provider-specific assumption"]
  ];

  for (const [pattern, label] of patterns) {
    if (pattern.test(page.body)) {
      matches.add(label);
    }
  }

  return [...matches];
}

function sourceSpecificTextMatches(text: string): string[] {
  const matches = new Set<string>();
  const patterns: Array<[RegExp, string]> = [
    [/\b(?:localhost|127\.0\.0\.1)\b/iu, "local host URL"],
    [/[A-Za-z]:\\/u, "absolute Windows path"],
    [/(?:^|\s)\/(?:Users|home|var|etc)\//u, "absolute Unix path"],
    [/\b(?:production|staging|vercel|netlify)\b/iu, "environment-specific wording"],
    [/\b(?:stripe|supabase|firebase|postgres|mysql|sqlite|redis)\b/iu, "provider-specific assumption"]
  ];

  for (const [pattern, label] of patterns) {
    if (pattern.test(text)) {
      matches.add(label);
    }
  }

  return [...matches];
}

function formatModuleLintMarkdown(report: ModuleLintReport): string {
  return `# Module Lint: ${report.module}

## Summary
- Pages scanned: ${report.summary.pages}
- Warnings: ${report.summary.warnings}
- Info: ${report.summary.info}

## Issues
${formatList(
  report.issues.map((issue) => {
    const page = issue.page ? `${issue.page}: ` : "";
    return `[${issue.severity}] ${page}${issue.message}`;
  }),
  "No module lint issues found."
)}
`;
}

export async function exportModulePack(
  rootDir: string,
  moduleName: string,
  options: ModulePackExportOptions = {}
): Promise<ModulePackExportResult> {
  const config = await loadAIWikiConfig(rootDir);
  const pages = await scanWikiPages(rootDir);
  const selectedPages = sortPages(
    pages
      .filter((page) => isPortablePageType(page.frontmatter.type))
      .filter((page) => pageMatchesModule(page, moduleName))
      .map((page) => ({
        type: page.frontmatter.type as ModulePackPage["type"],
        title: pageTitle(page),
        relativePath: page.relativePath,
        frontmatter: page.frontmatter,
        body: page.body
      }))
  );

  if (selectedPages.length === 0) {
    throw new Error(`No portable wiki pages found for module: ${moduleName}`);
  }

  const portability = await generateArchitectureBriefContext(
    rootDir,
    `migrate ${moduleName} module`,
    {
      modules: [moduleName],
      highRiskFiles: packFiles(selectedPages),
      ignorePatterns: config.ignore
    }
  );
  const pack: ModulePack = {
    version: AIWIKI_VERSION,
    sourceProject: config.projectName,
    module: moduleName,
    exportedAt: new Date().toISOString(),
    files: packFiles(selectedPages),
    pages: selectedPages,
    portability
  };
  const json = packToJson(pack);
  const outputPath = options.output
    ? await writeProjectOutput(
        rootDir,
        options.output,
        json,
        options.force ?? false,
        `Refusing to overwrite existing module pack: ${options.output}`
      )
    : await writeProjectOutput(
        rootDir,
        defaultPackPath(moduleName),
        json,
        options.force ?? false,
        `Refusing to overwrite existing module pack: ${defaultPackPath(moduleName)}`
      );
  const markdown = formatModulePackExportMarkdown(pack, outputPath);

  return { pack, markdown, json, outputPath };
}

export async function readModulePackFile(filePath: string): Promise<ModulePack> {
  const raw = await readFile(path.resolve(filePath), "utf8");
  return modulePackSchema.parse(JSON.parse(raw));
}

function remapModules(
  modules: string[] | undefined,
  sourceModule: string,
  targetModule: string
): string[] {
  const source = normalizeModuleName(sourceModule);
  const remapped = (modules ?? []).map((moduleName) =>
    normalizeModuleName(moduleName) === source ? targetModule : moduleName
  );

  return unique([targetModule, ...remapped]);
}

function retitleImportedPage(
  page: ModulePackPage,
  sourceModule: string,
  targetModule: string
): string {
  if (normalizeModuleName(page.title) === normalizeModuleName(sourceModule)) {
    return targetModule;
  }

  return page.title;
}

function importedPageSlug(
  page: ModulePackPage,
  sourceModule: string,
  targetModule: string
): string {
  const basename = path.posix.basename(toPosixPath(page.relativePath), ".md");
  if (
    page.type === "module" &&
    normalizeModuleName(basename) === normalizeModuleName(sourceModule)
  ) {
    return safeSlug(targetModule);
  }

  return safeSlug(basename);
}

function packPageToPlanEntry(
  page: ModulePackPage,
  sourceModule: string,
  targetModule: string
): WikiUpdatePlanEntry {
  const frontmatter = page.frontmatter as WikiPageFrontmatter;
  const slug = importedPageSlug(page, sourceModule, targetModule);
  const sourceBody = page.body.trim();
  const title = retitleImportedPage(page, sourceModule, targetModule);
  const remappedModules = remapModules(frontmatter.modules, sourceModule, targetModule);
  return {
    type: page.type,
    title,
    slug,
    status: "proposed",
    modules: remappedModules,
    files: frontmatter.files,
    tags: unique(["module-import", ...(frontmatter.tags ?? [])]),
    severity: frontmatter.severity,
    risk: frontmatter.risk,
    source: "manual",
    summary:
      sourceModule === targetModule
        ? `Imported from module pack for ${targetModule}.`
        : `Imported from module pack for ${sourceModule} as ${targetModule}.`,
    body: `${sourceBody}\n\n## Porting Notes\n\nImported from a module pack. Source module: ${sourceModule}. Target module: ${targetModule}. Review source assumptions before treating this as active target-project memory.\n`
  };
}

function typeDirectory(type: WikiUpdatePlanEntry["type"]): string {
  const dirs: Record<WikiUpdatePlanEntry["type"], string> = {
    module: "modules",
    pitfall: "pitfalls",
    decision: "decisions",
    pattern: "patterns",
    rule: "rules"
  };
  return dirs[type];
}

function plannedWikiPath(entry: WikiUpdatePlanEntry): string {
  const slug = entry.slug ?? safeSlug(entry.title);
  return `wiki/${typeDirectory(entry.type)}/${slug}.md`;
}

function importRisk(
  severity: ModuleImportRiskSeverity,
  code: ModuleImportRiskCode,
  message: string,
  source?: string,
  target?: string
): ModuleImportRisk {
  return { severity, code, message, source, target };
}

function titleTokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/u)
      .filter((token) => token.length > 2)
  );
}

function hasTokenOverlap(left: string, right: string): boolean {
  const leftTokens = titleTokens(left);
  const rightTokens = titleTokens(right);
  return [...leftTokens].some((token) => rightTokens.has(token));
}

async function detectModuleImportRisks(
  rootDir: string,
  pack: ModulePack,
  targetModule: string,
  updatePlanDraft: WikiUpdatePlan
): Promise<ModuleImportRisk[]> {
  const pages = await scanWikiPages(rootDir);
  const pageByPath = new Map(pages.map((page) => [`wiki/${page.relativePath}`, page]));
  const risks: ModuleImportRisk[] = [];

  for (const entry of updatePlanDraft.entries) {
    const targetPath = plannedWikiPath(entry);
    const existing = pageByPath.get(targetPath);
    if (existing) {
      risks.push(
        importRisk(
          "warning",
          "existing_page",
          `Import would target an existing ${entry.type} page and apply would skip it unless explicit append semantics are added.`,
          entry.title,
          targetPath
        )
      );
    }
  }

  for (const page of pages.filter((item) => item.frontmatter.type === "module")) {
    const title = pageTitle(page);
    const modules = page.frontmatter.modules ?? [];
    const exactMatch =
      normalizeModuleName(title) === normalizeModuleName(targetModule) ||
      modules.some((moduleName) => normalizeModuleName(moduleName) === normalizeModuleName(targetModule));
    const nearMatch =
      !exactMatch &&
      (hasTokenOverlap(title, targetModule) ||
        modules.some((moduleName) => hasTokenOverlap(moduleName, targetModule)));

    if (exactMatch || nearMatch) {
      risks.push(
        importRisk(
          exactMatch ? "warning" : "info",
          "similar_module",
          exactMatch
            ? `Target module ${targetModule} already has module memory.`
            : `Target module ${targetModule} looks similar to existing module memory.`,
          `wiki/${page.relativePath}`,
          targetModule
        )
      );
    }
  }

  const activeRules = pages.filter(
    (page) =>
      page.frontmatter.type === "rule" &&
      (page.frontmatter.status ?? "active") === "active"
  );
  const importedRules = updatePlanDraft.entries.filter((entry) => entry.type === "rule");
  for (const importedRule of importedRules) {
    for (const activeRule of activeRules) {
      if (hasTokenOverlap(importedRule.title, pageTitle(activeRule))) {
        risks.push(
          importRisk(
            "warning",
            "possible_rule_conflict",
            `Imported rule "${importedRule.title}" may overlap an active target-project rule.`,
            importedRule.title,
            `wiki/${activeRule.relativePath}`
          )
        );
      }
    }
  }

  for (const page of pack.pages) {
    for (const match of sourceSpecificTextMatches(page.body)) {
      risks.push(
        importRisk(
          "info",
          "source_specific_assumption",
          `Imported page contains a ${match}; review before applying as target-project memory.`,
          `pack:${page.relativePath}`
        )
      );
    }
  }

  return risks.sort((left, right) =>
    `${left.severity}:${left.code}:${left.source ?? ""}:${left.target ?? ""}`.localeCompare(
      `${right.severity}:${right.code}:${right.source ?? ""}:${right.target ?? ""}`
    )
  );
}

async function writeOutputPlan(
  rootDir: string,
  outputPlan: string | undefined,
  plan: WikiUpdatePlan,
  force: boolean
): Promise<string | undefined> {
  if (!outputPlan) {
    return undefined;
  }

  return writeProjectOutput(
    rootDir,
    outputPlan,
    `${JSON.stringify(plan, null, 2)}\n`,
    force,
    `Refusing to overwrite existing output plan: ${outputPlan}`
  );
}

export async function generateModuleImportPreview(
  rootDir: string,
  packPath: string,
  options: ModulePackImportOptions = {}
): Promise<ModulePackImportResult> {
  const config = await loadAIWikiConfig(rootDir);
  const pack = await readModulePackFile(packPath);
  const sourceModule = pack.module;
  const targetModule = options.as
    ? parseTargetModuleName(options.as)
    : sourceModule;
  const updatePlanDraft: WikiUpdatePlan = {
    version: AIWIKI_VERSION,
    title:
      sourceModule === targetModule
        ? `Import ${sourceModule} module memory from ${pack.sourceProject}`
        : `Import ${sourceModule} module memory from ${pack.sourceProject} as ${targetModule}`,
    entries: pack.pages.map((page) =>
      packPageToPlanEntry(page, sourceModule, targetModule)
    )
  };
  const guidance = [
    ...pack.portability.architectureBoundaries,
    ...pack.portability.hardcodingRisks,
    ...pack.portability.portabilityChecklist
  ];
  const risks = await detectModuleImportRisks(
    rootDir,
    pack,
    targetModule,
    updatePlanDraft
  );
  const preview: ModuleImportPreview = {
    sourceProject: pack.sourceProject,
    targetProject: config.projectName,
    sourceModule,
    targetModule,
    module: targetModule,
    targetStack: options.targetStack,
    pages: pack.pages,
    files: pack.files,
    guidance,
    risks,
    updatePlanDraft
  };
  const outputPlanPath = await writeOutputPlan(
    rootDir,
    options.outputPlan,
    updatePlanDraft,
    options.force ?? false
  );
  const markdown = formatModuleImportPreviewMarkdown(preview);
  const json = importPreviewToJson(preview);

  return { preview, markdown, json, outputPlanPath };
}

export async function generateModuleMemoryBrief(
  rootDir: string,
  moduleName: string,
  task: string
): Promise<ModuleMemoryBriefResult> {
  const config = await loadAIWikiConfig(rootDir);
  const pages = pagesForModule(await scanWikiPages(rootDir), moduleName);
  const files = packFiles(pages);
  const portability = await generateArchitectureBriefContext(rootDir, task, {
    modules: [moduleName],
    highRiskFiles: files,
    ignorePatterns: config.ignore
  });
  const guidance = [
    ...portability.architectureBoundaries,
    ...portability.hardcodingRisks,
    ...portability.portabilityChecklist
  ];
  const brief: ModuleMemoryBrief = {
    module: moduleName,
    task,
    projectName: config.projectName,
    pages,
    files,
    guidance,
    sections: [
      {
        title: "Porting Mode",
        items: [
          "Adapt old module experience to this project. Do not copy source code directly.",
          "Port module contracts, rules, pitfalls, configuration needs, and tests into the target implementation."
        ]
      },
      {
        title: "Module Pages",
        items: pageList(pages, "module")
      },
      {
        title: "Rules",
        items: pageList(pages, "rule")
      },
      {
        title: "Pitfalls",
        items: pageList(pages, "pitfall")
      },
      {
        title: "Decisions",
        items: pageList(pages, "decision")
      },
      {
        title: "Patterns",
        items: pageList(pages, "pattern")
      },
      {
        title: "Source Files To Inspect",
        items: files
      },
      {
        title: "Portability Guidance",
        items: guidance
      }
    ]
  };
  const markdown = formatModuleMemoryBriefMarkdown(brief);
  const json = moduleBriefToJson(brief);

  return { brief, markdown, json };
}

export async function lintModuleMemory(
  rootDir: string,
  moduleName: string
): Promise<ModuleLintResult> {
  await loadAIWikiConfig(rootDir);
  const pages = pagesForModule(await scanWikiPages(rootDir), moduleName);
  const issues: ModuleLintIssue[] = [];

  if (pages.length === 0) {
    issues.push(
      lintIssue(
        "warning",
        "no_module_memory",
        `No module memory found for ${moduleName}. Add a module page before relying on module brief or migration workflows.`
      )
    );
  }

  if (pages.length > 0 && !pages.some(pageHasPortabilityNotes)) {
    issues.push(
      lintIssue(
        "warning",
        "missing_portability_notes",
        "Module memory is missing portability notes for cross-project reuse."
      )
    );
  }

  if (pages.length > 0 && packFiles(pages).length === 0) {
    issues.push(
      lintIssue(
        "info",
        "missing_file_refs",
        "Module memory has no source file references; add files when they help future guards and migration briefs."
      )
    );
  }

  if (pages.length > 0 && !pages.some(pageHasTestNotes)) {
    issues.push(
      lintIssue(
        "warning",
        "missing_tests",
        "Module memory is missing tests, acceptance checks, or verification notes."
      )
    );
  }

  for (const page of pages) {
    for (const match of sourceSpecificMatches(page)) {
      issues.push(
        lintIssue(
          "warning",
          "source_specific_assumption",
          `Page contains a ${match}; document whether it is portable or source-project specific.`,
          `wiki/${page.relativePath}`
        )
      );
    }

    const tags = Array.isArray(page.frontmatter.tags)
      ? page.frontmatter.tags.filter((item): item is string => typeof item === "string")
      : [];
    const imported = tags.includes("module-import") || /Imported from a module pack/iu.test(page.body);
    if (page.type === "rule" && page.frontmatter.status === "active" && imported) {
      issues.push(
        lintIssue(
          "warning",
          "active_imported_rule",
          "Imported module rule is active; keep imported memory proposed until reviewed through apply --confirm or manual review.",
          `wiki/${page.relativePath}`
        )
      );
    }
  }

  const report: ModuleLintReport = {
    module: moduleName,
    summary: {
      pages: pages.length,
      warnings: issues.filter((issue) => issue.severity === "warning").length,
      info: issues.filter((issue) => issue.severity === "info").length
    },
    issues
  };
  const markdown = formatModuleLintMarkdown(report);
  const json = moduleLintToJson(report);

  return { report, markdown, json };
}
