import { lintWiki } from "./lint.js";
import { generateRulePromotionPreview } from "./promote-rules.js";
import { collectWikiStalenessWarnings } from "./staleness.js";
import type { WikiPage, WikiPageStatus, WikiPageType } from "./types.js";
import { scanWikiPages } from "./wiki-store.js";

export interface DoctorOptions {
  minRulePromotionCount?: number;
}

export interface DoctorFinding {
  severity: "info" | "warning" | "error";
  code: string;
  message: string;
  path?: string;
}

export interface DoctorReport {
  summary: {
    pagesChecked: number;
    lintErrors: number;
    lintWarnings: number;
    staleWarnings: number;
    rulePromotionCandidates: number;
    proposedPages: number;
    uncertainPages: number;
    deprecatedPages: number;
  };
  byType: Record<WikiPageType, number>;
  byStatus: Partial<Record<WikiPageStatus, number>>;
  findings: DoctorFinding[];
  nextActions: string[];
}

export interface DoctorResult {
  report: DoctorReport;
  markdown: string;
  json: string;
}

const PAGE_TYPES: WikiPageType[] = [
  "project_map",
  "module",
  "pitfall",
  "decision",
  "pattern",
  "rule",
  "file",
  "source"
];

function docPath(page: WikiPage): string {
  return `wiki/${page.relativePath}`;
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

function countByType(pages: WikiPage[]): Record<WikiPageType, number> {
  const counts = Object.fromEntries(PAGE_TYPES.map((type) => [type, 0])) as Record<WikiPageType, number>;
  for (const page of pages) {
    counts[page.frontmatter.type] += 1;
  }

  return counts;
}

function countByStatus(pages: WikiPage[]): Partial<Record<WikiPageStatus, number>> {
  const counts: Partial<Record<WikiPageStatus, number>> = {};
  for (const page of pages) {
    const status = page.frontmatter.status;
    if (status) {
      counts[status] = (counts[status] ?? 0) + 1;
    }
  }

  return counts;
}

function statusFindings(pages: WikiPage[]): DoctorFinding[] {
  return pages
    .filter((page) => page.frontmatter.status === "proposed" || page.frontmatter.status === "uncertain")
    .slice(0, 8)
    .map((page) => ({
      severity: "info",
      code: "review_non_active_memory",
      message: `${titleForPage(page)} is ${page.frontmatter.status}; review whether it should become active, stay pending, or be deprecated.`,
      path: docPath(page)
    }));
}

function longPageFindings(pages: WikiPage[]): DoctorFinding[] {
  return pages
    .map((page) => ({
      page,
      lines: page.body.split("\n").length
    }))
    .filter((item) => item.lines > 120)
    .slice(0, 8)
    .map((item) => ({
      severity: "warning",
      code: "long_memory_page",
      message: `${titleForPage(item.page)} has ${item.lines} body line(s); consider splitting dense memory into focused module, pitfall, decision, or rule pages.`,
      path: docPath(item.page)
    }));
}

function nextActions(report: Omit<DoctorReport, "nextActions">): string[] {
  const actions: string[] = [];
  if (report.summary.lintErrors > 0) {
    actions.push("Fix AIWiki lint errors before trusting memory output.");
  }
  if (report.summary.staleWarnings > 0) {
    actions.push("Run `aiwiki reflect --from-git-diff --read-only` and review refresh candidates for stale pages.");
  }
  if (report.summary.rulePromotionCandidates > 0) {
    actions.push("Run `aiwiki promote-rules` and review repeated high-severity pitfalls before promoting rules.");
  }
  if (report.summary.proposedPages + report.summary.uncertainPages > 0) {
    actions.push("Review proposed or uncertain pages and either activate, revise, or deprecate them.");
  }
  if (actions.length === 0) {
    actions.push("Memory health looks clean. Continue using `aiwiki codex`, `agent`, `guard`, and `reflect` during development.");
  }

  return actions;
}

function formatCounts(counts: Record<string, number> | Partial<Record<string, number>>): string[] {
  return Object.entries(counts)
    .filter(([, count]) => (count ?? 0) > 0)
    .map(([key, count]) => `${key}: ${count}`);
}

function formatFindings(findings: DoctorFinding[]): string {
  if (findings.length === 0) {
    return "- No memory governance findings.";
  }

  return findings
    .map((finding) => {
      const path = finding.path ? ` (${finding.path})` : "";
      return `- [${finding.severity}] ${finding.code}${path}: ${finding.message}`;
    })
    .join("\n");
}

export function formatDoctorReportMarkdown(report: DoctorReport): string {
  const typeCounts = formatCounts(report.byType);
  const statusCounts = formatCounts(report.byStatus);
  return [
    "# AIWiki Doctor Report",
    "",
    "## Summary",
    `- Pages checked: ${report.summary.pagesChecked}`,
    `- Lint errors: ${report.summary.lintErrors}`,
    `- Lint warnings: ${report.summary.lintWarnings}`,
    `- Stale warnings: ${report.summary.staleWarnings}`,
    `- Rule promotion candidates: ${report.summary.rulePromotionCandidates}`,
    `- Proposed pages: ${report.summary.proposedPages}`,
    `- Uncertain pages: ${report.summary.uncertainPages}`,
    `- Deprecated pages: ${report.summary.deprecatedPages}`,
    "",
    "## Memory Shape",
    ...(typeCounts.length > 0 ? typeCounts.map((item) => `- ${item}`) : ["- No wiki pages found."]),
    "",
    "## Status",
    ...(statusCounts.length > 0 ? statusCounts.map((item) => `- ${item}`) : ["- No explicit page statuses found."]),
    "",
    "## Findings",
    formatFindings(report.findings),
    "",
    "## Next Actions",
    ...report.nextActions.map((action) => `- ${action}`)
  ].join("\n") + "\n";
}

function doctorToJson(report: DoctorReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export async function doctorWiki(
  rootDir: string,
  options: DoctorOptions = {}
): Promise<DoctorResult> {
  const pages = await scanWikiPages(rootDir);
  const lint = await lintWiki(rootDir);
  const stale = await collectWikiStalenessWarnings(rootDir, pages);
  const promotions = await generateRulePromotionPreview(rootDir, {
    minCount: options.minRulePromotionCount
  });
  const byStatus = countByStatus(pages);
  const findings: DoctorFinding[] = [
    ...lint.report.issues.map((issue) => ({
      severity: issue.severity,
      code: issue.code,
      message: issue.message,
      path: issue.path
    })),
    ...stale.map((warning) => ({
      severity: "warning" as const,
      code: warning.code,
      message: warning.message,
      path: warning.page
    })),
    ...promotions.preview.candidates.map((candidate) => ({
      severity: "info" as const,
      code: "rule_promotion_candidate",
      message: `${candidate.title} is a repeated ${candidate.severity} pitfall candidate for rule promotion.`,
      path: candidate.sourcePitfalls[0]
    })),
    ...statusFindings(pages),
    ...longPageFindings(pages)
  ];
  const reportBase = {
    summary: {
      pagesChecked: pages.length,
      lintErrors: lint.report.summary.errors,
      lintWarnings: lint.report.summary.warnings,
      staleWarnings: stale.length,
      rulePromotionCandidates: promotions.preview.candidates.length,
      proposedPages: byStatus.proposed ?? 0,
      uncertainPages: byStatus.uncertain ?? 0,
      deprecatedPages: byStatus.deprecated ?? 0
    },
    byType: countByType(pages),
    byStatus,
    findings
  };
  const report: DoctorReport = {
    ...reportBase,
    nextActions: nextActions(reportBase)
  };

  return {
    report,
    markdown: formatDoctorReportMarkdown(report),
    json: doctorToJson(report)
  };
}
