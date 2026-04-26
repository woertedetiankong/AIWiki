import { appendFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  AIWIKI_VERSION,
  INDEX_PATH,
  WIKI_DIR
} from "./constants.js";
import { loadAIWikiConfig } from "./config.js";
import { buildWikiGraph } from "./graph.js";
import { appendLogEntry } from "./log.js";
import { formatMarkdown } from "./markdown.js";
import { resolveProjectPath } from "./paths.js";
import type {
  AIWikiConfig,
  WikiPage,
  WikiPageFrontmatter,
  WikiPageStatus
} from "./types.js";
import { parseWikiPageFrontmatter } from "./wiki-frontmatter.js";
import { scanWikiPages } from "./wiki-store.js";

const wikiUpdatePageTypeSchema = z.enum([
  "module",
  "pitfall",
  "decision",
  "pattern",
  "rule"
]);

const wikiUpdateStatusSchema = z.enum([
  "active",
  "deprecated",
  "proposed",
  "uncertain"
]);

const wikiUpdateRiskLevelSchema = z.enum([
  "low",
  "medium",
  "high",
  "critical"
]);

const safeSlugSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, {
    message: "Slug must be kebab-case with lowercase letters, numbers, and hyphens."
  });

const appendSectionSchema = z.object({
  heading: z.string().min(1),
  body: z.string().min(1)
});

export const wikiUpdatePlanEntrySchema = z.object({
  type: wikiUpdatePageTypeSchema,
  title: z.string().min(1),
  slug: safeSlugSchema.optional(),
  status: wikiUpdateStatusSchema.optional(),
  modules: z.array(z.string().min(1)).optional(),
  files: z.array(z.string().min(1)).optional(),
  tags: z.array(z.string().min(1)).optional(),
  severity: wikiUpdateRiskLevelSchema.optional(),
  risk: wikiUpdateRiskLevelSchema.optional(),
  frontmatter: z.record(z.string(), z.unknown()).optional(),
  summary: z.string().optional(),
  body: z.string().optional(),
  append: z.array(appendSectionSchema).optional()
});

export const wikiUpdatePlanSchema = z.object({
  version: z.string().optional(),
  title: z.string().optional(),
  entries: z.array(wikiUpdatePlanEntrySchema).min(1)
});

export type WikiUpdatePageType = z.infer<typeof wikiUpdatePageTypeSchema>;
export type WikiUpdatePlanEntry = z.infer<typeof wikiUpdatePlanEntrySchema>;
export type WikiUpdatePlan = z.infer<typeof wikiUpdatePlanSchema>;

export type WikiUpdateAction = "create" | "append" | "skip";

export interface WikiUpdateOperation {
  type: WikiUpdatePageType;
  title: string;
  path: string;
  action: WikiUpdateAction;
  reason: string;
}

export interface WikiUpdatePreview {
  projectName: string;
  planTitle?: string;
  confirmRequired: boolean;
  operations: WikiUpdateOperation[];
  safety: string[];
}

export interface WikiUpdateApplyOptions {
  confirm?: boolean;
  rebuildGraph?: boolean;
}

export interface WikiUpdateApplyResult {
  preview: WikiUpdatePreview;
  applied: boolean;
  created: string[];
  appended: string[];
  skipped: string[];
  indexUpdated: boolean;
  graphUpdated: boolean;
  markdown: string;
  json: string;
}

const TYPE_DIRS: Record<WikiUpdatePageType, string> = {
  module: "modules",
  pitfall: "pitfalls",
  decision: "decisions",
  pattern: "patterns",
  rule: "rules"
};

function compactObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined)
  ) as T;
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");

  if (!slug) {
    throw new Error(`Unable to derive a safe slug from title: ${value}`);
  }

  return safeSlugSchema.parse(slug);
}

