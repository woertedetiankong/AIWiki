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
  it("supports cold-start read-only git reflection and includes untracked files", async () => {
    const rootDir = await tempProject();
    await writeProjectFile(rootDir, "src/existing.ts", "export const value = 1;\n");
    await initGitProject(rootDir);
    await writeProjectFile(rootDir, "src/existing.ts", "export const value = 2;\n");
    await writeProjectFile(rootDir, "src/new-file.ts", "export const created = true;\n");
    await writeProjectFile(rootDir, "scratch/local.md", "# Local note\n");

    const result = await generateReflectPreview(rootDir, {
      fromGitDiff: true,
      readOnly: true
    });

    expect(result.preview.initialized).toBe(false);
    expect(result.preview.changedFiles).toEqual([
      "scratch/local.md",
      "src/existing.ts",
      "src/new-file.ts"
    ]);
    expect(result.preview.changedFiles).not.toContain("scratch/");
    expect(result.preview.updatePlanDraft).toBeUndefined();
    expect(result.markdown).toContain("Cold-start mode");
    expect(result.markdown).toContain("Includes untracked files from git status");

    await expect(
      generateReflectPreview(rootDir, {
        fromGitDiff: true,
        outputPlan: ".aiwiki/context-packs/reflect-plan.json"
      })
    ).rejects.toThrow("Cannot use --output-plan before AIWiki is initialized");
  });

  it("rejects git reflection in non-git projects with a short recovery hint", async () => {
    const rootDir = await tempProject();
    await writeProjectFile(rootDir, "src/example.ts", "export const value = 1;\n");

    await expect(
      generateReflectPreview(rootDir, {
        fromGitDiff: true,
        readOnly: true
      })
    ).rejects.toThrow("reflect --from-git-diff requires a Git repository");
  });

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
    expect(result.markdown).toContain("An update plan is a reviewable JSON draft");
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

  it("can preserve notes as raw source while generating a reflection preview", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await addReflectMemory(rootDir);
    await writeProjectFile(
      rootDir,
      "notes/today.md",
      "# Auth fix\n\nAuth route must check permissions server-side.\n"
    );

    const result = await generateReflectPreview(rootDir, {
      notes: "notes/today.md",
      saveRaw: true
    });

    expect(result.preview.rawNotePath).toBe(".aiwiki/sources/raw-notes/today.md");
    expect(result.markdown).toContain("Raw note copied to .aiwiki/sources/raw-notes/today.md");
    expect(result.preview.updatePlanDraft?.entries[0]).toMatchObject({
      source: "reflect"
    });
    expect(await readFile(path.join(rootDir, result.preview.rawNotePath!), "utf8")).toContain(
      "Auth route must check permissions"
    );
  });

  it("does not overwrite reflected raw notes unless force is set", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await writeProjectFile(rootDir, "notes/today.md", "# Note\n\nFirst.\n");

    const first = await generateReflectPreview(rootDir, {
      notes: "notes/today.md",
      saveRaw: true
    });
    await writeProjectFile(rootDir, "notes/today.md", "# Note\n\nSecond.\n");
    const second = await generateReflectPreview(rootDir, {
      notes: "notes/today.md",
      saveRaw: true
    });
    const forced = await generateReflectPreview(rootDir, {
      notes: "notes/today.md",
      saveRaw: true,
      force: true
    });

    expect(first.preview.rawNotePath).toBe(".aiwiki/sources/raw-notes/today.md");
    expect(second.preview.rawNotePath).toBe(".aiwiki/sources/raw-notes/today-2.md");
    expect(forced.preview.rawNotePath).toBe(".aiwiki/sources/raw-notes/today.md");
    expect(await readFile(path.join(rootDir, forced.preview.rawNotePath!), "utf8")).toContain(
      "Second."
    );
  });

  it("prevents raw-note writes in read-only reflection", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await writeProjectFile(rootDir, "notes/today.md", "# Note\n\nKeep this.\n");

    await expect(
      generateReflectPreview(rootDir, {
        notes: "notes/today.md",
        saveRaw: true,
        readOnly: true
      })
    ).rejects.toThrow("Cannot use --read-only with --save-raw");
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

  it("extracts specific work graph lessons from git diff", async () => {
    const rootDir = await tempProject();
    await writeProjectFile(rootDir, "src/task.ts", "export const task = 'baseline';\n");
    await writeProjectFile(rootDir, "src/prime.ts", "export const prime = 'baseline';\n");
    await writeProjectFile(rootDir, "src/schema.ts", "export const schema = 'baseline';\n");
    await initAIWiki({ rootDir, projectName: "demo" });
    await initGitProject(rootDir);

    await writeProjectFile(
      rootDir,
      "src/task.ts",
      [
        "export function readyTasks() {",
        "  return 'open tasks with no unfinished blocking dependencies';",
        "}",
        "",
        "export function claimTask() {",
        "  return 'Claims are coordination hints, not locks. Use --force when blockers remain.';",
        "}",
        "",
        "export function resumeTask() {",
        "  return '下一步做什么 / Next Action with Suggested test command for checkpoint handoff.';",
        "}",
        ""
      ].join("\n")
    );
    await writeProjectFile(
      rootDir,
      "src/prime.ts",
      "export const prime = 'AIWiki Prime active task ready work memory health next commands';\n"
    );
    await writeProjectFile(
      rootDir,
      "src/schema.ts",
      "export const schema = 'Schema name: all, task, task-event, or prime agent-facing data';\n"
    );

    const result = await generateReflectPreview(rootDir, {
      fromGitDiff: true,
      readOnly: true
    });

    expect(result.markdown).toContain("Task: `task ready` exposes open work");
    expect(result.markdown).toContain("Task claims are coordination hints, not locks");
    expect(result.markdown).toContain("Blocked task claims require explicit force");
    expect(result.markdown).toContain("Task checkpoints feed resume handoffs");
    expect(result.markdown).toContain("Prime: `aiwiki prime` is the Codex startup dashboard");
    expect(result.markdown).toContain("Schema: `aiwiki schema` is the agent-facing contract surface");
    expect(result.preview.updatePlanDraft?.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "module",
          title: "Task",
          summary: expect.stringContaining("`task ready` exposes open work")
        }),
        expect.objectContaining({
          type: "decision",
          title: "Task claims are coordination hints, not locks"
        }),
        expect.objectContaining({
          type: "rule",
          title: "Blocked task claims require explicit force"
        }),
        expect.objectContaining({
          type: "pattern",
          title: "Task checkpoints feed resume handoffs"
        }),
        expect.objectContaining({
          type: "module",
          title: "Prime"
        }),
        expect.objectContaining({
          type: "module",
          title: "Schema"
        })
      ])
    );
    expect(
      result.preview.updatePlanDraft?.entries.some((entry) =>
        entry.summary?.includes("Reflection candidate for")
      )
    ).toBe(false);
  });

  it("extracts optional Beads and raw-note ingest lessons from git diff", async () => {
    const rootDir = await tempProject();
    await writeProjectFile(rootDir, "src/beads.ts", "export const beads = 'baseline';\n");
    await writeProjectFile(rootDir, "src/ingest.ts", "export const ingest = 'baseline';\n");
    await writeProjectFile(rootDir, "src/raw-notes.ts", "export const notes = 'baseline';\n");
    await initAIWiki({ rootDir, projectName: "demo" });
    await initGitProject(rootDir);

    await writeProjectFile(
      rootDir,
      "src/beads.ts",
      "export function readBeadsContext() { return '.beads bd ready bd status beads_ready_work'; }\n"
    );
    await writeProjectFile(
      rootDir,
      "src/ingest.ts",
      "export const ingest = 'compatibility path; prefer reflect --notes --save-raw';\n"
    );
    await writeProjectFile(
      rootDir,
      "src/raw-notes.ts",
      "export function saveRawNote() { return 'raw-notes'; }\n"
    );

    const result = await generateReflectPreview(rootDir, {
      fromGitDiff: true,
      readOnly: true
    });

    expect(result.preview.updatePlanDraft?.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "module",
          title: "Beads",
          summary: expect.stringContaining("without writing to Beads")
        }),
        expect.objectContaining({
          type: "module",
          title: "Ingest",
          summary: expect.stringContaining("reflect --notes --save-raw")
        })
      ])
    );
  });

  it("extracts concrete changed-file risk lessons from git diff", async () => {
    const rootDir = await tempProject();
    await writeProjectFile(rootDir, "db/schema.sql", "CREATE TABLE posts (id TEXT);\n");
    await writeProjectFile(rootDir, "app/layout.tsx", "export default function Layout() { return null; }\n");
    await writeProjectFile(rootDir, "lib/wechat-copy.ts", "export function copy() { return true; }\n");
    await writeProjectFile(rootDir, "src/checkout.ts", "export const checkout = true;\n");
    await initAIWiki({ rootDir, projectName: "demo" });
    await initGitProject(rootDir);

    await writeProjectFile(
      rootDir,
      "db/schema.sql",
      "CREATE VIRTUAL TABLE posts_fts USING fts5(title, content);\nCREATE TRIGGER posts_fts_update AFTER UPDATE ON posts BEGIN SELECT 1; END;\n"
    );
    await writeProjectFile(
      rootDir,
      "app/layout.tsx",
      "\"use client\";\nimport { useEffect } from 'react';\nexport default function Layout() { useEffect(() => localStorage.getItem('theme'), []); return null; }\n"
    );
    await writeProjectFile(
      rootDir,
      "lib/wechat-copy.ts",
      "export async function pdf() { const html2pdf = await import('html2pdf.js'); document.title = String(html2pdf); }\n"
    );
    await writeProjectFile(
      rootDir,
      "src/checkout.ts",
      "export function chargeOrder(amountCents: number, currency: string) { return { amountCents, currency }; }\n"
    );

    const result = await generateReflectPreview(rootDir, {
      fromGitDiff: true,
      readOnly: true
    });

    expect(result.markdown).toContain("Database migrations must reach existing deployments");
    expect(result.markdown).toContain("FTS trigger changes need search regression checks");
    expect(result.markdown).toContain("Theme hydration can flash after first paint");
    expect(result.markdown).toContain("Browser-only libraries stay out of server bundles");
    expect(result.markdown).toContain("Money flows need idempotency and amount checks");
    expect(result.preview.updatePlanDraft?.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "pitfall",
          title: "Database migrations must reach existing deployments"
        }),
        expect.objectContaining({
          type: "pattern",
          title: "Browser-only libraries stay out of server bundles"
        }),
        expect.objectContaining({
          type: "pitfall",
          title: "Money flows need idempotency and amount checks"
        })
      ])
    );
  });

  it("extracts priority language risk lessons from git diff", async () => {
    const rootDir = await tempProject();
    await writeProjectFile(rootDir, "pyproject.toml", "[project]\nname = 'demo'\n");
    await writeProjectFile(rootDir, "src/main/java/UserService.java", "class UserService {}\n");
    await writeProjectFile(rootDir, "Makefile", "all:\n\tcc src/buffer.c\n");
    await writeProjectFile(rootDir, "src/buffer.c", "int main(void) { return 0; }\n");
    await initAIWiki({ rootDir, projectName: "demo" });
    await initGitProject(rootDir);

    await writeProjectFile(rootDir, "pyproject.toml", "[project]\nname = 'demo'\ndependencies = ['requests']\n");
    await writeProjectFile(
      rootDir,
      "src/main/java/UserService.java",
      "import org.springframework.transaction.annotation.Transactional;\nclass UserService { @Transactional synchronized void update() {} }\n"
    );
    await writeProjectFile(rootDir, "Makefile", "CFLAGS += -DNEW_FLAG\nall:\n\tcc src/buffer.c\n");
    await writeProjectFile(
      rootDir,
      "src/buffer.c",
      "#include <string.h>\nvoid copy(char *dst, char *src) { strcpy(dst, src); }\n"
    );

    const result = await generateReflectPreview(rootDir, {
      fromGitDiff: true,
      readOnly: true
    });

    expect(result.markdown).toContain("Python dependency changes need environment smoke tests");
    expect(result.markdown).toContain("Java transaction and concurrency changes need race-path checks");
    expect(result.markdown).toContain("C build-system changes need platform matrix checks");
    expect(result.markdown).toContain("C memory changes need sanitizer-minded review");
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

  it("reports freshness refreshes without generating low-signal wiki writes", async () => {
    const rootDir = await tempProject();
    await writeProjectFile(rootDir, "src/brief.ts", "export const value = 1;\n");
    await initAIWiki({ rootDir, projectName: "demo" });
    await mkdir(path.join(rootDir, ".aiwiki", "wiki", "modules"), { recursive: true });
    await writeMarkdownFile(
      path.join(rootDir, ".aiwiki", "wiki", "modules", "brief.md"),
      {
        type: "module",
        title: "Brief",
        modules: ["brief"],
        files: ["src/brief.ts"]
      },
      "# Brief\n\nBrief memory.\n"
    );
    await initGitProject(rootDir);
    await writeProjectFile(rootDir, "src/brief.ts", "export const value = 2;\n");

    const result = await generateReflectPreview(rootDir, {
      fromGitDiff: true,
      readOnly: true
    });

    expect(result.preview.selectedDocs).toContain("wiki/modules/brief.md");
    expect(result.markdown).toContain("Refresh Brief");
    expect(result.markdown).toContain("No update plan draft was generated.");
    expect(result.preview.updatePlanDraft).toBeUndefined();
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
    await writeProjectFile(
      rootDir,
      "notes/today.md",
      "# Module lesson\n\nBrief and config updates are reusable module memory.\n"
    );

    const result = await generateReflectPreview(rootDir, {
      fromGitDiff: true,
      notes: "notes/today.md"
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

  it("does not create generic module drafts for plain changed files", async () => {
    const rootDir = await tempProject();
    await writeProjectFile(rootDir, "src/words.ts", "export const words = 1;\n");
    await initAIWiki({ rootDir, projectName: "demo" });
    await initGitProject(rootDir);
    await writeProjectFile(rootDir, "src/words.ts", "export const words = 2;\n");

    const result = await generateReflectPreview(rootDir, {
      fromGitDiff: true,
      readOnly: true
    });

    expect(result.preview.changedFiles).toEqual(["src/words.ts"]);
    expect(result.preview.updatePlanDraft).toBeUndefined();
    expect(result.markdown).toContain("No update plan draft was generated.");
    expect(result.markdown).not.toContain("Review module summary for words.");
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

  it("excludes the output plan file from git reflection input", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await writeProjectFile(rootDir, "src/task.ts", "export const task = 1;\n");
    await initGitProject(rootDir);
    await writeProjectFile(
      rootDir,
      "src/task.ts",
      "export const resume = '下一步做什么 / Next Action checkpoint handoff';\n"
    );
    await writeProjectFile(
      rootDir,
      ".aiwiki/context-packs/reflect-plan.json",
      "{\"version\":\"old\"}\n"
    );
    await writeProjectFile(rootDir, ".aiwiki/evals/local.jsonl", "{}\n");
    await writeProjectFile(rootDir, ".venv/cache.py", "print('cache')\n");
    await writeProjectFile(rootDir, "node_modules/demo/index.js", "module.exports = true;\n");
    await writeProjectFile(rootDir, "package-lock.json", "{\"lockfileVersion\":3}\n");

    const result = await generateReflectPreview(rootDir, {
      fromGitDiff: true,
      outputPlan: ".aiwiki/context-packs/reflect-plan.json",
      force: true
    });

    expect(result.preview.changedFiles).toContain("src/task.ts");
    expect(result.preview.changedFiles).not.toContain(".aiwiki/context-packs/reflect-plan.json");
    expect(result.preview.changedFiles.some((file) => file.startsWith(".aiwiki/"))).toBe(false);
    expect(result.preview.changedFiles.some((file) => file.startsWith(".venv/"))).toBe(false);
    expect(result.preview.changedFiles.some((file) => file.startsWith("node_modules/"))).toBe(false);
    expect(result.preview.changedFiles).not.toContain("package-lock.json");
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
