import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  AIWIKI_VERSION,
  BACKLINKS_JSON_PATH,
  GRAPH_JSON_PATH
} from "./constants.js";
import { loadAIWikiConfig } from "./config.js";
import { loadGraphifyContext } from "./graphify.js";
import type { GraphifyContext } from "./graphify.js";
import { appendLogEntry } from "./log.js";
import { resolveProjectPath, toPosixPath } from "./paths.js";
import type {
  GraphEdge,
  GraphEdgeType,
  GraphJson,
  GraphNode,
  WikiPage
} from "./types.js";
import { scanWikiPages } from "./wiki-store.js";

export interface BacklinksJson {
  version: string;
  generated_at: string;
  backlinks: Record<string, string[]>;
}

export interface GraphBuildOptions {
  write?: boolean;
}

export interface GraphBuildResult {
  graph: GraphJson;
  backlinks: BacklinksJson;
  json: string;
  backlinksJson: string;
  outputPaths?: {
    graph: string;
    backlinks: string;
  };
}

export interface GraphRelateOptions {
  withGraphify?: boolean;
}

export interface GraphRelatedPage {
  id: string;
  title: string;
  type: GraphNode["type"];
  path?: string;
  severity?: string;
}

export interface GraphRelatedEdge {
  from: string;
  to: string;
  type: GraphEdgeType;
  source?: string;
}

export interface GraphRelate {
  filePath: string;
  fileNodeId: string;
  referencedBy: GraphRelatedPage[];
  relatedModules: string[];
  adjacentEdges: GraphRelatedEdge[];
  graphify?: {
    available: boolean;
    warnings: string[];
    relatedFiles: string[];
    relatedEdges: string[];
  };
}

export interface GraphRelateResult {
  relation: GraphRelate;
  markdown: string;
  json: string;
}

function docId(page: WikiPage): string {
  return `wiki/${page.relativePath}`;
}

function fileId(filePath: string): string {
  return `file:${toPosixPath(filePath).replace(/^\.\//u, "")}`;
}

function normalizeTargetFile(rootDir: string, filePath: string): string {
  const absolutePath = path.isAbsolute(filePath)
    ? filePath
    : resolveProjectPath(rootDir, filePath);
  const root = path.resolve(rootDir);
  const relativePath = path.relative(root, absolutePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`Refusing to relate a file outside project root: ${filePath}`);
  }

  return toPosixPath(relativePath).replace(/^\.\//u, "");
}

