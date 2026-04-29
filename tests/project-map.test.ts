import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initAIWiki } from "../src/init.js";
import { writeMarkdownFile } from "../src/markdown.js";
import {
  formatProjectMapMarkdown,
  generateProjectMap
} from "../src/project-map.js";
import type { AIWikiConfig } from "../src/types.js";

async function tempProject(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "aiwiki-map-"));
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

async function setupProject(rootDir: string): Promise<void> {
  await writeProjectFile(
    rootDir,
    "package.json",
    JSON.stringify(
      {
        dependencies: {
          commander: "^14.0.2",
          "gray-matter": "^4.0.3",
          zod: "^4.1.12"
        },
        devDependencies: {
          typescript: "^5.9.3",
          vitest: "^4.0.14"
        }
      },
      null,
      2
    )
  );
  await writeProjectFile(rootDir, "package-lock.json", "{}\n");
  await writeProjectFile(rootDir, "tsconfig.json", "{}\n");
  await writeProjectFile(rootDir, "pms-frame/pom.xml", "<project />\n");
  await writeProjectFile(rootDir, "pms-app/pages/home/index.vue", "<template />\n");
  await writeProjectFile(rootDir, "src/cli.ts", "export {};\n");
  await writeProjectFile(rootDir, "tests/cli.test.ts", "export {};\n");
  await writeProjectFile(rootDir, ".env", "SECRET=value\n");
  await writeProjectFile(rootDir, "dist/out.js", "generated\n");
  await writeProjectFile(rootDir, "pms-frame/target/classes/App.class", "generated\n");
  await writeProjectFile(rootDir, ".ai/chrome-debug-profile/Default/Network/Trust Tokens", "generated\n");
  await writeProjectFile(rootDir, ".idea/workspace.xml", "generated\n");
  await writeProjectFile(rootDir, ".wrangler/tmp/ProxyServerWorker.js", "generated\n");
  await writeProjectFile(rootDir, ".history/old.ts", "generated\n");
  await writeProjectFile(rootDir, ".venv/Lib/site-packages/vendor.py", "generated\n");
  await writeProjectFile(rootDir, ".pytest_cache/state", "generated\n");
  await writeProjectFile(rootDir, ".ruff_cache/cache", "generated\n");
  await writeProjectFile(rootDir, "__pycache__/module.pyc", "generated\n");
  await writeProjectFile(rootDir, ".pydantic-deep/tasks/state.json", "generated\n");
  await writeProjectFile(rootDir, "htmlcov/index.html", "generated\n");
  await writeProjectFile(rootDir, "archive.zip", "generated\n");
  await writeProjectFile(rootDir, "tsconfig.tsbuildinfo", "generated\n");
}

async function updateConfig(
  rootDir: string,
  patch: Partial<AIWikiConfig>
): Promise<void> {
  const configPath = path.join(rootDir, ".aiwiki", "config.json");
  const config = JSON.parse(await readFile(configPath, "utf8")) as AIWikiConfig;
  await writeFile(configPath, JSON.stringify({ ...config, ...patch }, null, 2), "utf8");
}

async function addMapMemory(rootDir: string): Promise<void> {
  const wikiDir = path.join(rootDir, ".aiwiki", "wiki");
  await mkdir(path.join(wikiDir, "modules"), { recursive: true });
  await mkdir(path.join(wikiDir, "pitfalls"), { recursive: true });
  await mkdir(path.join(wikiDir, "rules"), { recursive: true });

  await writeMarkdownFile(
    path.join(wikiDir, "modules", "cli.md"),
    {
      type: "module",
      title: "CLI",
      modules: ["cli"],
      files: ["src/cli.ts"]
    },
    "# Module: CLI\n\nCommand parsing and output live here.\n"
  );

  await writeMarkdownFile(
    path.join(wikiDir, "pitfalls", "auth-route.md"),
    {
      type: "pitfall",
      title: "Auth route permissions",
      modules: ["auth"],
      files: ["src/app/api/auth/route.ts"],
      severity: "high"
    },
    "# Pitfall: Auth route permissions\n\nCheck server-side permissions.\n"
  );

  await writeMarkdownFile(
    path.join(wikiDir, "rules", "protect-user-data.md"),
    {
      type: "rule",
      title: "Protect user data",
      modules: ["core"],
      severity: "critical"
    },
    "# Rule: Protect user data\n\nNever overwrite user-owned notes by default.\n"
  );
}

