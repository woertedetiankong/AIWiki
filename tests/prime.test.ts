import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initAIWiki } from "../src/init.js";
import { writeMarkdownFile } from "../src/markdown.js";
import { generatePrimeContext } from "../src/prime.js";
import { createTask, startTask } from "../src/task.js";

async function tempProject(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "aiwiki-prime-"));
}

describe("AIWiki prime", () => {
  it("returns cold-start guidance before AIWiki is initialized", async () => {
    const rootDir = await tempProject();

    const result = await generatePrimeContext(rootDir);

    expect(result.context.projectName).toBe(path.basename(rootDir));
    expect(result.context.initialized).toBe(false);
    expect(result.context.readyTasks).toEqual([]);
    expect(result.context.actions.map((action) => action.kind)).toEqual([
      "initialize_memory",
      "build_project_map",
      "start_context"
    ]);
    expect(result.markdown).toContain("Cold-start mode");
    expect(result.markdown).toContain("aiwiki init --project-name");
  });

  it("summarizes active task, ready work, memory health, and next actions", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await startTask(rootDir, "Active work", { id: "active-work" });
    await createTask(rootDir, "Open follow-up", {
      id: "open-follow-up",
      priority: 1
    });

    const result = await generatePrimeContext(rootDir);

    expect(result.context.projectName).toBe("demo");
    expect(result.context.activeTask?.id).toBe("active-work");
    expect(result.context.readyTasks.map((task) => task.id)).toContain("open-follow-up");
    expect(result.context.actions.some((action) => action.command.includes("aiwiki resume active-work"))).toBe(true);
    expect(result.markdown).toContain("# AIWiki Prime");
    expect(result.markdown).toContain("aiwiki guard <file>");
  });

  it("names stale memory warnings without implying lint errors", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await mkdir(path.join(rootDir, "src"), { recursive: true });
    await writeFile(path.join(rootDir, "src", "example.ts"), "export const value = 1;\n", "utf8");
    await mkdir(path.join(rootDir, ".aiwiki", "wiki", "modules"), { recursive: true });
    await writeMarkdownFile(
      path.join(rootDir, ".aiwiki", "wiki", "modules", "example.md"),
      {
        type: "module",
        title: "Example",
        modules: ["example"],
        files: ["src/example.ts"],
        last_updated: "2000-01-01"
      },
      "# Example\n\nExample memory.\n"
    );

    const result = await generatePrimeContext(rootDir);

    expect(result.context.memoryHealth.lintErrors).toBe(0);
    expect(result.context.memoryHealth.staleWarnings).toBeGreaterThan(0);
    expect(result.markdown).toContain("aiwiki doctor (Doctor found stale memory warnings.)");
    expect(result.markdown).not.toContain("Doctor found lint errors or stale memory warnings.");
  });
});
