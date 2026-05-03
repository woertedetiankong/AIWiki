import { loadAIWikiConfig } from "./config.js";
import { AIWIKI_VERSION, DEFAULT_RULE_PROMOTION_MIN_COUNT } from "./constants.js";
import type { WikiUpdatePlan } from "./apply.js";
import type { AIWikiConfig, RiskLevel, WikiPage } from "./types.js";
import { scanWikiPages } from "./wiki-store.js";

export interface PromoteRulesOptions {
  minCount?: number;
}

export interface RulePromotionCandidate {
  title: string;
  rule: string;
  why: string[];
  appliesTo: {
    modules: string[];
    files: string[];
  };
  sourcePitfalls: string[];
  severity: RiskLevel;
  encounteredCount: number;
  suggestedTargets: string[];
  requiresConfirmation: true;
}

export interface RulePromotionPreview {
  minCount: number;
  candidates: RulePromotionCandidate[];
  updatePlan?: WikiUpdatePlan;
  updatePlanDraft?: WikiUpdatePlan;
  skipped: string[];
  safety: string[];
}

export interface RulePromotionResult {
  preview: RulePromotionPreview;
  markdown: string;
  json: string;
}

const SEVERITY_RANK: Record<RiskLevel, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4
};

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
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

function firstBodyLine(page: WikiPage): string | undefined {
  return page.body
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("#"));
}

function docPath(page: WikiPage): string {
  return `wiki/${page.relativePath}`;
}

function suggestedTargets(config: AIWikiConfig): string[] {
  const targets = ["wiki/rules"];
  if (config.rulesTargets.agentsMd) {
    targets.push("AGENTS.md");
  }
  if (config.rulesTargets.claudeMd) {
    targets.push("CLAUDE.md");
  }
  if (config.rulesTargets.cursorRules) {
    targets.push(".cursor/rules");
  }

  return targets;
}

function isPromotablePitfall(page: WikiPage, minCount: number): boolean {
  const severity = page.frontmatter.severity;
  const encounteredCount = page.frontmatter.encountered_count ?? 0;
  return (
    page.frontmatter.type === "pitfall" &&
    page.frontmatter.status !== "deprecated" &&
    (severity === "high" || severity === "critical") &&
    encounteredCount >= minCount
  );
}

function ruleTitleForPitfall(page: WikiPage): string {
  const title = titleForPage(page).replace(/^Pitfall:\s*/iu, "").trim();
  return title.toLowerCase().startsWith("rule:")
    ? title
    : `Rule: Avoid ${title}`;
}

function ruleBodyForPitfall(page: WikiPage): string {
  const excerpt = firstBodyLine(page);
  if (excerpt) {
    return excerpt;
  }

  return `Avoid repeating the pitfall documented in ${docPath(page)}.`;
}

function candidateForPitfall(
  page: WikiPage,
  config: AIWikiConfig
): RulePromotionCandidate {
  const severity = page.frontmatter.severity ?? "high";
  const encounteredCount = page.frontmatter.encountered_count ?? 0;
  const modules = page.frontmatter.modules ?? [];
  const files = page.frontmatter.files ?? [];
  const why = [
    `Severity is ${severity}.`,
    `Encountered ${encounteredCount} time(s).`
  ];

  if (modules.some((moduleName) => config.highRiskModules.includes(moduleName))) {
    why.push("Applies to a configured high-risk module.");
  }

  if (files.some((file) => config.riskFiles.includes(file))) {
    why.push("Applies to a configured risk file.");
  }

  return {
    title: ruleTitleForPitfall(page),
    rule: ruleBodyForPitfall(page),
    why,
    appliesTo: {
      modules,
      files
    },
    sourcePitfalls: [docPath(page)],
    severity,
    encounteredCount,
    suggestedTargets: suggestedTargets(config),
    requiresConfirmation: true
  };
}

function skippedPitfalls(pages: WikiPage[], minCount: number): string[] {
  return pages
    .filter((page) => page.frontmatter.type === "pitfall")
    .filter((page) => !isPromotablePitfall(page, minCount))
    .map((page) => {
      const severity = page.frontmatter.severity ?? "unspecified";
      const count = page.frontmatter.encountered_count ?? 0;
      return `${titleForPage(page)} (${docPath(page)}; severity ${severity}; encountered ${count})`;
    })
    .sort();
}

