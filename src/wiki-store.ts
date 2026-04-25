import { readdir } from "node:fs/promises";
import path from "node:path";
import { WIKI_DIR } from "./constants.js";
import { readMarkdownFile } from "./markdown.js";
import { resolveProjectPath, toPosixPath } from "./paths.js";
import type { WikiPage, WikiPageFrontmatter, WikiPageType } from "./types.js";
import { parseWikiPageFrontmatter } from "./wiki-frontmatter.js";

export interface WikiPageFilter {
  type?: WikiPageType;
  module?: string;
  file?: string;
}

async function walkMarkdownFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }

  const results: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await walkMarkdownFiles(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      results.push(fullPath);
    }
  }

  return results.sort();
}

function normalizeComparablePath(filePath: string): string {
  return toPosixPath(filePath).replace(/^\.\//, "");
}

export async function scanWikiPages(rootDir: string): Promise<WikiPage[]> {
  const wikiRoot = resolveProjectPath(rootDir, WIKI_DIR);
  const files = await walkMarkdownFiles(wikiRoot);

  return Promise.all(
    files.map(async (filePath) => {
      const parsed = await readMarkdownFile<WikiPageFrontmatter>(filePath);
      const frontmatter = parseWikiPageFrontmatter(parsed.frontmatter);
      return {
        path: filePath,
        relativePath: toPosixPath(path.relative(wikiRoot, filePath)),
        frontmatter,
        body: parsed.body
      };
    })
  );
}

export function filterWikiPages(
  pages: WikiPage[],
  filter: WikiPageFilter
): WikiPage[] {
  const normalizedFile = filter.file
    ? normalizeComparablePath(filter.file)
    : undefined;

  return pages.filter((page) => {
    if (filter.type && page.frontmatter.type !== filter.type) {
      return false;
    }

    if (filter.module && !page.frontmatter.modules?.includes(filter.module)) {
      return false;
    }

    if (normalizedFile) {
      const files = page.frontmatter.files ?? [];
      const matchesFile = files.some(
        (file) => normalizeComparablePath(file) === normalizedFile
      );
      if (!matchesFile) {
        return false;
      }
    }

    return true;
  });
}

export async function findWikiPages(
  rootDir: string,
  filter: WikiPageFilter
): Promise<WikiPage[]> {
  return filterWikiPages(await scanWikiPages(rootDir), filter);
}
