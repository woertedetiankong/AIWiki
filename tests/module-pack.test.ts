import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { initAIWiki } from "../src/init.js";
import { writeMarkdownFile } from "../src/markdown.js";
import {
  exportModulePack,
  generateModuleImportPreview,
  readModulePackFile
} from "../src/module-pack.js";

const execFileAsync = promisify(execFile);

async function tempProject(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "aiwiki-module-pack-"));
}

async function addPaymentMemory(rootDir: string): Promise<void> {
  const wikiDir = path.join(rootDir, ".aiwiki", "wiki");
  await mkdir(path.join(wikiDir, "modules"), { recursive: true });
  await mkdir(path.join(wikiDir, "pitfalls"), { recursive: true });
  await mkdir(path.join(wikiDir, "patterns"), { recursive: true });
  await mkdir(path.join(wikiDir, "decisions"), { recursive: true });
  await mkdir(path.join(wikiDir, "rules"), { recursive: true });

  await writeMarkdownFile(
    path.join(wikiDir, "modules", "payment.md"),
    {
      type: "module",
      title: "Payment",
      modules: ["payment"],
      files: ["src/lib/stripe.ts", "src/app/api/stripe/webhook/route.ts"],
      risk: "high"
    },
    "# Module: Payment\n\nPayment creates checkout sessions and handles webhooks.\n"
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
    "# Pitfall: Stripe raw body\n\nVerify Stripe webhook signatures before parsing JSON.\n"
  );

  await writeMarkdownFile(
    path.join(wikiDir, "patterns", "provider-adapter.md"),
    {
      type: "pattern",
      title: "Provider adapter boundary",
      modules: ["payment"],
      tags: ["portable"]
    },
    "# Pattern: Provider adapter boundary\n\nKeep provider SDK calls behind an adapter.\n"
  );

  await writeMarkdownFile(
    path.join(wikiDir, "decisions", "stripe-provider.md"),
    {
      type: "decision",
      title: "Use Stripe provider",
      modules: ["payment"],
      status: "active"
    },
    "# Decision: Use Stripe provider\n\nStripe is the first payment provider.\n"
  );

  await writeMarkdownFile(
    path.join(wikiDir, "rules", "server-side-secrets.md"),
    {
      type: "rule",
      title: "Keep payment secrets server-side",
      modules: ["payment"],
      severity: "high"
    },
    "# Rule: Keep payment secrets server-side\n\nNever expose provider secrets to client code.\n"
  );
}

describe("module packs", () => {
  it("exports related module memory into a portable pack file", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "source-app" });
    await addPaymentMemory(rootDir);

    const result = await exportModulePack(rootDir, "payment", {
      output: ".aiwiki/module-packs/payment.aiwiki-pack.json"
    });

    expect(result.outputPath).toBe(
      path.join(rootDir, ".aiwiki", "module-packs", "payment.aiwiki-pack.json")
    );
    expect(result.pack.sourceProject).toBe("source-app");
    expect(result.pack.module).toBe("payment");
    expect(result.pack.pages.map((page) => page.type)).toEqual([
      "decision",
      "module",
      "pattern",
      "pitfall",
      "rule"
    ]);
    expect(result.pack.files).toContain("src/app/api/stripe/webhook/route.ts");
    expect(result.markdown).toContain("# Module Pack Export: payment");

    const saved = await readModulePackFile(result.outputPath!);
    expect(saved.pages.map((page) => page.title)).toContain("Stripe raw body");
  });

  it("imports a pack as preview and output-plan without writing wiki pages", async () => {
    const sourceDir = await tempProject();
    await initAIWiki({ rootDir: sourceDir, projectName: "source-app" });
    await addPaymentMemory(sourceDir);
    const exported = await exportModulePack(sourceDir, "payment", {
      output: ".aiwiki/module-packs/payment.aiwiki-pack.json"
    });

    const targetDir = await tempProject();
    await initAIWiki({ rootDir: targetDir, projectName: "target-app" });

    const result = await generateModuleImportPreview(targetDir, exported.outputPath!, {
      targetStack: "FastAPI + PostgreSQL",
      outputPlan: ".aiwiki/context-packs/payment-import-plan.json"
    });

    expect(result.preview.module).toBe("payment");
    expect(result.preview.targetProject).toBe("target-app");
    expect(result.preview.targetStack).toBe("FastAPI + PostgreSQL");
    expect(result.preview.updatePlanDraft.entries).toHaveLength(5);
    expect(result.markdown).toContain("# Module Import Preview: payment");
    expect(result.markdown).toContain("Cross-stack porting");
    expect(result.markdown).toContain("Do not copy source code directly");
    expect(result.outputPlanPath).toBe(
      path.join(targetDir, ".aiwiki", "context-packs", "payment-import-plan.json")
    );

    const modulesDir = path.join(targetDir, ".aiwiki", "wiki", "modules");
    const moduleFiles = await readFile(path.join(modulesDir, ".gitkeep"), "utf8");
    expect(moduleFiles).toBe("");
  });

  it("exposes module export and import through the CLI", async () => {
    const sourceDir = await tempProject();
    await initAIWiki({ rootDir: sourceDir, projectName: "source-app" });
    await addPaymentMemory(sourceDir);
    const cliPath = path.resolve("src", "cli.ts");
    const tsxLoader = path.resolve("node_modules", "tsx", "dist", "loader.mjs");

    const exportResult = await execFileAsync(
      process.execPath,
      [
        "--import",
        tsxLoader,
        cliPath,
        "module",
        "export",
        "payment",
        "--output",
        ".aiwiki/module-packs/payment.aiwiki-pack.json"
      ],
      { cwd: sourceDir }
    );
    expect(exportResult.stdout).toContain("# Module Pack Export: payment");

    const targetDir = await tempProject();
    await initAIWiki({ rootDir: targetDir, projectName: "target-app" });
    const importResult = await execFileAsync(
      process.execPath,
      [
        "--import",
        tsxLoader,
        cliPath,
        "module",
        "import",
        path.join(sourceDir, ".aiwiki", "module-packs", "payment.aiwiki-pack.json"),
        "--target-stack",
        "Next.js + TypeScript"
      ],
      { cwd: targetDir }
    );

    expect(importResult.stdout).toContain("# Module Import Preview: payment");
    expect(importResult.stdout).toContain("Next.js + TypeScript");
  });
});
