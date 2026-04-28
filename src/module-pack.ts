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
  targetStack?: string;
  outputPlan?: string;
  force?: boolean;
}

export interface ModuleImportPreview {
  sourceProject: string;
  targetProject: string;
  module: string;
  targetStack?: string;
  pages: ModulePackPage[];
  files: string[];
  guidance: string[];
  updatePlanDraft: WikiUpdatePlan;
}

export interface ModulePackImportResult {
  preview: ModuleImportPreview;
  markdown: string;
  json: string;
  outputPlanPath?: string;
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

function packFiles(pages: ModulePackPage[]): string[] {
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

function packPageToPlanEntry(page: ModulePackPage, moduleName: string): WikiUpdatePlanEntry {
  const frontmatter = page.frontmatter as WikiPageFrontmatter;
  const slug = safeSlug(path.posix.basename(toPosixPath(page.relativePath), ".md"));
  const sourceBody = page.body.trim();
  return {
    type: page.type,
    title: page.title,
    slug,
    status: "proposed",
    modules: unique([moduleName, ...(frontmatter.modules ?? [])]),
    files: frontmatter.files,
    tags: unique(["module-import", ...(frontmatter.tags ?? [])]),
    severity: frontmatter.severity,
    risk: frontmatter.risk,
    source: "manual",
    summary: `Imported from module pack for ${moduleName}.`,
    body: `${sourceBody}\n\n## Porting Notes\n\nImported from a module pack. Review source assumptions before treating this as active target-project memory.\n`
  };
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
  const updatePlanDraft: WikiUpdatePlan = {
    version: AIWIKI_VERSION,
    title: `Import ${pack.module} module memory from ${pack.sourceProject}`,
    entries: pack.pages.map((page) => packPageToPlanEntry(page, pack.module))
  };
  const guidance = [
    ...pack.portability.architectureBoundaries,
    ...pack.portability.hardcodingRisks,
    ...pack.portability.portabilityChecklist
  ];
  const preview: ModuleImportPreview = {
    sourceProject: pack.sourceProject,
    targetProject: config.projectName,
    module: pack.module,
    targetStack: options.targetStack,
    pages: pack.pages,
    files: pack.files,
    guidance,
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
