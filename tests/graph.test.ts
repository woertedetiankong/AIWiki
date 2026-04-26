import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildWikiGraph } from "../src/graph.js";
import { initAIWiki } from "../src/init.js";
import { writeMarkdownFile } from "../src/markdown.js";

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
