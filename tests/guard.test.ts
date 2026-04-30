import { mkdir, mkdtemp, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  formatFileGuardrailsMarkdown,
  generateFileGuardrails
} from "../src/guard.js";
import { initAIWiki } from "../src/init.js";
import { writeMarkdownFile } from "../src/markdown.js";

async function tempProject(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "aiwiki-guard-"));
}

async function addGuardMemory(rootDir: string): Promise<void> {
  const wikiDir = path.join(rootDir, ".aiwiki", "wiki");
  await mkdir(path.join(wikiDir, "modules"), { recursive: true });
  await mkdir(path.join(wikiDir, "pitfalls"), { recursive: true });
  await mkdir(path.join(wikiDir, "rules"), { recursive: true });
  await mkdir(path.join(wikiDir, "decisions"), { recursive: true });

  await writeMarkdownFile(
    path.join(wikiDir, "modules", "payment.md"),
    {
      type: "module",
      title: "Payment",
      modules: ["payment"],
      files: ["src/app/api/stripe/webhook/route.ts"],
      risk: "high"
    },
    "# Module: Payment\n\nStripe webhook and billing flows live here.\n"
  );

  await writeMarkdownFile(
    path.join(wikiDir, "pitfalls", "stripe-raw-body.md"),
    {
      type: "pitfall",
      title: "Stripe webhook raw body",
      modules: ["payment"],
      files: ["src/app/api/stripe/webhook/route.ts"],
      severity: "critical",
      encountered_count: 3
    },
    "# Pitfall: Stripe webhook raw body\n\nVerify raw body before parsing.\n"
  );

  await writeMarkdownFile(
    path.join(wikiDir, "pitfalls", "stripe-low-priority.md"),
    {
      type: "pitfall",
      title: "Stripe low priority note",
      modules: ["payment"],
      files: ["src/app/api/stripe/webhook/route.ts"],
      severity: "low"
    },
    "# Pitfall: Stripe low priority note\n\nA minor Stripe formatting issue.\n"
  );

  await writeMarkdownFile(
    path.join(wikiDir, "rules", "stripe-secrets.md"),
    {
      type: "rule",
      title: "Keep Stripe secrets server-side",
      modules: ["payment"],
      files: ["src/lib/stripe.ts"],
      severity: "high",
      status: "active"
    },
    "# Rule: Keep Stripe secrets server-side\n\nNever expose Stripe secrets to client code.\n"
  );

  await writeMarkdownFile(
    path.join(wikiDir, "decisions", "payment-webhook.md"),
    {
      type: "decision",
      title: "Use Stripe webhook route",
      modules: ["payment"],
      files: ["src/app/api/stripe/webhook/route.ts"],
      status: "active"
    },
    "# Decision: Use Stripe webhook route\n\nPayment events enter through the webhook route.\n"
  );
}

