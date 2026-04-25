import { readFile, writeFile } from "node:fs/promises";
import matter from "gray-matter";
import type { WikiPageFrontmatter } from "./types.js";

export interface ParsedMarkdown<T extends Record<string, unknown>> {
  frontmatter: T;
  body: string;
}

export function parseMarkdown<T extends Record<string, unknown>>(
  raw: string
): ParsedMarkdown<T> {
  const parsed = matter(raw);
  return {
    frontmatter: parsed.data as T,
    body: parsed.content.trimStart()
  };
}

export function formatMarkdown(
  frontmatter: Record<string, unknown>,
  body: string
): string {
  const normalizedBody = body.endsWith("\n") ? body : `${body}\n`;
  return matter.stringify(normalizedBody, frontmatter);
}

export async function readMarkdownFile<T extends Record<string, unknown>>(
  filePath: string
): Promise<ParsedMarkdown<T>> {
  return parseMarkdown<T>(await readFile(filePath, "utf8"));
}

export async function writeMarkdownFile(
  filePath: string,
  frontmatter: WikiPageFrontmatter,
  body: string
): Promise<void> {
  await writeFile(filePath, formatMarkdown(frontmatter, body), "utf8");
}
