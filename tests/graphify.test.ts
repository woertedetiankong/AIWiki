import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { generateDevelopmentBrief } from "../src/brief.js";
import { generateFileGuardrails } from "../src/guard.js";
import { importGraphifyContext, loadGraphifyContext } from "../src/graphify.js";
import { initAIWiki } from "../src/init.js";

const execFileAsync = promisify(execFile);

async function tempProject(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "aiwiki-graphify-"));
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

async function writeGraphifyOutput(rootDir: string): Promise<void> {
  await writeProjectFile(
    rootDir,
    "graphify-out/GRAPH_REPORT.md",
    [
      "# Graphify Report",
      "",
      "Module payment has high confidence structural links.",
      "File src/app/api/stripe/webhook/route.ts participates in webhook relations."
    ].join("\n")
  );
  await writeProjectFile(
    rootDir,
    "graphify-out/graph.json",
    JSON.stringify(
      {
        nodes: [
          {
            id: "src/app/api/stripe/webhook/route.ts",
            label: "Stripe webhook route",
            confidence: "high"
          },
          {
            id: "src/lib/stripe.ts",
            label: "Stripe adapter",
            confidence_label: "medium"
          }
        ],
        edges: [
          {
            source: "src/app/api/stripe/webhook/route.ts",
            target: "src/lib/stripe.ts",
            relation: "calls",
            confidence: "high"
          }
        ]
      },
      null,
      2
    )
  );
}

