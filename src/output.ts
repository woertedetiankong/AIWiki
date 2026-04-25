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
        results: response.results.map(serializeSearchResult)
      },
      null,
      2
    )}\n`;
  }

  if (response.results.length === 0) {
    return `# AIWiki Search Results\n\nQuery: \`${response.query}\`\n\nNo matching wiki pages found.\n`;
  }

  const lines = [
    "# AIWiki Search Results",
    "",
    `Query: \`${response.query}\``,
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