function formatList(items: string[], fallback: string): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : `- ${fallback}`;
}

function formatCandidate(candidate: RulePromotionCandidate, index: number): string {
  return [
    `## ${index + 1}. ${candidate.title}`,
    "",
    `- Rule: ${candidate.rule}`,
    `- Severity: ${candidate.severity}`,
    `- Encountered Count: ${candidate.encounteredCount}`,
    `- Applies To Modules: ${candidate.appliesTo.modules.join(", ") || "none"}`,
    `- Applies To Files: ${candidate.appliesTo.files.join(", ") || "none"}`,
    `- Source Pitfalls: ${candidate.sourcePitfalls.join(", ")}`,
    `- Suggested Targets: ${candidate.suggestedTargets.join(", ")}`,
    "- Requires Confirmation: yes",
    "",
    "Why:",
    ...candidate.why.map((item) => `- ${item}`)
  ].join("\n");
}

function updatePlanForCandidates(
  candidates: RulePromotionCandidate[]
): WikiUpdatePlan | undefined {
  if (candidates.length === 0) {
    return undefined;
  }

  return {
    version: AIWIKI_VERSION,
    title: "Rule promotion candidates",
    entries: candidates.map((candidate) => ({
      type: "rule",
      title: candidate.title.replace(/^Rule:\s*/iu, ""),
      source: "promote-rules",
      status: "proposed",
      modules: candidate.appliesTo.modules,
      files: candidate.appliesTo.files,
      severity: candidate.severity,
      frontmatter: {
        source_pitfalls: candidate.sourcePitfalls,
        encountered_count: candidate.encounteredCount
      },
      summary: candidate.rule
    }))
  };
}

export function formatRulePromotionPreviewMarkdown(
  preview: RulePromotionPreview
): string {
  const lines = [
    "# Rule Promotion Preview",
    "",
    `Minimum encountered count: ${preview.minCount}`,
    "",
    "## Candidates"
  ];

  if (preview.candidates.length === 0) {
    lines.push("- No rule promotion candidates found.");
  } else {
    lines.push(
      ...preview.candidates.flatMap((candidate, index) => [
        formatCandidate(candidate, index),
        ""
      ])
    );
  }

  lines.push(
    "## Update Plan Draft",
    preview.updatePlanDraft
      ? "- Save the JSON output and run `aiwiki apply <plan.json> --confirm` after reviewing the rule text."
      : "- No update plan draft was generated.",
    "",
    "## Skipped Pitfalls",
    formatList(preview.skipped, "No skipped pitfalls."),
    "",
    "## Safety",
    ...preview.safety.map((item) => `- ${item}`)
  );

  return `${lines.join("\n").trimEnd()}\n`;
}

function promotionToJson(preview: RulePromotionPreview): string {
  return `${JSON.stringify(preview, null, 2)}\n`;
}

export async function generateRulePromotionPreview(
  rootDir: string,
  options: PromoteRulesOptions = {}
): Promise<RulePromotionResult> {
  const config = await loadAIWikiConfig(rootDir);
  const minCount = options.minCount ?? DEFAULT_RULE_PROMOTION_MIN_COUNT;
  const pages = await scanWikiPages(rootDir);
  const candidates = pages
    .filter((page) => isPromotablePitfall(page, minCount))
    .map((page) => candidateForPitfall(page, config))
    .sort((a, b) => {
      const severityDelta = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
      if (severityDelta !== 0) {
        return severityDelta;
      }

      if (b.encounteredCount !== a.encounteredCount) {
        return b.encounteredCount - a.encounteredCount;
      }

      return a.title.localeCompare(b.title);
    });

  const updatePlanDraft = updatePlanForCandidates(candidates);
  const preview: RulePromotionPreview = {
    minCount,
    candidates,
    updatePlan: updatePlanDraft,
    updatePlanDraft,
    skipped: skippedPitfalls(pages, minCount),
    safety: [
      "This preview does not write wiki/rules pages.",
      "This preview does not modify AGENTS.md, CLAUDE.md, or .cursor/rules.",
      "Promote only stable, repeated, high-impact lessons after user confirmation."
    ]
  };

  return {
    preview,
    markdown: formatRulePromotionPreviewMarkdown(preview),
    json: promotionToJson(preview)
  };
}
