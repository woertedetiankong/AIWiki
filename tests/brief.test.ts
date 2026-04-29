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
    expect(result.markdown).toContain("## Must Read");
    expect(result.markdown).toContain("## Do Not");
    expect(result.markdown).toContain("## Rules");
    expect(result.markdown).toContain("## Pitfalls");
    expect(result.markdown).toContain("## Suggested Tests");
    expect(result.markdown.indexOf("## Must Read")).toBeLessThan(
      result.markdown.indexOf("## Do Not")
    );
    expect(result.markdown.indexOf("## Do Not")).toBeLessThan(
      result.markdown.indexOf("## Rules")
    );
    expect(result.markdown.indexOf("## Rules")).toBeLessThan(
      result.markdown.indexOf("## Pitfalls")
    );
    expect(result.markdown).toContain("Stripe webhook raw body");
    expect(result.markdown).toContain("Keep Stripe secrets server-side");
    expect(result.markdown).toContain("Do not treat this brief as exact code instructions.");
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

  it("includes architecture, hardcoding, portability, and module memory guidance by default", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await addRelevantMemory(rootDir);

    await mkdir(path.join(rootDir, "src", "app", "api", "stripe", "webhook"), {
      recursive: true
    });
    await writeFile(
      path.join(rootDir, "src", "app", "api", "stripe", "webhook", "route.ts"),
      Array.from({ length: 430 }, (_, index) => `export const line${index} = ${index};`).join("\n"),
      "utf8"
    );

    const result = await generateDevelopmentBrief(
      rootDir,
      "add stripe payment provider webhook"
    );

    expect(result.markdown).toContain("## Other Context");
    expect(result.markdown).toContain("payment");
    expect(result.markdown).toContain("provider");
    expect(result.markdown).toContain("webhook");
    expect(result.markdown).toContain("secrets");
    expect(result.markdown).toContain("pricing");
    expect(result.markdown).toContain("src/app/api/stripe/webhook/route.ts");
    expect(result.markdown).toContain("Large file");
    expect(result.markdown).toContain("reflect");
  });

  it("keeps architecture guidance stable when no project risks are detected", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });

    const result = await generateDevelopmentBrief(rootDir, "add settings page", {
      format: "json"
    });
    const parsed = JSON.parse(result.json) as {
      sections: Array<{ title: string; items: string[] }>;
    };
    const sectionTitles = parsed.sections.map((section) => section.title);

    expect(sectionTitles).toContain("Architecture Boundaries");
    expect(sectionTitles).toContain("Hardcoding and Configuration Risks");
    expect(sectionTitles).toContain("Portability Checklist");
    expect(sectionTitles).toContain("Module Memory to Maintain");
    expect(result.markdown).toContain("No large-file structure warnings detected.");
    expect(result.markdown).toContain("Record reusable module decisions after implementation.");
  });

  it("discovers task-matching source entry files for cold-start projects", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await mkdir(path.join(rootDir, "components"), { recursive: true });
    await mkdir(path.join(rootDir, "lib"), { recursive: true });
    await mkdir(path.join(rootDir, ".wrangler", "tmp"), { recursive: true });
    await writeFile(
      path.join(rootDir, "components", "NovelEditor.tsx"),
      "export function NovelEditor() { return 'editor'; }\n",
      "utf8"
    );
    await writeFile(
      path.join(rootDir, "lib", "appearance.ts"),
      "export const THEME_OPTIONS = ['default', 'editorial'];\n",
      "utf8"
    );
    await writeFile(
      path.join(rootDir, ".wrangler", "tmp", "ProxyServerWorker.js"),
      "export const generated = 'editor theme';\n",
      "utf8"
    );

    const result = await generateDevelopmentBrief(
      rootDir,
      "check whether editor supports different styles"
    );
    const parsed = JSON.parse(result.json) as {
      sections: Array<{ title: string; items: string[] }>;
    };
    const discovered = parsed.sections.find(
      (section) => section.title === "Discovered Entry Files"
    );

    expect(discovered?.items.join("\n")).toContain("components/NovelEditor.tsx");
    expect(discovered?.items.join("\n")).toContain("lib/appearance.ts");
    expect(discovered?.items.join("\n")).not.toContain(".wrangler");
    expect(result.markdown).toContain("components/NovelEditor.tsx");
  });

  it("discovers task-matching markdown docs for document cleanup tasks", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await mkdir(path.join(rootDir, "docs"), { recursive: true });
    await mkdir(path.join(rootDir, ".history"), { recursive: true });
    await writeFile(
      path.join(rootDir, "requirements.md"),
      "# Requirements\n\nCurrent PMS requirements and handoff notes.\n",
      "utf8"
    );
    await writeFile(
      path.join(rootDir, "docs", "deployment-checklist.md"),
      "# Deployment Checklist\n\nCurrent deployment verification docs.\n",
      "utf8"
    );
    await writeFile(
      path.join(rootDir, ".history", "requirements_20260401.md"),
      "# Old Requirements\n\nStale copy.\n",
      "utf8"
    );
    await mkdir(path.join(rootDir, "src"), { recursive: true });
    await writeFile(
      path.join(rootDir, "src", "DocumentController.ts"),
      "export const documentController = true;\n",
      "utf8"
    );

    const result = await generateDevelopmentBrief(
      rootDir,
      "梳理 Markdown 文档，判断 requirements 和 checklist 是否过时"
    );
    const parsed = JSON.parse(result.json) as {
      sections: Array<{ title: string; items: string[] }>;
    };
    const docs = parsed.sections.find(
      (section) => section.title === "Discovered Markdown Docs"
    );

    expect(docs?.items.join("\n")).toContain("requirements.md");
    expect(docs?.items.join("\n")).toContain("docs/deployment-checklist.md");
    expect(docs?.items.join("\n")).not.toContain(".history");
    expect(result.markdown).not.toContain("src/DocumentController.ts");
    expect(result.markdown).toContain("requirements.md");
  });

  it("adds an explicit architecture guard section when requested", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await addRelevantMemory(rootDir);

    const result = await generateDevelopmentBrief(
      rootDir,
      "add stripe payment webhook",
      {
        architectureGuard: true,
        format: "json"
      }
    );
    const parsed = JSON.parse(result.json) as {
      sections: Array<{ title: string; items: string[] }>;
    };
    const titles = parsed.sections.map((section) => section.title);
    const architectureGuard = parsed.sections.find(
      (section) => section.title === "Architecture Guard"
    );

    expect(titles).toContain("Architecture Boundaries");
    expect(titles).toContain("Architecture Guard");
    expect(architectureGuard?.items.join("\n")).toContain("Likely modules: payment");
    expect(architectureGuard?.items.join("\n")).toContain("billing/payment");
    expect(result.markdown).toContain("## Architecture Guard");
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
