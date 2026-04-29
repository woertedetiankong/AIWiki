import { describe, expect, it } from "vitest";
import {
  createIgnoreRules,
  parseIgnoreRules,
  shouldIgnorePath
} from "../src/ignore.js";

describe("ignore rules", () => {
  it("matches directory, suffix, and basename patterns", () => {
    const rules = createIgnoreRules(["dist/", "*.generated.ts", "__pycache__"]);

    expect(shouldIgnorePath("dist/app.js", rules)).toBe(true);
    expect(shouldIgnorePath("src/user.generated.ts", rules)).toBe(true);
    expect(shouldIgnorePath("pkg/__pycache__/module.pyc", rules)).toBe(true);
    expect(shouldIgnorePath("src/user.ts", rules)).toBe(false);
  });

  it("applies later negated rules as overrides", () => {
    const rules = parseIgnoreRules("*.ts\n!important.ts\n");

    expect(shouldIgnorePath("src/generated.ts", rules)).toBe(true);
    expect(shouldIgnorePath("important.ts", rules)).toBe(false);
  });

  it("ignores comments and blank lines", () => {
    const rules = parseIgnoreRules("# generated files\n\ncache/\n");

    expect(rules).toHaveLength(1);
    expect(shouldIgnorePath("cache/state.json", rules)).toBe(true);
  });
});
