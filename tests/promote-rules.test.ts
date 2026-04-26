import { mkdir, mkdtemp, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initAIWiki } from "../src/init.js";
import { writeMarkdownFile } from "../src/markdown.js";
import {
  formatRulePromotionPreviewMarkdown,
  generateRulePromotionPreview
} from "../src/promote-rules.js";

async function tempProject(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "aiwiki-promote-rules-"));
}

async function addPitfalls(rootDir: string): Promise<void> {
  const pitfallsDir = path.join(rootDir, ".aiwiki", "wiki", "pitfalls");
  await mkdir(pitfallsDir, { recursive: true });

  await writeMarkdownFile(
    path.join(pitfallsDir, "stripe-raw-body.md"),
    {
      type: "pitfall",
      title: "Stripe webhook raw body",
      modules: ["payment"],
      files: ["src/app/api/stripe/webhook/route.ts"],
      severity: "critical",
      encountered_count: 3
    },
    "# Pitfall: Stripe webhook raw body\n\nVerify raw body before parsing.\n"
  );

  await writeMarkdownFile(
    path.join(pitfallsDir, "auth-permissions.md"),
    {
      type: "pitfall",
      title: "Auth permission checks",
      modules: ["auth"],
      files: ["src/app/api/auth/route.ts"],
      severity: "high",
      encountered_count: 1
    },
    "# Pitfall: Auth permission checks\n\nCheck permissions server-side.\n"
  );

  await writeMarkdownFile(
    path.join(pitfallsDir, "deprecated.md"),
    {
      type: "pitfall",
      title: "Deprecated pitfall",
      severity: "critical",
      encountered_count: 5,
      status: "deprecated"
    },
    "# Pitfall: Deprecated pitfall\n\nOld issue.\n"
  );
}

describe("generateRulePromotionPreview", () => {
  it("promotes repeated high-severity pitfalls only", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await addPitfalls(rootDir);

    const result = await generateRulePromotionPreview(rootDir);

    expect(result.preview.candidates).toHaveLength(1);
    expect(result.preview.candidates[0]?.title).toBe(
      "Rule: Avoid Stripe webhook raw body"
    );
    expect(result.preview.candidates[0]?.sourcePitfalls).toEqual([
      "wiki/pitfalls/stripe-raw-body.md"
    ]);
    expect(result.preview.candidates[0]?.requiresConfirmation).toBe(true);
    expect(result.preview.updatePlan?.entries[0]?.type).toBe("rule");
    expect(result.preview.updatePlan?.entries[0]?.frontmatter).toEqual({
      source_pitfalls: ["wiki/pitfalls/stripe-raw-body.md"],
      encountered_count: 3
    });
    expect(result.markdown).toContain("This preview does not write wiki/rules pages.");
    expect(result.markdown).toContain("aiwiki apply <plan.json> --confirm");
    expect(result.markdown).toContain("Auth permission checks");
    expect(result.markdown).toContain("Deprecated pitfall");
  });

  it("honors min-count and formats json output", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await addPitfalls(rootDir);

    const result = await generateRulePromotionPreview(rootDir, { minCount: 4 });
    const parsed = JSON.parse(result.json) as {
      minCount: number;
      candidates: unknown[];
    };

    expect(parsed.minCount).toBe(4);
    expect(parsed.candidates).toHaveLength(0);
  });

  it("does not create structured rule pages", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await addPitfalls(rootDir);

    const result = await generateRulePromotionPreview(rootDir);

    expect(formatRulePromotionPreviewMarkdown(result.preview)).toContain(
      "# Rule Promotion Preview"
    );
    const ruleFiles = await readdir(path.join(rootDir, ".aiwiki", "wiki", "rules"));
    expect(ruleFiles).toEqual([".gitkeep"]);
  });
});
