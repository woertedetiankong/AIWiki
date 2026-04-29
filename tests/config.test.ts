import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AIWikiNotInitializedError,
  loadAIWikiConfig
} from "../src/config.js";

async function tempProject(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "aiwiki-config-"));
}

describe("loadAIWikiConfig", () => {
  it("throws a clear error when AIWiki is not initialized", async () => {
    const rootDir = await tempProject();
    await expect(loadAIWikiConfig(rootDir)).rejects.toBeInstanceOf(
      AIWikiNotInitializedError
    );
    await expect(loadAIWikiConfig(rootDir)).rejects.toThrow(
      "aiwiki init --project-name <name>"
    );
  });

  it("merges defaults into partial config", async () => {
    const rootDir = await tempProject();
    await mkdir(path.join(rootDir, ".aiwiki"), { recursive: true });
    await writeFile(
      path.join(rootDir, ".aiwiki", "config.json"),
      JSON.stringify({ projectName: "partial" }),
      "utf8"
    );

    const config = await loadAIWikiConfig(rootDir);

    expect(config.version).toBe("0.1.0");
    expect(config.provider).toBe("none");
    expect(config.tokenBudget.brief).toBe(8000);
    expect(config.rulesTargets.agentsMd).toBe(true);
  });

  it("rejects invalid config values", async () => {
    const rootDir = await tempProject();
    await mkdir(path.join(rootDir, ".aiwiki"), { recursive: true });
    await writeFile(
      path.join(rootDir, ".aiwiki", "config.json"),
      JSON.stringify({ projectName: "bad", provider: "unknown" }),
      "utf8"
    );

    await expect(loadAIWikiConfig(rootDir)).rejects.toThrow();
  });
});
