import type { SearchResponse, SearchResult } from "./search.js";

export type OutputFormat = "markdown" | "json";

export function parseOutputFormat(value: string | undefined): OutputFormat {
  if (value === undefined || value === "markdown") {
    return "markdown";
  }

  if (value === "json") {
    return "json";
  }

  throw new Error(`Unsupported output format: ${value}`);
}

export function parsePositiveInteger(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, received: ${value}`);
  }

  return parsed;
}

function formatList(values: string[] | undefined): string {
  return values && values.length > 0 ? values.join(", ") : "none";
}

function serializeSearchResult(result: SearchResult): Record<string, unknown> {
  return {
    title: result.title,
    score: result.score,
    matchedFields: result.matchedFields,
    path: result.page.relativePath,
    excerpt: result.excerpt,
    frontmatter: result.page.frontmatter
  };
}

export function formatSearchResponse(
  response: SearchResponse,
  format: OutputFormat
): string {
  if (format === "json") {
    return `${JSON.stringify(
      {
        query: response.query,
        source: response.source,
        indexStatus: response.indexStatus,
        results: response.results.map(serializeSearchResult)
      },
      null,
      2
    )}\n`;
  }

  if (response.results.length === 0) {
    const indexLines = formatSearchIndexStatusLines(response);
    return [
      "# AIWiki Search Results",
      "",
      `Query: \`${response.query}\``,
      `Source: ${response.source ?? "markdown"}`,
      ...indexLines,
      "",
      "No matching wiki pages found.",
      "",
      "Search scope: `.aiwiki/wiki` memory only; source files are not searched.",
      "Next: try `aiwiki brief \"<task>\"`, `aiwiki guard <file>`, or run `aiwiki map --write` to seed project memory."
    ].join("\n") + "\n";
  }

  const lines = [
    "# AIWiki Search Results",
    "",
    `Query: \`${response.query}\``,
    `Source: ${response.source ?? "markdown"}`,
    ...formatSearchIndexStatusLines(response),
    ""
  ];

  response.results.forEach((result, index) => {
    lines.push(
      `## ${index + 1}. ${result.title}`,
      "",
      `- Type: ${result.page.frontmatter.type}`,
      `- Path: ${result.page.relativePath}`,
      `- Score: ${result.score}`,
      `- Matched: ${result.matchedFields.join(", ")}`,
      `- Modules: ${formatList(result.page.frontmatter.modules)}`,
      `- Files: ${formatList(result.page.frontmatter.files)}`,
      `- Severity: ${result.page.frontmatter.severity ?? "none"}`
    );

    if (result.excerpt) {
      lines.push("", result.excerpt);
    }

    lines.push("");
  });

  return `${lines.join("\n").trimEnd()}\n`;
}

function formatSearchIndexStatusLines(response: SearchResponse): string[] {
  if (!response.indexStatus) {
    return [];
  }

  const status = response.indexStatus;
  const lines = [
    `Index fresh: ${status.fresh ? "yes" : "no"}`,
    `Index pages: ${status.pageCount}/${status.sourcePageCount}`
  ];

  if (response.source === "markdown") {
    lines.push(
      status.initialized
        ? "Index usage: unavailable; scanned Markdown instead."
        : "Index usage: unavailable before AIWiki is initialized; scanned Markdown instead."
    );
  }

  if (!status.fresh) {
    lines.push(
      `Index drift: ${status.stalePageCount} stale, ${status.missingPageCount} missing, ${status.extraPageCount} extra`,
      status.initialized
        ? "Refresh with `aiwiki index build`."
        : "Initialize with `aiwiki init --project-name <name>` and `aiwiki map --write` before building the index."
    );
  }

  return lines;
}
