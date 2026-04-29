import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { initAIWiki } from "../src/init.js";
import { writeMarkdownFile } from "../src/markdown.js";
import {
  formatReflectPreviewMarkdown,
  generateReflectPreview
} from "../src/reflect.js";
import { applyWikiUpdatePlan } from "../src/apply.js";

const execFileAsync = promisify(execFile);

async function tempProject(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "aiwiki-reflect-"));
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

async function addReflectMemory(rootDir: string): Promise<void> {
  const wikiDir = path.join(rootDir, ".aiwiki", "wiki");
  await mkdir(path.join(wikiDir, "pitfalls"), { recursive: true });
  await mkdir(path.join(wikiDir, "rules"), { recursive: true });

  await writeMarkdownFile(
    path.join(wikiDir, "pitfalls", "auth-permissions.md"),
    {
      type: "pitfall",
      title: "Auth route permission checks",
      modules: ["auth"],
      files: ["src/app/api/auth/route.ts"],
      severity: "high"
    },
    "# Pitfall: Auth route permission checks\n\nCheck permissions server-side.\n"
  );

  await writeMarkdownFile(
    path.join(wikiDir, "rules", "protect-auth.md"),
    {
      type: "rule",
      title: "Protect auth routes",
      modules: ["auth"],
      severity: "critical"
    },
    "# Rule: Protect auth routes\n\nAuth routes require explicit checks.\n"
  );
}

async function initGitProject(rootDir: string): Promise<void> {
  await execFileAsync("git", ["init"], { cwd: rootDir });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], {
    cwd: rootDir
  });
  await execFileAsync("git", ["config", "user.name", "Test User"], {
    cwd: rootDir
  });
  await execFileAsync("git", ["add", "."], { cwd: rootDir });
  await execFileAsync("git", ["commit", "-m", "baseline"], { cwd: rootDir });
}

