import type { WikiPage, WikiPageType } from "./types.js";
import {
  getHybridIndexStatus,
  readIndexedWikiPages,
  type HybridIndexStatus
} from "./hybrid-index.js";
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
  useIndex?: boolean;
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
  source?: "markdown" | "sqlite";
  indexStatus?: HybridIndexStatus;
}

const DEFAULT_SEARCH_LIMIT = 10;

const SEVERITY_BONUS = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 2
} as const;

const CJK_PATTERN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const CJK_RUN_PATTERN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu;

const QUERY_SYNONYMS: Array<{
  match: RegExp;
  tokens: string[];
}> = [
  { match: /命令|指令|入口|命令行|cli/iu, tokens: ["command", "cli"] },
  { match: /命令面|命令表面|入口面|指令面/iu, tokens: ["command", "surface"] },
  { match: /帮助|help/iu, tokens: ["help"] },
  { match: /隐藏|收束|降噪|噪音|太多/iu, tokens: ["hide", "hidden", "noise", "compact"] },
  { match: /删除|移除|去掉|精简/iu, tokens: ["delete", "remove", "prune"] },
  { match: /合并|整合|别名|迁移/iu, tokens: ["merge", "alias", "migration"] },
  { match: /搜索|检索|召回|查询/iu, tokens: ["search", "retrieval", "query"] },
  { match: /中文|汉字|cjk|unicode|编码/iu, tokens: ["chinese", "cjk", "unicode"] },
  { match: /工作流|流程|路径/iu, tokens: ["workflow", "path"] },
  { match: /记忆|知识|上下文/iu, tokens: ["memory", "context"] },
  { match: /规则|约束|护栏|风险|踩坑/iu, tokens: ["rule", "guard", "risk", "pitfall"] },
  { match: /维护|体检|健康|检查/iu, tokens: ["maintenance", "doctor", "lint"] },
  { match: /测试|验证|回归/iu, tokens: ["test", "verification", "regression"] },
  { match: /笔记|原始记录|复盘|反思/iu, tokens: ["notes", "raw", "reflect"] }
];

function normalizeText(value: string): string {
  return value.normalize("NFKC").toLowerCase();
}

function isSingleCjkToken(token: string): boolean {
  const chars = Array.from(token);
  return chars.length === 1 && CJK_PATTERN.test(chars[0] ?? "");
}

function cjkTokens(value: string): string[] {
  const runs = value.match(CJK_RUN_PATTERN) ?? [];
  return runs.flatMap((run) => {
    const chars = Array.from(run);
    if (chars.length < 2) {
      return [];
    }
    if (chars.length === 2) {
      return [run];
    }

    return [
      run,
      ...chars.slice(0, -1).map((_, index) => `${chars[index]}${chars[index + 1]}`)
    ];
  });
}

function synonymTokens(query: string): string[] {
  return QUERY_SYNONYMS.flatMap((entry) =>
    entry.match.test(query) ? entry.tokens : []
  );
}

function tokenize(query: string): string[] {
  const normalizedQuery = normalizeText(query);
  const pathFriendlyTokens = normalizedQuery
    .split(/[^\p{Letter}\p{Number}_./-]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length > 0 && !isSingleCjkToken(token));

  return [...new Set([
    ...pathFriendlyTokens,
    ...cjkTokens(normalizedQuery),
    ...synonymTokens(normalizedQuery)
  ])];
}

function normalized(value: string): string {
  return normalizeText(value);
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

  const indexStatus = options.useIndex
    ? await getHybridIndexStatus(rootDir)
    : undefined;
  const indexedPages = options.useIndex
    ? await readIndexedWikiPages(rootDir)
    : undefined;
  const source = indexedPages ? "sqlite" : "markdown";
  const pages = (indexedPages ?? (await scanWikiPages(rootDir))).filter((page) => {
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

  return { query, results, source, indexStatus };
}
