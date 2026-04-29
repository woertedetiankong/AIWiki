import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { initAIWiki } from "../src/init.js";
import { writeMarkdownFile } from "../src/markdown.js";
import {
  exportModulePack,
  generateModuleImportPreview,
  generateModuleMemoryBrief,
  lintModuleMemory,
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

  it("imports a pack under a safe target module name with --as semantics", async () => {
    const sourceDir = await tempProject();
    await initAIWiki({ rootDir: sourceDir, projectName: "source-app" });
    await addPaymentMemory(sourceDir);
    const exported = await exportModulePack(sourceDir, "payment", {
      output: ".aiwiki/module-packs/payment.aiwiki-pack.json"
    });

    const targetDir = await tempProject();
    await initAIWiki({ rootDir: targetDir, projectName: "target-app" });

    const result = await generateModuleImportPreview(targetDir, exported.outputPath!, {
      as: "billing",
      outputPlan: ".aiwiki/context-packs/billing-import-plan.json"
    });

    expect(result.preview.sourceModule).toBe("payment");
    expect(result.preview.targetModule).toBe("billing");
    expect(result.preview.module).toBe("billing");
    expect(result.markdown).toContain("Source module: payment");
    expect(result.markdown).toContain("Target module: billing");
    expect(result.preview.updatePlanDraft.title).toContain("as billing");

    const moduleEntry = result.preview.updatePlanDraft.entries.find(
      (entry) => entry.type === "module"
    );
    expect(moduleEntry).toMatchObject({
      title: "billing",
      slug: "billing",
      status: "proposed"
    });
    expect(moduleEntry?.modules).toContain("billing");
    expect(moduleEntry?.modules).not.toContain("payment");
    expect(moduleEntry?.summary).toContain("payment as billing");
    expect(moduleEntry?.body).toContain("Source module: payment. Target module: billing.");

    const savedPlan = JSON.parse(
      await readFile(result.outputPlanPath!, "utf8")
    ) as { entries: Array<{ modules?: string[] }> };
    expect(savedPlan.entries.every((entry) => entry.modules?.includes("billing"))).toBe(true);
  });

  it("reports import risks for existing pages, similar modules, active rules, and source assumptions", async () => {
    const sourceDir = await tempProject();
    await initAIWiki({ rootDir: sourceDir, projectName: "source-app" });
    await addPaymentMemory(sourceDir);
    await writeMarkdownFile(
      path.join(sourceDir, ".aiwiki", "wiki", "patterns", "local-callback.md"),
      {
        type: "pattern",
        title: "Local callback",
        modules: ["payment"],
        tags: ["portable"]
      },
      "# Pattern: Local callback\n\nUse localhost callback while testing Stripe in staging.\n"
    );
    const exported = await exportModulePack(sourceDir, "payment", {
      output: ".aiwiki/module-packs/payment.aiwiki-pack.json",
      force: true
    });

    const targetDir = await tempProject();
    await initAIWiki({ rootDir: targetDir, projectName: "target-app" });
    await writeMarkdownFile(
      path.join(targetDir, ".aiwiki", "wiki", "modules", "billing.md"),
      {
        type: "module",
        title: "Billing",
        modules: ["billing"],
        status: "active"
      },
      "# Module: Billing\n\nExisting billing memory.\n"
    );
    await writeMarkdownFile(
      path.join(targetDir, ".aiwiki", "wiki", "rules", "server-side-secrets.md"),
      {
        type: "rule",
        title: "Keep server-side secrets",
        modules: ["billing"],
        status: "active"
      },
      "# Rule: Keep server-side secrets\n\nExisting rule.\n"
    );

    const result = await generateModuleImportPreview(targetDir, exported.outputPath!, {
      as: "billing"
    });

    expect(result.markdown).toContain("## Import Risks");
    expect(result.preview.risks.map((risk) => risk.code)).toContain("existing_page");
    expect(result.preview.risks.map((risk) => risk.code)).toContain("similar_module");
    expect(result.preview.risks.map((risk) => risk.code)).toContain("possible_rule_conflict");
    expect(result.preview.risks.map((risk) => risk.code)).toContain("source_specific_assumption");
    expect(result.markdown).toContain("wiki/modules/billing.md");

    const parsed = JSON.parse(result.json) as {
      risks: Array<{ code: string; severity: string }>;
    };
    expect(parsed.risks.some((risk) => risk.code === "existing_page")).toBe(true);
  });

  it("keeps old import module behavior when --as is not provided", async () => {
    const sourceDir = await tempProject();
    await initAIWiki({ rootDir: sourceDir, projectName: "source-app" });
    await addPaymentMemory(sourceDir);
    const exported = await exportModulePack(sourceDir, "payment", {
      output: ".aiwiki/module-packs/payment.aiwiki-pack.json"
    });
    const targetDir = await tempProject();
    await initAIWiki({ rootDir: targetDir, projectName: "target-app" });

    const result = await generateModuleImportPreview(targetDir, exported.outputPath!);

    expect(result.preview.sourceModule).toBe("payment");
    expect(result.preview.targetModule).toBe("payment");
    expect(result.preview.module).toBe("payment");
    expect(result.preview.updatePlanDraft.title).not.toContain(" as ");
    expect(result.preview.updatePlanDraft.entries[0]?.modules).toContain("payment");
  });

  it("rejects unsafe --as module names", async () => {
    const sourceDir = await tempProject();
    await initAIWiki({ rootDir: sourceDir, projectName: "source-app" });
    await addPaymentMemory(sourceDir);
    const exported = await exportModulePack(sourceDir, "payment", {
      output: ".aiwiki/module-packs/payment.aiwiki-pack.json"
    });
    const targetDir = await tempProject();
    await initAIWiki({ rootDir: targetDir, projectName: "target-app" });

    await expect(
      generateModuleImportPreview(targetDir, exported.outputPath!, {
        as: "Billing Module"
      })
    ).rejects.toThrow("Unsafe module name for --as");
  });

  it("does not overwrite --as output plans unless force is provided", async () => {
    const sourceDir = await tempProject();
    await initAIWiki({ rootDir: sourceDir, projectName: "source-app" });
    await addPaymentMemory(sourceDir);
    const exported = await exportModulePack(sourceDir, "payment", {
      output: ".aiwiki/module-packs/payment.aiwiki-pack.json"
    });
    const targetDir = await tempProject();
    await initAIWiki({ rootDir: targetDir, projectName: "target-app" });

    await generateModuleImportPreview(targetDir, exported.outputPath!, {
      as: "billing",
      outputPlan: ".aiwiki/context-packs/billing-import-plan.json"
    });
    await expect(
      generateModuleImportPreview(targetDir, exported.outputPath!, {
        as: "billing",
        outputPlan: ".aiwiki/context-packs/billing-import-plan.json"
      })
    ).rejects.toThrow("Refusing to overwrite existing output plan");

    await generateModuleImportPreview(targetDir, exported.outputPath!, {
      as: "billing",
      outputPlan: ".aiwiki/context-packs/billing-import-plan.json",
      force: true
    });
  });

  it("exposes module export and import through the CLI", async () => {
    const sourceDir = await tempProject();
    await initAIWiki({ rootDir: sourceDir, projectName: "source-app" });
    await addPaymentMemory(sourceDir);
    const cliPath = path.resolve("src", "cli.ts");
    const tsxLoader = pathToFileURL(
      path.resolve("node_modules", "tsx", "dist", "loader.mjs")
    ).href;

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
        "--as",
        "billing",
        "--target-stack",
        "Next.js + TypeScript"
      ],
      { cwd: targetDir }
    );

    expect(importResult.stdout).toContain("# Module Import Preview: billing");
    expect(importResult.stdout).toContain("Source module: payment");
    expect(importResult.stdout).toContain("Target module: billing");
    expect(importResult.stdout).toContain("Next.js + TypeScript");
  }, 15000);

  it("generates a module brief for adapting module memory to a task", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await addPaymentMemory(rootDir);

    const result = await generateModuleMemoryBrief(
      rootDir,
      "payment",
      "implement checkout in a new stack"
    );

    expect(result.markdown).toContain("# Module Brief: payment");
    expect(result.markdown).toContain("## Must Read");
    expect(result.markdown).toContain("## Porting Rules");
    expect(result.markdown).toContain("## Pitfalls");
    expect(result.markdown).toContain("## Configuration and Boundary Notes");
    expect(result.markdown).toContain("## Suggested Tests");
    expect(result.markdown.indexOf("## Must Read")).toBeLessThan(
      result.markdown.indexOf("## Porting Rules")
    );
    expect(result.markdown).toContain("Do not copy source code directly");
    expect(result.markdown).toContain("Stripe raw body");
    expect(result.markdown).toContain("Keep payment secrets server-side");
    expect(result.brief.files).toContain("src/app/api/stripe/webhook/route.ts");

    const parsed = JSON.parse(result.json) as {
      module: string;
      sections: Array<{ title: string }>;
    };
    expect(parsed.module).toBe("payment");
    expect(parsed.sections.map((section) => section.title)).toContain("Pitfalls");
  });

  it("lints module memory for portability and unsafe imported active rules", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await addPaymentMemory(rootDir);
    await writeMarkdownFile(
      path.join(rootDir, ".aiwiki", "wiki", "rules", "imported-active.md"),
      {
        type: "rule",
        title: "Imported local callback",
        modules: ["payment"],
        status: "active",
        tags: ["module-import"]
      },
      "# Rule: Imported local callback\n\nImported from a module pack. Use localhost callback in staging.\n"
    );

    const result = await lintModuleMemory(rootDir, "payment");

    expect(result.report.issues.map((issue) => issue.code)).toContain(
      "missing_portability_notes"
    );
    expect(result.report.issues.map((issue) => issue.code)).toContain(
      "source_specific_assumption"
    );
    expect(result.report.issues.map((issue) => issue.code)).toContain(
      "active_imported_rule"
    );
    expect(result.markdown).toContain("# Module Lint: payment");
  });

  it("returns stable module brief and lint output when no module memory matches", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });

    const brief = await generateModuleMemoryBrief(rootDir, "billing", "add billing");
    const lint = await lintModuleMemory(rootDir, "billing");

    expect(brief.brief.pages).toEqual([]);
    expect(brief.markdown).toContain("No module memory matched this module.");
    expect(lint.report.issues).toContainEqual(
      expect.objectContaining({ code: "no_module_memory" })
    );
  });

  it("exposes module brief and lint through the CLI", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await addPaymentMemory(rootDir);
    const cliPath = path.resolve("src", "cli.ts");
    const tsxLoader = pathToFileURL(
      path.resolve("node_modules", "tsx", "dist", "loader.mjs")
    ).href;

    const brief = await execFileAsync(
      process.execPath,
      [
        "--import",
        tsxLoader,
        cliPath,
        "module",
        "brief",
        "payment",
        "implement checkout",
        "--format",
        "json"
      ],
      { cwd: rootDir }
    );
    const parsedBrief = JSON.parse(brief.stdout) as { module: string };
    expect(parsedBrief.module).toBe("payment");

    const lint = await execFileAsync(
      process.execPath,
      ["--import", tsxLoader, cliPath, "module", "lint", "payment"],
      { cwd: rootDir }
    );
    expect(lint.stdout).toContain("# Module Lint: payment");
  }, 15000);
});
