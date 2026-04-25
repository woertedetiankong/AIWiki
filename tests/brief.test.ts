import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AIWikiNotInitializedError } from "../src/config.js";
import { initAIWiki } from "../src/init.js";
import { writeMarkdownFile } from "../src/markdown.js";
import { generateDevelopmentBrief } from "../src/brief.js";

async function tempProject(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "aiwiki-brief-"));
}

async function addRelevantMemory(rootDir: string): Promise<void> {
  const modulesDir = path.join(rootDir, ".aiwiki", "wiki", "modules");
  const pitfallsDir = path.join(rootDir, ".aiwiki", "wiki", "pitfalls");
  const rulesDir = path.join(rootDir, ".aiwiki", "wiki", "rules");
  await mkdir(modulesDir, { recursive: true });
  await mkdir(pitfallsDir, { recursive: true });
  await mkdir(rulesDir, { recursive: true });

  await writeMarkdownFile(
    path.join(modulesDir, "payment.md"),
    {
      type: "module",
      title: "Payment",
      modules: ["payment"],
      files: ["src/lib/stripe.ts"],
      risk: "high"
    },
    "# Module: Payment\n\nPayment uses Stripe webhook routes.\n"
  );

  await writeMarkdownFile(
    path.join(pitfallsDir, "stripe-raw-body.md"),
    {
      type: "pitfall",
      title: "Stripe webhook raw body",
      modules: ["payment"],
      files: ["src/app/api/stripe/webhook/route.ts"],
      severity: "critical",
      encountered_count: 2
    },
    "# Pitfall: Stripe webhook raw body\n\nVerify raw body before parsing.\n"
  );

  await writeMarkdownFile(
    path.join(rulesDir, "server-side-stripe.md"),
    {
      type: "rule",
      title: "Keep Stripe secrets server-side",
      modules: ["payment"],
      files: ["src/lib/stripe.ts"],
      status: "active",
      severity: "high"
    },
    "# Rule: Keep Stripe secrets server-side\n\nNever expose Stripe secrets to client code.\n"
  );
}

describe("generateDevelopmentBrief", () => {
  it("throws a clear error when AIWiki is not initialized", async () => {
    const rootDir = await tempProject();

    await expect(
      generateDevelopmentBrief(rootDir, "stripe webhook")
    ).rejects.toBeInstanceOf(AIWikiNotInitializedError);
  });

  it("generates a no-LLM brief with relevant memory sections", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await addRelevantMemory(rootDir);

    const result = await generateDevelopmentBrief(rootDir, "stripe webhook");

    expect(result.markdown).toContain("# Development Brief: stripe webhook");
    expect(result.markdown).toContain("## Known Pitfalls");
    expect(result.markdown).toContain("Stripe webhook raw body");
    expect(result.markdown).toContain("Keep Stripe secrets server-side");
    expect(result.markdown).toContain(
      "Create your own implementation plan before editing code."
    );
    expect(result.markdown).not.toContain("Step 1");
    expect(result.markdown).not.toContain("Edit ");

    const log = await readFile(path.join(rootDir, ".aiwiki", "log.md"), "utf8");
    expect(log).toContain("brief | stripe webhook");

    const evals = await readFile(
      path.join(rootDir, ".aiwiki", "evals", "brief-cases.jsonl"),
      "utf8"
    );
    expect(evals).toContain("\"task\":\"stripe webhook\"");
  });

  it("returns stable json output", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await addRelevantMemory(rootDir);

    const result = await generateDevelopmentBrief(rootDir, "stripe webhook", {
      format: "json"
    });
    const parsed = JSON.parse(result.json) as {
      task: string;
      projectName: string;
      selectedDocs: string[];
      sections: Array<{ title: string; items: string[] }>;
    };

    expect(parsed.task).toBe("stripe webhook");
    expect(parsed.projectName).toBe("demo");
    expect(parsed.selectedDocs).toContain("wiki/pitfalls/stripe-raw-body.md");
    expect(parsed.sections.map((section) => section.title)).toContain(
      "Notes for Codex"
    );
  });

  it("does not overwrite output files unless force is set", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await addRelevantMemory(rootDir);

    await generateDevelopmentBrief(rootDir, "stripe webhook", {
      output: ".aiwiki/context-packs/current.md"
    });

    await expect(
      generateDevelopmentBrief(rootDir, "stripe webhook again", {
        output: ".aiwiki/context-packs/current.md"
      })
    ).rejects.toThrow("Refusing to overwrite");

    await writeFile(
      path.join(rootDir, ".aiwiki", "context-packs", "current.md"),
      "custom\n",
      "utf8"
    );

    await generateDevelopmentBrief(rootDir, "stripe webhook forced", {
      output: ".aiwiki/context-packs/current.md",
      force: true
    });

    const output = await readFile(
      path.join(rootDir, ".aiwiki", "context-packs", "current.md"),
      "utf8"
    );
    expect(output).toContain("# Development Brief: stripe webhook forced");
  });
});