function pagePath(entry: WikiUpdatePlanEntry): string {
  const slug = entry.slug ?? slugify(entry.title);
  return `${WIKI_DIR}/${TYPE_DIRS[entry.type]}/${slug}.md`;
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

function assertFrontmatterMatchesEntry(entry: WikiUpdatePlanEntry): void {
  const frontmatter = entry.frontmatter ?? {};
  if (frontmatter.type !== undefined && frontmatter.type !== entry.type) {
    throw new Error(
      `Frontmatter type for "${entry.title}" must match entry type "${entry.type}".`
    );
  }

  if (frontmatter.title !== undefined && frontmatter.title !== entry.title) {
    throw new Error(
      `Frontmatter title for "${entry.title}" must match entry title.`
    );
  }
}

function frontmatterForEntry(entry: WikiUpdatePlanEntry): WikiPageFrontmatter {
  assertFrontmatterMatchesEntry(entry);
  return parseWikiPageFrontmatter(
    compactObject({
      ...(entry.frontmatter ?? {}),
      type: entry.type,
      title: entry.title,
      status: entry.status,
      modules: entry.modules,
      files: entry.files,
      tags: entry.tags,
      severity: entry.severity,
      risk: entry.risk,
      last_updated: new Date().toISOString().slice(0, 10)
    })
  );
}

function defaultStatus(type: WikiUpdatePageType): WikiPageStatus {
  return type === "rule" ? "proposed" : "active";
}

function defaultHeading(type: WikiUpdatePageType, title: string): string {
  const label = type
    .split("_")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
  return `${label}: ${title}`;
}

function templateBody(entry: WikiUpdatePlanEntry): string {
  if (entry.body && entry.body.trim().length > 0) {
    return entry.body.trimEnd() + "\n";
  }

  const summary = entry.summary?.trim();
  const intro = summary ? `${summary}\n` : "";
  const heading = `# ${defaultHeading(entry.type, entry.title)}`;

  if (entry.type === "module") {
    return [
      heading,
      "",
      "## Purpose",
      "",
      intro,
      "## Current Architecture",
      "",
      "## Key Files",
      "",
      "## Known Pitfalls",
      "",
      "## Required Patterns",
      "",
      "## Recent Changes"
    ].join("\n").trimEnd() + "\n";
  }

  if (entry.type === "pitfall") {
    return [
      heading,
      "",
      "## Symptom",
      "",
      intro,
      "## Root Cause",
      "",
      "## Correct Fix",
      "",
      "## Avoid",
      "",
      "## Related",
      "",
      "## Source"
    ].join("\n").trimEnd() + "\n";
  }

  if (entry.type === "decision") {
    return [
      heading,
      "",
      "## Context",
      "",
      intro,
      "## Decision",
      "",
      "## Consequences",
      "",
      "## Related Pitfalls"
    ].join("\n").trimEnd() + "\n";
  }

  if (entry.type === "pattern") {
    return [
      heading,
      "",
      "## Use When",
      "",
      intro,
      "## Required Steps",
      "",
      "## Example Shape",
      "",
      "## Common Mistakes"
    ].join("\n").trimEnd() + "\n";
  }

  return [
    heading,
    "",
    "## Rule",
    "",
    intro,
    "## Why",
    "",
    "## Applies To",
    "",
    "## Examples"
  ].join("\n").trimEnd() + "\n";
}

function pageContent(entry: WikiUpdatePlanEntry): string {
  const frontmatter = frontmatterForEntry({
    ...entry,
    status: entry.status ?? defaultStatus(entry.type)
  });
  return formatMarkdown(frontmatter, templateBody(entry));
}

function appendContent(entry: WikiUpdatePlanEntry): string {
  return (entry.append ?? [])
    .map((section) => `\n\n## ${section.heading.trim()}\n\n${section.body.trimEnd()}\n`)
    .join("");
}

function planFromUnknown(value: unknown): WikiUpdatePlan {
  const plan = wikiUpdatePlanSchema.parse(value);
  for (const entry of plan.entries) {
    frontmatterForEntry(entry);
  }
  return plan;
}

export async function readWikiUpdatePlanFile(
  rootDir: string,
  planPath: string
): Promise<WikiUpdatePlan> {
  const raw = await readFile(resolveProjectPath(rootDir, planPath), "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Malformed update plan JSON: ${message}`);
  }

  return planFromUnknown(parsed);
}

function operationForEntry(
  rootDir: string,
  entry: WikiUpdatePlanEntry,
  exists: boolean
): WikiUpdateOperation {
  const relativePath = pagePath(entry);
  resolveProjectPath(rootDir, relativePath);

  if (!exists) {
    return {
      type: entry.type,
      title: entry.title,
      path: relativePath,
      action: "create",
      reason: "Target wiki page does not exist."
    };
  }

  if (entry.append && entry.append.length > 0) {
    return {
      type: entry.type,
      title: entry.title,
      path: relativePath,
      action: "append",
      reason: "Target wiki page exists and explicit append sections were provided."
    };
  }

  return {
    type: entry.type,
    title: entry.title,
    path: relativePath,
    action: "skip",
    reason: "Target wiki page already exists and no explicit append sections were provided."
  };
}

async function operationsForPlan(
  rootDir: string,
  plan: WikiUpdatePlan
): Promise<WikiUpdateOperation[]> {
  const operations: WikiUpdateOperation[] = [];
  for (const entry of plan.entries) {
    const relativePath = pagePath(entry);
    const absolutePath = resolveProjectPath(rootDir, relativePath);
    operations.push(
      operationForEntry(rootDir, entry, await pathExists(absolutePath))
    );
  }
  return operations;
}

export async function generateWikiUpdatePreview(
  rootDir: string,
  planInput: unknown
): Promise<WikiUpdatePreview> {
  const config = await loadAIWikiConfig(rootDir);
  const plan = planFromUnknown(planInput);
  const operations = await operationsForPlan(rootDir, plan);

  return {
    projectName: config.projectName,
    planTitle: plan.title,
    confirmRequired: true,
    operations,
    safety: [
      "Dry-run previews do not write files.",
      "Confirmed applies only create new wiki pages or append explicit sections.",
      "Existing wiki pages are never overwritten by this workflow.",
      "Agent rule files outside .aiwiki/wiki/rules are not modified."
    ]
  };
}

function titleForPage(page: WikiPage): string {
  if (page.frontmatter.title && page.frontmatter.title.trim().length > 0) {
    return page.frontmatter.title;
  }

  const heading = page.body
    .split("\n")
    .find((line) => line.trim().startsWith("#"));

  return heading ? heading.replace(/^#+\s*/u, "").trim() : page.relativePath;
}

function wikiLink(page: WikiPage): string {
  return `[[wiki/${page.relativePath}]]`;
}

function formatIndexSection(
  title: string,
  pages: WikiPage[],
  fallback: string
): string {
  const lines = pages.map((page) => `- ${wikiLink(page)} - ${titleForPage(page)}`);
  return `## ${title}\n\n${lines.length > 0 ? lines.join("\n") : `- ${fallback}`}`;
}

function formatWikiIndex(config: AIWikiConfig, pages: WikiPage[]): string {
  const sorted = [...pages].sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const byType = (type: string) =>
    sorted.filter((page) => page.frontmatter.type === type);

  return [
    `# AIWiki Index: ${config.projectName}`,
    "",
    "This index is maintained by AIWiki commands.",
    "",
    `Generated by AIWiki ${AIWIKI_VERSION}.`,
    "",
    formatIndexSection("Project Map", byType("project_map"), "No project map has been generated yet."),
    "",
    formatIndexSection("Modules", byType("module"), "No module pages yet."),
    "",
    formatIndexSection("Pitfalls", byType("pitfall"), "No pitfall pages yet."),
    "",
    formatIndexSection("Decisions", byType("decision"), "No decision pages yet."),
    "",
    formatIndexSection("Patterns", byType("pattern"), "No pattern pages yet."),
    "",
    formatIndexSection("Rules", byType("rule"), "No rule pages yet.")
  ].join("\n").trimEnd() + "\n";
}

async function regenerateIndex(rootDir: string, config: AIWikiConfig): Promise<void> {
  const pages = await scanWikiPages(rootDir);
  const indexPath = resolveProjectPath(rootDir, INDEX_PATH);
  await mkdir(path.dirname(indexPath), { recursive: true });
  await writeFile(indexPath, formatWikiIndex(config, pages), "utf8");
}

function formatOperation(operation: WikiUpdateOperation): string {
  return [
    `- ${operation.action}: ${operation.path}`,
    `  - Type: ${operation.type}`,
    `  - Title: ${operation.title}`,
    `  - Reason: ${operation.reason}`
  ].join("\n");
}

export function formatWikiUpdateApplyMarkdown(
  result: Pick<
    WikiUpdateApplyResult,
    | "preview"
    | "applied"
    | "created"
    | "appended"
    | "skipped"
    | "indexUpdated"
    | "graphUpdated"
  >
): string {
  const title = result.applied ? "# Wiki Update Applied" : "# Wiki Update Preview";
  const lines = [
    title,
    "",
    `Project: ${result.preview.projectName}`,
    result.preview.planTitle ? `Plan: ${result.preview.planTitle}` : undefined,
    `Applied: ${result.applied ? "yes" : "no"}`,
    "",
    "## Operations",
    result.preview.operations.length > 0
      ? result.preview.operations.map(formatOperation).join("\n")
      : "- No operations.",
    "",
    "## Summary",
    `- Created: ${result.created.length}`,
    `- Appended: ${result.appended.length}`,
    `- Skipped: ${result.skipped.length}`,
    `- Index Updated: ${result.indexUpdated ? "yes" : "no"}`,
    `- Graph Updated: ${result.graphUpdated ? "yes" : "no"}`,
    "",
    "## Safety",
    ...result.preview.safety.map((item) => `- ${item}`)
  ].filter((line): line is string => line !== undefined);

  return `${lines.join("\n").trimEnd()}\n`;
}

function applyToJson(
  result: Omit<WikiUpdateApplyResult, "markdown" | "json">
): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

export async function applyWikiUpdatePlan(
  rootDir: string,
  planInput: unknown,
  options: WikiUpdateApplyOptions = {}
): Promise<WikiUpdateApplyResult> {
  const config = await loadAIWikiConfig(rootDir);
  const plan = planFromUnknown(planInput);
  const preview = await generateWikiUpdatePreview(rootDir, plan);
  const created: string[] = [];
  const appended: string[] = [];
  const skipped = preview.operations
    .filter((operation) => operation.action === "skip")
    .map((operation) => operation.path);

  let indexUpdated = false;
  let graphUpdated = false;

  if (options.confirm) {
    for (const [index, entry] of plan.entries.entries()) {
      const operation = preview.operations[index];
      if (!operation || operation.action === "skip") {
        continue;
      }

      const absolutePath = resolveProjectPath(rootDir, operation.path);
      await mkdir(path.dirname(absolutePath), { recursive: true });

      if (operation.action === "create") {
        await writeFile(absolutePath, pageContent(entry), {
          encoding: "utf8",
          flag: "wx"
        });
        created.push(operation.path);
      } else {
        if (!(await pathExists(absolutePath))) {
          throw new Error(`Cannot append missing wiki page: ${operation.path}`);
        }
        await appendFile(absolutePath, appendContent(entry), "utf8");
        appended.push(operation.path);
      }
    }

    if (created.length > 0 || appended.length > 0) {
      await regenerateIndex(rootDir, config);
      indexUpdated = true;
      await appendLogEntry(rootDir, {
        action: "apply",
        title: plan.title ?? "Wiki Update Plan",
        bullets: [
          ...created.map((file) => `Created: [[${file.replace(/^\.aiwiki\//u, "")}]]`),
          ...appended.map((file) => `Appended: [[${file.replace(/^\.aiwiki\//u, "")}]]`),
          ...skipped.map((file) => `Skipped existing: [[${file.replace(/^\.aiwiki\//u, "")}]]`)
        ]
      });
    }

    if ((options.rebuildGraph ?? true) && (created.length > 0 || appended.length > 0)) {
      await buildWikiGraph(rootDir, { write: true });
      graphUpdated = true;
    }
  }

  const base = {
    preview,
    applied: options.confirm ?? false,
    created,
    appended,
    skipped,
    indexUpdated,
    graphUpdated
  };
  const markdown = formatWikiUpdateApplyMarkdown(base);
  const json = applyToJson(base);
  return { ...base, markdown, json };
}
