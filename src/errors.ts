export interface StructuredCliError {
  error: {
    code: string;
    message: string;
    hint?: string;
    retryable: boolean;
  };
}

function codeForMessage(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("not initialized") || lower.includes("run `aiwiki init")) {
    return "NOT_INITIALIZED";
  }
  if (lower.includes("unsupported output format")) {
    return "INVALID_FORMAT";
  }
  if (lower.includes("task priority must be an integer")) {
    return "INVALID_PRIORITY";
  }
  if (lower.includes("expected a positive integer")) {
    return "INVALID_POSITIVE_INTEGER";
  }
  if (lower.includes("unsupported task status")) {
    return "INVALID_TASK_STATUS";
  }
  if (lower.includes("reflect --from-git-diff requires a git repository")) {
    return "NOT_GIT_REPOSITORY";
  }
  if (lower.includes("refusing to overwrite existing project map")) {
    return "WOULD_OVERWRITE_PROJECT_MAP";
  }
  if (lower.includes("refusing to overwrite existing output plan")) {
    return "WOULD_OVERWRITE_OUTPUT_PLAN";
  }
  if (lower.includes("outside project root")) {
    return "PATH_OUTSIDE_PROJECT";
  }
  if (lower.includes("corrupt task event log")) {
    return "CORRUPT_TASK_EVENT_LOG";
  }
  if (lower.includes("task already exists")) {
    return "TASK_ALREADY_EXISTS";
  }
  if (lower.includes("task not found")) {
    return "TASK_NOT_FOUND";
  }
  if (lower.includes("no active aiwiki task")) {
    return "NO_ACTIVE_TASK";
  }
  if (lower.includes("would create a cycle") || lower.includes("depend on itself")) {
    return "TASK_DEPENDENCY_CYCLE";
  }
  if (lower.includes("blocked by unfinished dependencies")) {
    return "TASK_BLOCKED";
  }
  if (lower.includes("unsupported schema")) {
    return "INVALID_SCHEMA";
  }

  return "AIWIKI_ERROR";
}

function hintForCode(code: string): string | undefined {
  switch (code) {
    case "NOT_INITIALIZED":
      return "Run `aiwiki init --project-name <name>` in the project root.";
    case "INVALID_FORMAT":
      return "Use `--format markdown` or `--format json`.";
    case "INVALID_PRIORITY":
      return "Use a task priority from 0 to 4, where 0 is highest urgency.";
    case "INVALID_POSITIVE_INTEGER":
      return "Use a positive integer greater than 0.";
    case "INVALID_TASK_STATUS":
      return "Use one of: open, in_progress, blocked, deferred, done, paused, cancelled.";
    case "NOT_GIT_REPOSITORY":
      return "Run `git init`, use `aiwiki reflect --notes <path>`, or skip git reflection until changes are tracked.";
    case "WOULD_OVERWRITE_PROJECT_MAP":
      return "Review the existing map first, then rerun `aiwiki map --write --force` if replacing AIWiki-managed map output is intended.";
    case "WOULD_OVERWRITE_OUTPUT_PLAN":
      return "Review or remove the existing plan first, or rerun with `--force` after confirming it is safe to replace.";
    case "PATH_OUTSIDE_PROJECT":
      return "Pass a project-local path.";
    case "CORRUPT_TASK_EVENT_LOG":
      return "Inspect the reported JSONL line before trusting task resume output.";
    case "NO_ACTIVE_TASK":
      return "Run `aiwiki task ready`, `aiwiki task claim <id>`, or `aiwiki task start \"<task>\"`.";
    case "TASK_DEPENDENCY_CYCLE":
      return "Use `related` or `discovered_from` for non-blocking links, or remove the cyclic blocker.";
    case "TASK_BLOCKED":
      return "Run `aiwiki task ready` and claim an unblocked task, or pass `--force` when the human explicitly approves bypassing blockers.";
    case "INVALID_SCHEMA":
      return "Use one of: all, task, task-event, prime.";
    default:
      return undefined;
  }
}

export function toStructuredCliError(error: unknown): StructuredCliError {
  const message = error instanceof Error ? error.message : String(error);
  const code = codeForMessage(message);
  return {
    error: {
      code,
      message,
      hint: hintForCode(code),
      retryable: code !== "CORRUPT_TASK_EVENT_LOG"
    }
  };
}

export function wantsJsonError(argv: string[]): boolean {
  const formatIndex = argv.indexOf("--format");
  return argv.includes("--json") ||
    argv.includes("--robot") ||
    argv.includes("--format=json") ||
    (formatIndex >= 0 && argv[formatIndex + 1] === "json");
}
