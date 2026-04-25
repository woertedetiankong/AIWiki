import { mkdir, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { writeMarkdownFile } from "../src/markdown.js";
import { filterWikiPages, scanWikiPages } from "../src/wiki-store.js";

async function tempProject(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "aiwiki-store-"));
}

describe("wiki store", () => {
  it("scans pages and filters by type, module, and file", async () => {
    const rootDir = await tempProject();
    const modulesDir = path.join(rootDir, ".aiwiki", "wiki", "modules");
    const pitfallsDir = path.join(rootDir, ".aiwiki", "wiki", "pitfalls");
    await mkdir(modulesDir, { recursive: true });
    await mkdir(pitfallsDir, { recursive: true });

    await writeMarkdownFile(
      path.join(modulesDir, "payment.md"),
      {
        type: "module",
        title: "Payment",
        modules: ["payment"],
        files: ["src/lib/stripe.ts"]
      },
      "# Module: Payment\n"
    );

    await writeMarkdownFile(
      path.join(pitfallsDir, "raw-body.md"),
      {
        type: "pitfall",
        modules: ["payment"],
        files: ["src/app/api/stripe/webhook/route.ts"],
        severity: "critical"
      },
      "# Pitfall: Raw body\n"
    );

    const pages = await scanWikiPages(rootDir);

    expect(pages).toHaveLength(2);
    expect(filterWikiPages(pages, { type: "pitfall" })).toHaveLength(1);
    expect(filterWikiPages(pages, { module: "payment" })).toHaveLength(2);
    expect(
      filterWikiPages(pages, {
        file: "./src/app/api/stripe/webhook/route.ts"
      })
    ).toHaveLength(1);
  });

  it("rejects wiki pages with invalid frontmatter", async () => {
    const rootDir = await tempProject();
    const pitfallsDir = path.join(rootDir, ".aiwiki", "wiki", "pitfalls");
    await mkdir(pitfallsDir, { recursive: true });

    await writeMarkdownFile(
      path.join(pitfallsDir, "bad.md"),
      {
        type: "unknown"
      } as never,
      "# Bad\n"
    );

    await expect(scanWikiPages(rootDir)).rejects.toThrow();
  });
});
