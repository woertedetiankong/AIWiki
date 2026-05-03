import path from "node:path";

export type SupportedProjectLanguage =
  | "python"
  | "java"
  | "typescript"
  | "javascript"
  | "c"
  | "sql";

export interface ProjectProfile {
  languages: SupportedProjectLanguage[];
  manifests: string[];
  runtimes: string[];
}

export interface SemanticRiskInput {
  filePath: string;
  content: string;
  files: string[];
}

export interface SemanticRisk {
  id: string;
  language?: SupportedProjectLanguage;
  category:
    | "api"
    | "build"
    | "concurrency"
    | "database"
    | "dependencies"
    | "frontend"
    | "memory"
    | "runtime"
    | "security";
  confidence: "low" | "medium" | "high";
  message: string;
  evidence: string[];
}

export interface DiffRiskLesson {
  type: "pattern" | "pitfall";
  title: string;
  modules: string[];
  severity?: "low" | "medium" | "high" | "critical";
  summary: string;
  tags: string[];
  files: string[];
}

interface ScoredRiskFile {
  file: string;
  score: number;
}

function normalize(filePath: string): string {
  return filePath.replace(/\\/gu, "/").replace(/^\.\//u, "").toLowerCase();
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function includesAny(text: string, needles: string[]): boolean {
  return needles.some((needle) => text.includes(needle));
}

function stripJsTsTextLiterals(content: string): string {
  let output = "";
  let index = 0;
  const previousSignificant = (): string | undefined => {
    for (let cursor = output.length - 1; cursor >= 0; cursor -= 1) {
      const char = output[cursor];
      if (char && !/\s/u.test(char)) {
        return char;
      }
    }

    return undefined;
  };
  const isRegexStart = (): boolean => {
    const previous = previousSignificant();
    return !previous ||
      /[({[=,:;!&|?+\-*~^<>]/u.test(previous) ||
      /\b(?:return|case|throw|yield)\s*$/u.test(output);
  };

  while (index < content.length) {
    const char = content[index];
    const next = content[index + 1];

    if (char === "/" && next === "*") {
      output += " ";
      index += 2;
      while (index < content.length && !(content[index] === "*" && content[index + 1] === "/")) {
        index += 1;
      }
      index += 2;
      continue;
    }

    if (char === "/" && next === "/") {
      output += " ";
      index += 2;
      while (index < content.length && content[index] !== "\n" && content[index] !== "\r") {
        index += 1;
      }
      continue;
    }

    if (char === "\"" || char === "'" || char === "`") {
      const quote = char;
      output += " ";
      index += 1;
      while (index < content.length) {
        const current = content[index];
        if (current === "\\") {
          index += 2;
          continue;
        }
        index += 1;
        if (current === quote) {
          break;
        }
      }
      output += " ";
      continue;
    }

    if (char === "/" && isRegexStart()) {
      output += " ";
      index += 1;
      let inCharacterClass = false;
      while (index < content.length) {
        const current = content[index];
        if (current === "\\") {
          index += 2;
          continue;
        }
        if (current === "[") {
          inCharacterClass = true;
        } else if (current === "]") {
          inCharacterClass = false;
        } else if (current === "/" && !inCharacterClass) {
          index += 1;
          while (/[a-z]/iu.test(content[index] ?? "")) {
            index += 1;
          }
          break;
        } else if (current === "\n" || current === "\r") {
          break;
        }
        index += 1;
      }
      output += " ";
      continue;
    }

    output += char;
    index += 1;
  }

  return output;
}

function matchingProjectFiles(files: string[], candidates: string[]): string[] {
  const normalizedFiles = new Map(files.map((file) => [normalize(file), file]));
  return candidates
    .map((candidate) => normalizedFiles.get(normalize(candidate)))
    .filter((file): file is string => Boolean(file));
}

function filesWithExtensions(files: string[], extensions: string[]): string[] {
  return files.filter((file) => extensions.includes(path.posix.extname(normalize(file))));
}

export function detectFileLanguage(filePath: string): SupportedProjectLanguage | undefined {
  const normalized = normalize(filePath);
  const extension = path.posix.extname(normalized);
  if (extension === ".py") {
    return "python";
  }
  if (extension === ".java") {
    return "java";
  }
  if (extension === ".ts" || extension === ".tsx" || extension === ".mts" || extension === ".cts") {
    return "typescript";
  }
  if (extension === ".js" || extension === ".jsx" || extension === ".mjs" || extension === ".cjs") {
    return "javascript";
  }
  if (extension === ".c" || extension === ".h") {
    return "c";
  }
  if (extension === ".sql") {
    return "sql";
  }

  return undefined;
}

export function detectProjectProfile(files: string[]): ProjectProfile {
  const normalized = files.map(normalize);
  const languages: SupportedProjectLanguage[] = [];
  const manifests = matchingProjectFiles(files, [
    "package.json",
    "tsconfig.json",
    "jsconfig.json",
    "pyproject.toml",
    "requirements.txt",
    "setup.py",
    "Pipfile",
    "poetry.lock",
    "pom.xml",
    "build.gradle",
    "build.gradle.kts",
    "settings.gradle",
    "settings.gradle.kts",
    "Makefile",
    "CMakeLists.txt",
    "configure.ac",
    "meson.build"
  ]);
  const runtimes = matchingProjectFiles(files, [
    "next.config.js",
    "next.config.mjs",
    "next.config.ts",
    "vite.config.js",
    "vite.config.ts",
    "wrangler.toml",
    "Dockerfile",
    "docker-compose.yml"
  ]);

  if (normalized.includes("pyproject.toml") || normalized.includes("requirements.txt") || filesWithExtensions(files, [".py"]).length > 0) {
    languages.push("python");
  }
  if (normalized.includes("pom.xml") || normalized.includes("build.gradle") || normalized.includes("build.gradle.kts") || filesWithExtensions(files, [".java"]).length > 0) {
    languages.push("java");
  }
  if (normalized.includes("tsconfig.json") || filesWithExtensions(files, [".ts", ".tsx", ".mts", ".cts"]).length > 0) {
    languages.push("typescript");
  }
  if (normalized.includes("package.json") || filesWithExtensions(files, [".js", ".jsx", ".mjs", ".cjs"]).length > 0) {
    languages.push("javascript");
  }
  if (normalized.includes("makefile") || normalized.includes("cmakelists.txt") || filesWithExtensions(files, [".c", ".h"]).length > 0) {
    languages.push("c");
  }
  if (filesWithExtensions(files, [".sql"]).length > 0) {
    languages.push("sql");
  }

  return {
    languages: unique(languages),
    manifests,
    runtimes
  };
}

function risk(input: Omit<SemanticRisk, "evidence"> & { evidence?: string[] }): SemanticRisk {
  return {
    ...input,
    evidence: input.evidence ?? []
  };
}

function isDatabaseChange(filePath: string, content: string): boolean {
  const normalized = normalize(filePath);
  return normalized === "db/schema.sql" ||
    normalized.endsWith("/schema.sql") ||
    normalized.includes("/migrations/") ||
    normalized.includes("/migration/") ||
    normalized.includes("migrations/") ||
    (path.posix.extname(normalized) === ".sql" &&
      /\b(?:create|alter|drop)\s+(?:virtual\s+)?(?:table|index|trigger|view)\b|\bfts5\b/iu.test(content));
}

function deployScriptCandidates(files: string[]): string[] {
  return matchingProjectFiles(files, [
    "scripts/deploy.sh",
    "scripts/init.sh",
    "scripts/migrate.sh",
    "scripts/verify.sh",
    "scripts/cf-deploy.sh",
    "scripts/cf-init.sh",
    "deploy.sh",
    "Makefile",
    "Dockerfile",
    "docker-compose.yml",
    "package.json",
    "pyproject.toml",
    "pom.xml",
    "build.gradle",
    "wrangler.toml"
  ]);
}

function isFrontendPath(filePath: string): boolean {
  return /^(app|src\/app|components|src\/components|pages|src\/pages|client|src\/client)\//u.test(normalize(filePath));
}

function isJsTsManifest(filePath: string): boolean {
  return [
    "package.json",
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "bun.lockb",
    "tsconfig.json",
    "jsconfig.json",
    "vite.config.ts",
    "vite.config.js",
    "next.config.ts",
    "next.config.js",
    "next.config.mjs"
  ].includes(normalize(filePath));
}

function isPythonManifest(filePath: string): boolean {
  return [
    "pyproject.toml",
    "requirements.txt",
    "requirements-dev.txt",
    "setup.py",
    "setup.cfg",
    "Pipfile",
    "Pipfile.lock",
    "poetry.lock"
  ].includes(normalize(filePath));
}

function isJavaBuildFile(filePath: string): boolean {
  return [
    "pom.xml",
    "build.gradle",
    "build.gradle.kts",
    "settings.gradle",
    "settings.gradle.kts",
    "gradle.properties"
  ].includes(normalize(filePath));
}

function isCBuildFile(filePath: string): boolean {
  return [
    "makefile",
    "cmakelists.txt",
    "configure.ac",
    "meson.build"
  ].includes(normalize(filePath));
}

function scoreRepresentativeRiskFile(filePath: string): ScoredRiskFile | undefined {
  const normalized = normalize(filePath);
  const basename = path.posix.basename(normalized);
  const extension = path.posix.extname(normalized);
  let score = 0;

  if (
    isPythonManifest(filePath) ||
    isJavaBuildFile(filePath) ||
    isJsTsManifest(filePath) ||
    isCBuildFile(filePath)
  ) {
    score += 55;
  }

  if (
    basename === "views.py" ||
    basename === "routes.py" ||
    basename === "models.py" ||
    normalized.includes("/migrations/")
  ) {
    score += 70;
  }

  if (extension === ".java" && /(?:controller|resource|security|service|repository|transaction)/u.test(normalized)) {
    score += 70;
  }

  if (
    (extension === ".ts" || extension === ".tsx" || extension === ".js" || extension === ".jsx") &&
    (normalized.includes("/api/") ||
      normalized.includes("route.") ||
      normalized.includes("layout.") ||
      normalized.includes("server") ||
      normalized.includes("auth") ||
      normalized.includes("security"))
  ) {
    score += 70;
  }

  if (extension === ".h" && (normalized.startsWith("include/") || normalized.includes("/include/"))) {
    score += 75;
  }

  if (extension === ".c" && /(?:mem|buf|str|copy|alloc|free|security|auth|parse|ssl|tls|http|url)/u.test(normalized)) {
    score += 85;
  }

  if ((extension === ".c" || extension === ".h") && /^(lib|src|include)\//u.test(normalized)) {
    score += 15;
  }

  if (/(^|\/)(auth|security|permission|token|secret|migration|schema|payment|billing|webhook|checkout|charge|invoice|subscription)/u.test(normalized)) {
    score += 25;
  }

  if (normalized.startsWith("docs/") || normalized.includes("/examples/") || normalized.startsWith("examples/")) {
    score -= 55;
  }

  if (normalized.startsWith("tests/") || normalized.includes("/tests/")) {
    score -= 35;
  }

  if (score <= 0) {
    return undefined;
  }

  return { file: filePath, score };
}

export function representativeRiskFiles(files: string[], limit = 5): string[] {
  return files
    .map(scoreRepresentativeRiskFile)
    .filter((item): item is ScoredRiskFile => Boolean(item))
    .sort((left, right) => right.score - left.score || left.file.localeCompare(right.file))
    .map((item) => item.file)
    .slice(0, limit);
}

function hasPythonWebBoundary(filePath: string, content: string): boolean {
  const normalized = normalize(filePath);
  return normalized.includes("views.py") ||
    normalized.includes("urls.py") ||
    normalized.includes("routes.py") ||
    normalized.includes("api/") ||
    /@app\.route|fastapi|apirouter|django\.urls|rest_framework/iu.test(content);
}

function hasJavaWebBoundary(filePath: string, content: string): boolean {
  const normalized = normalize(filePath);
  return normalized.includes("controller") ||
    normalized.includes("resource") ||
    /@(RestController|Controller|RequestMapping|GetMapping|PostMapping|PutMapping|DeleteMapping|Path)\b/u.test(content);
}

function hasMoneyFlowPath(filePath: string): boolean {
  const normalized = normalize(filePath);
  return /(?:^|\/)(?:checkout|charge|billing|payment|payments|stripe|webhook|invoice|subscription)(?:[./_-]|$)/u.test(normalized);
}

function hasMoneyFlowCode(content: string): boolean {
  const code = stripJsTsTextLiterals(content).toLowerCase();
  const moneyIdentifiers =
    /\b(?:charge|checkout|payment|payments|invoice|subscription|billing|stripe|webhook)\w*\b/u;
  const amountIdentifiers =
    /\b(?:amount|amountcents|amount_cents|currency|price|priceid|subtotal|total|tax)\b/u;
  const codeBoundary =
    /\b(?:export|function|async|const|let|var|class|interface|type|enum|return|await|new)\b/u;

  return moneyIdentifiers.test(code) ||
    (amountIdentifiers.test(code) && codeBoundary.test(code));
}

export function semanticChangeRisksForFile(input: SemanticRiskInput): SemanticRisk[] {
  const normalized = normalize(input.filePath);
  const lowerContent = input.content.toLowerCase();
  const language = detectFileLanguage(input.filePath);
  const profile = detectProjectProfile(input.files);
  const risks: SemanticRisk[] = [];

  if (isDatabaseChange(input.filePath, input.content)) {
    const deployScripts = deployScriptCandidates(input.files);
    risks.push(risk({
      id: "database-migration-deploy-path",
      language: language === "sql" ? "sql" : undefined,
      category: "database",
      confidence: "high",
      message: "Database schema or migration change: verify how existing environments receive this change; editing schema.sql alone may not update already-created databases.",
      evidence: [input.filePath]
    }));
    if (deployScripts.length > 0) {
      risks.push(risk({
        id: "database-migration-script-coverage",
        category: "database",
        confidence: "medium",
        message: `Check deployment/init scripts for migration coverage: ${deployScripts.join(", ")}.`,
        evidence: deployScripts
      }));
    }
    if (includesAny(lowerContent, ["fts", "trigger"])) {
      risks.push(risk({
        id: "database-fts-trigger-regression",
        language: "sql",
        category: "database",
        confidence: "high",
        message: "FTS/trigger change: test insert, update, delete, and search or related-content flows so stale index rows are not left behind.",
        evidence: [input.filePath]
      }));
    }
  }

  if (isJsTsManifest(input.filePath)) {
    risks.push(risk({
      id: "js-ts-build-contract",
      language: normalized.includes("ts") ? "typescript" : "javascript",
      category: "build",
      confidence: "medium",
      message: "JS/TS build or dependency contract change: run install/lockfile checks plus build, typecheck, and focused tests for affected packages.",
      evidence: [input.filePath]
    }));
  }

  if (
    normalized.includes("appearance") ||
    normalized.endsWith("app/layout.tsx") ||
    normalized.endsWith("app/layout.jsx") ||
    (isFrontendPath(input.filePath) &&
      includesAny(lowerContent, ["localstorage", "data-theme", "useeffect"]))
  ) {
    risks.push(risk({
      id: "frontend-hydration-first-paint",
      language: language === "typescript" ? "typescript" : "javascript",
      category: "frontend",
      confidence: "medium",
      message: "Appearance hydration change: verify first paint, hydration, and stored theme/font behavior; useEffect runs after paint and can introduce visible theme flash.",
      evidence: [input.filePath]
    }));
  }

  if (
    /\bimport\s*\(\s*["']html2pdf\.js["']\s*\)|\bfrom\s+["']html2pdf\.js["']/u.test(input.content) ||
    (isFrontendPath(input.filePath) && includesAny(lowerContent, ["window.", "document.", "navigator."]))
  ) {
    risks.push(risk({
      id: "browser-only-runtime-boundary",
      language: language === "typescript" ? "typescript" : "javascript",
      category: "runtime",
      confidence: "medium",
      message: "Browser-only API/library usage: keep it out of server and Worker bundles; verify with the project build or runtime preview path.",
      evidence: [input.filePath]
    }));
  }

  if (
    (language === "typescript" || language === "javascript") &&
    (
      normalized.includes("/api/") ||
      normalized.includes("route.ts") ||
      normalized.includes("route.js") ||
      /\bprocess\.env\.[A-Z0-9_]+/u.test(input.content) ||
      /(^|\/)(auth|security|session|token|secret)[^/]*\.[cm]?[tj]sx?$/u.test(normalized)
    )
  ) {
    risks.push(risk({
      id: "js-ts-server-api-boundary",
      language,
      category: "api",
      confidence: "medium",
      message: "Server/API boundary change: keep secrets server-side and cover auth, input validation, and error paths before shipping.",
      evidence: [input.filePath]
    }));
  }

  if (
    (language === "typescript" || language === "javascript") &&
    (hasMoneyFlowPath(input.filePath) || hasMoneyFlowCode(input.content))
  ) {
    risks.push(risk({
      id: "js-ts-money-flow-boundary",
      language,
      category: "security",
      confidence: "medium",
      message: "Money/payment flow change: cover amount/currency math, idempotency, webhook retries, and provider error paths before shipping.",
      evidence: [input.filePath]
    }));
  }

  if (isPythonManifest(input.filePath)) {
    risks.push(risk({
      id: "python-dependency-contract",
      language: "python",
      category: "dependencies",
      confidence: "medium",
      message: "Python dependency or packaging change: sync the environment, run import smoke tests, and verify the supported Python version matrix.",
      evidence: [input.filePath]
    }));
  }

  if (language === "python" && (normalized.includes("/migrations/") || normalized.endsWith("models.py"))) {
    risks.push(risk({
      id: "python-model-migration-contract",
      language: "python",
      category: "database",
      confidence: "medium",
      message: "Python model or migration change: verify generated migrations, rollback/upgrade behavior, and data compatibility for existing deployments.",
      evidence: [input.filePath]
    }));
  }

  if (language === "python" && hasPythonWebBoundary(input.filePath, input.content)) {
    risks.push(risk({
      id: "python-web-api-boundary",
      language: "python",
      category: "api",
      confidence: "medium",
      message: "Python web/API boundary change: cover routing, auth/permission checks, input validation, and error responses.",
      evidence: [input.filePath]
    }));
  }

  if (language === "python" && /\b(?:pickle\.loads|yaml\.load|subprocess\.|eval\(|exec\(|os\.environ)\b/u.test(input.content)) {
    risks.push(risk({
      id: "python-runtime-security-boundary",
      language: "python",
      category: "security",
      confidence: "medium",
      message: "Python runtime/security-sensitive code: review deserialization, shell execution, environment variables, and untrusted input paths.",
      evidence: [input.filePath]
    }));
  }

  if (isJavaBuildFile(input.filePath)) {
    risks.push(risk({
      id: "java-build-contract",
      language: "java",
      category: "build",
      confidence: "medium",
      message: "Java build or dependency graph change: refresh dependencies and run compile plus the relevant unit/integration test task.",
      evidence: [input.filePath]
    }));
  }

  if (language === "java" && hasJavaWebBoundary(input.filePath, input.content)) {
    risks.push(risk({
      id: "java-controller-api-boundary",
      language: "java",
      category: "api",
      confidence: "medium",
      message: "Java controller/API boundary change: cover request mapping, validation, security annotations, serialization, and error status behavior.",
      evidence: [input.filePath]
    }));
  }

  if (language === "java" && /@(Transactional|Async)\b|\bCompletableFuture\b|\bThread\b|\bsynchronized\b|\bvolatile\b/u.test(input.content)) {
    risks.push(risk({
      id: "java-transaction-concurrency-boundary",
      language: "java",
      category: "concurrency",
      confidence: "medium",
      message: "Java transaction/concurrency-sensitive change: verify rollback behavior, thread safety, async error handling, and race-prone paths.",
      evidence: [input.filePath]
    }));
  }

  if (isCBuildFile(input.filePath)) {
    risks.push(risk({
      id: "c-build-matrix",
      language: "c",
      category: "build",
      confidence: "medium",
      message: "C build-system change: verify compiler flags, generated config headers, platform matrix, and clean rebuild behavior.",
      evidence: [input.filePath]
    }));
  }

  if (language === "c" && /\.(?:h)$/u.test(normalized)) {
    risks.push(risk({
      id: "c-public-header-contract",
      language: "c",
      category: "api",
      confidence: "medium",
      message: "C header/API change: check ABI/API compatibility, include order, macro side effects, and downstream compile coverage.",
      evidence: [input.filePath]
    }));
  }

  if (language === "c" && /\b(?:malloc|calloc|realloc|free|memcpy|memmove|strcpy|strncpy|sprintf|snprintf|gets)\s*\(/u.test(input.content)) {
    risks.push(risk({
      id: "c-memory-safety",
      language: "c",
      category: "memory",
      confidence: "high",
      message: "C memory-safety-sensitive change: review allocation/free ownership, bounds checks, string APIs, and sanitizer or focused regression coverage.",
      evidence: [input.filePath]
    }));
  }

  if (profile.languages.length > 1 && profile.manifests.includes(input.filePath)) {
    risks.push(risk({
      id: "polyglot-project-contract",
      category: "build",
      confidence: "low",
      message: `Polyglot project signal (${profile.languages.join(", ")}): make sure this change does not break cross-language build or generated-code contracts.`,
      evidence: profile.manifests
    }));
  }

  const seen = new Set<string>();
  return risks.filter((item) => {
    if (seen.has(item.id)) {
      return false;
    }
    seen.add(item.id);
    return true;
  });
}

export function semanticChangeRiskMessages(input: SemanticRiskInput): string[] {
  return semanticChangeRisksForFile(input).map((riskItem) => riskItem.message);
}

export function diffRiskLessonsFromChanges(changedFiles: string[], linesByFile: Map<string, string[]>): DiffRiskLesson[] {
  const lessons: DiffRiskLesson[] = [];
  const seen = new Set<string>();
  const add = (lesson: DiffRiskLesson): void => {
    const key = `${lesson.type}:${lesson.title}`;
    if (!seen.has(key)) {
      seen.add(key);
      lessons.push(lesson);
    }
  };

  for (const file of changedFiles) {
    const content = (linesByFile.get(file) ?? []).join("\n");
    for (const riskItem of semanticChangeRisksForFile({ filePath: file, content, files: changedFiles })) {
      if (riskItem.id === "database-migration-deploy-path") {
        add({
          type: "pitfall",
          title: "Database migrations must reach existing deployments",
          modules: ["database"],
          severity: "high",
          summary: "Schema and migration edits need an explicit deploy/init path; editing schema.sql alone may not update existing databases.",
          tags: ["database", "migrations", "deploy"],
          files: [file]
        });
      } else if (riskItem.id === "database-fts-trigger-regression") {
        add({
          type: "pitfall",
          title: "FTS trigger changes need search regression checks",
          modules: ["database", "search"],
          severity: "high",
          summary: "FTS trigger changes should be verified through insert, update, delete, and search or related-content flows to avoid stale index rows.",
          tags: ["database", "search", "fts"],
          files: [file]
        });
      } else if (riskItem.id === "frontend-hydration-first-paint") {
        add({
          type: "pitfall",
          title: "Theme hydration can flash after first paint",
          modules: ["appearance", "layout"],
          severity: "medium",
          summary: "Moving stored theme/font application into client effects can run after first paint; verify first paint and hydration behavior.",
          tags: ["frontend", "hydration", "theme"],
          files: [file]
        });
      } else if (riskItem.id === "browser-only-runtime-boundary") {
        add({
          type: "pattern",
          title: "Browser-only libraries stay out of server bundles",
          modules: ["build", "frontend"],
          summary: "Browser-only APIs and libraries should stay behind dynamic or client-only boundaries and be verified with the project build or preview path.",
          tags: ["ssr", "worker", "build"],
          files: [file]
        });
      } else if (riskItem.id === "js-ts-money-flow-boundary") {
        add({
          type: "pitfall",
          title: "Money flows need idempotency and amount checks",
          modules: ["billing", "payments"],
          severity: "high",
          summary: "Checkout, charge, invoice, or amount handling changes should cover idempotency, currency math, retries, and provider error paths.",
          tags: ["payments", "idempotency", "money"],
          files: [file]
        });
      } else if (riskItem.id === "python-dependency-contract") {
        add({
          type: "pattern",
          title: "Python dependency changes need environment smoke tests",
          modules: ["python", "dependencies"],
          summary: "Python dependency and packaging changes should be checked with environment sync, import smoke tests, and supported-version coverage.",
          tags: ["python", "dependencies", "build"],
          files: [file]
        });
      } else if (riskItem.id === "python-runtime-security-boundary") {
        add({
          type: "pitfall",
          title: "Python runtime security changes need input-boundary review",
          modules: ["python", "security"],
          severity: "high",
          summary: "Python code touching deserialization, shell execution, environment variables, or dynamic execution should be reviewed against untrusted input paths.",
          tags: ["python", "security", "runtime"],
          files: [file]
        });
      } else if (riskItem.id === "java-build-contract") {
        add({
          type: "pattern",
          title: "Java build graph changes need compile and integration checks",
          modules: ["java", "build"],
          summary: "Java dependency or build-script changes should be verified with dependency refresh, compile, and relevant unit or integration tests.",
          tags: ["java", "build", "dependencies"],
          files: [file]
        });
      } else if (riskItem.id === "java-transaction-concurrency-boundary") {
        add({
          type: "pitfall",
          title: "Java transaction and concurrency changes need race-path checks",
          modules: ["java", "concurrency"],
          severity: "medium",
          summary: "Java code touching transactions, async execution, threads, or synchronization should cover rollback behavior, thread safety, and async errors.",
          tags: ["java", "concurrency", "transactions"],
          files: [file]
        });
      } else if (riskItem.id === "c-build-matrix") {
        add({
          type: "pattern",
          title: "C build-system changes need platform matrix checks",
          modules: ["c", "build"],
          summary: "C build-system changes should be verified across compiler flags, generated config headers, clean rebuilds, and supported platforms.",
          tags: ["c", "build", "portability"],
          files: [file]
        });
      } else if (riskItem.id === "c-memory-safety") {
        add({
          type: "pitfall",
          title: "C memory changes need sanitizer-minded review",
          modules: ["c", "memory"],
          severity: "high",
          summary: "C changes touching allocation, free, buffer copies, or string APIs need ownership, bounds, and sanitizer or focused regression checks.",
          tags: ["c", "memory-safety", "security"],
          files: [file]
        });
      }
    }
  }

  return lessons;
}
