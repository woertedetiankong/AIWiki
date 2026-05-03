import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { initAIWiki } from "../src/init.js";
import { generateMaintenanceReview } from "../src/maintain.js";
import { writeMarkdownFile } from "../src/markdown.js";

const execFileAsync = promisify(execFile);

async function tempProject(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "aiwiki-maintain-"));
}

async function writeProjectFile(rootDir: string, relativePath: string, content: string): Promise<void> {
  const filePath = path.join(rootDir, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
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

async function projectWithPrimeDiff(): Promise<string> {
  const rootDir = await tempProject();
  await writeProjectFile(rootDir, "src/prime.ts", "export const prime = 'baseline';\n");
  await initAIWiki({ rootDir, projectName: "demo" });
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
  return rootDir;
}

function cliArgs(...args: string[]): string[] {
  const cliPath = path.resolve("src", "cli.ts");
  const tsxLoader = pathToFileURL(
    path.resolve("node_modules", "tsx", "dist", "loader.mjs")
  ).href;
  return ["--import", tsxLoader, cliPath, ...args];
}

describe("generateMaintenanceReview", () => {
  it("runs doctor plus read-only reflect without writing a plan by default", async () => {
    const rootDir = await projectWithPrimeDiff();
    const reflectCasesPath = path.join(rootDir, ".aiwiki", "evals", "reflect-cases.jsonl");
    const initialReflectCases = await readFile(reflectCasesPath, "utf8");

    const result = await generateMaintenanceReview(rootDir);

    expect(result.report.status).toBe("needs_review");
    expect(result.report.reflect.status).toBe("checked");
    expect(result.report.reflect.changedFiles).toContain("src/prime.ts");
    expect(result.report.reflect.candidateWrites).toBeGreaterThan(0);
    expect(result.report.reflect.outputPlanPath).toBeUndefined();
    expect(result.markdown).toContain("aiwiki maintain --output-plan");
    expect(await readFile(reflectCasesPath, "utf8")).toBe(initialReflectCases);
  });

  it("writes a reviewable output plan without applying wiki changes", async () => {
    const rootDir = await projectWithPrimeDiff();
    const planPath = ".aiwiki/context-packs/maintain-plan.json";

    const result = await generateMaintenanceReview(rootDir, {
      outputPlan: planPath
    });

    expect(result.report.reflect.outputPlanPath).toBeTruthy();
    expect(result.report.nextActions.join("\n")).toContain(`aiwiki apply ${planPath}`);
    expect(result.report.safety.join("\n")).toContain("never confirms long-term wiki writes");
    const plan = JSON.parse(
      await readFile(path.join(rootDir, planPath), "utf8")
    ) as {
      entries: Array<{
        title: string;
        source?: string;
        append?: Array<{ heading: string; body: string }>;
      }>;
    };
    expect(plan.entries.length).toBeGreaterThan(0);
    const prime = plan.entries.find((entry) => entry.title === "Prime");
    expect(prime?.source).toBe("maintain");
    expect(prime?.append?.[0]).toMatchObject({
      heading: "Maintenance Review"
    });
    expect(prime?.append?.[0]?.body).toContain("src/prime.ts");
  });

  it("exposes a cold-start CLI review without creating .aiwiki", async () => {
    const rootDir = await tempProject();

    const { stdout } = await execFileAsync(
      process.execPath,
      cliArgs("maintain", "--no-from-git-diff", "--format", "json"),
      { cwd: rootDir }
    );
    const parsed = JSON.parse(stdout) as {
      status: string;
      initialized: boolean;
      reflect: { status: string };
    };

    expect(parsed.status).toBe("setup_required");
    expect(parsed.initialized).toBe(false);
    expect(parsed.reflect.status).toBe("skipped");
    expect(await pathExists(path.join(rootDir, ".aiwiki"))).toBe(false);
  });
});
