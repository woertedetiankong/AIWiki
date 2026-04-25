import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initAIWiki } from "../src/init.js";
import { loadAIWikiConfig } from "../src/config.js";

async function tempProject(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "aiwiki-init-"));
}

describe("initAIWiki", () => {
  it("creates the full .aiwiki structure in an empty directory", async () => {
    const rootDir = await tempProject();
    const result = await initAIWiki({ rootDir, projectName: "demo" });

    expect(result.created).toContain(".aiwiki/config.json");
    expect(result.created).toContain(".aiwiki/AGENTS.md");
    expect(result.created).toContain(".aiwiki/index.md");
    expect(result.created).toContain(".aiwiki/log.md");
    expect(result.created).toContain(".aiwiki/prompts/brief.md");
    expect(result.created).toContain(".aiwiki/wiki/modules/.gitkeep");
    expect(result.warnings).toHaveLength(1);

    const config = await loadAIWikiConfig(rootDir);
    expect(config.projectName).toBe("demo");
    expect(config.provider).toBe("none");
    expect(config.ignore).toContain(".env*");
  });

  it("does not overwrite existing files on repeated init", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });

    const agentsPath = path.join(rootDir, ".aiwiki", "AGENTS.md");
    await writeFile(agentsPath, "custom agents file\n", "utf8");

    const result = await initAIWiki({ rootDir, projectName: "changed" });

    expect(result.skipped).toContain(".aiwiki/AGENTS.md");
    expect(await readFile(agentsPath, "utf8")).toBe("custom agents file\n");

    const config = await loadAIWikiConfig(rootDir);
    expect(config.projectName).toBe("demo");
  });

  it("refreshes forceable default files with --force without deleting extra files", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });

    const extraPath = path.join(rootDir, ".aiwiki", "wiki", "modules", "extra.md");
    await writeFile(extraPath, "# Extra\n", "utf8");

    const promptPath = path.join(rootDir, ".aiwiki", "prompts", "brief.md");
    await writeFile(promptPath, "custom prompt\n", "utf8");

    const result = await initAIWiki({
      rootDir,
      projectName: "renamed",
      force: true
    });

    expect(result.overwritten).toContain(".aiwiki/prompts/brief.md");
    expect(await readFile(extraPath, "utf8")).toBe("# Extra\n");
    expect(await readFile(promptPath, "utf8")).toContain(
      "# AIWiki Brief Prompt"
    );

    const config = await loadAIWikiConfig(rootDir);
    expect(config.projectName).toBe("renamed");
  });
});
