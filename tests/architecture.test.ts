import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { initAIWiki } from "../src/init.js";
import type { AIWikiConfig } from "../src/types.js";
import {
  formatArchitectureAuditMarkdown,
  generateArchitectureAudit
} from "../src/architecture.js";

const execFileAsync = promisify(execFile);

async function tempProject(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "aiwiki-architecture-"));
}

async function writeProjectFile(
  rootDir: string,
  relativePath: string,
  content: string
): Promise<void> {
  const filePath = path.join(rootDir, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

async function updateConfig(
  rootDir: string,
  patch: Partial<AIWikiConfig>
): Promise<void> {
  const configPath = path.join(rootDir, ".aiwiki", "config.json");
  const config = JSON.parse(await readFile(configPath, "utf8")) as AIWikiConfig;
  await writeFile(configPath, JSON.stringify({ ...config, ...patch }, null, 2), "utf8");
}

describe("generateArchitectureAudit", () => {
  it("reports large files, hardcoding risks, high-risk files, and missing module memory", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await updateConfig(rootDir, {
      highRiskModules: ["payment"],
      riskFiles: ["src/app/api/stripe/webhook/route.ts"]
    });
    await writeProjectFile(
      rootDir,
      "src/app/api/stripe/webhook/route.ts",
      [
        "const stripeSecret = 'sk_test_123';",
        "const webhookUrl = 'https://example.com/stripe/webhook';",
        ...Array.from({ length: 430 }, (_, index) => `export const line${index} = ${index};`)
      ].join("\n")
    );

    const result = await generateArchitectureAudit(rootDir);

    expect(result.audit.summary.scannedFiles).toBe(1);
    expect(result.audit.summary.totalIssues).toBeGreaterThanOrEqual(4);
    expect(result.markdown).toContain("# Architecture Audit: demo");
    expect(result.markdown).toContain("## Large Files");
    expect(result.markdown).toContain("src/app/api/stripe/webhook/route.ts");
    expect(result.markdown).toContain("## Hardcoding Risks");
    expect(result.markdown).toContain("secret-like literal");
    expect(result.markdown).toContain("## Missing Module Memory");
    expect(result.markdown).toContain("payment");

    const parsed = JSON.parse(result.json) as { summary: { totalIssues: number } };
    expect(parsed.summary.totalIssues).toBe(result.audit.summary.totalIssues);
  });

  it("returns a stable no-risk audit for small projects", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await writeProjectFile(rootDir, "src/settings.ts", "export const value = 1;\n");

    const result = await generateArchitectureAudit(rootDir);

    expect(result.audit.summary.totalIssues).toBe(0);
    expect(result.markdown).toContain("No large files detected.");
    expect(result.markdown).toContain("No hardcoding risks detected.");
    expect(result.markdown).toContain("No missing module memory detected.");
  });

  it("exposes architecture audit through the CLI", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await writeProjectFile(
      rootDir,
      "src/payment.ts",
      "const webhookUrl = 'https://example.com/webhook';\n"
    );

    const cliPath = path.resolve("src", "cli.ts");
    const tsxLoader = path.resolve("node_modules", "tsx", "dist", "loader.mjs");
    const { stdout } = await execFileAsync(
      process.execPath,
      ["--import", tsxLoader, cliPath, "architecture", "audit"],
      { cwd: rootDir }
    );

    expect(stdout).toContain("# Architecture Audit: demo");
    expect(stdout).toContain("Hardcoding Risks");
  });
});
