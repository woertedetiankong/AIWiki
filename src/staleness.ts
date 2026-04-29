import { stat } from "node:fs/promises";
import path from "node:path";
import { resolveProjectPath, toPosixPath } from "./paths.js";
import type { WikiPage } from "./types.js";

export type WikiStalenessWarningCode =
  | "missing_referenced_file"
  | "stale_referenced_file";

export interface WikiStalenessWarning {
  code: WikiStalenessWarningCode;
  page: string;
  file: string;
  message: string;
  pageLastUpdated?: string;
  fileModifiedAt?: string;
}

export interface WikiStalenessOptions {
  limit?: number;
}

function uniquePages(pages: WikiPage[]): WikiPage[] {
  const byPath = new Map<string, WikiPage>();
  for (const page of pages) {
    byPath.set(page.relativePath, page);
  }

  return [...byPath.values()];
}

function docPath(page: WikiPage): string {
  return `wiki/${page.relativePath}`;
}

function normalizeFileRef(rootDir: string, fileRef: string): string | undefined {
  const trimmed = fileRef.trim();
  if (!trimmed) {
    return undefined;
  }

  const root = path.resolve(rootDir);
  const absolutePath = path.isAbsolute(trimmed)
    ? path.resolve(trimmed)
    : path.resolve(root, trimmed);
  const relativePath = path.relative(root, absolutePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return undefined;
  }

  return toPosixPath(relativePath).replace(/^\.\//u, "");
}

function parseLastUpdated(value: string | undefined): Date | undefined {
  if (!value) {
    return undefined;
  }

  if (/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    const parsed = new Date(`${value}T23:59:59.999Z`);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function missingFileWarning(page: WikiPage, fileRef: string): WikiStalenessWarning {
  return {
    code: "missing_referenced_file",
    page: docPath(page),
    file: fileRef,
    message: `${docPath(page)} references missing project file ${fileRef}.`
  };
}

function staleFileWarning(
  page: WikiPage,
  fileRef: string,
  lastUpdated: string,
  fileModifiedAt: Date
): WikiStalenessWarning {
  const modified = fileModifiedAt.toISOString();
  return {
    code: "stale_referenced_file",
    page: docPath(page),
    file: fileRef,
    message: `${docPath(page)} may be stale: ${fileRef} changed after last_updated ${lastUpdated}.`,
    pageLastUpdated: lastUpdated,
    fileModifiedAt: modified
  };
}

export function formatStalenessWarning(warning: WikiStalenessWarning): string {
  return `[${warning.code}] ${warning.message}`;
}

export async function collectWikiStalenessWarnings(
  rootDir: string,
  pages: WikiPage[],
  options: WikiStalenessOptions = {}
): Promise<WikiStalenessWarning[]> {
  const warnings: WikiStalenessWarning[] = [];

  for (const page of uniquePages(pages)) {
    const fileRefs = page.frontmatter.files ?? [];
    const lastUpdated = page.frontmatter.last_updated;
    const lastUpdatedDate = parseLastUpdated(lastUpdated);

    for (const fileRef of fileRefs) {
      const normalizedFile = normalizeFileRef(rootDir, fileRef);
      if (!normalizedFile) {
        warnings.push(missingFileWarning(page, fileRef));
        continue;
      }

      let fileStat;
      try {
        fileStat = await stat(resolveProjectPath(rootDir, normalizedFile));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          warnings.push(missingFileWarning(page, normalizedFile));
          continue;
        }

        throw error;
      }

      if (
        fileStat.isFile() &&
        lastUpdated &&
        lastUpdatedDate &&
        fileStat.mtime.getTime() > lastUpdatedDate.getTime()
      ) {
        warnings.push(staleFileWarning(page, normalizedFile, lastUpdated, fileStat.mtime));
      }
    }
  }

  const sorted = warnings.sort((left, right) =>
    `${left.code}:${left.page}:${left.file}`.localeCompare(
      `${right.code}:${right.page}:${right.file}`
    )
  );

  return options.limit ? sorted.slice(0, options.limit) : sorted;
}
