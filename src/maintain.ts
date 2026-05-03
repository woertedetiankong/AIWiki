import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { WikiUpdatePageType, WikiUpdatePlan, WikiUpdatePlanEntry } from "./apply.js";
import { wikiUpdatePlanSchema } from "./apply.js";
import { AIWikiNotInitializedError, loadAIWikiConfig } from "./config.js";
import { doctorWiki } from "./doctor.js";
import type { DoctorFinding, DoctorReport } from "./doctor.js";
import type { OutputFormat } from "./output.js";
import { resolveProjectPath } from "./paths.js";
import { generateReflectPreview } from "./reflect.js";
import { collectWikiStalenessWarnings } from "./staleness.js";
import type { WikiStalenessWarning } from "./staleness.js";
import type { WikiPage } from "./types.js";
import { scanWikiPages } from "./wiki-store.js";

export interface MaintainOptions {
  fromGitDiff?: boolean;
  outputPlan?: string;
  force?: boolean;
  minRulePromotionCount?: number;
  format?: OutputFormat;
}

export type MaintainStatus = "clean" | "needs_review" | "blocked" | "setup_required";

export type MaintainReflectStatus = "checked" | "skipped" | "failed";

export interface MaintainReflectSummary {
  status: MaintainReflectStatus;
  fromGitDiff: boolean;
  changedFiles: string[];
  selectedDocs: string[];
  candidateWrites: number;
  outputPlanPath?: string;
  error?: string;
}

export interface MaintainReport {
  projectName: string;
  initialized: boolean;
  status: MaintainStatus;
  doctor: DoctorReport;
  reflect: MaintainReflectSummary;
  nextActions: string[];
  safety: string[];
}

export interface MaintainResult {
  report: MaintainReport;
  markdown: string;
  json: string;
}

const DEFAULT_PLAN_PATH = ".aiwiki/context-packs/maintain-reflect-plan.json";

const TYPE_DIRS: Record<WikiUpdatePageType, string> = {
  module: "modules",
  pitfall: "pitfalls",
  decision: "decisions",
  pattern: "patterns",
  rule: "rules"
};

const UPDATE_PAGE_TYPES = new Set<WikiUpdatePageType>([
  "module",
  "pitfall",
  "decision",
  "pattern",
  "rule"
]);

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");
}

function entryPath(entry: WikiUpdatePlanEntry): string {
  const slug = entry.slug ?? slugify(entry.title);
  return `.aiwiki/wiki/${TYPE_DIRS[entry.type]}/${slug}.md`;
}

async function projectName(rootDir: string): Promise<string> {
  try {
    const config = await loadAIWikiConfig(rootDir);
    return config.projectName;
  } catch (error) {
    if (error instanceof AIWikiNotInitializedError) {
      return path.basename(path.resolve(rootDir)) || "project";
    }

    throw error;
  }
}

function isInitialized(report: DoctorReport): boolean {
  return !report.findings.some((finding) => finding.code === "not_initialized");
}

function docPath(page: WikiPage): string {
  return `wiki/${page.relativePath}`;
}

