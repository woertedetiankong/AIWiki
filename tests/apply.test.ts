import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyWikiUpdatePlan,
  generateFileGuardrails,
  generateDevelopmentBrief,
  readWikiUpdatePlanFile,
  searchWikiMemory
} from "../src/index.js";
import { initAIWiki } from "../src/init.js";
import { writeMarkdownFile } from "../src/markdown.js";

async function tempProject(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "aiwiki-apply-"));
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

describe("applyWikiUpdatePlan", () => {
  it("previews wiki updates without writing files by default", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });

    const result = await applyWikiUpdatePlan(rootDir, {
      title: "Payment memory",
      entries: [
        {
          type: "module",
          title: "Payment",
          modules: ["payment"],
          summary: "Stripe and billing flows."
        }
      ]
    });

    expect(result.applied).toBe(false);
    expect(result.created).toEqual([]);
    expect(result.preview.operations[0]?.action).toBe("create");
    expect(result.preview.operations[0]?.frontmatterPreview).toMatchObject({
      type: "module",
      title: "Payment",
      status: "active"
    });
    expect(result.preview.operations[0]?.bodyPreview).toContain(
      "# Module: Payment"
    );
    expect(result.markdown).toContain("# Wiki Update Preview");
    expect(result.markdown).toContain("## What This Plan Is");
    expect(result.markdown).toContain("reviewable set of candidate AIWiki memory changes");
    expect(result.markdown).toContain("## Planned Changes");
    expect(result.markdown).toContain("- Create wiki pages: 1");
    expect(result.markdown).toContain("## Memory To Save");
    expect(result.markdown).toContain("Module note: Payment");
    expect(result.markdown).toContain("Plain meaning: Stripe and billing flows.");
    expect(result.markdown).toContain("## Confirm Only If");
    expect(result.markdown).toContain("## Applied Results");
    expect(result.markdown).toContain("Frontmatter Preview");
    expect(result.markdown).toContain("Body Preview");

    const modules = await readdir(path.join(rootDir, ".aiwiki", "wiki", "modules"));
    expect(modules).toEqual([".gitkeep"]);
  });

  it("creates confirmed wiki pages, updates index and graph, and makes memory searchable", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });

    const result = await applyWikiUpdatePlan(
      rootDir,
      {
        title: "Stripe memory",
        entries: [
          {
            type: "module",
            title: "Payment",
            source: "manual",
            modules: ["payment"],
            files: ["src/lib/stripe.ts"],
            summary: "Stripe and billing flows."
          },
          {
            type: "pitfall",
            title: "Stripe webhook raw body",
            slug: "stripe-webhook-raw-body",
            source: "reflect",
            modules: ["payment"],
            files: ["src/app/api/stripe/webhook/route.ts"],
            severity: "critical",
            frontmatter: {
              encountered_count: 2
            },
            body: "# Pitfall: Stripe webhook raw body\n\nVerify raw body before JSON parsing.\n"
          }
        ]
      },
      { confirm: true }
    );

    expect(result.applied).toBe(true);
    expect(result.created).toEqual([
      ".aiwiki/wiki/modules/payment.md",
      ".aiwiki/wiki/pitfalls/stripe-webhook-raw-body.md"
    ]);
    expect(result.preview.operations[1]?.source).toBe("reflect");
    expect(result.markdown).toContain("Source: reflect");
    expect(result.indexUpdated).toBe(true);
    expect(result.graphUpdated).toBe(true);

    const pitfall = await readFile(
      path.join(rootDir, ".aiwiki", "wiki", "pitfalls", "stripe-webhook-raw-body.md"),
      "utf8"
    );
    expect(pitfall).toContain("encountered_count: 2");
    expect(pitfall).toContain("Verify raw body before JSON parsing.");

    const index = await readFile(path.join(rootDir, ".aiwiki", "index.md"), "utf8");
    expect(index).toContain("[[wiki/pitfalls/stripe-webhook-raw-body.md]]");

    const log = await readFile(path.join(rootDir, ".aiwiki", "log.md"), "utf8");
    expect(log).toContain("apply | Stripe memory");

    const graph = await readFile(
      path.join(rootDir, ".aiwiki", "graph", "graph.json"),
      "utf8"
    );
    expect(graph).toContain("wiki/pitfalls/stripe-webhook-raw-body.md");

    const search = await searchWikiMemory(rootDir, "stripe webhook raw body");
    expect(search.results[0]?.title).toBe("Stripe webhook raw body");

    const brief = await generateDevelopmentBrief(rootDir, "fix stripe webhook");
    expect(brief.markdown).toContain("Stripe webhook raw body");

    const guard = await generateFileGuardrails(
      rootDir,
      "src/app/api/stripe/webhook/route.ts"
    );
    expect(guard.markdown).toContain("Stripe webhook raw body");
  });

  it("skips existing pages unless explicit append sections are provided", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await writeMarkdownFile(
      path.join(rootDir, ".aiwiki", "wiki", "rules", "protect-auth.md"),
      {
        type: "rule",
        title: "Protect auth routes",
        status: "proposed"
      },
      "# Rule: Protect auth routes\n\nOriginal user text.\n"
    );

    const skipped = await applyWikiUpdatePlan(
      rootDir,
      {
        entries: [
          {
            type: "rule",
            title: "Protect auth routes",
            slug: "protect-auth",
            body: "# Rule: Protect auth routes\n\nReplacement text.\n"
          }
        ]
      },
      { confirm: true }
    );

    expect(skipped.skipped).toEqual([".aiwiki/wiki/rules/protect-auth.md"]);
    expect(skipped.created).toEqual([]);
    expect(skipped.markdown).toContain(
      "Target wiki page already exists and no explicit append sections were provided."
    );
    expect(
      await readFile(path.join(rootDir, ".aiwiki", "wiki", "rules", "protect-auth.md"), "utf8")
    ).toContain("Original user text.");

    const appended = await applyWikiUpdatePlan(
      rootDir,
      {
        entries: [
          {
            type: "rule",
            title: "Protect auth routes",
            slug: "protect-auth",
            append: [
              {
                heading: "Examples",
                body: "Check permissions before returning auth data."
              }
            ]
          }
        ]
      },
      { confirm: true, rebuildGraph: false }
    );

    expect(appended.appended).toEqual([".aiwiki/wiki/rules/protect-auth.md"]);
    expect(appended.graphUpdated).toBe(false);
    expect(appended.preview.operations[0]?.appendPreview?.[0]).toMatchObject({
      heading: "Examples",
      bodyPreview: "Check permissions before returning auth data."
    });
    expect(appended.markdown).toContain("Append Preview");
    const rule = await readFile(
      path.join(rootDir, ".aiwiki", "wiki", "rules", "protect-auth.md"),
      "utf8"
    );
    expect(rule).toContain("Original user text.");
    expect(rule).toContain("Check permissions before returning auth data.");
  });

  it("rejects malformed JSON, invalid paths, unknown types, and invalid frontmatter", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await writeProjectFile(rootDir, "bad.json", "{");

    await expect(readWikiUpdatePlanFile(rootDir, "bad.json")).rejects.toThrow(
      "Malformed update plan JSON"
    );

    await expect(
      applyWikiUpdatePlan(rootDir, {
        entries: [{ type: "unknown", title: "Unknown" }]
      })
    ).rejects.toThrow();

    await expect(
      applyWikiUpdatePlan(rootDir, {
        entries: [{ type: "module", title: "Escape", slug: "../escape" }]
      })
    ).rejects.toThrow();

    await expect(
      applyWikiUpdatePlan(rootDir, {
        entries: [
          {
            type: "pitfall",
            title: "Bad count",
            frontmatter: { encountered_count: -1 }
          }
        ]
      })
    ).rejects.toThrow();
  });
});
