import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  formatIngestPreviewMarkdown,
  generateIngestPreview
} from "../src/ingest.js";
import { applyWikiUpdatePlan } from "../src/apply.js";
import { initAIWiki } from "../src/init.js";
import { writeMarkdownFile } from "../src/markdown.js";

const execFileAsync = promisify(execFile);

async function tempProject(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "aiwiki-ingest-"));
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

async function addIngestMemory(rootDir: string): Promise<void> {
  const wikiDir = path.join(rootDir, ".aiwiki", "wiki");
  await mkdir(path.join(wikiDir, "pitfalls"), { recursive: true });

  await writeMarkdownFile(
    path.join(wikiDir, "pitfalls", "stripe-webhook.md"),
    {
      type: "pitfall",
      title: "Stripe webhook raw body",
      modules: ["payment"],
      files: ["src/app/api/stripe/webhook/route.ts"],
      severity: "critical"
    },
    "# Pitfall: Stripe webhook raw body\n\nVerify raw body before parsing.\n"
  );
}

describe("generateIngestPreview", () => {
  it("copies a raw note and generates structured suggestions", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await addIngestMemory(rootDir);
    await writeProjectFile(
      rootDir,
      "old-notes/stripe.md",
      [
        "---",
        "title: Stripe webhook lesson",
        "modules:",
        "  - payment",
        "files:",
        "  - src/app/api/stripe/webhook/route.ts",
        "---",
        "# Stripe webhook lesson",
        "",
        "Stripe raw body must be verified before JSON parsing."
      ].join("\n")
    );

    const result = await generateIngestPreview(rootDir, "old-notes/stripe.md");

    expect(result.rawNotePath).toBe(".aiwiki/sources/raw-notes/stripe.md");
    expect(result.markdown).toContain("# Ingest Preview: old-notes/stripe.md");
    expect(result.markdown).toContain("Raw source copied to");
    expect(result.preview.selectedDocs).toContain("wiki/pitfalls/stripe-webhook.md");
    expect(result.preview.updatePlanDraft?.entries[0]).toMatchObject({
      type: "pitfall",
      slug: "stripe-webhook",
      source: "ingest"
    });

    const dryRun = await applyWikiUpdatePlan(
      rootDir,
      result.preview.updatePlanDraft
    );
    expect(dryRun.preview.operations[0]?.action).toBe("append");

    const copied = await readFile(path.join(rootDir, result.rawNotePath), "utf8");
    expect(copied).toContain("Stripe raw body must be verified");
  });

  it("creates a new update plan draft when no existing memory matches", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await writeProjectFile(
      rootDir,
      "notes/auth-rule.md",
      [
        "---",
        "modules:",
        "  - auth",
        "files:",
        "  - src/app/api/auth/route.ts",
        "---",
        "# Auth route rule",
        "",
        "Auth routes must check permissions server-side."
      ].join("\n")
    );

    const result = await generateIngestPreview(rootDir, "notes/auth-rule.md");

    expect(result.preview.updatePlanDraft?.entries[0]).toMatchObject({
      type: "rule",
      title: "Auth route rule",
      source: "ingest",
      status: "proposed",
      modules: ["auth"],
      files: ["src/app/api/auth/route.ts"]
    });

    const dryRun = await applyWikiUpdatePlan(
      rootDir,
      result.preview.updatePlanDraft
    );
    expect(dryRun.preview.operations[0]?.action).toBe("create");
  });

  it("does not overwrite raw note copies unless force is set", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await writeProjectFile(rootDir, "notes/lesson.md", "# Lesson\n\nFirst.\n");

    const first = await generateIngestPreview(rootDir, "notes/lesson.md");
    await writeProjectFile(rootDir, "notes/lesson.md", "# Lesson\n\nSecond.\n");
    const second = await generateIngestPreview(rootDir, "notes/lesson.md");
    const forced = await generateIngestPreview(rootDir, "notes/lesson.md", {
      force: true
    });

    expect(first.rawNotePath).toBe(".aiwiki/sources/raw-notes/lesson.md");
    expect(second.rawNotePath).toBe(".aiwiki/sources/raw-notes/lesson-2.md");
    expect(forced.rawNotePath).toBe(".aiwiki/sources/raw-notes/lesson.md");

    const overwritten = await readFile(path.join(rootDir, forced.rawNotePath), "utf8");
    expect(overwritten).toContain("Second.");
  });

  it("writes an output plan draft without changing structured wiki pages", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await writeProjectFile(
      rootDir,
      "notes/auth-rule.md",
      "# Auth route rule\n\nAuth routes must check permissions server-side.\n"
    );

    const result = await generateIngestPreview(rootDir, "notes/auth-rule.md", {
      outputPlan: ".aiwiki/context-packs/ingest-plan.json"
    });

    expect(result.preview.outputPlanPath).toBe(
      path.join(rootDir, ".aiwiki/context-packs/ingest-plan.json")
    );
    expect(result.markdown).toContain("aiwiki apply");
    const plan = JSON.parse(
      await readFile(
        path.join(rootDir, ".aiwiki/context-packs/ingest-plan.json"),
        "utf8"
      )
    ) as { entries: Array<{ source?: string }> };
    expect(plan.entries[0]?.source).toBe("ingest");

    await expect(
      readFile(
        path.join(rootDir, ".aiwiki", "wiki", "rules", "auth-route-rule.md"),
        "utf8"
      )
    ).rejects.toThrow();
  });

  it("rejects unsafe output plan paths and requires force to overwrite", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await writeProjectFile(rootDir, "notes/lesson.md", "# Lesson\n\nMust keep local.\n");

    await expect(
      generateIngestPreview(rootDir, "notes/lesson.md", {
        outputPlan: "../outside.json"
      })
    ).rejects.toThrow("Refusing to access path outside project root");

    await generateIngestPreview(rootDir, "notes/lesson.md", {
      outputPlan: ".aiwiki/context-packs/ingest-plan.json"
    });
    await expect(
      generateIngestPreview(rootDir, "notes/lesson.md", {
        outputPlan: ".aiwiki/context-packs/ingest-plan.json"
      })
    ).rejects.toThrow("Refusing to overwrite existing output plan");

    await generateIngestPreview(rootDir, "notes/lesson.md", {
      outputPlan: ".aiwiki/context-packs/ingest-plan.json",
      force: true
    });
  });

  it("formats markdown and json output", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await writeProjectFile(rootDir, "notes/lesson.md", "# Lesson\n\nMarkdown note.\n");

    const result = await generateIngestPreview(rootDir, "notes/lesson.md");
    expect(formatIngestPreviewMarkdown(result.preview)).toContain(
      "# Ingest Preview"
    );

    const parsed = JSON.parse(result.json) as {
      sourcePath: string;
      updatePlanDraft: { entries: unknown[] };
    };
    expect(parsed.sourcePath).toBe("notes/lesson.md");
    expect(parsed.updatePlanDraft.entries).toHaveLength(1);
  });

  it("exposes ingest as a CLI alias for reflect notes with raw preservation", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await writeProjectFile(
      rootDir,
      "notes/lesson.md",
      "# Lesson\n\nAuth routes must check permissions server-side.\n"
    );
    const cliPath = path.resolve("src", "cli.ts");
    const tsxLoader = pathToFileURL(
      path.resolve("node_modules", "tsx", "dist", "loader.mjs")
    ).href;

    const { stdout } = await execFileAsync(
      process.execPath,
      ["--import", tsxLoader, cliPath, "ingest", "notes/lesson.md"],
      { cwd: rootDir }
    );

    expect(stdout).toContain("# Reflect Preview");
    expect(stdout).toContain("Raw note copied to .aiwiki/sources/raw-notes/lesson.md");
    expect(await readFile(
      path.join(rootDir, ".aiwiki/sources/raw-notes/lesson.md"),
      "utf8"
    )).toContain("Auth routes must check permissions");
  });
});
