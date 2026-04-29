import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadAIWikiConfig } from "./config.js";
import type { OutputFormat } from "./output.js";
import { resolveProjectPath, toPosixPath } from "./paths.js";

export interface GraphifyNode {
  id: string;
  label?: string;
  path?: string;
  confidence?: string;
}

export interface GraphifyEdge {
  from: string;
  to: string;
  type?: string;
  confidence?: string;
}

export interface GraphifyContext {
  sourcePath: string;
  reportPath?: string;
  graphPath?: string;
  available: boolean;
  warnings: string[];
  reportSummary: string[];
  nodes: GraphifyNode[];
  edges: GraphifyEdge[];
  files: string[];
}

export interface GraphifyImportResult {
  context: GraphifyContext;
  markdown: string;
  json: string;
  outputPath?: string;
}

export interface GraphifyImportOptions {
  output?: string;
  force?: boolean;
  format?: OutputFormat;
}

const DEFAULT_GRAPHIFY_PATH = "graphify-out";
const REPORT_FILE_NAME = "GRAPH_REPORT.md";
const GRAPH_FILE_NAME = "graph.json";

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

async function isDirectory(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isDirectory();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

function relative(rootDir: string, filePath: string): string {
  return toPosixPath(path.relative(rootDir, filePath));
}

async function resolveGraphifyFiles(
  rootDir: string,
  inputPath: string
): Promise<{
  sourcePath: string;
  reportPath: string;
  graphPath: string;
}> {
  const sourceAbsolutePath = resolveProjectPath(rootDir, inputPath);
  const sourceIsDirectory = await isDirectory(sourceAbsolutePath);
  const baseDir = sourceIsDirectory
    ? sourceAbsolutePath
    : path.dirname(sourceAbsolutePath);
  const basename = path.basename(sourceAbsolutePath);

  return {
    sourcePath: relative(rootDir, sourceAbsolutePath),
    reportPath:
      basename === REPORT_FILE_NAME
        ? sourceAbsolutePath
        : path.join(baseDir, REPORT_FILE_NAME),
    graphPath:
      basename === GRAPH_FILE_NAME
        ? sourceAbsolutePath
        : path.join(baseDir, GRAPH_FILE_NAME)
  };
}

function firstString(value: unknown, keys: string[]): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const item = record[key];
    if (typeof item === "string" && item.trim().length > 0) {
      return item;
    }
    if (typeof item === "number") {
      return String(item);
    }
  }

  return undefined;
}

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined)
  ) as T;
}

function arrayFromUnknown(value: unknown, keys: string[]): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const item = record[key];
    if (Array.isArray(item)) {
      return item;
    }
  }

  return [];
}

