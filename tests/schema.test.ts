import { describe, expect, it } from "vitest";
import { getSchemaResult, parseSchemaName } from "../src/schema.js";

describe("AIWiki schemas", () => {
  it("returns task, task event, and prime schemas", () => {
    const result = getSchemaResult("all");

    expect(Object.keys(result.schemas)).toEqual(["task", "task-event", "prime"]);
    expect(result.markdown).toContain("Use `--format json`");
    expect(result.json).toContain("AIWiki Task Metadata");
    expect(result.json).toContain("task_claimed");
    expect(result.json).toContain("initialized");
    expect(result.json).toContain("initialize_memory");
  });

  it("validates schema names", () => {
    expect(parseSchemaName(undefined)).toBe("all");
    expect(parseSchemaName("prime")).toBe("prime");
    expect(() => parseSchemaName("missing")).toThrow("Unsupported schema");
  });
});
