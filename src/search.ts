import type { WikiPage, WikiPageType } from "./types.js";
import { scanWikiPages } from "./wiki-store.js";

export type SearchMatchedField = "title" | "frontmatter" | "path" | "body";

export interface SearchResult {
  page: WikiPage;
  score: number;
  matchedFields: SearchMatchedField[];
  title: string;
  excerpt?: string;
}

export interface SearchOptions {
  type?: WikiPageType;
  limit?: number;
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
}

const DEFAULT_SEARCH_LIMIT = 10;

const SEVERITY_BONUS = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 2
} as const;

function tokenize(query: string): string[] {
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9_./-]+/u)
    .map((token) => token.trim())
    .filter(Boolean);

  return [...new Set(tokens)];
}

function normalized(value: string): string {
  return value.toLowerCase();
}

function extractTitle(page: WikiPage): string {
  if (page.frontmatter.title && page.frontmatter.title.trim().length > 0) {
    return page.frontmatter.title;
  }

  const heading = page.body
    .split("\n")
    .find((line) => line.trim().startsWith("#"));

  if (heading) {
    return heading.replace(/^#+\s*/, "").trim();
  }

  return page.relativePath;
}

function firstMatchingExcerpt(body: string, tokens: string[]): string | undefined {
  const lines = body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

  const match = lines.find((line) => {
    const value = normalized(line);
    return tokens.some((token) => value.includes(token));
  });

  return match ?? lines[0];
}

function addField(
  fields: Set<SearchMatchedField>,
  field: SearchMatchedField,
  haystack: string,
  tokens: string[],
  points: number
): number {
  const value = normalized(haystack);
  const matches = tokens.filter((token) => value.includes(token));
  if (matches.length === 0) {
    return 0;
  }

  fields.add(field);
  return points * matches.length;
}

function scorePage(page: WikiPage, tokens: string[]): SearchResult | undefined {
  const matchedFields = new Set<SearchMatchedField>();
  const title = extractTitle(page);
  const frontmatterText = JSON.stringify(page.frontmatter);
  let score = 0;

  score += addField(matchedFields, "title", title, tokens, 5);
  score += addField(matchedFields, "frontmatter", frontmatterText, tokens, 4);
  score += addField(matchedFields, "path", page.relativePath, tokens, 4);
  score += addField(matchedFields, "body", page.body, tokens, 2);

  if (score <= 0) {
    return undefined;
  }

  if (page.frontmatter.severity) {
    score += SEVERITY_BONUS[page.frontmatter.severity];
  }

  if (page.frontmatter.status === "deprecated") {
    score -= 5;
  }

  if (page.frontmatter.encountered_count) {
    score += Math.min(page.frontmatter.encountered_count, 3);
  }

  return {
    page,
    score,
    matchedFields: [...matchedFields],
    title,
    excerpt: firstMatchingExcerpt(page.body, tokens)
  };
}

export async function searchWikiMemory(
  rootDir: string,
  query: string,
  options: SearchOptions = {}
): Promise<SearchResponse> {
  const tokens = tokenize(query);
  const limit = options.limit ?? DEFAULT_SEARCH_LIMIT;

  if (tokens.length === 0 || limit <= 0) {
    return { query, results: [] };
  }

  const pages = (await scanWikiPages(rootDir)).filter((page) => {
    return options.type ? page.frontmatter.type === options.type : true;
  });

  const results = pages
    .map((page) => scorePage(page, tokens))
    .filter((result): result is SearchResult => result !== undefined)
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      return a.page.relativePath.localeCompare(b.page.relativePath);
    })
    .slice(0, limit);

  return { query, results };
}