function titleForPage(page: WikiPage): string {
  if (page.frontmatter.title && page.frontmatter.title.trim().length > 0) {
    return page.frontmatter.title;
  }

  const heading = page.body
    .split("\n")
    .find((line) => line.trim().startsWith("#"));

  if (heading) {
    return heading.replace(/^#+\s*/u, "").trim();
  }

  return page.relativePath;
}

function normalizeDocRef(fromPage: WikiPage, value: string): string {
  const withoutHash = value.split("#")[0] ?? value;
  const normalized = toPosixPath(withoutHash.trim());

  if (normalized.startsWith("wiki/")) {
    return normalized;
  }

  if (normalized.startsWith(".") || normalized.includes("/")) {
    const base = path.posix.dirname(fromPage.relativePath);
    return `wiki/${path.posix.normalize(path.posix.join(base, normalized))}`;
  }

  if (normalized.endsWith(".md")) {
    return `wiki/${normalized}`;
  }

  return `wiki/${normalized}`;
}

function extractMarkdownDocRefs(page: WikiPage): string[] {
  const refs = new Set<string>();
  const wikiLinkPattern = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/gu;
  const markdownLinkPattern = /\[[^\]]+\]\(([^)]+\.md(?:#[^)]+)?)\)/gu;

  for (const match of page.body.matchAll(wikiLinkPattern)) {
    if (match[1]) {
      refs.add(normalizeDocRef(page, match[1]));
    }
  }

  for (const match of page.body.matchAll(markdownLinkPattern)) {
    if (match[1]) {
      refs.add(normalizeDocRef(page, match[1]));
    }
  }

  return [...refs].sort();
}

function addNode(nodes: Map<string, GraphNode>, node: GraphNode): void {
  if (!nodes.has(node.id)) {
    nodes.set(node.id, node);
  }
}

function edgeKey(edge: GraphEdge): string {
  return `${edge.from}|${edge.to}|${edge.type}|${edge.source ?? ""}`;
}

function addEdge(edges: Map<string, GraphEdge>, edge: GraphEdge): void {
  if (edge.from === edge.to) {
    return;
  }

  edges.set(edgeKey(edge), edge);
}

function addDocEdges(
  edges: Map<string, GraphEdge>,
  page: WikiPage,
  from: string,
  refs: string[] | undefined,
  type: GraphEdgeType
): void {
  for (const ref of refs ?? []) {
    addEdge(edges, { from, to: normalizeDocRef(page, ref), type });
  }
}

function buildBacklinks(graph: GraphJson): BacklinksJson {
  const backlinks: Record<string, string[]> = {};
  for (const edge of graph.edges) {
    backlinks[edge.to] = [...(backlinks[edge.to] ?? []), edge.from];
  }

  for (const key of Object.keys(backlinks)) {
    backlinks[key] = [...new Set(backlinks[key])].sort();
  }

  return {
    version: graph.version,
    generated_at: graph.generated_at,
    backlinks
  };
}

export function formatGraphJson(graph: GraphJson): string {
  return `${JSON.stringify(graph, null, 2)}\n`;
}

export function formatBacklinksJson(backlinks: BacklinksJson): string {
  return `${JSON.stringify(backlinks, null, 2)}\n`;
}

function pageByNodeId(graph: GraphJson): Map<string, GraphNode> {
  return new Map(graph.nodes.map((node) => [node.id, node]));
}

function graphifyRelation(
  filePath: string,
  context: GraphifyContext
): GraphRelate["graphify"] {
  const relatedFiles = context.files.filter((file) => {
    return file === filePath || file.endsWith(`/${filePath}`) || filePath.endsWith(file);
  });
  const relatedEdges = context.edges
    .filter((edge) => edge.from.includes(filePath) || edge.to.includes(filePath))
    .slice(0, 12)
    .map((edge) => {
      const details = [
        edge.type ? `type ${edge.type}` : undefined,
        edge.confidence ? `confidence ${edge.confidence}` : undefined
      ].filter(Boolean);
      return `${edge.from} -> ${edge.to}${details.length > 0 ? ` (${details.join(", ")})` : ""}`;
    });

  return {
    available: context.available,
    warnings: context.warnings,
    relatedFiles,
    relatedEdges
  };
}

function formatList(items: string[], fallback: string): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : `- ${fallback}`;
}

function formatRelatedPages(pages: GraphRelatedPage[]): string[] {
  return pages.map((page) => {
    const details = [
      page.type,
      page.path,
      page.severity ? `severity ${page.severity}` : undefined
    ].filter(Boolean);
    return `${page.title} (${details.join("; ")})`;
  });
}

function formatRelatedEdges(edges: GraphRelatedEdge[]): string[] {
  return edges.map((edge) => {
    const source = edge.source ? `; source ${edge.source}` : "";
    return `${edge.from} -> ${edge.to} (${edge.type}${source})`;
  });
}

export function formatGraphRelateMarkdown(relation: GraphRelate): string {
  const graphifyLines = relation.graphify
    ? `
## Graphify Structural Context
- Available: ${relation.graphify.available ? "yes" : "no"}
${formatList(relation.graphify.warnings.map((warning) => `Warning: ${warning}`), "No warnings.")}
${formatList(relation.graphify.relatedFiles.map((file) => `Related file reference: ${file}.`), "No related Graphify file references.")}
${formatList(relation.graphify.relatedEdges.map((edge) => `Related relation: ${edge}.`), "No related Graphify edges.")}
`
    : "";

  return `# Graph Relations: ${relation.filePath}

## Referenced By
${formatList(formatRelatedPages(relation.referencedBy), "No wiki pages reference this file.")}

## Related Modules
${formatList(relation.relatedModules, "No related module nodes found.")}

## Adjacent Graph Edges
${formatList(formatRelatedEdges(relation.adjacentEdges), "No adjacent graph edges found.")}
${graphifyLines}
## Safety
- This command is read-only.
- Graph and Graphify relations are task context, not confirmed AIWiki memory.
`;
}

function graphRelateToJson(relation: GraphRelate): string {
  return `${JSON.stringify(relation, null, 2)}\n`;
}

export async function buildWikiGraph(
  rootDir: string,
  options: GraphBuildOptions = {}
): Promise<GraphBuildResult> {
  await loadAIWikiConfig(rootDir);
  const pages = await scanWikiPages(rootDir);
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();

  for (const page of pages) {
    const id = docId(page);
    addNode(nodes, {
      id,
      type: page.frontmatter.type,
      label: titleForPage(page),
      path: id,
      status: page.frontmatter.status,
      severity: page.frontmatter.severity ?? page.frontmatter.risk
    });

    for (const file of page.frontmatter.files ?? []) {
      const target = fileId(file);
      addNode(nodes, {
        id: target,
        type: "file",
        label: file,
        path: file
      });
      addEdge(edges, { from: id, to: target, type: "references_file" });
    }

    for (const moduleName of page.frontmatter.modules ?? []) {
      addNode(nodes, {
        id: `module:${moduleName}`,
        type: "module",
        label: moduleName
      });
      addEdge(edges, {
        from: id,
        to: `module:${moduleName}`,
        type: "relates_to",
        source: "frontmatter.modules"
      });
    }

    addDocEdges(edges, page, id, page.frontmatter.related_pitfalls, "relates_to");
    addDocEdges(edges, page, id, page.frontmatter.related_decisions, "relates_to");
    addDocEdges(edges, page, id, page.frontmatter.related_patterns, "relates_to");
    addDocEdges(edges, page, id, page.frontmatter.supersedes, "supersedes");
    addDocEdges(edges, page, id, page.frontmatter.conflicts_with, "conflicts_with");
    addDocEdges(edges, page, id, page.frontmatter.source_sessions, "relates_to");

    const sourcePitfalls = page.frontmatter.source_pitfalls;
    if (Array.isArray(sourcePitfalls)) {
      addDocEdges(
        edges,
        page,
        id,
        sourcePitfalls.filter((item): item is string => typeof item === "string"),
        "promoted_from"
      );
    }

    for (const ref of extractMarkdownDocRefs(page)) {
      addEdge(edges, {
        from: id,
        to: ref,
        type: "relates_to",
        source: "markdown"
      });
    }
  }

  const generatedAt = new Date().toISOString();
  const graph: GraphJson = {
    version: AIWIKI_VERSION,
    generated_at: generatedAt,
    nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...edges.values()].sort((a, b) => edgeKey(a).localeCompare(edgeKey(b)))
  };
  const backlinks = buildBacklinks(graph);
  const json = formatGraphJson(graph);
  const backlinksJson = formatBacklinksJson(backlinks);

  let outputPaths: GraphBuildResult["outputPaths"];
  if (options.write) {
    const graphPath = resolveProjectPath(rootDir, GRAPH_JSON_PATH);
    const backlinksPath = resolveProjectPath(rootDir, BACKLINKS_JSON_PATH);
    await mkdir(path.dirname(graphPath), { recursive: true });
    await writeFile(graphPath, json, "utf8");
    await writeFile(backlinksPath, backlinksJson, "utf8");
    await appendLogEntry(rootDir, {
      action: "graph build",
      title: "Wiki Graph",
      bullets: [
        "Updated: [[graph/graph.json]]",
        "Updated: [[graph/backlinks.json]]"
      ]
    });
    outputPaths = { graph: graphPath, backlinks: backlinksPath };
  }

  return { graph, backlinks, json, backlinksJson, outputPaths };
}