function pageTitle(page: WikiPage): string {
  if (page.frontmatter.title && page.frontmatter.title.trim().length > 0) {
    return page.frontmatter.title;
  }

  const heading = page.body
    .split("\n")
    .find((line) => line.trim().startsWith("#"));
  return heading ? heading.replace(/^#+\s*/u, "").trim() : page.relativePath;
}

function updatePageType(page: WikiPage): WikiUpdatePageType | undefined {
  const type = page.frontmatter.type;
  return UPDATE_PAGE_TYPES.has(type as WikiUpdatePageType)
    ? type as WikiUpdatePageType
    : undefined;
}

function stalenessByPage(warnings: WikiStalenessWarning[]): Map<string, WikiStalenessWarning[]> {
  const grouped = new Map<string, WikiStalenessWarning[]>();
  for (const warning of warnings.filter((item) => item.code === "stale_referenced_file")) {
    grouped.set(warning.page, [...(grouped.get(warning.page) ?? []), warning]);
  }

  return grouped;
}

function refreshAppendBody(page: WikiPage, warnings: WikiStalenessWarning[]): string {
  const files = warnings.map((warning) => warning.file);
  const sample = files.slice(0, 8);
  const omitted = files.length - sample.length;
  return [
    "AIWiki maintain flagged this page because referenced project files changed after the page's `last_updated` value.",
    "",
    "Changed referenced files:",
    ...sample.map((file) => `- ${file}`),
    ...(omitted > 0 ? [`- ${omitted} more file(s) omitted from this maintenance note.`] : []),
    "",
    "Before confirming this append, review the current page against those files. If the page is stale or misleading, edit the memory content instead of blindly confirming this plan.",
    "",
    `Confirming this append records that ${docPath(page)} was reviewed through the maintain workflow.`
  ].join("\n");
}

function staleRefreshEntry(
  entry: WikiUpdatePlanEntry,
  page: WikiPage,
  warnings: WikiStalenessWarning[]
): WikiUpdatePlanEntry {
  return {
    ...entry,
    source: "maintain",
    summary: entry.summary ?? `${pageTitle(page)} needs a stale-memory maintenance review.`,
    append: [
      ...(entry.append ?? []),
      {
        heading: "Maintenance Review",
        body: refreshAppendBody(page, warnings)
      }
    ]
  };
}

async function maintainPlanFromReflect(
  rootDir: string,
  reflectPlan: WikiUpdatePlan | undefined
): Promise<WikiUpdatePlan | undefined> {
  if (!reflectPlan || reflectPlan.entries.length === 0) {
    return undefined;
  }

  const pages = await scanWikiPages(rootDir);
  const warnings = stalenessByPage(await collectWikiStalenessWarnings(rootDir, pages));
  const pageEntries: Array<[string, WikiPage]> = [];
  for (const page of pages) {
    if (updatePageType(page)) {
      pageEntries.push([`.aiwiki/wiki/${page.relativePath}`, page]);
    }
  }
  const pagesByUpdatePath = new Map(pageEntries);
  const entries = reflectPlan.entries.map((entry) => {
    const page = pagesByUpdatePath.get(entryPath(entry));
    const pageWarnings = page ? warnings.get(docPath(page)) : undefined;
    return page && pageWarnings && pageWarnings.length > 0
      ? staleRefreshEntry(entry, page, pageWarnings)
      : entry;
  });

  return wikiUpdatePlanSchema.parse({
    ...reflectPlan,
    title: reflectPlan.title
      ? `Maintain: ${reflectPlan.title.replace(/^Reflect:\s*/u, "")}`
      : "Maintain: Memory refresh proposals",
    entries
  });
}

async function writeOutputPlanFile(
  rootDir: string,
  outputPlan: string,
  plan: WikiUpdatePlan,
  force: boolean
): Promise<string> {
  const outputPath = resolveProjectPath(rootDir, outputPlan);
  if (!force && (await pathExists(outputPath))) {
    throw new Error(`Refusing to overwrite existing output plan: ${outputPlan}`);
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  return outputPath;
}

function determineStatus(
  initialized: boolean,
  doctor: DoctorReport,
  reflect: MaintainReflectSummary
): MaintainStatus {
  if (!initialized) {
    return "setup_required";
  }
  if (doctor.summary.lintErrors > 0) {
    return "blocked";
  }
  if (
    doctor.summary.lintWarnings > 0 ||
    doctor.summary.staleWarnings > 0 ||
    doctor.summary.rulePromotionCandidates > 0 ||
    doctor.summary.proposedPages > 0 ||
    doctor.summary.uncertainPages > 0 ||
    doctor.summary.deprecatedPages > 0 ||
    reflect.candidateWrites > 0 ||
    reflect.status === "failed"
  ) {
    return "needs_review";
  }

  return "clean";
}

async function reflectSummary(
  rootDir: string,
  options: MaintainOptions
): Promise<MaintainReflectSummary> {
  const fromGitDiff = options.fromGitDiff ?? true;
  if (!fromGitDiff) {
    return {
      status: "skipped",
      fromGitDiff: false,
      changedFiles: [],
      selectedDocs: [],
      candidateWrites: 0
    };
  }

  try {
    const result = await generateReflectPreview(rootDir, {
      fromGitDiff: true,
      readOnly: true
    });
    const plan = await maintainPlanFromReflect(rootDir, result.preview.updatePlanDraft);
    const outputPlanPath = options.outputPlan && plan
      ? await writeOutputPlanFile(rootDir, options.outputPlan, plan, options.force ?? false)
      : undefined;

    return {
      status: "checked",
      fromGitDiff: true,
      changedFiles: result.preview.changedFiles,
      selectedDocs: result.preview.selectedDocs,
      candidateWrites: plan?.entries.length ?? result.preview.updatePlanDraft?.entries.length ?? 0,
      outputPlanPath
    };
  } catch (error) {
    return {
      status: "failed",
      fromGitDiff: true,
      changedFiles: [],
      selectedDocs: [],
      candidateWrites: 0,
      error: errorMessage(error)
    };
  }
}

function nextActions(
  doctor: DoctorReport,
  reflect: MaintainReflectSummary,
  options: MaintainOptions
): string[] {
  const actions: string[] = [];

  if (doctor.findings.some((finding) => finding.code === "not_initialized")) {
    actions.push(...doctor.nextActions);
  }
  if (doctor.summary.lintErrors > 0) {
    actions.push("Fix AIWiki lint errors before trusting generated maintenance guidance.");
  }
  if (reflect.status === "failed" && reflect.error) {
    actions.push(`Reflect check did not complete: ${reflect.error}`);
  }
  if (reflect.candidateWrites > 0 && reflect.outputPlanPath) {
    const planPath = options.outputPlan ?? reflect.outputPlanPath;
    actions.push(`Preview candidate memory writes with \`aiwiki apply ${planPath}\`.`);
    actions.push("Run `aiwiki apply <plan> --confirm` only after explicit user approval.");
  } else if (reflect.candidateWrites > 0) {
    actions.push(`Generate a reviewable plan with \`aiwiki maintain --output-plan ${DEFAULT_PLAN_PATH}\`.`);
  }
  if (doctor.summary.staleWarnings > 0) {
    actions.push("Review stale wiki pages before relying on them for future Codex runs.");
  }
  if (doctor.summary.rulePromotionCandidates > 0) {
    actions.push("Run `aiwiki promote-rules` and review repeated high-severity pitfalls before promoting rules.");
  }
  if (doctor.summary.proposedPages + doctor.summary.uncertainPages > 0) {
    actions.push("Review proposed or uncertain pages and either activate, revise, or deprecate them.");
  }
  if (actions.length === 0) {
    actions.push("Memory maintenance looks clean. Continue using `aiwiki agent`, `guard`, and `reflect` during development.");
  }

  return unique(actions);
}

function safetyLines(outputPlan?: string, outputPlanPath?: string): string[] {
  return [
    "This command never confirms long-term wiki writes.",
    outputPlanPath
      ? "The output plan is a reviewable local artifact; preview it with `aiwiki apply <plan>` before any confirmation."
      : outputPlan
        ? "No output plan was written because this review did not produce a candidate update plan."
      : "No output plan was written because `--output-plan` was not provided.",
    "Do not run `aiwiki apply <plan> --confirm` unless the user explicitly approves the candidate memory."
  ];
}

function formatFinding(finding: DoctorFinding): string {
  const pathText = finding.path ? ` (${finding.path})` : "";
  return `[${finding.severity}] ${finding.code}${pathText}: ${finding.message}`;
}

function formatMaintenanceMarkdown(report: MaintainReport): string {
  const findings = report.doctor.findings.slice(0, 8).map(formatFinding);
  const omitted = report.doctor.findings.length - findings.length;
  return [
    "# AIWiki Maintenance Review",
    "",
    "## Status",
    `- Overall: ${report.status}`,
    `- Project: ${report.projectName}`,
    `- Initialized: ${report.initialized ? "yes" : "no"}`,
    `- Pages checked: ${report.doctor.summary.pagesChecked}`,
    `- Lint errors: ${report.doctor.summary.lintErrors}`,
    `- Lint warnings: ${report.doctor.summary.lintWarnings}`,
    `- Stale warnings: ${report.doctor.summary.staleWarnings}`,
    `- Rule promotion candidates: ${report.doctor.summary.rulePromotionCandidates}`,
    `- Proposed pages: ${report.doctor.summary.proposedPages}`,
    `- Uncertain pages: ${report.doctor.summary.uncertainPages}`,
    "",
    "## Reflect",
    `- Status: ${report.reflect.status}`,
    `- From git diff: ${report.reflect.fromGitDiff ? "yes" : "no"}`,
    `- Changed files: ${report.reflect.changedFiles.length}`,
    `- Selected memory docs: ${report.reflect.selectedDocs.length}`,
    `- Candidate wiki writes: ${report.reflect.candidateWrites}`,
    report.reflect.outputPlanPath
      ? `- Output plan: ${report.reflect.outputPlanPath}`
      : "- Output plan: not written",
    report.reflect.error ? `- Error: ${report.reflect.error}` : undefined,
    "",
    "## Findings",
    ...(findings.length > 0 ? findings.map((item) => `- ${item}`) : ["- No memory governance findings."]),
    ...(omitted > 0 ? [`- ${omitted} more finding(s) omitted from markdown; use --format json for full detail.`] : []),
    "",
    "## Next Actions",
    ...report.nextActions.map((action) => `- ${action}`),
    "",
    "## Safety",
    ...report.safety.map((item) => `- ${item}`)
  ].filter((line): line is string => line !== undefined).join("\n") + "\n";
}

function maintainToJson(report: MaintainReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export async function generateMaintenanceReview(
  rootDir: string,
  options: MaintainOptions = {}
): Promise<MaintainResult> {
  const doctor = await doctorWiki(rootDir, {
    minRulePromotionCount: options.minRulePromotionCount
  });
  const reflect = await reflectSummary(rootDir, options);
  const initialized = isInitialized(doctor.report);
  const report: MaintainReport = {
    projectName: await projectName(rootDir),
    initialized,
    status: determineStatus(initialized, doctor.report, reflect),
    doctor: doctor.report,
    reflect,
    nextActions: nextActions(doctor.report, reflect, options),
    safety: safetyLines(options.outputPlan, reflect.outputPlanPath)
  };

  return {
    report,
    markdown: formatMaintenanceMarkdown(report),
    json: maintainToJson(report)
  };
}
