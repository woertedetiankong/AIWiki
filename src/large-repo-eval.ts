import { execFile } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { generateCodexRunbook } from "./codex.js";
import { generateFileGuardrails } from "./guard.js";
import type { OutputFormat } from "./output.js";
import { generatePrimeContext } from "./prime.js";

const execFileAsync = promisify(execFile);

export interface LargeRepoGuardCheck {
  file: string;
  expectedRiskIncludes: string[];
}

export interface LargeRepoFixture {
  name: string;
  repoUrl: string;
  sparsePaths: string[];
  task: string;
  guardChecks: LargeRepoGuardCheck[];
}

export interface LargeRepoEvalOptions {
  cacheDir?: string;
  fixtures?: LargeRepoFixture[];
  fixtureNames?: string[];
  skipClone?: boolean;
  format?: OutputFormat;
}

export interface LargeRepoGuardCheckResult {
  file: string;
  changeRisks: string[];
  expectedRiskIncludes: string[];
  exists: boolean;
  coveredBySparsePath: boolean;
  passed: boolean;
  missing: string[];
}

export interface LargeRepoGuardTargetCheck {
  file: string;
  exists: boolean;
  coveredBySparsePath: boolean;
}

export interface LargeRepoFixtureResult {
  name: string;
  repoUrl: string;
  repoDir: string;
  passed: boolean;
  primeInitialized: boolean;
  codexInitialized: boolean;
  guardTargets: string[];
  guardTargetChecks: LargeRepoGuardTargetCheck[];
  missingGuardTargets: string[];
  guardTargetsOutsideSparsePaths: string[];
  guardChecks: LargeRepoGuardCheckResult[];
  errors: string[];
}

export interface LargeRepoEvalResult {
  cacheDir: string;
  passed: boolean;
  fixtures: LargeRepoFixtureResult[];
  markdown: string;
  json: string;
}

export const DEFAULT_LARGE_REPO_FIXTURES: LargeRepoFixture[] = [
  {
    name: "django-python",
    repoUrl: "https://github.com/django/django.git",
    sparsePaths: [
      "pyproject.toml",
      "django/contrib/auth/views.py",
      "django/contrib/auth/migrations/*"
    ],
    task: "assess a representative Python web change",
    guardChecks: [
      {
        file: "django/contrib/auth/views.py",
        expectedRiskIncludes: ["Python web/API boundary change"]
      }
    ]
  },
  {
    name: "spring-java",
    repoUrl: "https://github.com/spring-projects/spring-framework.git",
    sparsePaths: [
      "build.gradle",
      "settings.gradle",
      "spring-webmvc/src/main/java/org/springframework/web/servlet/mvc/method/annotation/RequestMappingHandlerMapping.java"
    ],
    task: "assess a representative Java web change",
    guardChecks: [
      {
        file: "spring-webmvc/src/main/java/org/springframework/web/servlet/mvc/method/annotation/RequestMappingHandlerMapping.java",
        expectedRiskIncludes: ["Java controller/API boundary change"]
      }
    ]
  },
  {
    name: "typescript-ts",
    repoUrl: "https://github.com/microsoft/TypeScript.git",
    sparsePaths: [
      "package.json",
      "tsconfig.json",
      "src/compiler/checker.ts"
    ],
    task: "assess a representative TypeScript compiler change",
    guardChecks: [
      {
        file: "package.json",
        expectedRiskIncludes: ["JS/TS build or dependency contract change"]
      }
    ]
  },
  {
    name: "react-js",
    repoUrl: "https://github.com/facebook/react.git",
    sparsePaths: [
      "package.json",
      "packages/react-dom/src/client/ReactDOMClient.js"
    ],
    task: "assess a representative JavaScript frontend change",
    guardChecks: [
      {
        file: "package.json",
        expectedRiskIncludes: ["JS/TS build or dependency contract change"]
      }
    ]
  },
  {
    name: "curl-c",
    repoUrl: "https://github.com/curl/curl.git",
    sparsePaths: [
      "CMakeLists.txt",
      "Makefile",
      "include/curl/curl.h",
      "lib/memdebug.c",
      "lib/curlx/strcopy.c",
      "lib/url.c"
    ],
    task: "assess a representative C memory safety change",
    guardChecks: [
      {
        file: "lib/memdebug.c",
        expectedRiskIncludes: ["C memory-safety-sensitive change"]
      }
    ]
  }
];

