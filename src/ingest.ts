import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadAIWikiConfig } from "./config.js";
import { RAW_NOTES_DIR } from "./constants.js";
import { parseMarkdown } from "./markdown.js";
import { resolveProjectPath, toPosixPath } from "./paths.js";
import { searchWikiMemory } from "./search.js";

export interface IngestOptions {
  force?: boolean;
  limit?: number;
}

export interface IngestSection {
  title: string;
  items: string[];
}

export interface IngestPreview {
  sourcePath: string;
  rawNotePath: string;
  selectedDocs: string[];
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

function normalizeInputPath(rootDir: string, sourcePath: string): string {
  const absolutePath = resolveProjectPath(rootDir, sourcePath);
  return toPosixPath(path.relative(rootDir, absolutePath));
}

function rawNoteFileName(sourcePath: string): string {
  const parsed = path.parse(sourcePath);
  const baseName = parsed.name
    .replace(/[^a-zA-Z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .toLowerCase();
  const extension = parsed.ext || ".md";
  return `${baseName || "note"}${extension}`;
}

async function nextRawNotePath(
  rootDir: string,
  sourcePath: string,
  force: boolean
): Promise<string> {
  const fileName = rawNoteFileName(sourcePath);
  const parsed = path.parse(fileName);
  const relativePath = `${RAW_NOTES_DIR}/${fileName}`;
  const absolutePath = resolveProjectPath(rootDir, relativePath);

  if (force || !(await pathExists(absolutePath))) {
    return relativePath;
  }

  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${RAW_NOTES_DIR}/${parsed.name}-${index}${parsed.ext}`;
    if (!(await pathExists(resolveProjectPath(rootDir, candidate)))) {
      return candidate;
    }
  }

  throw new Error(`Unable to find available raw note path for ${sourcePath}`);
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
  return [
    `# Ingest Preview: ${preview.sourcePath}`,
    "",
    ...preview.sections.flatMap((value) => [formatSection(value), ""]),
    "## Safety",
    "- The raw source note was preserved without creating structured wiki pages.",
    "- Review these suggestions before adding pitfalls, modules, decisions, patterns, or rules."
  ].join("\n").trimEnd() + "\n";
}

function ingestToJson(preview: IngestPreview): string {
  return `${JSON.stringify(preview, null, 2)}\n`;
}

export async function generateIngestPreview(
  rootDir: string,
  sourcePath: string,
  options: IngestOptions = {}
): Promise<IngestResult> {
  await loadAIWikiConfig(rootDir);
  const normalizedSourcePath = normalizeInputPath(rootDir, sourcePath);
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
  const rawNotePath = await nextRawNotePath(
    rootDir,
    normalizedSourcePath,
    options.force ?? false
  );
  const rawNoteAbsolutePath = resolveProjectPath(rootDir, rawNotePath);
  await mkdir(path.dirname(rawNoteAbsolutePath), { recursive: true });
  await writeFile(rawNoteAbsolutePath, raw, "utf8");

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

  const markdown = formatIngestPreviewMarkdown(preview);
  const json = ingestToJson(preview);
  return { preview, markdown, json, rawNotePath };
}