describe("generateProjectMap", () => {
  it("detects stack, directories, modules, rules, and generated candidates", async () => {
    const rootDir = await tempProject();
    await setupProject(rootDir);
    await initAIWiki({ rootDir, projectName: "demo" });
    await addMapMemory(rootDir);

    const result = await generateProjectMap(rootDir);

    expect(result.projectMap.stack).toContain("Node.js");
    expect(result.projectMap.stack).toContain("TypeScript");
    expect(result.projectMap.stack).toContain("Java");
    expect(result.projectMap.stack).toContain("Maven");
    expect(result.projectMap.stack).toContain("Vue");
    expect(result.projectMap.stack).toContain("Commander CLI");
    expect(result.projectMap.stack).toContain("Vitest");
    expect(result.projectMap.importantDirectories).toEqual(["pages", "src", "tests"]);
    expect(result.projectMap.modules).toContain("CLI");
    expect(result.projectMap.existingRules).toContain("Protect user data");
    expect(result.projectMap.generatedFiles).toContain("package-lock.json");
    expect(result.projectMap.scannedFiles).toBe(7);
    expect(result.projectMap.generatedFiles).not.toContain(".wrangler/tmp/ProxyServerWorker.js");
    expect(result.projectMap.generatedFiles).not.toContain("archive.zip");
    expect(result.projectMap.highRiskFiles.join("\n")).not.toContain("target/classes");
    expect(result.projectMap.highRiskFiles.join("\n")).not.toContain("chrome-debug-profile");
    expect(result.projectMap.highRiskFiles.join("\n")).not.toContain(".venv");
    expect(result.projectMap.highRiskFiles.join("\n")).not.toContain(".pydantic-deep");
    expect(result.markdown).toContain("# Project Map: demo");
  });

  it("merges configured and wiki-derived high-risk files", async () => {
    const rootDir = await tempProject();
    await setupProject(rootDir);
    await initAIWiki({ rootDir, projectName: "demo" });
    await updateConfig(rootDir, {
      riskFiles: ["src/cli.ts"],
      highRiskModules: ["auth"]
    });
    await addMapMemory(rootDir);

    const result = await generateProjectMap(rootDir);

    expect(result.projectMap.highRiskFiles).toContain("src/cli.ts");
    expect(result.projectMap.highRiskFiles).toContain("src/app/api/auth/route.ts");
    expect(result.projectMap.missingModulePages).toContain("auth");
  });

  it("uses .gitignore and lets config ignore rules override later", async () => {
    const rootDir = await tempProject();
    await writeProjectFile(rootDir, ".gitignore", "*.ts\n");
    await writeProjectFile(rootDir, "src/allowed-auth.ts", "export {};\n");
    await writeProjectFile(rootDir, "src/blocked-auth.ts", "export {};\n");
    await initAIWiki({ rootDir, projectName: "demo" });
    await updateConfig(rootDir, {
      ignore: ["!src/allowed-auth.ts"]
    });

    const result = await generateProjectMap(rootDir);

    expect(result.projectMap.highRiskFiles).toContain("src/allowed-auth.ts");
    expect(result.projectMap.highRiskFiles).not.toContain("src/blocked-auth.ts");
  });

  it("formats markdown and json output", async () => {
    const rootDir = await tempProject();
    await setupProject(rootDir);
    await initAIWiki({ rootDir, projectName: "demo" });

    const result = await generateProjectMap(rootDir);

    expect(formatProjectMapMarkdown(result.projectMap)).toContain(
      "## Important Directories"
    );

    const parsed = JSON.parse(result.json) as { projectName: string };
    expect(parsed.projectName).toBe("demo");
  });

  it("writes project map without overwriting unless force is set", async () => {
    const rootDir = await tempProject();
    await setupProject(rootDir);
    await initAIWiki({ rootDir, projectName: "demo" });

    const written = await generateProjectMap(rootDir, { write: true });
    expect(written.outputPath).toBe(
      path.join(rootDir, ".aiwiki", "wiki", "project-map.md")
    );

    await expect(generateProjectMap(rootDir, { write: true })).rejects.toThrow(
      "Refusing to overwrite existing project map"
    );

    await generateProjectMap(rootDir, { write: true, force: true });

    const output = await readFile(written.outputPath!, "utf8");
    expect(output).toContain("type: project_map");
    expect(output).toContain("# Project Map: demo");

    const index = await readFile(path.join(rootDir, ".aiwiki", "index.md"), "utf8");
    expect(index).toContain("[[wiki/project-map.md]]");
    expect(index).not.toContain("No project map has been generated yet.");
  });
});
