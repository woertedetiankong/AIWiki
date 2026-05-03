import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadAIWikiConfig } from "./config.js";
import { AIWIKI_VERSION } from "./constants.js";
import { parseMarkdown } from "./markdown.js";
import { resolveProjectPath } from "./paths.js";
import { normalizeRawNoteSourcePath, saveRawNote } from "./raw-notes.js";
import { searchWikiMemory } from "./search.js";
import type { SearchResult } from "./search.js";
import type { WikiUpdatePlan, WikiUpdatePlanEntry } from "./apply.js";
import type { WikiPage } from "./types.js";

export interface IngestOptions {
  force?: boolean;
  limit?: number;
  outputPlan?: string;
}

export interface IngestSection {
  title: string;
  items: string[];
}

export interface IngestPreview {
  sourcePath: string;
  rawNotePath: string;
  selectedDocs: string[];
  outputPlanPath?: string;
  updatePlanDraft?: WikiUpdatePlan;
  sections: IngestSection[];
}

export interface IngestResult {
  preview: IngestPreview;
  markdown: string;
  json: string;
  rawNotePath: string;
}

const DEFAULT_INGEST_LIMIT = 8;
const MAX_SEARCH_TEXT = 800;

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function safeSlug(value: string, fallbackValue: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");
  if (slug.length > 0) {
    return slug;
  }

  let hash = 0;
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) % 100000;
  }

  return `${fallbackValue}-${hash}`;
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

function firstHeading(body: string): string | undefined {
  return body
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("#"))
    ?.replace(/^#+\s*/u, "")
    .trim();
}

function firstBodyLine(body: string): string | undefined {
  return body
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("#"));
}