describe("generateFileGuardrails", () => {
  it("returns cold-start guardrails when AIWiki is not initialized", async () => {
    const rootDir = await tempProject();

    const result = await generateFileGuardrails(
      rootDir,
      "src/app/api/stripe/webhook/route.ts",
      { architectureGuard: true }
    );

    expect(result.markdown).toContain("## Setup");
    expect(result.markdown).toContain("Cold-start mode");
    expect(result.markdown).toContain("aiwiki init --project-name <name>");
    expect(result.markdown).toContain("## Architecture Guard");
    expect(result.markdown).toContain("High-risk signals");
  });

  it("matches related memory by file path and search context", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await addGuardMemory(rootDir);

    const result = await generateFileGuardrails(
      rootDir,
      "src/app/api/stripe/webhook/route.ts"
    );

    expect(result.markdown).toContain(
      "# File Guardrails: src/app/api/stripe/webhook/route.ts"
    );
    expect(result.markdown).toContain("## Do Not");
    expect(result.markdown).toContain("## Rules");
    expect(result.markdown).toContain("## Pitfalls");
    expect(result.markdown).toContain("## Required Checks");
    expect(result.markdown).toContain("## Suggested Tests");
    expect(result.markdown.indexOf("## Do Not")).toBeLessThan(
      result.markdown.indexOf("## Rules")
    );
    expect(result.markdown.indexOf("## Rules")).toBeLessThan(
      result.markdown.indexOf("## Pitfalls")
    );
    expect(result.markdown).toContain("Payment");
    expect(result.markdown).toContain("Stripe webhook raw body");
    expect(result.markdown).toContain("Keep Stripe secrets server-side");
    expect(result.markdown).toContain("Use Stripe webhook route");
    expect(result.guardrails.matchedDocs).toContain(
      "wiki/pitfalls/stripe-raw-body.md"
    );
  });

  it("orders high severity pitfalls before low severity pitfalls", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await addGuardMemory(rootDir);

    const result = await generateFileGuardrails(
      rootDir,
      "src/app/api/stripe/webhook/route.ts"
    );

    expect(result.markdown.indexOf("Stripe webhook raw body")).toBeLessThan(
      result.markdown.indexOf("Stripe low priority note")
    );
  });

  it("returns a stable empty guardrail response for unknown files", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await addGuardMemory(rootDir);

    const result = await generateFileGuardrails(rootDir, "src/unknown.ts");

    expect(result.guardrails.matchedDocs).toEqual([]);
    expect(result.markdown).toContain("No related modules found.");
    expect(result.markdown).toContain("No matching rules found.");
    expect(result.markdown).toContain("No stale wiki memory warnings for matched context.");
    expect(result.markdown).toContain("wiki/files/src-unknown.md");
  });

  it("suggests nearby tests and file signals for source files", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await mkdir(path.join(rootDir, "src"), { recursive: true });
    await mkdir(path.join(rootDir, "tests"), { recursive: true });
    await writeFile(
      path.join(rootDir, "src", "brief.ts"),
      [
        "import { helper } from './helper.js';",
        "export function brief() { return helper(); }"
      ].join("\n"),
      "utf8"
    );
    await writeFile(path.join(rootDir, "src", "helper.ts"), "export const helper = () => true;\n", "utf8");
    await writeFile(path.join(rootDir, "tests", "brief.test.ts"), "import '../src/brief.js';\n", "utf8");

    const result = await generateFileGuardrails(rootDir, "src/brief.ts");
    const parsed = JSON.parse(result.json) as {
      suggestedTests: string[];
      fileSignals: { exists: boolean; lines?: number; imports: string[] };
      fileNoteRecommended: boolean;
    };

    expect(result.markdown).toContain("npm run test -- tests/brief.test.ts");
    expect(result.markdown).toContain("## File Signals");
    expect(parsed.suggestedTests.join("\n")).toContain("tests/brief.test.ts");
    expect(parsed.fileSignals).toMatchObject({ exists: true, lines: 2 });
    expect(parsed.fileSignals.imports).toContain("./helper.js");
    expect(parsed.fileNoteRecommended).toBe(true);
  });

  it("surfaces staleness warnings for matched file memory", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await addGuardMemory(rootDir);
    const targetFile = path.join(rootDir, "src", "app", "api", "stripe", "webhook", "route.ts");
    await mkdir(path.dirname(targetFile), { recursive: true });
    await writeFile(targetFile, "export const route = true;\n", "utf8");
    await mkdir(path.join(rootDir, "src", "lib"), { recursive: true });
    await writeFile(
      path.join(rootDir, "src", "lib", "stripe.ts"),
      "export const stripe = true;\n",
      "utf8"
    );
    await utimes(
      targetFile,
      new Date("2026-04-01T00:00:00Z"),
      new Date("2026-04-01T00:00:00Z")
    );

    await writeMarkdownFile(
      path.join(rootDir, ".aiwiki", "wiki", "modules", "payment.md"),
      {
        type: "module",
        title: "Payment",
        modules: ["payment"],
        files: ["src/app/api/stripe/webhook/route.ts"],
        risk: "high",
        last_updated: "2026-03-01"
      },
      "# Module: Payment\n\nStripe webhook and billing flows live here.\n"
    );

    const result = await generateFileGuardrails(
      rootDir,
      "src/app/api/stripe/webhook/route.ts"
    );
    const parsed = JSON.parse(result.json) as {
      stalenessWarnings?: Array<{ code: string; file: string }>;
    };

    expect(result.markdown).toContain("## Staleness Warnings");
    expect(result.markdown).toContain("stale_referenced_file");
    expect(parsed.stalenessWarnings).toEqual([
      expect.objectContaining({
        code: "stale_referenced_file",
        file: "src/app/api/stripe/webhook/route.ts"
      })
    ]);
  });

  it("formats markdown and json output", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await addGuardMemory(rootDir);

    const result = await generateFileGuardrails(rootDir, "src/lib/stripe.ts");
    expect(formatFileGuardrailsMarkdown(result.guardrails)).toContain(
      "# File Guardrails: src/lib/stripe.ts"
    );

    const parsed = JSON.parse(result.json) as { filePath: string };
    expect(parsed.filePath).toBe("src/lib/stripe.ts");
  });

  it("adds architecture guardrails for route and high-risk files when requested", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await addGuardMemory(rootDir);

    const result = await generateFileGuardrails(
      rootDir,
      "src/app/api/stripe/webhook/route.ts",
      { architectureGuard: true }
    );
    const parsed = JSON.parse(result.json) as {
      sections: Array<{ title: string; items: string[] }>;
    };
    const section = parsed.sections.find(
      (item) => item.title === "Architecture Guard"
    );

    expect(result.markdown).toContain("## Architecture Guard");
    expect(section?.items.join("\n")).toContain("Route/controller boundary");
    expect(section?.items.join("\n")).toContain("High-risk signals");
    expect(section?.items.join("\n")).toContain("webhooks");
  });
});