function defaultCacheDir(): string {
  return path.join(os.tmpdir(), "aiwiki-large-repo-eval");
}

function fixtureDirName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_.-]+/gu, "-").replace(/^-|-$/gu, "");
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

function sparsePattern(filePath: string): string {
  return `/${filePath.replace(/^\/+/u, "")}`;
}

function normalizeRepoPath(filePath: string): string {
  return filePath.replace(/\\/gu, "/").replace(/^\/+/u, "").replace(/^\.\//u, "");
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.*]/gu, "\\$&");
}

function sparsePathCoversFile(sparsePath: string, filePath: string): boolean {
  const normalizedSparsePath = normalizeRepoPath(sparsePath);
  const normalizedFilePath = normalizeRepoPath(filePath);

  if (normalizedSparsePath.includes("*")) {
    const pattern = `^${escapeRegex(normalizedSparsePath).replace(/\\\*/gu, ".*")}$`;
    return new RegExp(pattern, "u").test(normalizedFilePath);
  }

  return normalizedFilePath === normalizedSparsePath ||
    normalizedFilePath.startsWith(`${normalizedSparsePath}/`);
}

function isCoveredBySparsePaths(fixture: LargeRepoFixture, filePath: string): boolean {
  return fixture.sparsePaths.some((sparsePath) =>
    sparsePathCoversFile(sparsePath, filePath)
  );
}

async function ensureSparseCheckout(
  fixture: LargeRepoFixture,
  cacheDir: string,
  skipClone: boolean
): Promise<string> {
  await mkdir(cacheDir, { recursive: true });
  const repoDir = path.join(cacheDir, fixtureDirName(fixture.name));
  const gitDir = path.join(repoDir, ".git");
  if (!(await pathExists(gitDir))) {
    if (skipClone) {
      throw new Error(`Missing cached checkout for ${fixture.name}: ${repoDir}`);
    }

    if (await pathExists(repoDir)) {
      throw new Error(`Cache target exists but is not a git checkout: ${repoDir}`);
    }

    await execFileAsync("git", [
      "clone",
      "--depth=1",
      "--filter=blob:none",
      "--sparse",
      fixture.repoUrl,
      repoDir
    ], {
      maxBuffer: 1024 * 1024 * 8
    });
  }

  await execFileAsync("git", [
    "-C",
    repoDir,
    "sparse-checkout",
    "set",
    "--no-cone",
    ...fixture.sparsePaths.map(sparsePattern)
  ], {
    maxBuffer: 1024 * 1024 * 8
  });

  return repoDir;
}

function filterFixtures(fixtures: LargeRepoFixture[], fixtureNames: string[] | undefined): LargeRepoFixture[] {
  if (!fixtureNames || fixtureNames.length === 0) {
    return fixtures;
  }

  const wanted = new Set(fixtureNames);
  const selected = fixtures.filter((fixture) => wanted.has(fixture.name));
  const selectedNames = new Set(selected.map((fixture) => fixture.name));
  const missing = [...wanted].filter((name) => !selectedNames.has(name));
  if (missing.length > 0) {
    throw new Error(`Unknown large-repo eval fixture(s): ${missing.join(", ")}`);
  }

  return selected;
}