function parseGraphifyNodes(value: unknown): GraphifyNode[] {
  return arrayFromUnknown(value, ["nodes", "vertices"])
    .map((item, index) => {
      const id =
        firstString(item, ["id", "key", "name", "path", "file"]) ??
        `node-${index + 1}`;
      return compact({
        id,
        label: firstString(item, ["label", "name", "title", "symbol"]),
        path: firstString(item, ["path", "file", "relativePath"]),
        confidence: firstString(item, ["confidence", "confidence_label", "confidenceLabel"])
      });
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

function parseGraphifyEdges(value: unknown): GraphifyEdge[] {
  const edges: GraphifyEdge[] = [];
  for (const item of arrayFromUnknown(value, ["edges", "links", "relations"])) {
      const from = firstString(item, ["from", "source", "sourceId", "src"]);
      const to = firstString(item, ["to", "target", "targetId", "dst"]);
      if (!from || !to) {
        continue;
      }

      edges.push(compact({
        from,
        to,
        type: firstString(item, ["type", "relation", "kind", "label"]),
        confidence: firstString(item, ["confidence", "confidence_label", "confidenceLabel"])
      }));
  }

  return edges.sort((a, b) =>
    `${a.from}:${a.to}:${a.type ?? ""}`.localeCompare(`${b.from}:${b.to}:${b.type ?? ""}`)
  );
}

function summarizeReport(report: string): string[] {
  return report
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => line.startsWith("#") || /confidence|risk|module|file|edge|relation/iu.test(line))
    .slice(0, 12);
}

function graphFiles(nodes: GraphifyNode[], edges: GraphifyEdge[]): string[] {
  const fileLike = new Set<string>();
  for (const node of nodes) {
    for (const value of [node.path, node.id]) {
      if (value && /[/.\\]/u.test(value)) {
        fileLike.add(toPosixPath(value));
      }
    }
  }

  for (const edge of edges) {
    for (const value of [edge.from, edge.to]) {
      if (/[/.\\]/u.test(value)) {
        fileLike.add(toPosixPath(value));
      }
    }
  }

  return [...fileLike].sort();
}

function formatList(items: string[], fallback: string): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : `- ${fallback}`;
}

function formatNode(node: GraphifyNode): string {
  const details = [
    node.path ? `path ${node.path}` : undefined,
    node.confidence ? `confidence ${node.confidence}` : undefined
  ].filter(Boolean);
  return `${node.label ?? node.id}${details.length > 0 ? ` (${details.join(", ")})` : ""}`;
}

function formatEdge(edge: GraphifyEdge): string {
  const details = [
    edge.type ? `type ${edge.type}` : undefined,
    edge.confidence ? `confidence ${edge.confidence}` : undefined
  ].filter(Boolean);
  return `${edge.from} -> ${edge.to}${details.length > 0 ? ` (${details.join(", ")})` : ""}`;
}

export function formatGraphifyContextMarkdown(context: GraphifyContext): string {
  return `# Graphify Context Import

## Source
- Requested path: ${context.sourcePath}
- Report: ${context.reportPath ?? "missing"}
- Graph JSON: ${context.graphPath ?? "missing"}
- Available: ${context.available ? "yes" : "no"}

## Warnings
${formatList(context.warnings, "No warnings.")}

## Report Summary
${formatList(context.reportSummary, "No report summary available.")}

## Nodes
${formatList(context.nodes.slice(0, 20).map(formatNode), "No graph nodes parsed.")}

## Edges
${formatList(context.edges.slice(0, 20).map(formatEdge), "No graph edges parsed.")}

## Files
${formatList(context.files.slice(0, 20), "No file references parsed.")}

## Safety
- Graphify output is structural context only.
- This command does not create wiki pages, rules, or confirmed AIWiki memory.
`;
}

function toJson(context: GraphifyContext, outputPath?: string): string {
  return `${JSON.stringify(outputPath ? { ...context, outputPath } : context, null, 2)}\n`;
}

async function writeProjectOutput(
  rootDir: string,
  outputPath: string,
  content: string,
  force: boolean
): Promise<string> {
  const resolved = resolveProjectPath(rootDir, outputPath);
  if (!force && (await pathExists(resolved))) {
    throw new Error(`Refusing to overwrite existing Graphify context output: ${outputPath}`);
  }

  await mkdir(path.dirname(resolved), { recursive: true });
  await writeFile(resolved, content, "utf8");
  return resolved;
}

export async function loadGraphifyContext(
  rootDir: string,
  inputPath = DEFAULT_GRAPHIFY_PATH
): Promise<GraphifyContext> {
  await loadAIWikiConfig(rootDir);
  const files = await resolveGraphifyFiles(rootDir, inputPath);
  const warnings: string[] = [];
  let reportSummary: string[] = [];
  let nodes: GraphifyNode[] = [];
  let edges: GraphifyEdge[] = [];
  let reportPath: string | undefined;
  let graphPath: string | undefined;

  if (await pathExists(files.reportPath)) {
    reportPath = relative(rootDir, files.reportPath);
    reportSummary = summarizeReport(await readFile(files.reportPath, "utf8"));
  } else {
    warnings.push(`Missing ${REPORT_FILE_NAME}.`);
  }

  if (await pathExists(files.graphPath)) {
    graphPath = relative(rootDir, files.graphPath);
    try {
      const parsed = JSON.parse(await readFile(files.graphPath, "utf8")) as unknown;
      nodes = parseGraphifyNodes(parsed);
      edges = parseGraphifyEdges(parsed);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Malformed ${GRAPH_FILE_NAME}: ${message}`);
    }
  } else {
    warnings.push(`Missing ${GRAPH_FILE_NAME}.`);
  }

  return {
    sourcePath: files.sourcePath,
    reportPath,
    graphPath,
    available: Boolean(reportPath || graphPath) && !warnings.some((item) => item.startsWith("Malformed")),
    warnings,
    reportSummary,
    nodes,
    edges,
    files: graphFiles(nodes, edges)
  };
}

export async function importGraphifyContext(
  rootDir: string,
  inputPath: string,
  options: GraphifyImportOptions = {}
): Promise<GraphifyImportResult> {
  const context = await loadGraphifyContext(rootDir, inputPath);
  const markdown = formatGraphifyContextMarkdown(context);
  const contextJson = toJson(context);
  const outputPath = options.output
    ? await writeProjectOutput(
        rootDir,
        options.output,
        options.format === "json" ? contextJson : markdown,
        options.force ?? false
      )
    : undefined;
  return {
    context,
    markdown: outputPath
      ? `${markdown}\n## Output\n- Written to: ${toPosixPath(path.relative(rootDir, outputPath))}\n`
      : markdown,
    json: toJson(context, outputPath ? toPosixPath(path.relative(rootDir, outputPath)) : undefined),
    outputPath
  };
}
