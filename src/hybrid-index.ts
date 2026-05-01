import { createHash } from "node:crypto";
import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";
import {
  AIWIKI_VERSION,
  HYBRID_INDEX_DB_PATH,
  HYBRID_INDEX_JSONL_PATH,
  WIKI_DIR
} from "./constants.js";
import { AIWikiNotInitializedError, loadAIWikiConfig } from "./config.js";
import { resolveProjectPath } from "./paths.js";
import type { OutputFormat } from "./output.js";
import type { WikiPage, WikiPageFrontmatter } from "./types.js";
import { scanWikiPages } from "./wiki-store.js";

export interface HybridIndexOptions {
  exportJsonl?: boolean;
}

export interface HybridIndexRecord {
  relativePath: string;
  type: string;
  status: string;
  title: string;
  body: string;
  frontmatter: WikiPageFrontmatter;
  modules: string[];
  files: string[];
  tags: string[];
  severity?: string;
  risk?: string;
  lastUpdated?: string;
  sourceMtimeMs: number;
  contentHash: string;
  indexedAt: string;
}

export interface HybridIndexBuildResult {
  dbPath: string;
  jsonlPath?: string;
  indexedAt: string;
  pageCount: number;
  exportedJsonl: boolean;
}

export interface HybridIndexStatus {
  dbPath: string;
  jsonlPath: string;
  initialized: boolean;
  dbExists: boolean;
  jsonlExists: boolean;
  fresh: boolean;
  pageCount: number;
  sourcePageCount: number;
  stalePageCount: number;
  missingPageCount: number;
  extraPageCount: number;
  stalePages: string[];
  missingPages: string[];
  extraPages: string[];
  indexedAt?: string;
  schemaVersion?: string;
  error?: string;
}

const SCHEMA_VERSION = "1";

interface PageRow {
  relative_path: string;
  type: string;
  status: string;
  title: string;
  body: string;
  frontmatter_json: string;
  source_mtime_ms: number;
  content_hash: string;
  indexed_at: string;
}

interface PageFingerprintRow {
  relative_path: string;
  content_hash: string;
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
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

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return unique(
    value
      .map((item) => (typeof item === "string" ? item.trim() : undefined))
      .filter((item): item is string => Boolean(item))
  );
}

function frontmatterValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function pageContentHash(page: WikiPage): string {
  return createHash("sha256")
    .update(page.relativePath)
    .update("\n")
    .update(JSON.stringify(page.frontmatter))
    .update("\n")
    .update(page.body)
    .digest("hex");
}

async function recordForPage(
  page: WikiPage,
  indexedAt: string
): Promise<HybridIndexRecord> {
  const sourceStat = await stat(page.path);
  const modules = asStringArray(page.frontmatter.modules);
  const files = asStringArray(page.frontmatter.files);
  const tags = asStringArray(page.frontmatter.tags);

  return {
    relativePath: page.relativePath,
    type: page.frontmatter.type,
    status: page.frontmatter.status ?? "active",
    title: titleForPage(page),
    body: page.body,
    frontmatter: page.frontmatter,
    modules,
    files,
    tags,
    severity: frontmatterValue(page.frontmatter.severity),
    risk: frontmatterValue(page.frontmatter.risk),
    lastUpdated: frontmatterValue(page.frontmatter.last_updated),
    sourceMtimeMs: sourceStat.mtimeMs,
    contentHash: pageContentHash(page),
    indexedAt
  };
}

async function recordsForCurrentWiki(
  rootDir: string,
  indexedAt: string
): Promise<HybridIndexRecord[]> {
  const pages = await scanWikiPages(rootDir);
  return Promise.all(
    pages
      .slice()
      .sort((a, b) => a.relativePath.localeCompare(b.relativePath))
      .map((page) => recordForPage(page, indexedAt))
  );
}

function indexDbPath(rootDir: string): string {
  return resolveProjectPath(rootDir, HYBRID_INDEX_DB_PATH);
}

function indexJsonlPath(rootDir: string): string {
  return resolveProjectPath(rootDir, HYBRID_INDEX_JSONL_PATH);
}