describe("Graphify adapter", () => {
  it("imports Graphify report and graph JSON as structural context", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await writeGraphifyOutput(rootDir);

    const result = await importGraphifyContext(rootDir, "graphify-out");

    expect(result.context.available).toBe(true);
    expect(result.context.reportPath).toBe("graphify-out/GRAPH_REPORT.md");
    expect(result.context.graphPath).toBe("graphify-out/graph.json");
    expect(result.context.nodes[0]).toMatchObject({
      id: "src/app/api/stripe/webhook/route.ts",
      confidence: "high"
    });
    expect(result.context.edges[0]).toMatchObject({
      from: "src/app/api/stripe/webhook/route.ts",
      to: "src/lib/stripe.ts",
      type: "calls",
      confidence: "high"
    });
    expect(result.markdown).toContain("Graphify output is structural context only");
    expect(result.json).toContain("\"confidence\": \"high\"");
  });

  it("writes markdown Graphify context packs without creating wiki memory", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await writeGraphifyOutput(rootDir);

    const result = await importGraphifyContext(rootDir, "graphify-out", {
      output: ".aiwiki/context-packs/graphify-context.md",
      format: "markdown"
    });

    expect(result.outputPath).toBe(
      path.join(rootDir, ".aiwiki", "context-packs", "graphify-context.md")
    );
    expect(result.markdown).toContain("## Output");
    expect(result.markdown).toContain(".aiwiki/context-packs/graphify-context.md");

    const saved = await readFile(result.outputPath!, "utf8");
    expect(saved).toContain("# Graphify Context Import");
    expect(saved).toContain("Graphify output is structural context only");
    expect(saved).not.toContain("## Output");

    const moduleDirEntries = await readdir(path.join(rootDir, ".aiwiki", "wiki", "modules"));
    expect(moduleDirEntries).toEqual([".gitkeep"]);
  });

  it("writes json Graphify context packs and reports the output path in json", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await writeGraphifyOutput(rootDir);

    const result = await importGraphifyContext(rootDir, "graphify-out", {
      output: ".aiwiki/context-packs/graphify-context.json",
      format: "json"
    });
    const saved = JSON.parse(await readFile(result.outputPath!, "utf8")) as {
      nodes: Array<{ id: string }>;
      outputPath?: string;
    };
    const stdoutJson = JSON.parse(result.json) as { outputPath?: string };

    expect(saved.nodes[0]?.id).toBe("src/app/api/stripe/webhook/route.ts");
    expect(saved.outputPath).toBeUndefined();
    expect(stdoutJson.outputPath).toBe(".aiwiki/context-packs/graphify-context.json");
  });

  it("does not overwrite Graphify context output unless force is provided", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await writeGraphifyOutput(rootDir);

    await importGraphifyContext(rootDir, "graphify-out", {
      output: ".aiwiki/context-packs/graphify-context.md"
    });
    await expect(
      importGraphifyContext(rootDir, "graphify-out", {
        output: ".aiwiki/context-packs/graphify-context.md"
      })
    ).rejects.toThrow("Refusing to overwrite existing Graphify context output");

    await importGraphifyContext(rootDir, "graphify-out", {
      output: ".aiwiki/context-packs/graphify-context.md",
      force: true
    });
  });

  it("rejects Graphify context outputs outside the project root", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await writeGraphifyOutput(rootDir);

    await expect(
      importGraphifyContext(rootDir, "graphify-out", {
        output: path.join(os.tmpdir(), "graphify-context.md")
      })
    ).rejects.toThrow("outside project root");
  });

  it("degrades gracefully for missing and malformed Graphify output", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });

    const missing = await loadGraphifyContext(rootDir);
    expect(missing.available).toBe(false);
    expect(missing.warnings).toContain("Missing GRAPH_REPORT.md.");
    expect(missing.warnings).toContain("Missing graph.json.");

    await writeProjectFile(rootDir, "graphify-out/graph.json", "{not json");
    const malformed = await loadGraphifyContext(rootDir);
    expect(malformed.available).toBe(false);
    expect(malformed.warnings.some((warning) => warning.startsWith("Malformed graph.json"))).toBe(true);
  });

  it("includes Graphify context in brief and guard only when requested", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await writeGraphifyOutput(rootDir);

    const brief = await generateDevelopmentBrief(rootDir, "fix stripe webhook", {
      withGraphify: true
    });
    expect(brief.markdown).toContain("## Graphify Structural Context");
    expect(brief.markdown).toContain("Graphify file reference: src/app/api/stripe/webhook/route.ts.");

    const guard = await generateFileGuardrails(
      rootDir,
      "src/app/api/stripe/webhook/route.ts",
      { withGraphify: true }
    );
    expect(guard.markdown).toContain("## Graphify Structural Context");
    expect(guard.markdown).toContain("Related relation:");
  });

  it("exposes graph import-graphify through the CLI", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await writeGraphifyOutput(rootDir);

    const cliPath = path.resolve("src", "cli.ts");
    const tsxLoader = pathToFileURL(
      path.resolve("node_modules", "tsx", "dist", "loader.mjs")
    ).href;
    const { stdout } = await execFileAsync(
      process.execPath,
      ["--import", tsxLoader, cliPath, "graph", "import-graphify", "graphify-out"],
      { cwd: rootDir }
    );

    expect(stdout).toContain("# Graphify Context Import");
    expect(stdout).toContain("Stripe webhook route");
  });

  it("exposes graph import-graphify output writing through the CLI", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await writeGraphifyOutput(rootDir);

    const cliPath = path.resolve("src", "cli.ts");
    const tsxLoader = pathToFileURL(
      path.resolve("node_modules", "tsx", "dist", "loader.mjs")
    ).href;
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        "--import",
        tsxLoader,
        cliPath,
        "graph",
        "import-graphify",
        "graphify-out",
        "--output",
        ".aiwiki/context-packs/graphify-context.json",
        "--format",
        "json"
      ],
      { cwd: rootDir }
    );
    const parsed = JSON.parse(stdout) as { outputPath?: string };
    const saved = JSON.parse(
      await readFile(
        path.join(rootDir, ".aiwiki", "context-packs", "graphify-context.json"),
        "utf8"
      )
    ) as { edges: unknown[] };

    expect(parsed.outputPath).toBe(".aiwiki/context-packs/graphify-context.json");
    expect(saved.edges.length).toBe(1);
  }, 15000);
});
