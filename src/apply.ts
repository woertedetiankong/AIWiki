import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  CACHE_DIR,
  WIKI_DIR
} from "./constants.js";
import { loadAIWikiConfig } from "./config.js";
import { buildWikiGraph } from "./graph.js";
import { appendLogEntry } from "./log.js";
import { formatMarkdown, readMarkdownFile } from "./markdown.js";
import { resolveProjectPath } from "./paths.js";
import type {
  WikiPageFrontmatter,
  WikiPageStatus
} from "./types.js";
import { regenerateIndex } from "./wiki-index.js";
import { parseWikiPageFrontmatter } from "./wiki-frontmatter.js";

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

const wikiUpdateSourceSchema = z.enum([
  "reflect",
  "ingest",
  "maintain",
  "promote-rules",
  "manual"
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
  source: wikiUpdateSourceSchema.optional(),
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
export type WikiUpdateSource = z.infer<typeof wikiUpdateSourceSchema>;
export type WikiUpdatePlanEntry = z.infer<typeof wikiUpdatePlanEntrySchema>;
export type WikiUpdatePlan = z.infer<typeof wikiUpdatePlanSchema>;

export type WikiUpdateAction = "create" | "append" | "skip";

export interface WikiUpdateOperation {
  type: WikiUpdatePageType;
  title: string;
  path: string;
  action: WikiUpdateAction;
  source?: WikiUpdateSource;
  reason: string;
  targetHash?: string;
  summaryPreview?: string;
  frontmatterPreview?: Record<string, unknown>;
  bodyPreview?: string;
  appendPreview?: Array<{
    heading: string;
    bodyPreview: string;
  }>;
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
  previewStateKey?: string;
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

interface ApplyPreviewState {
  version: string;
  planHash: string;
  operations: Array<{
    path: string;
    action: WikiUpdateAction;
    targetHash?: string;
  }>;
}

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

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function planHash(plan: WikiUpdatePlan): string {
  return hashText(JSON.stringify(plan));
}

async function fileHash(filePath: string): Promise<string> {
  return hashText(await readFile(filePath, "utf8"));
}

function previewStatePath(rootDir: string, stateKey: string): string {
  const safeKey = hashText(stateKey).slice(0, 24);
  return resolveProjectPath(rootDir, CACHE_DIR, "apply-previews", `${safeKey}.json`);
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

async function appendToExistingPage(
  filePath: string,
  entry: WikiUpdatePlanEntry
): Promise<void> {
  const existing = await readMarkdownFile<WikiPageFrontmatter>(filePath);
  await writeFile(
    filePath,
    formatMarkdown(
      {
        ...existing.frontmatter,
        last_updated: new Date().toISOString().slice(0, 10)
      },
      `${existing.body.trimEnd()}${appendContent(entry)}`
    ),
    "utf8"
  );
}

function previewText(value: string, maxLength = 1200): string {
  const normalized = value.trimEnd();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength).trimEnd()}\n...`;
}

function createFrontmatterPreview(entry: WikiUpdatePlanEntry): Record<string, unknown> {
  return frontmatterForEntry({
    ...entry,
    status: entry.status ?? defaultStatus(entry.type)
  }) as unknown as Record<string, unknown>;
}

function appendPreview(entry: WikiUpdatePlanEntry): WikiUpdateOperation["appendPreview"] {
  return (entry.append ?? []).map((section) => ({
    heading: section.heading.trim(),
    bodyPreview: previewText(section.body)
  }));
}

function stripMarkdownDecorators(value: string): string {
  return value
    .replace(/^#+\s*/u, "")
    .replace(/^[-*]\s+/u, "")
    .replace(/`([^`]+)`/gu, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/gu, "$1")
    .trim();
}

function summaryFromMarkdownBody(body: string | undefined): string | undefined {
  if (!body) {
    return undefined;
  }

  const line = body
    .split("\n")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .find((item) => !item.startsWith("#"));

  if (!line) {
    return undefined;
  }

  const summary = stripMarkdownDecorators(line);
  if (!summary) {
    return undefined;
  }

  return summary.length > 180 ? `${summary.slice(0, 177).trimEnd()}...` : summary;
}

function entrySummaryPreview(entry: WikiUpdatePlanEntry): string | undefined {
  return entry.summary?.trim() || summaryFromMarkdownBody(entry.body);
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
  exists: boolean,
  targetHash: string | undefined
): WikiUpdateOperation {
  const relativePath = pagePath(entry);
  resolveProjectPath(rootDir, relativePath);

  if (!exists) {
    return {
      type: entry.type,
      title: entry.title,
      path: relativePath,
      action: "create",
      source: entry.source,
      reason: "Target wiki page does not exist.",
      summaryPreview: entrySummaryPreview(entry),
      frontmatterPreview: createFrontmatterPreview(entry),
      bodyPreview: previewText(templateBody(entry))
    };
  }

  if (entry.append && entry.append.length > 0) {
    return {
      type: entry.type,
      title: entry.title,
      path: relativePath,
      action: "append",
      source: entry.source,
      reason: "Target wiki page exists and explicit append sections were provided.",
      targetHash,
      summaryPreview: entry.summary ?? summaryFromMarkdownBody(entry.append.at(0)?.body),
      appendPreview: appendPreview(entry)
    };
  }

  return {
    type: entry.type,
    title: entry.title,
    path: relativePath,
    action: "skip",
    source: entry.source,
    summaryPreview: entrySummaryPreview(entry),
    targetHash,
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
    const exists = await pathExists(absolutePath);
    operations.push(
      operationForEntry(
        rootDir,
        entry,
        exists,
        exists ? await fileHash(absolutePath) : undefined
      )
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
      "Dry-run previews do not write wiki pages.",
      "Confirmed applies only create new wiki pages or append explicit sections.",
      "Existing wiki pages are never overwritten by this workflow.",
      "Agent rule files outside .aiwiki/wiki/rules are not modified."
    ]
  };
}

function formatOperation(operation: WikiUpdateOperation): string {
  const lines = [
    `- ${operation.action}: ${operation.path}`,
    `  - Type: ${operation.type}`,
    `  - Title: ${operation.title}`,
    `  - Source: ${operation.source ?? "manual"}`,
    `  - Reason: ${operation.reason}`
  ];

  if (operation.frontmatterPreview) {
    lines.push("  - Frontmatter Preview:");
    for (const [key, value] of Object.entries(operation.frontmatterPreview)) {
      lines.push(`    - ${key}: ${JSON.stringify(value)}`);
    }
  }

  if (operation.targetHash) {
    lines.push(`  - Target Hash: ${operation.targetHash}`);
  }

  if (operation.bodyPreview) {
    lines.push("  - Body Preview:");
    lines.push("    ```md");
    lines.push(
      ...operation.bodyPreview
        .split("\n")
        .map((line) => `    ${line}`)
    );
    lines.push("    ```");
  }

  if (operation.appendPreview && operation.appendPreview.length > 0) {
    lines.push("  - Append Preview:");
    for (const section of operation.appendPreview) {
      lines.push(`    - Heading: ${section.heading}`);
      lines.push("      ```md");
      lines.push(
        ...section.bodyPreview
          .split("\n")
          .map((line) => `      ${line}`)
      );
      lines.push("      ```");
    }
  }

  return lines.join("\n");
}

function operationCount(
  operations: WikiUpdateOperation[],
  action: WikiUpdateAction
): number {
  return operations.filter((operation) => operation.action === action).length;
}

function plainTypeLabel(type: WikiUpdatePageType): string {
  if (type === "rule") {
    return "Rule to remember";
  }

  if (type === "pattern") {
    return "Reusable workflow pattern";
  }

  if (type === "module") {
    return "Module note";
  }

  if (type === "pitfall") {
    return "Pitfall to avoid";
  }

  return "Project decision";
}

function actionPhrase(action: WikiUpdateAction): string {
  if (action === "create") {
    return "Will create";
  }

  if (action === "append") {
    return "Will append to";
  }

  return "Will skip";
}

function formatPlainMemoryProposal(operation: WikiUpdateOperation): string {
  const summary = operation.summaryPreview?.trim()
    || "No short explanation was provided; review the detailed operation before confirming.";

  return [
    `- ${plainTypeLabel(operation.type)}: ${operation.title}`,
    `  - Plain meaning: ${summary}`,
    `  - ${actionPhrase(operation.action)}: ${operation.path}`
  ].join("\n");
}

function confirmationGuidance(applied: boolean): string[] {
  if (applied) {
    return [
      "This plan has been confirmed and applied.",
      "AIWiki updated the listed wiki pages, then refreshed index and graph data when writes occurred."
    ];
  }

  return [
    "This plan is a reviewable set of candidate AIWiki memory changes.",
    "The preview below shows exactly which wiki pages would be created, appended, or skipped.",
    "Nothing has been written yet; run the same apply command with `--confirm` only after reviewing the operations."
  ];
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
  const plannedCreates = operationCount(result.preview.operations, "create");
  const plannedAppends = operationCount(result.preview.operations, "append");
  const plannedSkips = operationCount(result.preview.operations, "skip");
  const lines = [
    title,
    "",
    `Project: ${result.preview.projectName}`,
    result.preview.planTitle ? `Plan: ${result.preview.planTitle}` : undefined,
    `Applied: ${result.applied ? "yes" : "no"}`,
    "",
    "## What This Plan Is",
    ...confirmationGuidance(result.applied).map((item) => `- ${item}`),
    "",
    "## Planned Changes",
    `- Create wiki pages: ${plannedCreates}`,
    `- Append existing pages: ${plannedAppends}`,
    `- Skip existing pages: ${plannedSkips}`,
    "",
    "## Memory To Save",
    result.preview.operations.length > 0
      ? result.preview.operations.map(formatPlainMemoryProposal).join("\n")
      : "- No candidate memory changes.",
    "",
    "## Confirm Only If",
    "- Each plain-language memory item above is durable project knowledge, not a one-off session note.",
    "- The listed target paths are the wiki pages you expect AIWiki to maintain.",
    "- Proposed rules are acceptable as proposed memory and can be promoted or edited later.",
    "",
    "## Operations",
    result.preview.operations.length > 0
      ? result.preview.operations.map(formatOperation).join("\n")
      : "- No operations.",
    "",
    "## Applied Results",
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

function stateForPreview(plan: WikiUpdatePlan, preview: WikiUpdatePreview): ApplyPreviewState {
  return {
    version: "1",
    planHash: planHash(plan),
    operations: preview.operations.map((operation) => ({
      path: operation.path,
      action: operation.action,
      targetHash: operation.targetHash
    }))
  };
}

async function writePreviewState(
  rootDir: string,
  stateKey: string,
  state: ApplyPreviewState
): Promise<void> {
  const filePath = previewStatePath(rootDir, stateKey);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

async function readPreviewState(
  rootDir: string,
  stateKey: string
): Promise<ApplyPreviewState | undefined> {
  try {
    return JSON.parse(
      await readFile(previewStatePath(rootDir, stateKey), "utf8")
    ) as ApplyPreviewState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}

async function assertPreviewStateFresh(
  rootDir: string,
  stateKey: string,
  plan: WikiUpdatePlan,
  preview: WikiUpdatePreview
): Promise<void> {
  const state = await readPreviewState(rootDir, stateKey);
  if (!state) {
    throw new Error(
      "Apply confirmation requires a fresh preview. Run `aiwiki apply <plan>` before `aiwiki apply <plan> --confirm`."
    );
  }

  if (state.planHash !== planHash(plan)) {
    throw new Error(
      "Apply confirmation refused because the plan changed after the last preview. Preview the plan again before confirming."
    );
  }

  for (const operation of preview.operations) {
    if (operation.action !== "append") {
      continue;
    }

    const previewed = state.operations.find((item) => item.path === operation.path);
    if (!previewed?.targetHash) {
      throw new Error(
        `Apply confirmation refused because no preview hash was recorded for ${operation.path}. Preview the plan again before confirming.`
      );
    }
    if (previewed.targetHash !== operation.targetHash) {
      throw new Error(
        `Apply confirmation refused because ${operation.path} changed after preview. Preview the plan again before confirming.`
      );
    }
  }
}

export async function applyWikiUpdatePlan(
  rootDir: string,
  planInput: unknown,
  options: WikiUpdateApplyOptions = {}
): Promise<WikiUpdateApplyResult> {
  const config = await loadAIWikiConfig(rootDir);
  const plan = planFromUnknown(planInput);
  const preview = await generateWikiUpdatePreview(rootDir, plan);
  const previewStateKey = options.previewStateKey ?? planHash(plan);
  const created: string[] = [];
  const appended: string[] = [];
  const skipped = preview.operations
    .filter((operation) => operation.action === "skip")
    .map((operation) => operation.path);

  let indexUpdated = false;
  let graphUpdated = false;

  if (!options.confirm) {
    await writePreviewState(rootDir, previewStateKey, stateForPreview(plan, preview));
  }

  if (options.confirm) {
    await assertPreviewStateFresh(rootDir, previewStateKey, plan, preview);

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
        await appendToExistingPage(absolutePath, entry);
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