function initializeSchema(db: Database.Database): void {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS wiki_pages (
      relative_path TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      frontmatter_json TEXT NOT NULL,
      modules_json TEXT NOT NULL,
      files_json TEXT NOT NULL,
      tags_json TEXT NOT NULL,
      severity TEXT,
      risk TEXT,
      last_updated TEXT,
      source_mtime_ms REAL NOT NULL,
      content_hash TEXT NOT NULL,
      indexed_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_wiki_pages_type ON wiki_pages(type);
    CREATE INDEX IF NOT EXISTS idx_wiki_pages_status ON wiki_pages(status);
    CREATE INDEX IF NOT EXISTS idx_wiki_pages_hash ON wiki_pages(content_hash);

    CREATE TABLE IF NOT EXISTS wiki_page_modules (
      relative_path TEXT NOT NULL,
      module TEXT NOT NULL,
      PRIMARY KEY (relative_path, module),
      FOREIGN KEY (relative_path) REFERENCES wiki_pages(relative_path) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_wiki_page_modules_module ON wiki_page_modules(module);

    CREATE TABLE IF NOT EXISTS wiki_page_files (
      relative_path TEXT NOT NULL,
      file_path TEXT NOT NULL,
      PRIMARY KEY (relative_path, file_path),
      FOREIGN KEY (relative_path) REFERENCES wiki_pages(relative_path) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_wiki_page_files_file ON wiki_page_files(file_path);

    CREATE TABLE IF NOT EXISTS wiki_page_tags (
      relative_path TEXT NOT NULL,
      tag TEXT NOT NULL,
      PRIMARY KEY (relative_path, tag),
      FOREIGN KEY (relative_path) REFERENCES wiki_pages(relative_path) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_wiki_page_tags_tag ON wiki_page_tags(tag);

    CREATE VIRTUAL TABLE IF NOT EXISTS wiki_pages_fts USING fts5(
      relative_path UNINDEXED,
      title,
      body,
      frontmatter_json
    );
  `);
}

function resetIndexTables(db: Database.Database): void {
  db.exec(`
    DELETE FROM wiki_pages_fts;
    DELETE FROM wiki_page_tags;
    DELETE FROM wiki_page_files;
    DELETE FROM wiki_page_modules;
    DELETE FROM wiki_pages;
  `);
}

function insertRecords(db: Database.Database, records: HybridIndexRecord[]): void {
  const insertPage = db.prepare(`
    INSERT INTO wiki_pages (
      relative_path,
      type,
      status,
      title,
      body,
      frontmatter_json,
      modules_json,
      files_json,
      tags_json,
      severity,
      risk,
      last_updated,
      source_mtime_ms,
      content_hash,
      indexed_at
    ) VALUES (
      @relativePath,
      @type,
      @status,
      @title,
      @body,
      @frontmatterJson,
      @modulesJson,
      @filesJson,
      @tagsJson,
      @severity,
      @risk,
      @lastUpdated,
      @sourceMtimeMs,
      @contentHash,
      @indexedAt
    )
  `);
  const insertFts = db.prepare(`
    INSERT INTO wiki_pages_fts (relative_path, title, body, frontmatter_json)
    VALUES (?, ?, ?, ?)
  `);
  const insertModule = db.prepare(`
    INSERT INTO wiki_page_modules (relative_path, module) VALUES (?, ?)
  `);
  const insertFile = db.prepare(`
    INSERT INTO wiki_page_files (relative_path, file_path) VALUES (?, ?)
  `);
  const insertTag = db.prepare(`
    INSERT INTO wiki_page_tags (relative_path, tag) VALUES (?, ?)
  `);

  const transaction = db.transaction(() => {
    resetIndexTables(db);
    for (const record of records) {
      const frontmatterJson = JSON.stringify(record.frontmatter);
      insertPage.run({
        ...record,
        frontmatterJson,
        modulesJson: JSON.stringify(record.modules),
        filesJson: JSON.stringify(record.files),
        tagsJson: JSON.stringify(record.tags),
        severity: record.severity ?? null,
        risk: record.risk ?? null,
        lastUpdated: record.lastUpdated ?? null
      });
      insertFts.run(record.relativePath, record.title, record.body, frontmatterJson);
      for (const moduleName of record.modules) {
        insertModule.run(record.relativePath, moduleName);
      }
      for (const filePath of record.files) {
        insertFile.run(record.relativePath, filePath);
      }
      for (const tag of record.tags) {
        insertTag.run(record.relativePath, tag);
      }
    }

    db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)").run(
      "schema_version",
      SCHEMA_VERSION
    );
    db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)").run(
      "aiwiki_version",
      AIWIKI_VERSION
    );
    db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)").run(
      "indexed_at",
      records[0]?.indexedAt ?? new Date().toISOString()
    );
    db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)").run(
      "page_count",
      String(records.length)
    );
  });

  transaction();
}

async function writeJsonlSnapshot(
  jsonlPath: string,
  records: HybridIndexRecord[]
): Promise<void> {
  await mkdir(path.dirname(jsonlPath), { recursive: true });
  const tmpPath = `${jsonlPath}.${process.pid}.tmp`;
  const content = records
    .map((record) => JSON.stringify(record))
    .join("\n");
  await writeFile(tmpPath, content.length > 0 ? `${content}\n` : "", "utf8");
  await rename(tmpPath, jsonlPath);
}

export async function buildHybridIndex(
  rootDir: string,
  options: HybridIndexOptions = {}
): Promise<HybridIndexBuildResult> {
  await loadAIWikiConfig(rootDir);
  const indexedAt = new Date().toISOString();
  const records = await recordsForCurrentWiki(rootDir, indexedAt);
  const dbPath = indexDbPath(rootDir);
  const jsonlPath = indexJsonlPath(rootDir);

  await mkdir(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  try {
    initializeSchema(db);
    insertRecords(db, records);
  } finally {
    db.close();
  }

  const shouldExportJsonl = options.exportJsonl !== false;
  if (shouldExportJsonl) {
    await writeJsonlSnapshot(jsonlPath, records);
  }

  return {
    dbPath,
    jsonlPath: shouldExportJsonl ? jsonlPath : undefined,
    indexedAt,
    pageCount: records.length,
    exportedJsonl: shouldExportJsonl
  };
}

function readMetadata(db: Database.Database, key: string): string | undefined {
  const row = db
    .prepare("SELECT value FROM metadata WHERE key = ?")
    .get(key) as { value?: string } | undefined;
  return row?.value;
}

function formatLimitedList(values: string[], limit = 10): string[] {
  if (values.length <= limit) {
    return values.map((value) => `- ${value}`);
  }

  return [
    ...values.slice(0, limit).map((value) => `- ${value}`),
    `- ${values.length - limit} more item(s) omitted.`
  ];
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

export async function getHybridIndexStatus(rootDir: string): Promise<HybridIndexStatus> {
  const dbPath = indexDbPath(rootDir);
  const jsonlPath = indexJsonlPath(rootDir);
  let initialized = true;
  try {
    await loadAIWikiConfig(rootDir);
  } catch (error) {
    if (!(error instanceof AIWikiNotInitializedError)) {
      throw error;
    }
    initialized = false;
  }
  const dbExists = await pathExists(dbPath);
  const jsonlExists = await pathExists(jsonlPath);
  const sourceRecords = await recordsForCurrentWiki(rootDir, new Date().toISOString());
  const sourceByPath = new Map(
    sourceRecords.map((record) => [record.relativePath, record])
  );

  if (!dbExists) {
    return {
      dbPath,
      jsonlPath,
      initialized,
      dbExists,
      jsonlExists,
      fresh: false,
      pageCount: 0,
      sourcePageCount: sourceRecords.length,
      stalePageCount: 0,
      missingPageCount: sourceRecords.length,
      extraPageCount: 0,
      stalePages: [],
      missingPages: sourceRecords.map((record) => record.relativePath),
      extraPages: []
    };
  }

  const db = new Database(dbPath, { readonly: true });
  try {
    const pageCountRow = db
      .prepare("SELECT count(*) AS count FROM wiki_pages")
      .get() as { count: number };
    const indexedRows = db
      .prepare("SELECT relative_path, content_hash FROM wiki_pages ORDER BY relative_path")
      .all() as PageFingerprintRow[];
    const indexedByPath = new Map(
      indexedRows.map((row) => [row.relative_path, row.content_hash])
    );
    const missingPages = sourceRecords
      .filter((record) => !indexedByPath.has(record.relativePath))
      .map((record) => record.relativePath);
    const extraPages = indexedRows
      .filter((row) => !sourceByPath.has(row.relative_path))
      .map((row) => row.relative_path);
    const stalePages = sourceRecords
      .filter((record) => indexedByPath.get(record.relativePath) !== undefined)
      .filter((record) => indexedByPath.get(record.relativePath) !== record.contentHash)
      .map((record) => record.relativePath);
    const schemaVersion = readMetadata(db, "schema_version");
    const fresh =
      schemaVersion === SCHEMA_VERSION &&
      missingPages.length === 0 &&
      extraPages.length === 0 &&
      stalePages.length === 0;

    return {
      dbPath,
      jsonlPath,
      initialized,
      dbExists,
      jsonlExists,
      fresh,
      pageCount: pageCountRow.count,
      sourcePageCount: sourceRecords.length,
      stalePageCount: stalePages.length,
      missingPageCount: missingPages.length,
      extraPageCount: extraPages.length,
      stalePages,
      missingPages,
      extraPages,
      indexedAt: readMetadata(db, "indexed_at"),
      schemaVersion
    };
  } catch (error) {
    return {
      dbPath,
      jsonlPath,
      initialized,
      dbExists,
      jsonlExists,
      fresh: false,
      pageCount: 0,
      sourcePageCount: sourceRecords.length,
      stalePageCount: 0,
      missingPageCount: sourceRecords.length,
      extraPageCount: 0,
      stalePages: [],
      missingPages: sourceRecords.map((record) => record.relativePath),
      extraPages: [],
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    db.close();
  }
}

export async function readIndexedWikiPages(rootDir: string): Promise<WikiPage[] | undefined> {
  const dbPath = indexDbPath(rootDir);
  if (!(await pathExists(dbPath))) {
    return undefined;
  }

  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db
      .prepare(
        `SELECT relative_path, type, status, title, body, frontmatter_json,
                source_mtime_ms, content_hash, indexed_at
         FROM wiki_pages
         ORDER BY relative_path`
      )
      .all() as PageRow[];

    return rows.map((row) => {
      const frontmatter = JSON.parse(row.frontmatter_json) as WikiPageFrontmatter;
      return {
        path: resolveProjectPath(rootDir, WIKI_DIR, row.relative_path),
        relativePath: row.relative_path,
        frontmatter,
        body: row.body
      };
    });
  } finally {
    db.close();
  }
}

export function formatHybridIndexBuildMarkdown(
  result: HybridIndexBuildResult
): string {
  const lines = [
    "# AIWiki Hybrid Index",
    "",
    `- SQLite: ${result.dbPath}`,
    `- Pages indexed: ${result.pageCount}`,
    `- Indexed at: ${result.indexedAt}`,
    `- JSONL snapshot: ${result.jsonlPath ?? "skipped"}`
  ];

  return `${lines.join("\n")}\n`;
}

export function formatHybridIndexStatusMarkdown(status: HybridIndexStatus): string {
  const lines = [
    "# AIWiki Hybrid Index Status",
    "",
    `- SQLite: ${status.dbExists ? status.dbPath : "missing"}`,
    `- JSONL snapshot: ${status.jsonlExists ? status.jsonlPath : "missing"}`,
    `- Initialized: ${status.initialized ? "yes" : "no"}`,
    `- Fresh: ${status.fresh ? "yes" : "no"}`,
    `- Pages indexed: ${status.pageCount}`,
    `- Source pages: ${status.sourcePageCount}`,
    `- Stale pages: ${status.stalePageCount}`,
    `- Missing pages: ${status.missingPageCount}`,
    `- Extra pages: ${status.extraPageCount}`,
    `- Indexed at: ${status.indexedAt ?? "unknown"}`,
    `- Schema version: ${status.schemaVersion ?? "unknown"}`
  ];

  if (!status.initialized) {
    lines.push("", "Run `aiwiki init --project-name <name>` and `aiwiki map --write` before building the index.");
  } else if (!status.fresh && !status.error) {
    lines.push("", "Run `aiwiki index build` to refresh the derived index.");
  }

  if (status.stalePages.length > 0) {
    lines.push("", "## Stale Pages", ...formatLimitedList(status.stalePages));
  }

  if (status.missingPages.length > 0) {
    lines.push("", "## Missing Pages", ...formatLimitedList(status.missingPages));
  }

  if (status.extraPages.length > 0) {
    lines.push("", "## Extra Pages", ...formatLimitedList(status.extraPages));
  }

  if (status.error) {
    lines.push(`- Error: ${status.error}`);
  }

  return `${lines.join("\n")}\n`;
}

export function formatHybridIndexBuildResult(
  result: HybridIndexBuildResult,
  format: OutputFormat
): string {
  if (format === "json") {
    return `${JSON.stringify(result, null, 2)}\n`;
  }

  return formatHybridIndexBuildMarkdown(result);
}

export function formatHybridIndexStatus(
  status: HybridIndexStatus,
  format: OutputFormat
): string {
  if (format === "json") {
    return `${JSON.stringify(status, null, 2)}\n`;
  }

  return formatHybridIndexStatusMarkdown(status);
}
