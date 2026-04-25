import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { appendLogEntry, formatLogEntry } from "../src/log.js";

async function tempProject(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "aiwiki-log-"));
}

describe("log", () => {
  it("formats entries using the PRD timeline shape", () => {
    expect(
      formatLogEntry({
        date: "2026-04-25",
        action: "reflect",
        title: "Stripe refund webhook",
        bullets: [
          "Updated: [[wiki/modules/payment.md]]",
          "Added: [[wiki/pitfalls/stripe-webhook-raw-body.md]]"
        ]
      })
    ).toBe(
      "## [2026-04-25] reflect | Stripe refund webhook\n" +
        "- Updated: [[wiki/modules/payment.md]]\n" +
        "- Added: [[wiki/pitfalls/stripe-webhook-raw-body.md]]\n\n"
    );
  });

  it("appends entries to .aiwiki/log.md", async () => {
    const rootDir = await tempProject();

    await appendLogEntry(rootDir, {
      date: "2026-04-25",
      action: "init",
      title: "AIWiki",
      bullets: ["Created initial structure"]
    });

    const log = await readFile(path.join(rootDir, ".aiwiki", "log.md"), "utf8");
    expect(log).toContain("## [2026-04-25] init | AIWiki");
    expect(log).toContain("- Created initial structure");
  });
});
