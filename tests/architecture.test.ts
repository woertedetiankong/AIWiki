import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { initAIWiki } from "../src/init.js";
import type { AIWikiConfig } from "../src/types.js";
import {
  formatArchitectureAuditMarkdown,
  generateArchitectureAudit,
  generateArchitectureBriefContext
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

  it("adds line evidence and avoids tokenBudget false-positive secrets", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await writeProjectFile(
      rootDir,
      "src/config.ts",
      [
        "export const tokenBudget = { brief: 8000 };",
        "const stripeSecret = 'sk_test_123456789';"
      ].join("\n")
    );

    const result = await generateArchitectureAudit(rootDir);
    const parsed = JSON.parse(result.json) as {
      issues: Array<{ severity: string; line?: number; snippet?: string; category?: string }>;
    };
    const secret = parsed.issues.find((issue) => issue.category === "secret");
    const tokenBudget = parsed.issues.find((issue) => issue.snippet?.includes("tokenBudget"));

    expect(secret).toMatchObject({ severity: "high", line: 2 });
    expect(result.markdown).toContain("src/config.ts:2");
    expect(result.markdown).toContain("Snippet:");
    expect(tokenBudget?.severity).not.toBe("high");
  });

  it("supports architecture audit config allowlists", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await updateConfig(rootDir, {
      architectureAudit: {
        ignorePaths: ["src/ignored"],
        ignoreLiteralPatterns: ["allowedSecret"]
      }
    });
    await writeProjectFile(rootDir, "src/ignored/key.ts", "const key = 'sk_test_ignored';\n");
    await writeProjectFile(rootDir, "src/allowed.ts", "const allowedSecret = 'sk_test_allowed';\n");
    await writeProjectFile(rootDir, "src/live.ts", "const liveSecret = 'sk_test_visible';\n");

    const result = await generateArchitectureAudit(rootDir);
    const text = result.markdown;

    expect(text).not.toContain("src/ignored/key.ts");
    expect(text).not.toContain("src/allowed.ts");
    expect(text).toContain("src/live.ts");
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
    const tsxLoader = pathToFileURL(
      path.resolve("node_modules", "tsx", "dist", "loader.mjs")
    ).href;
    const { stdout } = await execFileAsync(
      process.execPath,
      ["--import", tsxLoader, cliPath, "architecture", "audit"],
      { cwd: rootDir }
    );

    expect(stdout).toContain("# Architecture Audit: demo");
    expect(stdout).toContain("Hardcoding Risks");
  });
});

describe("generateArchitectureBriefContext", () => {
  it("does not fall back to all large files when focus files are shallow paths", async () => {
    const rootDir = await tempProject();
    await writeProjectFile(rootDir, "cli/picker.py", "def pick():\n    return 'picker'\n");
    await writeProjectFile(
      rootDir,
      "apps/deepresearch/static/app.js",
      Array.from({ length: 900 }, (_, index) => `export const app${index} = ${index};`).join("\n")
    );
    await writeProjectFile(
      rootDir,
      "examples/full_app/static/app.js",
      Array.from({ length: 900 }, (_, index) => `export const example${index} = ${index};`).join("\n")
    );

    const context = await generateArchitectureBriefContext(
      rootDir,
      "fix interactive CLI picker display behavior",
      { focusFiles: ["cli/picker.py"] }
    );
    const boundaries = context.architectureBoundaries.join("\n");

    expect(boundaries).toContain("No large-file structure warnings detected.");
    expect(boundaries).not.toContain("apps/deepresearch/static/app.js");
    expect(boundaries).not.toContain("examples/full_app/static/app.js");
  });

  it("keeps focused brief warnings on exact files instead of expanding whole directories", async () => {
    const rootDir = await tempProject();
    await writeProjectFile(
      rootDir,
      "pydantic_deep/toolsets/skills/toolset.py",
      Array.from({ length: 650 }, (_, index) => `TOOLSET_${index} = ${index}`).join("\n")
    );
    await writeProjectFile(
      rootDir,
      "pydantic_deep/toolsets/skills/backend.py",
      Array.from({ length: 650 }, (_, index) => `BACKEND_${index} = ${index}`).join("\n")
    );

    const context = await generateArchitectureBriefContext(
      rootDir,
      "modify skill toolset behavior",
      { focusFiles: ["pydantic_deep/toolsets/skills/toolset.py"] }
    );
    const boundaries = context.architectureBoundaries.join("\n");

    expect(boundaries).toContain("pydantic_deep/toolsets/skills/toolset.py");
    expect(boundaries).not.toContain("pydantic_deep/toolsets/skills/backend.py");
  });
});
