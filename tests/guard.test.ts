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

  it("does not overmatch generic missing-file path tokens", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    const wikiDir = path.join(rootDir, ".aiwiki", "wiki", "pitfalls");
    await mkdir(wikiDir, { recursive: true });
    await writeMarkdownFile(
      path.join(wikiDir, "generic-file-write.md"),
      {
        type: "pitfall",
        title: "Generic file write",
        modules: ["storage"],
        severity: "high"
      },
      "# Pitfall: Generic file write\n\nMissing file handling can create noisy guard output.\n"
    );

    const result = await generateFileGuardrails(rootDir, "definitely-missing-file.ts");

    expect(result.guardrails.matchedDocs).toEqual([]);
    expect(result.markdown).not.toContain("Generic file write");
    expect(result.markdown).toContain("No matching pitfalls found.");
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

  it("surfaces semantic risks for database, hydration, and browser-only changes", async () => {
    const rootDir = await tempProject();
    await mkdir(path.join(rootDir, "db", "migrations"), { recursive: true });
    await mkdir(path.join(rootDir, "scripts"), { recursive: true });
    await mkdir(path.join(rootDir, "components"), { recursive: true });
    await mkdir(path.join(rootDir, "lib"), { recursive: true });
    await mkdir(path.join(rootDir, "src"), { recursive: true });
    await writeFile(
      path.join(rootDir, "db", "schema.sql"),
      "CREATE VIRTUAL TABLE posts_fts USING fts5(title, content);\nCREATE TRIGGER posts_fts_update AFTER UPDATE ON posts BEGIN SELECT 1; END;\n",
      "utf8"
    );
    await writeFile(path.join(rootDir, "scripts", "cf-deploy.sh"), "wrangler d1 execute DB --file db/schema.sql\n", "utf8");
    await writeFile(path.join(rootDir, "scripts", "cf-init.sh"), "wrangler d1 execute DB --file db/schema.sql\n", "utf8");
    await writeFile(
      path.join(rootDir, "components", "AppearanceHydrator.tsx"),
      "\"use client\";\nimport { useEffect } from 'react';\nexport function AppearanceHydrator() { useEffect(() => localStorage.getItem('theme'), []); return null; }\n",
      "utf8"
    );
    await writeFile(
      path.join(rootDir, "lib", "wechat-copy.ts"),
      "export async function pdf() { const html2pdf = await import('html2pdf.js'); document.title = String(html2pdf); }\n",
      "utf8"
    );
    await writeFile(
      path.join(rootDir, "src", "checkout.ts"),
      "export function chargeOrder(amountCents: number, currency: string) { return { amountCents, currency }; }\n",
      "utf8"
    );

    const schema = await generateFileGuardrails(rootDir, "db/schema.sql");
    const appearance = await generateFileGuardrails(rootDir, "components/AppearanceHydrator.tsx");
    const browserOnly = await generateFileGuardrails(rootDir, "lib/wechat-copy.ts");
    const checkout = await generateFileGuardrails(rootDir, "src/checkout.ts", {
      architectureGuard: true
    });

    expect(schema.markdown).toContain("## Change Risks");
    expect(schema.markdown).toContain("Database schema or migration change");
    expect(schema.markdown).toContain("scripts/cf-deploy.sh");
    expect(schema.markdown).toContain("FTS/trigger change");
    expect(appearance.markdown).toContain("Appearance hydration change");
    expect(browserOnly.markdown).toContain("Browser-only API/library usage");
    expect(checkout.markdown).toContain("Money/payment flow change");
    expect(checkout.markdown).toContain("checkout, charge/amount handling");
  });

  it("surfaces priority language risks for Python, Java, JS/TS, and C projects", async () => {
    const rootDir = await tempProject();
    await mkdir(path.join(rootDir, "app"), { recursive: true });
    await mkdir(path.join(rootDir, "src", "main", "java"), { recursive: true });
    await mkdir(path.join(rootDir, "src", "app", "api", "auth"), { recursive: true });
    await mkdir(path.join(rootDir, "src"), { recursive: true });
    await writeFile(path.join(rootDir, "pyproject.toml"), "[project]\nname = 'demo'\n", "utf8");
    await writeFile(path.join(rootDir, "pom.xml"), "<project></project>\n", "utf8");
    await writeFile(path.join(rootDir, "package.json"), "{\"scripts\":{\"test\":\"vitest\"}}\n", "utf8");
    await writeFile(path.join(rootDir, "Makefile"), "all:\n\tcc src/buffer.c\n", "utf8");
    await writeFile(
      path.join(rootDir, "app", "routes.py"),
      "import subprocess\n@app.route('/run')\ndef run(): subprocess.run(['echo'])\n",
      "utf8"
    );
    await writeFile(
      path.join(rootDir, "src", "main", "java", "UserController.java"),
      "@RestController class UserController { synchronized void update() {} }\n",
      "utf8"
    );
    await writeFile(
      path.join(rootDir, "src", "app", "api", "auth", "route.ts"),
      "export const token = process.env.SECRET_TOKEN;\n",
      "utf8"
    );
    await writeFile(
      path.join(rootDir, "src", "buffer.c"),
      "void copy(char *dst, char *src) { strcpy(dst, src); }\n",
      "utf8"
    );

    const python = await generateFileGuardrails(rootDir, "app/routes.py");
    const java = await generateFileGuardrails(rootDir, "src/main/java/UserController.java");
    const ts = await generateFileGuardrails(rootDir, "src/app/api/auth/route.ts");
    const c = await generateFileGuardrails(rootDir, "src/buffer.c");

    expect(python.markdown).toContain("Python web/API boundary change");
    expect(python.markdown).toContain("Python runtime/security-sensitive code");
    expect(java.markdown).toContain("Java controller/API boundary change");
    expect(java.markdown).toContain("Java transaction/concurrency-sensitive change");
    expect(ts.markdown).toContain("Server/API boundary change");
    expect(c.markdown).toContain("C memory-safety-sensitive change");
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
