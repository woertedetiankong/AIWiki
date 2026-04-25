import { describe, expect, it } from "vitest";
import { formatMarkdown, parseMarkdown } from "../src/markdown.js";
import type { WikiPageFrontmatter } from "../src/types.js";

describe("markdown frontmatter", () => {
  it("round-trips frontmatter and body", () => {
    const frontmatter: WikiPageFrontmatter = {
      type: "pitfall",
      status: "active",
      modules: ["payment"],
      files: ["src/app/api/stripe/webhook/route.ts"],
      severity: "high"
    };

    const formatted = formatMarkdown(frontmatter, "# Pitfall\n\nUse raw body.\n");
    const parsed = parseMarkdown<WikiPageFrontmatter>(formatted);

    expect(parsed.frontmatter).toEqual(frontmatter);
    expect(parsed.body).toBe("# Pitfall\n\nUse raw body.\n");
  });
});
