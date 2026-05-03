import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { resolveProjectPath, toPosixPath } from "./paths.js";

const execFileAsync = promisify(execFile);

interface GitStatusTarget {
  file: string;
  status: string;
}

const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  ".py",
  ".java",
  ".c",
  ".h",
  ".sql"
]);

function normalizeChangedFile(filePath: string): string {
  return toPosixPath(filePath).replace(/^\.\//u, "");
}

function statusTarget(line: string): GitStatusTarget | undefined {
  if (!line.trim()) {
    return undefined;
  }

  const renamed = /^R\s+(.+?)\s+->\s+(.+)$/u.exec(line.trim());
  if (renamed?.[2]) {
    return { file: normalizeChangedFile(renamed[2]), status: "R" };
  }

  const match = /^([ MADRCU?!]{2})\s+(.+)$/u.exec(line);
  if (!match?.[2]) {
    return undefined;
  }

  return {
    file: normalizeChangedFile(match[2]),
    status: match[1].trim() || "M"
  };
}

function isSourceFile(file: string): boolean {
  return SOURCE_EXTENSIONS.has(path.posix.extname(file.toLowerCase()));
}

function isTestFile(file: string): boolean {
  const normalized = file.toLowerCase();
  return normalized.startsWith("tests/") ||
    normalized.includes("/tests/") ||
    /(?:^|\/)(?:test_|.+\.(?:test|spec)\.)/u.test(normalized);
}

function usefulGuardTarget(file: string): boolean {
  return file.length > 0 &&
    !file.startsWith(".aiwiki/");
}

function targetScore(target: GitStatusTarget): number {
  const normalized = target.file.toLowerCase();
  let score = 0;

  if (isTestFile(normalized)) {
    score += 45;
  } else if (isSourceFile(normalized)) {
    score += 80;
  }
  if (/^(package.json|tsconfig\.json|jsconfig\.json|pyproject\.toml|requirements.*\.txt|pom\.xml|build\.gradle(?:\.kts)?|makefile|cmakelists\.txt)$/u.test(normalized)) {
    score += 40;
  }
  if (/(^|\/)(agent|cli|codex|eval|guard|prime|reflect|risk|task|usability)[^/]*\./u.test(normalized)) {
    score += 25;
  }
  if (target.status.includes("?")) {
    score += 15;
  }
  if (normalized.startsWith("docs/") || normalized.startsWith("README".toLowerCase())) {
    score -= 20;
  }

  return score;
}

async function existingProjectFiles(
  rootDir: string,
  targets: GitStatusTarget[]
): Promise<GitStatusTarget[]> {
  const existing: GitStatusTarget[] = [];
  for (const target of targets) {
    try {
      const fileStat = await stat(resolveProjectPath(rootDir, target.file));
      if (fileStat.isFile()) {
        existing.push(target);
      }
    } catch {
      // Deleted files and ignored paths do not need file guardrails.
    }
  }

  return existing;
}

export async function changedGuardTargetsFromGitStatus(
  rootDir: string,
  limit = 5
): Promise<string[]> {
  let stdout = "";
  try {
    ({ stdout } = await execFileAsync("git", ["status", "--short"], {
      cwd: rootDir,
      maxBuffer: 1024 * 1024
    }));
  } catch {
    return [];
  }

  const seen = new Set<string>();
  const parsed = stdout
    .split("\n")
    .map(statusTarget)
    .filter((target): target is GitStatusTarget => Boolean(target))
    .filter((target) => usefulGuardTarget(target.file))
    .filter((target) => {
      if (seen.has(target.file)) {
        return false;
      }
      seen.add(target.file);
      return true;
    });
  const existing = await existingProjectFiles(rootDir, parsed);

  return existing
    .sort(compareTargets)
    .map((target) => target.file)
    .slice(0, limit);
}

function compareTargets(left: GitStatusTarget, right: GitStatusTarget): number {
  return targetScore(right) - targetScore(left) ||
    left.file.localeCompare(right.file);
}

export function rankGuardTargetFiles(files: string[], limit = 5): string[] {
  const seen = new Set<string>();
  return files
    .map((file, index) => ({ file: normalizeChangedFile(file), index }))
    .filter((target) => usefulGuardTarget(target.file))
    .filter((target) => {
      if (seen.has(target.file)) {
        return false;
      }
      seen.add(target.file);
      return true;
    })
    .map((target) => ({ file: target.file, status: "M", index: target.index }))
    .sort((left, right) => targetScore(right) - targetScore(left) || left.index - right.index)
    .map((target) => target.file)
    .slice(0, limit);
}