describe("generateReflectPreview", () => {
  it("generates a notes-based reflection preview without wiki writes", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await addReflectMemory(rootDir);
    await writeProjectFile(
      rootDir,
      "notes/today.md",
      "# Auth fix\n\nAuth route needed server-side permission checks.\n"
    );

    const result = await generateReflectPreview(rootDir, {
      notes: "notes/today.md"
    });

    expect(result.markdown).toContain("# Reflect Preview");
    expect(result.markdown).toContain("## Review First");
    expect(result.markdown).toContain("## Update Plan Draft");
    expect(result.markdown).toContain("## Lessons to Capture");
    expect(result.markdown.indexOf("## Review First")).toBeLessThan(
      result.markdown.indexOf("## Update Plan Draft")
    );
    expect(result.markdown).toContain("Notes summary: Auth fix");
    expect(result.markdown).toContain("Auth route permission checks");
    expect(result.markdown).toContain("candidate wiki write");
    expect(result.markdown).toContain("No wiki pages are written until apply --confirm.");
    expect(result.preview.selectedDocs).toContain("wiki/pitfalls/auth-permissions.md");
    expect(result.preview.updatePlanDraft?.entries[0]).toMatchObject({
      type: "pitfall",
      source: "reflect",
      slug: "auth-permissions"
    });

    const dryRun = await applyWikiUpdatePlan(
      rootDir,
      result.preview.updatePlanDraft
    );
    expect(dryRun.preview.operations[0]?.action).toBe("append");
    expect(dryRun.preview.operations[0]?.source).toBe("reflect");
  });

  it("reads git diff and detects changed high-risk files", async () => {
    const rootDir = await tempProject();
    await writeProjectFile(
      rootDir,
      "src/app/api/auth/route.ts",
      "export const value = 1;\n"
    );
    await initAIWiki({ rootDir, projectName: "demo" });
    await addReflectMemory(rootDir);
    await initGitProject(rootDir);
    await writeProjectFile(
      rootDir,
      "src/app/api/auth/route.ts",
      "export const value = 2;\n"
    );

    const result = await generateReflectPreview(rootDir, {
      fromGitDiff: true
    });

    expect(result.preview.changedFiles).toEqual(["src/app/api/auth/route.ts"]);
    expect(result.markdown).toContain("Git diff changed 1 file(s).");
    expect(result.markdown).toContain(
      "Consider whether changes to src/app/api/auth/route.ts introduced a reusable pitfall."
    );
  });

  it("generates module and pitfall draft entries from high-risk changed files", async () => {
    const rootDir = await tempProject();
    await writeProjectFile(
      rootDir,
      "src/app/api/auth/route.ts",
      "export const value = 1;\n"
    );
    await initAIWiki({ rootDir, projectName: "demo" });
    await initGitProject(rootDir);
    await writeProjectFile(
      rootDir,
      "src/app/api/auth/route.ts",
      "export const value = 2;\n"
    );

    const result = await generateReflectPreview(rootDir, {
      fromGitDiff: true
    });

    expect(result.preview.updatePlanDraft?.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "module", modules: ["auth"] }),
        expect.objectContaining({
          type: "pitfall",
          files: ["src/app/api/auth/route.ts"],
          source: "reflect"
        })
      ])
    );
  });

  it("scopes module draft files to the inferred changed module", async () => {
    const rootDir = await tempProject();
    await writeProjectFile(rootDir, "README.md", "# Demo\n");
    await writeProjectFile(rootDir, "prd.md", "# PRD\n");
    await writeProjectFile(rootDir, "src/brief.ts", "export const brief = 1;\n");
    await writeProjectFile(rootDir, "src/config.ts", "export const config = 1;\n");
    await writeProjectFile(rootDir, "tests/brief.test.ts", "export const briefTest = 1;\n");
    await initAIWiki({ rootDir, projectName: "demo" });
    await initGitProject(rootDir);

    await writeProjectFile(rootDir, "README.md", "# Demo\n\nUpdated docs.\n");
    await writeProjectFile(rootDir, "src/brief.ts", "export const brief = 2;\n");
    await writeProjectFile(rootDir, "src/config.ts", "export const config = 2;\n");
    await writeProjectFile(rootDir, "tests/brief.test.ts", "export const briefTest = 2;\n");

    const result = await generateReflectPreview(rootDir, {
      fromGitDiff: true
    });

    const entries = result.preview.updatePlanDraft?.entries ?? [];
    const briefEntry = entries.find(
      (entry) => entry.type === "module" && entry.modules?.includes("brief")
    );
    const configEntry = entries.find(
      (entry) => entry.type === "module" && entry.modules?.includes("config")
    );

    expect(briefEntry?.files).toEqual(["src/brief.ts", "tests/brief.test.ts"]);
    expect(briefEntry?.files).not.toContain("README.md");
    expect(briefEntry?.files).not.toContain("src/config.ts");
    expect(configEntry?.files).toEqual(["src/config.ts"]);
  });

  it("writes an output plan draft without overwriting unless force is set", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await writeProjectFile(
      rootDir,
      "notes/today.md",
      "# Auth rule\n\nAuth routes must check permissions server-side.\n"
    );

    const result = await generateReflectPreview(rootDir, {
      notes: "notes/today.md",
      outputPlan: ".aiwiki/context-packs/reflect-plan.json"
    });

    expect(result.preview.outputPlanPath).toBe(
      path.join(rootDir, ".aiwiki/context-packs/reflect-plan.json")
    );
    expect(result.markdown).toContain("aiwiki apply");
    expect(result.markdown).toContain('aiwiki apply "');
    const plan = JSON.parse(
      await readFile(
        path.join(rootDir, ".aiwiki/context-packs/reflect-plan.json"),
        "utf8"
      )
    ) as { entries: Array<{ source?: string }> };
    expect(plan.entries[0]?.source).toBe("reflect");

    await expect(
      generateReflectPreview(rootDir, {
        notes: "notes/today.md",
        outputPlan: ".aiwiki/context-packs/reflect-plan.json"
      })
    ).rejects.toThrow("Refusing to overwrite existing output plan");

    await generateReflectPreview(rootDir, {
      notes: "notes/today.md",
      outputPlan: ".aiwiki/context-packs/reflect-plan.json",
      force: true
    });
  });

  it("appends reflect eval cases for each preview generation", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await writeProjectFile(
      rootDir,
      "notes/today.md",
      "# Auth rule\n\nAuth routes must check permissions server-side.\n"
    );

    await generateReflectPreview(rootDir, {
      notes: "notes/today.md"
    });
    await generateReflectPreview(rootDir, {
      notes: "notes/today.md"
    });

    const evals = (
      await readFile(
        path.join(rootDir, ".aiwiki", "evals", "reflect-cases.jsonl"),
        "utf8"
      )
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as {
        command?: string;
        input?: { notesPath?: string };
        updatePlanDraftEntries?: number;
      });

    expect(evals).toHaveLength(2);
    expect(evals[0]).toMatchObject({
      command: "reflect",
      input: { notesPath: "notes/today.md" }
    });
    expect(evals[0]?.updatePlanDraftEntries).toBeGreaterThanOrEqual(1);
  });

  it("supports read-only reflection previews without appending eval data", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await writeProjectFile(
      rootDir,
      "notes/today.md",
      "# Auth rule\n\nAuth routes must check permissions server-side.\n"
    );
    const evalPath = path.join(rootDir, ".aiwiki", "evals", "reflect-cases.jsonl");
    const initialEvals = await readFile(evalPath, "utf8");

    const result = await generateReflectPreview(rootDir, {
      notes: "notes/today.md",
      readOnly: true
    });

    expect(result.markdown).toContain("# Reflect Preview");
    expect(await readFile(evalPath, "utf8")).toBe(initialEvals);
  });

  it("rejects read-only reflection previews that request output plans", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await writeProjectFile(
      rootDir,
      "notes/today.md",
      "# Auth rule\n\nAuth routes must check permissions server-side.\n"
    );

    await expect(
      generateReflectPreview(rootDir, {
        notes: "notes/today.md",
        readOnly: true,
        outputPlan: ".aiwiki/context-packs/reflect-plan.json"
      })
    ).rejects.toThrow("Cannot use --read-only with --output-plan");

    await expect(
      readFile(
        path.join(rootDir, ".aiwiki", "context-packs", "reflect-plan.json"),
        "utf8"
      )
    ).rejects.toThrow();
  });

  it("rejects output plan paths outside the project root", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await writeProjectFile(
      rootDir,
      "notes/today.md",
      "# Auth rule\n\nAuth routes must check permissions server-side.\n"
    );

    await expect(
      generateReflectPreview(rootDir, {
        notes: "notes/today.md",
        outputPlan: "../outside.json"
      })
    ).rejects.toThrow("Refusing to access path outside project root");
  });

  it("formats markdown and json output", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });

    const result = await generateReflectPreview(rootDir);
    expect(formatReflectPreviewMarkdown(result.preview)).toContain(
      "# Reflect Preview"
    );

    const parsed = JSON.parse(result.json) as {
      projectName: string;
      updatePlanDraft?: unknown;
    };
    expect(parsed.projectName).toBe("demo");
    expect(parsed.updatePlanDraft).toBeUndefined();
  });
});
