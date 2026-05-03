import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { generateAgentContext } from "./agent.js";
import { generateDevelopmentBrief } from "./brief.js";
import { generateCodexRunbook } from "./codex.js";
import { generateFileGuardrails } from "./guard.js";
import { initAIWiki } from "./init.js";
import { generateMaintenanceReview } from "./maintain.js";
import { writeMarkdownFile } from "./markdown.js";
import {
  exportModulePack,
  generateModuleImportPreview
} from "./module-pack.js";
import type { OutputFormat } from "./output.js";
import { generatePrimeContext } from "./prime.js";
import {
  checkpointTask,
  resumeTask,
  startTask
} from "./task.js";

const execFileAsync = promisify(execFile);

export interface UsabilityEvalOptions {
  scenarioNames?: string[];
  format?: OutputFormat;
}

export interface UsabilityEvalCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface UsabilityEvalScenarioResult {
  name: string;
  userRequest: string;
  passed: boolean;
  checks: UsabilityEvalCheck[];
  excerpt: string;
}

export interface UsabilityEvalResult {
  passed: boolean;
  scenarios: UsabilityEvalScenarioResult[];
  markdown: string;
  json: string;
}

interface UsabilityEvalScenario {
  name: string;
  userRequest: string;
  run: () => Promise<UsabilityEvalScenarioResult>;
}

function check(name: string, passed: boolean, detail: string): UsabilityEvalCheck {
  return { name, passed, detail };
}

function scenarioResult(
  name: string,
  userRequest: string,
  checks: UsabilityEvalCheck[],
  excerpt: string
): UsabilityEvalScenarioResult {
  return {
    name,
    userRequest,
    checks,
    excerpt,
    passed: checks.every((item) => item.passed)
  };
}

function compactExcerpt(value: string, limit = 8): string {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, limit)
    .join(" | ");
}

