import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  formatIngestPreviewMarkdown,
  generateIngestPreview
} from "../src/ingest.js";
import { initAIWiki } from "../src/init.js";
import { writeMarkdownFile } from "../src/markdown.js";

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

    const copied = await readFile(path.join(rootDir, result.rawNotePath), "utf8");
    expect(copied).toContain("Stripe raw body must be verified");
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

  it("formats markdown and json output", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await writeProjectFile(rootDir, "notes/lesson.md", "# Lesson\n\nMarkdown note.\n");

    const result = await generateIngestPreview(rootDir, "notes/lesson.md");
    expect(formatIngestPreviewMarkdown(result.preview)).toContain(
      "# Ingest Preview"
    );

    const parsed = JSON.parse(result.json) as { sourcePath: string };
    expect(parsed.sourcePath).toBe("notes/lesson.md");
  });
});
