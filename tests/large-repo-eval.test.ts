import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { runLargeRepoEval } from "../src/large-repo-eval.js";

const execFileAsync = promisify(execFile);

async function tempProject(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "aiwiki-large-repo-eval-"));
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

describe("large repo eval", () => {
  it("runs against a local sparse checkout fixture without network access", async () => {
    const sourceDir = await tempProject();
    await mkdir(path.join(sourceDir, "app"), { recursive: true });
    await writeFile(path.join(sourceDir, "pyproject.toml"), "[project]\nname = 'demo'\n", "utf8");
    await writeFile(
      path.join(sourceDir, "app", "routes.py"),
      "import subprocess\n@app.route('/run')\ndef run(): subprocess.run(['echo'])\n",
      "utf8"
    );
    await initGitProject(sourceDir);

    const result = await runLargeRepoEval({
      cacheDir: path.join(await tempProject(), "cache"),
      fixtures: [
        {
          name: "local-python",
          repoUrl: sourceDir,
          sparsePaths: ["pyproject.toml", "app/routes.py"],
          task: "assess a representative Python web change",
          guardChecks: [
            {
              file: "app/routes.py",
              expectedRiskIncludes: ["Python web/API boundary change"]
            }
          ]
        }
      ]
    });

    expect(result.passed).toBe(true);
    expect(result.markdown).toContain("Status: PASS");
    expect(result.markdown).toContain("Guard checks: 1/1 pass");
    expect(result.markdown).not.toContain("### Guard:");
    expect(result.fixtures[0]).toMatchObject({
      name: "local-python",
      primeInitialized: false,
      codexInitialized: false,
      passed: true
    });
    expect(result.fixtures[0]?.guardTargets).toContain("app/routes.py");
    expect(result.fixtures[0]?.guardChecks[0]?.changeRisks.join("\n")).toContain(
      "Python web/API boundary change"
    );
  });

  it("rejects unknown fixture filters before cloning", async () => {
    await expect(
      runLargeRepoEval({
        fixtures: [],
        fixtureNames: ["missing"]
      })
    ).rejects.toThrow("Unknown large-repo eval fixture");
  });
});