async function tempProject(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
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

async function writeProjectFile(rootDir: string, relativePath: string, content: string): Promise<void> {
  const filePath = path.join(rootDir, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

async function initGitProject(rootDir: string): Promise<void> {
  await execFileAsync("git", ["init"], { cwd: rootDir });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], {
    cwd: rootDir
  });
  await execFileAsync("git", ["config", "user.name", "Test User"], {
    cwd: rootDir
  });
  await execFileAsync("git", ["add", "."], { cwd: rootDir });
  await execFileAsync("git", ["commit", "-m", "baseline"], { cwd: rootDir });
}

async function addPaymentMemory(rootDir: string): Promise<void> {
  const wikiDir = path.join(rootDir, ".aiwiki", "wiki");
  await mkdir(path.join(wikiDir, "modules"), { recursive: true });
  await mkdir(path.join(wikiDir, "pitfalls"), { recursive: true });
  await mkdir(path.join(wikiDir, "rules"), { recursive: true });

  await writeMarkdownFile(
    path.join(wikiDir, "modules", "payment.md"),
    {
      type: "module",
      title: "Payment",
      modules: ["payment"],
      files: ["src/app/api/stripe/webhook/route.ts"],
      risk: "high"
    },
    "# Module: Payment\n\nPayment creates checkout sessions and handles provider webhooks.\n"
  );
  await writeMarkdownFile(
    path.join(wikiDir, "pitfalls", "stripe-raw-body.md"),
    {
      type: "pitfall",
      title: "Stripe raw body",
      modules: ["payment"],
      files: ["src/app/api/stripe/webhook/route.ts"],
      severity: "critical"
    },
    "# Pitfall: Stripe raw body\n\nVerify webhook signatures before parsing JSON.\n"
  );
  await writeMarkdownFile(
    path.join(wikiDir, "rules", "payment-secrets.md"),
    {
      type: "rule",
      title: "Keep payment secrets server-side",
      modules: ["payment"],
      files: ["src/lib/stripe.ts"],
      severity: "high",
      status: "active"
    },
    "# Rule: Keep payment secrets server-side\n\nNever expose provider secrets to client code.\n"
  );
}

async function evaluateResumeFirst(): Promise<UsabilityEvalScenarioResult> {
  const userRequest = "继续昨天没做完的功能";
  const rootDir = await tempProject("aiwiki-usability-resume-");
  await initAIWiki({ rootDir, projectName: "resume-demo" });
  await writeProjectFile(rootDir, "src/resume-target.ts", "export const resumeTarget = true;\n");
  await startTask(rootDir, "Continue yesterday feature", {
    id: "continue-yesterday-feature",
    priority: 1,
    assignee: "codex"
  });
  await checkpointTask(rootDir, {
    step: "Built initial resume target",
    status: "done",
    tests: ["npm run test -- tests/resume-target.test.ts"],
    next: ["Run aiwiki guard src/resume-target.ts before editing the next behavior."]
  });

  const prime = await generatePrimeContext(rootDir);
  const resume = await resumeTask(rootDir, undefined, { readOnly: true });
  const nextLine = resume.markdown.split("\n")[2] ?? "";
  const checks = [
    check(
      "resume-next-action-first",
      nextLine.includes("下一步做什么 / Next Action:") &&
        nextLine.includes("src/resume-target.ts"),
      nextLine
    ),
    check(
      "prime-surfaces-active-task",
      prime.context.actions.some((action) => action.kind === "resume_task"),
      "prime should suggest resume before broad implementation"
    )
  ];

  return scenarioResult("resume-first", userRequest, checks, compactExcerpt(resume.markdown));
}

async function evaluatePaymentGuardPrecision(): Promise<UsabilityEvalScenarioResult> {
  const userRequest = "帮我改这个文件，别踩之前支付 webhook 的坑";
  const rootDir = await tempProject("aiwiki-usability-guard-");
  await writeProjectFile(
    rootDir,
    "src/brief.ts",
    [
      "export const guidance = [",
      "  'webhook event parsing and idempotency',",
      "  'Focused tests should cover auth, webhooks, migrations, or billing if this task touches those domains.',",
      "  'Money/payment flow change: cover amount/currency math before shipping.'",
      "];"
    ].join("\n")
  );
  await writeProjectFile(
    rootDir,
    "src/checkout.ts",
    "export function chargeOrder(amountCents: number, currency: string) { return { amountCents, currency }; }\n"
  );

  const advisory = await generateFileGuardrails(rootDir, "src/brief.ts");
  const checkout = await generateFileGuardrails(rootDir, "src/checkout.ts");
  const checks = [
    check(
      "generic-advisory-not-payment-risk",
      !advisory.markdown.includes("Money/payment flow change"),
      "src/brief.ts advisory text should stay quiet"
    ),
    check(
      "real-payment-code-still-guarded",
      checkout.markdown.includes("Money/payment flow change"),
      "checkout amount/currency handling should still be guarded"
    )
  ];

  return scenarioResult("guard-payment-precision", userRequest, checks, compactExcerpt(advisory.markdown));
}

async function evaluateModuleImportPreview(): Promise<UsabilityEvalScenarioResult> {
  const userRequest = "把之前项目的 billing 模块经验迁移过来";
  const sourceDir = await tempProject("aiwiki-usability-module-source-");
  await initAIWiki({ rootDir: sourceDir, projectName: "source-app" });
  await addPaymentMemory(sourceDir);
  const exported = await exportModulePack(sourceDir, "payment", {
    output: ".aiwiki/module-packs/payment.aiwiki-pack.json"
  });

  const targetDir = await tempProject("aiwiki-usability-module-target-");
  await initAIWiki({ rootDir: targetDir, projectName: "target-app" });
  const preview = await generateModuleImportPreview(targetDir, exported.outputPath!, {
    as: "billing",
    targetStack: "FastAPI + PostgreSQL"
  });
  const targetModulePath = path.join(targetDir, ".aiwiki", "wiki", "modules", "billing.md");
  const statuses = preview.preview.updatePlanDraft.entries.map((entry) => entry.status);
  const checks = [
    check(
      "preview-only-no-output-plan",
      preview.outputPlanPath === undefined && !(await pathExists(targetModulePath)),
      "import preview should not write wiki pages or output plans unless requested"
    ),
    check(
      "imported-memory-proposed",
      statuses.length > 0 && statuses.every((status) => status === "proposed"),
      `entry statuses: ${statuses.join(", ")}`
    ),
    check(
      "portability-warning-visible",
      preview.markdown.includes("Do not copy source code directly"),
      "preview should warn against blind source-code copying"
    )
  ];

  return scenarioResult("module-import-preview", userRequest, checks, compactExcerpt(preview.markdown));
}

async function evaluateMaintainabilityRequest(): Promise<UsabilityEvalScenarioResult> {
  const userRequest = "实现一个新功能，代码要可维护，不要硬编码";
  const rootDir = await tempProject("aiwiki-usability-maintainable-");
  await initAIWiki({ rootDir, projectName: "maintainable-demo" });
  await writeProjectFile(rootDir, "src/feature.ts", "export const feature = true;\n");
  await initGitProject(rootDir);
  await writeProjectFile(rootDir, "src/feature.ts", "export const feature = false;\n");

  const brief = await generateDevelopmentBrief(rootDir, userRequest, {
    architectureGuard: true,
    readOnly: true,
    format: "json"
  });
  const agent = await generateAgentContext(rootDir, userRequest, {
    architectureGuard: true
  });
  const runbook = await generateCodexRunbook(rootDir, userRequest, {
    team: true
  });
  const sections = brief.brief.sections;
  const hardcoding = sections.find((section) => section.title === "Hardcoding and Configuration Risks");
  const architectureGuard = sections.find((section) => section.title === "Architecture Guard");
  const checks = [
    check(
      "hardcoding-guidance-present",
      Boolean(hardcoding && hardcoding.items.length > 0),
      "brief should surface hardcoding/configuration risks"
    ),
    check(
      "architecture-boundary-present",
      Boolean(
        architectureGuard?.items.some((item) =>
          item.includes("Keep route/controller files thin")
        )
      ),
      "architecture guard should push boundaries without refactoring by default"
    ),
    check(
      "agent-next-commands-compact",
      agent.context.nextCommands.length <= 3,
      `next commands: ${agent.context.nextCommands.join(" | ")}`
    ),
    check(
      "runbook-guards-changed-source",
      runbook.runbook.commands.beforeEditing.includes("aiwiki guard src/feature.ts"),
      `before editing: ${runbook.runbook.commands.beforeEditing.join(" | ")}`
    ),
    check(
      "runbook-codex-owned",
      runbook.markdown.includes("The user only needs to describe the requirement"),
      "runbook should speak to Codex as the operator"
    )
  ];

  return scenarioResult("maintainability-request", userRequest, checks, compactExcerpt(runbook.markdown));
}

async function evaluateMaintainStaleRefresh(): Promise<UsabilityEvalScenarioResult> {
  const userRequest = "这个阶段做完了，帮我检查记忆有没有不同步";
  const rootDir = await tempProject("aiwiki-usability-maintain-");
  await initAIWiki({ rootDir, projectName: "maintain-demo" });
  await writeProjectFile(rootDir, "src/prime.ts", "export const prime = 'baseline';\n");
  await writeMarkdownFile(
    path.join(rootDir, ".aiwiki", "wiki", "modules", "prime.md"),
    {
      type: "module",
      title: "Prime",
      status: "active",
      modules: ["prime"],
      files: ["src/prime.ts"],
      last_updated: "2020-01-01"
    },
    "# Module: Prime\n\nOld prime memory.\n"
  );
  await initGitProject(rootDir);
  await writeProjectFile(
    rootDir,
    "src/prime.ts",
    "export const prime = 'aiwiki prime active task ready work memory health';\n"
  );

  const planPath = ".aiwiki/context-packs/maintain-plan.json";
  const maintain = await generateMaintenanceReview(rootDir, {
    outputPlan: planPath
  });
  const plan = JSON.parse(
    await readFile(path.join(rootDir, planPath), "utf8")
  ) as {
    entries: Array<{
      title: string;
      source?: string;
      append?: Array<{ heading: string; body: string }>;
    }>;
  };
  const prime = plan.entries.find((entry) => entry.title === "Prime");
  const primePage = await readFile(
    path.join(rootDir, ".aiwiki", "wiki", "modules", "prime.md"),
    "utf8"
  );
  const checks = [
    check(
      "maintain-writes-review-plan",
      Boolean(maintain.report.reflect.outputPlanPath) &&
        maintain.report.reflect.candidateWrites > 0,
      `candidate writes: ${maintain.report.reflect.candidateWrites}`
    ),
    check(
      "stale-existing-page-becomes-append",
      prime?.source === "maintain" &&
        Boolean(prime.append?.some((item) => item.heading === "Maintenance Review")),
      "stale existing memory should be reviewed through an append plan"
    ),
    check(
      "maintain-stays-preview-first",
      !primePage.includes("Maintenance Review"),
      "maintain should not mutate wiki pages without apply --confirm"
    ),
    check(
      "apply-preview-next-action-visible",
      maintain.report.nextActions.some((action) =>
        action.includes(`aiwiki apply ${planPath}`)
      ),
      maintain.report.nextActions.join(" | ")
    )
  ];

  return scenarioResult("maintain-stale-refresh", userRequest, checks, compactExcerpt(maintain.markdown));
}

const DEFAULT_USABILITY_EVAL_SCENARIOS: UsabilityEvalScenario[] = [
  {
    name: "resume-first",
    userRequest: "继续昨天没做完的功能",
    run: evaluateResumeFirst
  },
  {
    name: "guard-payment-precision",
    userRequest: "帮我改这个文件，别踩之前支付 webhook 的坑",
    run: evaluatePaymentGuardPrecision
  },
  {
    name: "module-import-preview",
    userRequest: "把之前项目的 billing 模块经验迁移过来",
    run: evaluateModuleImportPreview
  },
  {
    name: "maintainability-request",
    userRequest: "实现一个新功能，代码要可维护，不要硬编码",
    run: evaluateMaintainabilityRequest
  },
  {
    name: "maintain-stale-refresh",
    userRequest: "这个阶段做完了，帮我检查记忆有没有不同步",
    run: evaluateMaintainStaleRefresh
  }
];

function selectScenarios(
  scenarios: UsabilityEvalScenario[],
  scenarioNames: string[] | undefined
): UsabilityEvalScenario[] {
  if (!scenarioNames || scenarioNames.length === 0) {
    return scenarios;
  }

  const wanted = new Set(scenarioNames);
  const selected = scenarios.filter((scenario) => wanted.has(scenario.name));
  const selectedNames = new Set(selected.map((scenario) => scenario.name));
  const missing = [...wanted].filter((name) => !selectedNames.has(name));
  if (missing.length > 0) {
    throw new Error(`Unknown usability eval scenario(s): ${missing.join(", ")}`);
  }

  return selected;
}

function formatScenarioMarkdown(result: UsabilityEvalScenarioResult): string[] {
  return [
    `## ${result.name}`,
    "",
    `- Status: ${result.passed ? "PASS" : "FAIL"}`,
    `- User request: ${result.userRequest}`,
    "",
    "### Checks",
    "",
    ...result.checks.map((item) =>
      `- ${item.passed ? "PASS" : "FAIL"} ${item.name}: ${item.detail}`
    ),
    "",
    "### Excerpt",
    "",
    result.excerpt || "No excerpt captured."
  ];
}

function formatUsabilityEvalMarkdown(result: Omit<UsabilityEvalResult, "markdown" | "json">): string {
  return [
    "# AIWiki Codex-Owned Usability Eval",
    "",
    `Status: ${result.passed ? "PASS" : "FAIL"}`,
    "",
    ...result.scenarios.flatMap(formatScenarioMarkdown)
  ].join("\n").trimEnd() + "\n";
}

function usabilityEvalToJson(result: Omit<UsabilityEvalResult, "markdown" | "json">): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

export async function runUsabilityEval(options: UsabilityEvalOptions = {}): Promise<UsabilityEvalResult> {
  const scenarios = selectScenarios(
    DEFAULT_USABILITY_EVAL_SCENARIOS,
    options.scenarioNames
  );
  const results = await Promise.all(scenarios.map((scenario) => scenario.run()));
  const base = {
    scenarios: results,
    passed: results.every((scenario) => scenario.passed)
  };

  return {
    ...base,
    markdown: formatUsabilityEvalMarkdown(base),
    json: usabilityEvalToJson(base)
  };
}