function pageTitle(page: WikiPage): string {
  if (page.frontmatter.title && page.frontmatter.title.trim().length > 0) {
    return page.frontmatter.title;
  }

  const heading = page.body
    .split("\n")
    .find((line) => line.trim().startsWith("#"));

  return heading ? heading.replace(/^#+\s*/u, "").trim() : page.relativePath;
}

function pageSlug(page: WikiPage): string {
  return page.relativePath.split("/").at(-1)?.replace(/\.md$/u, "") ?? safeSlug(pageTitle(page), "page");
}

function frontmatterList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function inferTags(raw: string): string[] {
  const value = raw.toLowerCase();
  const tags = [
    "auth",
    "payment",
    "stripe",
    "database",
    "migration",
    "test",
    "security",
    "cli",
    "markdown"
  ];
  return tags.filter((tag) => value.includes(tag));
}

function includesAny(value: string, words: string[]): boolean {
  const normalizedValue = value.toLowerCase();
  return words.some((word) => normalizedValue.includes(word));
}

function appendEntryForPage(
  page: WikiPage,
  title: string,
  excerpt: string | undefined,
  rawNotePath: string
): WikiUpdatePlanEntry {
  return {
    type: page.frontmatter.type as WikiUpdatePlanEntry["type"],
    title: pageTitle(page),
    slug: pageSlug(page),
    source: "ingest",
    append: [
      {
        heading: "Ingested Note",
        body: [
          `Source note: ${rawNotePath}.`,
          `Candidate summary: ${title}.`,
          excerpt,
          "Review this append section before confirming the wiki update."
        ].filter(Boolean).join("\n\n")
      }
    ]
  };
}

function entryTypeForNote(raw: string): WikiUpdatePlanEntry["type"] {
  if (includesAny(raw, ["decision", "decided", "choose", "chose", "决定", "选择"])) {
    return "decision";
  }
  if (includesAny(raw, ["pattern", "reuse", "reusable", "模式", "复用"])) {
    return "pattern";
  }
  if (includesAny(raw, ["must", "never", "always", "required", "必须", "不要", "总是"])) {
    return "rule";
  }
  return "pitfall";
}

function severityForNote(raw: string): WikiUpdatePlanEntry["severity"] {
  if (includesAny(raw, ["critical", "security", "secret", "token", "auth", "payment", "webhook", "严重", "安全"])) {
    return "critical";
  }
  if (includesAny(raw, ["bug", "error", "failed", "pitfall", "错误", "失败", "踩坑"])) {
    return "high";
  }
  return "medium";
}

function buildIngestUpdatePlanDraft(
  title: string,
  raw: string,
  rawNotePath: string,
  modules: string[],
  files: string[],
  tags: string[],
  excerpt: string | undefined,
  results: SearchResult[]
): WikiUpdatePlan {
  const existingPages = results
    .map((result) => result.page)
    .filter((page) =>
      page.frontmatter.type === "pitfall" ||
      page.frontmatter.type === "decision" ||
      page.frontmatter.type === "pattern" ||
      page.frontmatter.type === "rule" ||
      page.frontmatter.type === "module"
    )
    .slice(0, 3);
  const entries: WikiUpdatePlanEntry[] = existingPages.map((page) =>
    appendEntryForPage(page, title, excerpt, rawNotePath)
  );

  if (entries.length === 0) {
    const type = entryTypeForNote(raw);
    entries.push({
      type,
      title,
      slug: safeSlug(title, type),
      source: "ingest",
      status: type === "rule" ? "proposed" : "active",
      modules,
      files,
      tags,
      severity: type === "pitfall" || type === "rule" ? severityForNote(raw) : undefined,
      frontmatter: {
        source_notes: [rawNotePath]
      },
      summary: excerpt ?? `Candidate imported from ${rawNotePath}.`
    });
  }

  return {
    version: AIWIKI_VERSION,
    title: `Ingest: ${title}`,
    entries
  };
}

function fallback(items: string[], value: string): string[] {
  return items.length > 0 ? items : [value];
}

function section(title: string, items: string[]): IngestSection {
  return { title, items };
}

function formatSection(value: IngestSection): string {
  return `## ${value.title}\n${value.items.map((item) => `- ${item}`).join("\n")}`;
}

export function formatIngestPreviewMarkdown(preview: IngestPreview): string {
  const draftLine = preview.updatePlanDraft
    ? preview.outputPlanPath
      ? `- Update plan draft entries: ${preview.updatePlanDraft.entries.length}. Saved to ${preview.outputPlanPath}. Run \`aiwiki apply ${preview.outputPlanPath}\`, then \`aiwiki apply ${preview.outputPlanPath} --confirm\` after review.`
      : `- Update plan draft entries: ${preview.updatePlanDraft.entries.length}. Save with \`--output-plan <path>\` or save the JSON output, then run \`aiwiki apply <plan.json>\` before \`--confirm\`.`
    : "- No update plan draft was generated.";
  return [
    `# Ingest Preview: ${preview.sourcePath}`,
    "",
    ...preview.sections.flatMap((value) => [formatSection(value), ""]),
    "## Update Plan Draft",
    draftLine,
    "",
    "## Safety",
    "- The raw source note was preserved without creating structured wiki pages.",
    "- Review these suggestions before adding pitfalls, modules, decisions, patterns, or rules."
  ].join("\n").trimEnd() + "\n";
}

function ingestToJson(preview: IngestPreview): string {
  return `${JSON.stringify(preview, null, 2)}\n`;
}

async function writeOutputPlanFile(
  rootDir: string,
  outputPlan: string,
  plan: WikiUpdatePlan,
  force: boolean
): Promise<string> {
  const outputPath = resolveProjectPath(rootDir, outputPlan);
  if (!force && (await pathExists(outputPath))) {
    throw new Error(`Refusing to overwrite existing output plan: ${outputPlan}`);
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  return outputPath;
}

async function assertOutputPlanWritable(
  rootDir: string,
  outputPlan: string | undefined,
  force: boolean
): Promise<void> {
  if (!outputPlan) {
    return;
  }

  const outputPath = resolveProjectPath(rootDir, outputPlan);
  if (!force && (await pathExists(outputPath))) {
    throw new Error(`Refusing to overwrite existing output plan: ${outputPlan}`);
  }
}

export async function generateIngestPreview(
  rootDir: string,
  sourcePath: string,
  options: IngestOptions = {}
): Promise<IngestResult> {
  await loadAIWikiConfig(rootDir);
  await assertOutputPlanWritable(
    rootDir,
    options.outputPlan,
    options.force ?? false
  );
  const normalizedSourcePath = normalizeRawNoteSourcePath(rootDir, sourcePath);
  const sourceAbsolutePath = resolveProjectPath(rootDir, normalizedSourcePath);
  const raw = await readFile(sourceAbsolutePath, "utf8");
  const parsed = parseMarkdown<Record<string, unknown>>(raw);
  const title =
    typeof parsed.frontmatter.title === "string"
      ? parsed.frontmatter.title
      : firstHeading(parsed.body) ?? path.basename(normalizedSourcePath);
  const modules = frontmatterList(parsed.frontmatter.modules);
  const files = frontmatterList(parsed.frontmatter.files);
  const tags = unique([
    ...frontmatterList(parsed.frontmatter.tags),
    ...inferTags(raw)
  ]);
  const savedRawNote = await saveRawNote(rootDir, normalizedSourcePath, raw, {
    force: options.force
  });
  const rawNotePath = savedRawNote.rawNotePath;

  const query = unique([
    title,
    ...modules,
    ...files,
    ...tags,
    parsed.body.slice(0, MAX_SEARCH_TEXT).replace(/\s+/gu, " ")
  ]).join(" ");
  const search = await searchWikiMemory(rootDir, query, {
    limit: options.limit ?? DEFAULT_INGEST_LIMIT
  });
  const selectedDocs = search.results.map(
    (result) => `wiki/${result.page.relativePath}`
  );
  const excerpt = firstBodyLine(parsed.body);

  const preview: IngestPreview = {
    sourcePath: normalizedSourcePath,
    rawNotePath,
    selectedDocs,
    updatePlanDraft: buildIngestUpdatePlanDraft(
      title,
      raw,
      rawNotePath,
      modules,
      files,
      tags,
      excerpt,
      search.results
    ),
    sections: [
      section("Source Summary", [
        `Title: ${title}`,
        excerpt ? `First note line: ${excerpt}` : "No note body summary detected.",
        `Raw source copied to ${rawNotePath}.`
      ]),
      section(
        "Possible Modules",
        fallback(
          unique([
            ...modules,
            ...search.results.flatMap((result) => result.page.frontmatter.modules ?? [])
          ]),
          "No module candidates detected."
        )
      ),
      section(
        "Possible Pitfalls",
        [
          "If this note describes a repeatable failure mode, create or update a pitfall page.",
          "Keep one-off chronological details in raw notes unless they help future edits."
        ]
      ),
      section(
        "Possible Decisions",
        [
          "If this note records an architecture or product choice, create or update a decision page.",
          "Do not deprecate older decisions without explicit confirmation."
        ]
      ),
      section(
        "Possible Patterns",
        [
          "If this note contains a reusable implementation shape, create or update a pattern page."
        ]
      ),
      section(
        "Possible Rules",
        [
          "Only promote a rule when the lesson is stable, repeated, and important for future AI coding sessions."
        ]
      ),
      section(
        "Related Existing Memory",
        fallback(selectedDocs, "No related wiki pages found.")
      ),
      section(
        "Confirmed Apply Workflow",
        [
          "Convert accepted suggestions into a WikiUpdatePlan JSON file.",
          "Run `aiwiki apply <plan.json>` to preview exact file operations.",
          "Run `aiwiki apply <plan.json> --confirm` only after reviewing the preview."
        ]
      )
    ]
  };

  if (options.outputPlan && preview.updatePlanDraft) {
    preview.outputPlanPath = await writeOutputPlanFile(
      rootDir,
      options.outputPlan,
      preview.updatePlanDraft,
      options.force ?? false
    );
  }

  const markdown = formatIngestPreviewMarkdown(preview);
  const json = ingestToJson(preview);
  return { preview, markdown, json, rawNotePath };
}