async function evaluateGuardCheck(
  repoDir: string,
  fixture: LargeRepoFixture,
  check: LargeRepoGuardCheck
): Promise<LargeRepoGuardCheckResult> {
  const exists = await pathExists(path.join(repoDir, normalizeRepoPath(check.file)));
  const coveredBySparsePath = isCoveredBySparsePaths(fixture, check.file);
  const guard = exists
    ? await generateFileGuardrails(repoDir, check.file)
    : undefined;
  const missing = check.expectedRiskIncludes.filter((expected) =>
    !guard?.guardrails.changeRisks.some((risk) => risk.includes(expected))
  );

  return {
    file: check.file,
    changeRisks: guard?.guardrails.changeRisks ?? [],
    expectedRiskIncludes: check.expectedRiskIncludes,
    exists,
    coveredBySparsePath,
    missing,
    passed: exists && coveredBySparsePath && missing.length === 0
  };
}

async function evaluateGuardTargets(
  repoDir: string,
  fixture: LargeRepoFixture,
  guardTargets: string[]
): Promise<LargeRepoGuardTargetCheck[]> {
  return Promise.all(
    guardTargets.map(async (file) => ({
      file,
      exists: await pathExists(path.join(repoDir, normalizeRepoPath(file))),
      coveredBySparsePath: isCoveredBySparsePaths(fixture, file)
    }))
  );
}

