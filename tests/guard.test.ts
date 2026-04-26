import { mkdir, mkdtemp } from "node:fs/promises";
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
    expect(result.markdown).toContain("No related module pages found.");
    expect(result.markdown).toContain("wiki/files/src-unknown.md");
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
});