export async function relateGraphFile(
  rootDir: string,
  filePath: string,
  options: GraphRelateOptions = {}
): Promise<GraphRelateResult> {
  await loadAIWikiConfig(rootDir);
  const normalizedFile = normalizeTargetFile(rootDir, filePath);
  const nodeId = fileId(normalizedFile);
  const graph = (await buildWikiGraph(rootDir)).graph;
  const nodes = pageByNodeId(graph);
  const referencingEdges = graph.edges.filter((edge) => edge.to === nodeId);
  const pageIds = new Set(referencingEdges.map((edge) => edge.from));
  const referencedBy = [...pageIds]
    .map((id) => nodes.get(id))
    .filter((node): node is GraphNode => Boolean(node))
    .map((node) => ({
      id: node.id,
      title: node.label,
      type: node.type,
      path: node.path,
      severity: node.severity
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const relatedModules = [
    ...new Set(
      graph.edges
        .filter((edge) => pageIds.has(edge.from) && edge.to.startsWith("module:"))
        .map((edge) => nodes.get(edge.to)?.label ?? edge.to.replace(/^module:/u, ""))
    )
  ].sort();
  const adjacentEdges = graph.edges
    .filter((edge) => edge.from === nodeId || edge.to === nodeId || pageIds.has(edge.from))
    .map((edge) => ({
      from: edge.from,
      to: edge.to,
      type: edge.type,
      source: edge.source
    }))
    .sort((left, right) =>
      `${left.from}:${left.to}:${left.type}`.localeCompare(`${right.from}:${right.to}:${right.type}`)
    );
  const graphify = options.withGraphify
    ? graphifyRelation(normalizedFile, await loadGraphifyContext(rootDir))
    : undefined;
  const relation: GraphRelate = {
    filePath: normalizedFile,
    fileNodeId: nodeId,
    referencedBy,
    relatedModules,
    adjacentEdges,
    graphify
  };

  return {
    relation,
    markdown: formatGraphRelateMarkdown(relation),
    json: graphRelateToJson(relation)
  };
}