async function evaluateFixture(
  fixture: LargeRepoFixture,
  cacheDir: string,
  skipClone: boolean
): Promise<LargeRepoFixtureResult> {
  const errors: string[] = [];
  let repoDir = path.join(cacheDir, fixtureDirName(fixture.name));
  let primeInitialized = true;
  let codexInitialized = true;
  let guardTargets: string[] = [];
  let guardTargetChecks: LargeRepoGuardTargetCheck[] = [];
  let missingGuardTargets: string[] = [];
  let guardTargetsOutsideSparsePaths: string[] = [];
  let guardChecks: LargeRepoGuardCheckResult[] = [];

  try {
    repoDir = await ensureSparseCheckout(fixture, cacheDir, skipClone);
    const prime = await generatePrimeContext(repoDir);
    const codex = await generateCodexRunbook(repoDir, fixture.task, {
      team: true,
      format: "json"
    });
    primeInitialized = prime.context.initialized;
    codexInitialized = codex.runbook.initialized;
    guardTargets = codex.runbook.guardTargets;
    guardTargetChecks = await evaluateGuardTargets(repoDir, fixture, guardTargets);
    missingGuardTargets = guardTargetChecks
      .filter((check) => !check.exists)
      .map((check) => check.file);
    guardTargetsOutsideSparsePaths = guardTargetChecks
      .filter((check) => !check.coveredBySparsePath)
      .map((check) => check.file);
    guardChecks = await Promise.all(
      fixture.guardChecks.map((check) => evaluateGuardCheck(repoDir, fixture, check))
    );

    if (primeInitialized) {
      errors.push("Expected prime to run in cold-start mode.");
    }
    if (codexInitialized) {
      errors.push("Expected codex runbook to run in cold-start mode.");
    }
    if (guardTargets.length === 0) {
      errors.push("Expected codex --team to produce at least one guard target.");
    }
    if (missingGuardTargets.length > 0) {
      errors.push(`Guard target(s) do not exist in sparse checkout: ${missingGuardTargets.join(", ")}`);
    }
    if (guardTargetsOutsideSparsePaths.length > 0) {
      errors.push(`Guard target(s) are outside fixture sparse paths: ${guardTargetsOutsideSparsePaths.join(", ")}`);
    }
    for (const check of guardChecks) {
      if (!check.passed) {
        const reasons = [
          check.exists ? undefined : "file missing",
          check.coveredBySparsePath ? undefined : "outside sparse paths",
          check.missing.length > 0 ? `missing: ${check.missing.join(", ")}` : undefined
        ].filter((reason): reason is string => Boolean(reason));
        errors.push(`Guard check failed for ${check.file}; ${reasons.join("; ")}`);
      }
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  return {
    name: fixture.name,
    repoUrl: fixture.repoUrl,
    repoDir,
    passed: errors.length === 0,
    primeInitialized,
    codexInitialized,
    guardTargets,
    guardTargetChecks,
    missingGuardTargets,
    guardTargetsOutsideSparsePaths,
    guardChecks,
    errors
  };
}

function formatFixtureMarkdown(result: LargeRepoFixtureResult): string[] {
  const passedGuardChecks = result.guardChecks.filter((check) => check.passed).length;
  const guardTargetSample = result.guardTargets.slice(0, 3);
  const omittedGuardTargets = result.guardTargets.length - guardTargetSample.length;
  const lines = [
    `## ${result.name}`,
    "",
    `- Status: ${result.passed ? "PASS" : "FAIL"}`,
    `- Repo: ${result.repoUrl}`,
    `- Checkout: ${result.repoDir}`,
    `- Cold-start checks: prime ${result.primeInitialized ? "FAIL" : "PASS"}, codex ${result.codexInitialized ? "FAIL" : "PASS"}`,
    `- Guard targets: ${result.guardTargets.length > 0
      ? `${result.guardTargets.length} (${guardTargetSample.join(", ")}${omittedGuardTargets > 0 ? `, +${omittedGuardTargets} more` : ""})`
      : "none"}`,
    `- Guard target existence: ${result.missingGuardTargets.length === 0 ? "PASS" : `FAIL (${result.missingGuardTargets.join(", ")})`}`,
    `- Guard target sparse coverage: ${result.guardTargetsOutsideSparsePaths.length === 0 ? "PASS" : `FAIL (${result.guardTargetsOutsideSparsePaths.join(", ")})`}`,
    `- Guard checks: ${passedGuardChecks}/${result.guardChecks.length} pass`
  ];

  for (const check of result.guardChecks) {
    if (check.passed) {
      continue;
    }
    lines.push(
      "",
      `### Guard: ${check.file}`,
      "",
      `- Status: ${check.passed ? "PASS" : "FAIL"}`,
      `- Expected: ${check.expectedRiskIncludes.join(", ")}`,
      `- Risks: ${check.changeRisks.length > 0 ? check.changeRisks.join(" | ") : "none"}`
    );
    if (check.missing.length > 0) {
      lines.push(`- Missing: ${check.missing.join(", ")}`);
    }
  }

  if (result.errors.length > 0) {
    lines.push("", "### Errors", "", ...result.errors.map((error) => `- ${error}`));
  }

  return lines;
}

function formatLargeRepoEvalMarkdown(result: Omit<LargeRepoEvalResult, "markdown" | "json">): string {
  return [
    "# AIWiki Large Repo Eval",
    "",
    `Status: ${result.passed ? "PASS" : "FAIL"}`,
    `Cache: ${result.cacheDir}`,
    "",
    ...result.fixtures.flatMap((fixture) => [...formatFixtureMarkdown(fixture), ""])
  ].join("\n").trimEnd() + "\n";
}

function largeRepoEvalToJson(result: Omit<LargeRepoEvalResult, "markdown" | "json">): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

export async function runLargeRepoEval(options: LargeRepoEvalOptions = {}): Promise<LargeRepoEvalResult> {
  const cacheDir = path.resolve(options.cacheDir ?? defaultCacheDir());
  const fixtures = filterFixtures(
    options.fixtures ?? DEFAULT_LARGE_REPO_FIXTURES,
    options.fixtureNames
  );
  const results = await Promise.all(
    fixtures.map((fixture) => evaluateFixture(fixture, cacheDir, options.skipClone ?? false))
  );
  const base = {
    cacheDir,
    fixtures: results,
    passed: results.every((fixture) => fixture.passed)
  };

  return {
    ...base,
    markdown: formatLargeRepoEvalMarkdown(base),
    json: largeRepoEvalToJson(base)
  };
}
