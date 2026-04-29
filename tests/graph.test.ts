import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { buildWikiGraph, relateGraphFile } from "../src/graph.js";
import { initAIWiki } from "../src/init.js";
import { writeMarkdownFile } from "../src/markdown.js";

const execFileAsync = promisify(execFile);

async function tempProject(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "aiwiki-graph-"));
}

async function addGraphMemory(rootDir: string): Promise<void> {
  const wikiDir = path.join(rootDir, ".aiwiki", "wiki");
  await mkdir(path.join(wikiDir, "modules"), { recursive: true });
  await mkdir(path.join(wikiDir, "pitfalls"), { recursive: true });
  await mkdir(path.join(wikiDir, "decisions"), { recursive: true });

  await writeMarkdownFile(
    path.join(wikiDir, "modules", "payment.md"),
    {
      type: "module",
      title: "Payment",
      modules: ["payment"],
      files: ["src/lib/stripe.ts"],
      related_pitfalls: ["../pitfalls/stripe-webhook.md"]
    },
    "# Module: Payment\n\nSee [[../decisions/stripe-provider.md]].\n"
  );

  await writeMarkdownFile(
    path.join(wikiDir, "pitfalls", "stripe-webhook.md"),
    {
      type: "pitfall",
      title: "Stripe webhook raw body",
      modules: ["payment"],
      files: ["src/app/api/stripe/webhook/route.ts"],
      severity: "critical"
    },
    "# Pitfall: Stripe webhook raw body\n\nVerify raw body.\n"
  );

  await writeMarkdownFile(
    path.join(wikiDir, "decisions", "stripe-provider.md"),
    {
      type: "decision",
      title: "Use Stripe",
      modules: ["payment"],
      status: "active"
    },
    "# Decision: Use Stripe\n\nUse Stripe for payment provider.\n"
  );
}

describe("buildWikiGraph", () => {
  it("builds graph nodes, edges, and backlinks from wiki pages", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await addGraphMemory(rootDir);

    const result = await buildWikiGraph(rootDir);

    expect(result.graph.nodes.map((node) => node.id)).toContain(
      "wiki/modules/payment.md"
    );
    expect(result.graph.nodes.map((node) => node.id)).toContain(
      "file:src/lib/stripe.ts"
    );
    expect(result.graph.nodes.map((node) => node.id)).toContain("module:payment");
    expect(result.graph.edges).toContainEqual(
      expect.objectContaining({
        from: "wiki/modules/payment.md",
        to: "wiki/pitfalls/stripe-webhook.md",
        type: "relates_to"
      })
    );
    expect(result.graph.edges).toContainEqual(
      expect.objectContaining({
        from: "wiki/modules/payment.md",
        to: "file:src/lib/stripe.ts",
        type: "references_file"
      })
    );
    expect(result.backlinks.backlinks["wiki/pitfalls/stripe-webhook.md"]).toContain(
      "wiki/modules/payment.md"
    );
  });

  it("writes graph and backlinks files", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await addGraphMemory(rootDir);

    const result = await buildWikiGraph(rootDir, { write: true });

    expect(result.outputPaths?.graph).toBe(
      path.join(rootDir, ".aiwiki", "graph", "graph.json")
    );
    expect(result.outputPaths?.backlinks).toBe(
      path.join(rootDir, ".aiwiki", "graph", "backlinks.json")
    );

    const graph = JSON.parse(await readFile(result.outputPaths!.graph, "utf8")) as {
      nodes: unknown[];
    };
    const backlinks = JSON.parse(
      await readFile(result.outputPaths!.backlinks, "utf8")
    ) as { backlinks: Record<string, string[]> };

    expect(graph.nodes.length).toBeGreaterThan(0);
    expect(backlinks.backlinks["wiki/pitfalls/stripe-webhook.md"]).toContain(
      "wiki/modules/payment.md"
    );
  });
});

describe("relateGraphFile", () => {
  it("summarizes wiki graph relations for a referenced file", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await addGraphMemory(rootDir);

    const result = await relateGraphFile(rootDir, "src/lib/stripe.ts");

    expect(result.relation.fileNodeId).toBe("file:src/lib/stripe.ts");
    expect(result.relation.referencedBy).toContainEqual(
      expect.objectContaining({
        id: "wiki/modules/payment.md",
        title: "Payment"
      })
    );
    expect(result.relation.relatedModules).toContain("payment");
    expect(result.relation.adjacentEdges).toContainEqual(
      expect.objectContaining({
        from: "wiki/modules/payment.md",
        to: "file:src/lib/stripe.ts",
        type: "references_file"
      })
    );
    expect(result.markdown).toContain("# Graph Relations: src/lib/stripe.ts");
  });

  it("returns a stable empty relation summary for unknown files", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await addGraphMemory(rootDir);

    const result = await relateGraphFile(rootDir, "src/unknown.ts");

    expect(result.relation.referencedBy).toEqual([]);
    expect(result.markdown).toContain("No wiki pages reference this file.");
  });

  it("rejects files outside the project root", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });

    await expect(
      relateGraphFile(rootDir, path.join(os.tmpdir(), "outside.ts"))
    ).rejects.toThrow("outside project root");
  });

  it("includes Graphify warnings when requested and Graphify output is missing", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await addGraphMemory(rootDir);

    const result = await relateGraphFile(rootDir, "src/lib/stripe.ts", {
      withGraphify: true
    });

    expect(result.relation.graphify?.available).toBe(false);
    expect(result.relation.graphify?.warnings).toContain("Missing GRAPH_REPORT.md.");
    expect(result.markdown).toContain("## Graphify Structural Context");
  });

  it("exposes graph relate through the CLI with json output", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await addGraphMemory(rootDir);
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
        "relate",
        "src/lib/stripe.ts",
        "--format",
        "json"
      ],
      { cwd: rootDir }
    );
    const parsed = JSON.parse(stdout) as {
      filePath: string;
      relatedModules: string[];
    };

    expect(parsed.filePath).toBe("src/lib/stripe.ts");
    expect(parsed.relatedModules).toContain("payment");
  });
});
