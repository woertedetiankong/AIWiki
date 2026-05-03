import { execFile } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { runUsabilityEval } from "../src/usability-eval.js";

const execFileAsync = promisify(execFile);

function cliArgs(...args: string[]): string[] {
  const cliPath = path.resolve("src", "cli.ts");
  const tsxLoader = pathToFileURL(
    path.resolve("node_modules", "tsx", "dist", "loader.mjs")
  ).href;
  return ["--import", tsxLoader, cliPath, ...args];
}

describe("Codex-owned usability eval", () => {
  it("runs the default natural-language workflow scenarios", async () => {
    const result = await runUsabilityEval();

    expect(result.passed).toBe(true);
    expect(result.scenarios.map((scenario) => scenario.name)).toEqual([
      "resume-first",
      "guard-payment-precision",
      "module-import-preview",
      "maintainability-request",
      "maintain-stale-refresh"
    ]);
    expect(result.markdown).toContain("# AIWiki Codex-Owned Usability Eval");
    expect(result.markdown).toContain("继续昨天没做完的功能");
    expect(result.markdown).toContain("generic-advisory-not-payment-risk");
    expect(result.markdown).toContain("imported-memory-proposed");
    expect(result.markdown).toContain("stale-existing-page-becomes-append");
  });

  it("supports filtering scenarios by name", async () => {
    const result = await runUsabilityEval({
      scenarioNames: ["guard-payment-precision"]
    });

    expect(result.passed).toBe(true);
    expect(result.scenarios).toHaveLength(1);
    expect(result.scenarios[0]?.name).toBe("guard-payment-precision");
  });

  it("rejects unknown scenario filters before running", async () => {
    await expect(
      runUsabilityEval({ scenarioNames: ["missing-scenario"] })
    ).rejects.toThrow("Unknown usability eval scenario");
  });

  it("exposes the usability eval through the hidden CLI", async () => {
    const { stdout } = await execFileAsync(
      process.execPath,
      cliArgs(
        "eval",
        "usability",
        "--scenario",
        "guard-payment-precision",
        "--format",
        "json"
      ),
      { cwd: path.resolve(".") }
    );
    const parsed = JSON.parse(stdout) as {
      passed: boolean;
      scenarios: Array<{ name: string; passed: boolean }>;
    };

    expect(parsed.passed).toBe(true);
    expect(parsed.scenarios).toEqual([
      expect.objectContaining({
        name: "guard-payment-precision",
        passed: true
      })
    ]);
  });
});
