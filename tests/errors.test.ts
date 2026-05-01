import { describe, expect, it } from "vitest";
import { toStructuredCliError, wantsJsonError } from "../src/errors.js";

describe("structured CLI errors", () => {
  it("maps common task and format failures to stable error codes", () => {
    expect(toStructuredCliError(new Error("Task not found: missing")).error.code).toBe(
      "TASK_NOT_FOUND"
    );
    expect(
      toStructuredCliError(new Error("Unsupported output format: yaml")).error
    ).toMatchObject({
      code: "INVALID_FORMAT",
      hint: "Use `--format markdown` or `--format json`."
    });
    expect(
      toStructuredCliError(new Error("Task auth is blocked by unfinished dependencies: schema")).error.code
    ).toBe("TASK_BLOCKED");
    expect(
      toStructuredCliError(new Error("Task priority must be an integer from 0 to 4, received: 9")).error
    ).toMatchObject({
      code: "INVALID_PRIORITY",
      hint: "Use a task priority from 0 to 4, where 0 is highest urgency."
    });
    expect(
      toStructuredCliError(new Error("reflect --from-git-diff requires a Git repository.")).error
    ).toMatchObject({
      code: "NOT_GIT_REPOSITORY"
    });
    expect(
      toStructuredCliError(new Error("Refusing to overwrite existing project map: .aiwiki/wiki/project-map.md")).error
    ).toMatchObject({
      code: "WOULD_OVERWRITE_PROJECT_MAP"
    });
  });

  it("detects JSON error preference from argv", () => {
    expect(wantsJsonError(["node", "aiwiki", "task", "claim", "x", "--format", "json"])).toBe(true);
    expect(wantsJsonError(["node", "aiwiki", "task", "claim", "x"])).toBe(false);
  });
});
