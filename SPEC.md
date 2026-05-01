# AIWiki Specification

Status: Draft v1

Purpose: Define the implementation contract for AIWiki, a local-first project memory and context
engineering CLI for AI coding agents.

This specification is intended to be more implementation-oriented than `prd.md`. The PRD explains
product direction and roadmap; this document defines the behavior that coding agents MUST implement
and test.

## Normative Language

The key words `MUST`, `MUST NOT`, `REQUIRED`, `SHOULD`, `SHOULD NOT`, `RECOMMENDED`, `MAY`, and
`OPTIONAL` in this document are to be interpreted as described in RFC 2119.

`Implementation-defined` means the behavior is part of the implementation contract, but this
specification does not prescribe one universal policy. Implementations MUST document the selected
behavior.

## 1. Problem Statement

AIWiki is a local-first command line tool that stores durable project memory for AI coding agents.
It helps agents prepare for tasks, avoid known pitfalls while editing files, record task progress,
and turn completed work into reusable project knowledge.

AIWiki solves six operational problems:

- AI coding sessions are temporary, but project memory needs to be durable.
- Historical decisions, pitfalls, rules, and module notes are often scattered across chat logs.
- Coding agents need task-specific context packs instead of the entire history.
- High-risk files need guardrails before edits, especially for payment, auth, security, and
  migration work.
- Beginners may not ask for good architecture, so the tool must proactively surface quality
  guardrails.
- Module experience should be portable across projects without blindly copying code.

Important boundary:

- AIWiki is a memory, context, guardrail, and task-continuity layer.
- AIWiki is not a coding agent and MUST NOT directly modify business code as part of memory
  operations.
- AIWiki is not a full code knowledge graph engine. Optional code-structure adapters are future
  work and are tracked in `SPEC-FUTURE.md`.
- AIWiki's durable state lives under the project-local `.aiwiki/` directory unless a command
  explicitly writes to a user-provided project-local output path.
- Command write semantics are explicit:
  - Read-only commands or `--read-only` mode MUST NOT write any files.
  - Preview-only commands MUST NOT write long-term wiki memory, but MAY write runtime log/eval
    records unless `--read-only` is provided.
  - Confirmed writes MUST require an explicit confirmation flag or command path.

## 2. Goals and Non-Goals

### 2.1 Goals

- Initialize a project-local `.aiwiki/` memory directory.
- Store project memory as Markdown, JSON, and JSONL files that are easy to inspect and version.
- Generate task-specific Development Briefs from existing memory.
- Generate file-specific guardrails before editing.
- Preserve raw notes and generate structured wiki update suggestions.
- Generate reflection previews from notes and/or `git diff`.
- Apply confirmed wiki update plans with preview-first semantics.
- Build a lightweight graph from wiki pages, frontmatter, markdown links, and file references.
- Check wiki health and report errors/warnings.
- Suggest rule promotion candidates from repeated high-severity pitfalls.
- Track task continuity through task files, checkpoints, decisions, blockers, and resume briefs.
- Keep public commands usable by Codex, Claude Code, Cursor, Gemini CLI, and humans.

### 2.2 Non-Goals

- AIWiki MUST NOT implement a complex Web UI in the current CLI-first product line.
- AIWiki MUST NOT require a remote database, cloud sync, or graph database.
- AIWiki MUST NOT require a specific AI coding agent.
- AIWiki MUST NOT store secrets, API keys, cookies, or credentials in `.aiwiki/`.
- AIWiki MUST NOT promote rules, delete pages, deprecate decisions, or overwrite user-authored
  memory without an explicit confirmation path.
- AIWiki MUST NOT blindly migrate code between projects.
- AIWiki MUST NOT fork or reimplement external code intelligence engines as part of the current
  CLI contract.

## 3. System Overview

### 3.1 Main Components

1. `CLI Layer`
   - Parses commands and options.
   - Calls domain functions.
   - Formats Markdown or JSON output.
   - MUST keep command handlers thin.

2. `Configuration Layer`
   - Loads `.aiwiki/config.json`.
   - Merges defaults.
   - Validates user-editable config.
   - Throws a clear not-initialized error when `.aiwiki/` is missing.

3. `Markdown Storage Layer`
   - Reads and writes Markdown with YAML frontmatter.
   - Scans `.aiwiki/wiki/`.
   - Validates wiki page frontmatter.

4. `Search Layer`
   - Performs local no-LLM search over title, frontmatter, relative path, and body.
   - Scores severity and encountered count.
   - Supports type filters and result limits.

5. `Context Compiler`
   - Generates Development Briefs.
   - Generates file guardrails.
   - Generates resume briefs.
   - Compiles durable memory into task-specific temporary context.

6. `Reflection and Ingest Layer`
   - Preserves raw Markdown notes.
   - Reads git diffs when requested.
   - Produces preview-only memory update suggestions.

7. `Apply Layer`
   - Reads a user-provided update plan.
   - Validates it with schemas.
   - Previews creates/appends/skips by default.
   - Writes only when explicitly confirmed.

8. `Graph Layer`
   - Builds `.aiwiki/graph/graph.json`.
   - Builds `.aiwiki/graph/backlinks.json`.
   - Uses wiki frontmatter, markdown links, module refs, file refs, and relation fields.

9. `Task Continuity Layer`
   - Creates task directories.
   - Records checkpoints, decisions, blockers, changed files, tests, and metadata.
   - Treats `checkpoints.jsonl` as the append-only event source for task progress summaries.
   - Maintains `.aiwiki/tasks/active-task`.
   - Derives status and resume briefs from task events for new agent sessions.

10. `External Context Adapter Layer`
   - Reads optional external artifacts such as Graphify output.
   - Treats external artifacts as task context, not confirmed AIWiki memory.

### 3.2 Abstraction Levels

AIWiki is easiest to extend when kept in these layers:

1. `Product Policy`
   - PRD, SPEC, AGENTS, and prompt templates.

2. `Local Memory Schema`
   - `.aiwiki/` layout, page frontmatter, graph JSON, task files.

3. `Domain Services`
   - brief, guard, reflect, ingest, apply, lint, graph, task.

4. `Command Surface`
   - user-facing CLI and stable output formats.

5. `Agent Integration`
   - AGENTS.md rules, MCP, future adapter commands.

### 3.3 External Dependencies

Required:

- Node.js 20 or newer.
- Local filesystem.
- TypeScript runtime/build toolchain for development.

Optional:

- Git CLI for `reflect --from-git-diff` and `checkpoint --from-git-diff`.
- Graphify output files under `graphify-out/`.
- AI provider APIs are not required by the current implemented command set. Future provider-backed
  workflows are tracked in `SPEC-FUTURE.md`.

## 4. Project Directory Contract

### 4.1 Root Directory

All commands operate relative to the current working directory unless an explicit project root is
added in a future version.

Commands that write files MUST keep writes inside the project root unless this specification
explicitly allows otherwise.

### 4.2 `.aiwiki/` Layout

`aiwiki init` MUST create the following logical layout:

```text
.aiwiki/
  config.json
  AGENTS.md
  index.md
  log.md
  sessions/
  sources/
    raw-notes/
    git-diffs/
    ai-summaries/
  tasks/
  wiki/
    modules/
    pitfalls/
    decisions/
    patterns/
    rules/
    files/
  graph/
    graph.json
    backlinks.json
  context-packs/
  prompts/
  evals/
```

The implementation MAY create `.gitkeep` files for empty directories.

### 4.3 User-Owned Data

All files under `.aiwiki/` MUST be treated as user-owned data.

Commands MUST NOT delete user-created files.

Commands MUST NOT overwrite existing user-editable files unless:

- the command is explicitly defined as refreshable, and
- the user passes a force/confirm option, and
- tests cover the overwrite behavior.

## 5. Core Domain Model

### 5.1 AIWiki Config

`AIWikiConfig` MUST include:

- `version`
- `projectName`
- `provider`
- `tokenBudget.brief`
- `tokenBudget.guard`
- `tokenBudget.reflect`
- `rulesTargets.agentsMd`
- `rulesTargets.claudeMd`
- `rulesTargets.cursorRules`
- `ignore`
- `riskFiles`
- `highRiskModules`

Supported provider values:

- `openai`
- `anthropic`
- `openai-compatible`
- `none`

Implementations MUST merge partial config files with defaults.

Invalid config MUST produce a clear error.

Project file scans MUST combine built-in generated/dependency ignore rules, root `.gitignore`
rules, and `AIWikiConfig.ignore` rules in that order. Ignore rules MAY use `!path` to re-include
files ignored by earlier rules. Commands MUST treat these rules as scan guidance only; they MUST
NOT delete or rewrite ignored files.

### 5.2 Wiki Page

A wiki page is a Markdown file under `.aiwiki/wiki/` with YAML frontmatter.

Supported page types:

- `project_map`
- `module`
- `pitfall`
- `decision`
- `pattern`
- `rule`
- `file`
- `source`

Supported statuses:

- `active`
- `deprecated`
- `proposed`
- `uncertain`

Supported risk/severity levels:

- `low`
- `medium`
- `high`
- `critical`

Common frontmatter fields:

- `type`
- `status`
- `title`
- `modules`
- `files`
- `tags`
- `severity`
- `risk`
- `related_pitfalls`
- `related_decisions`
- `related_patterns`
- `supersedes`
- `conflicts_with`
- `source_sessions`
- `encountered_count`
- `created_at`
- `last_updated`

The scanner MUST reject malformed frontmatter with a clear error.

### 5.3 Graph JSON

The graph model MUST include:

```ts
interface GraphJson {
  version: string;
  generated_at: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}
```

Node IDs MUST be stable for a given wiki page path or file path.

Edges MUST NOT include self-loops.

The graph builder MUST derive edges from:

- file references in frontmatter
- module references in frontmatter
- `related_pitfalls`
- `related_decisions`
- `related_patterns`
- `supersedes`
- `conflicts_with`
- `source_sessions`
- markdown wikilinks
- markdown links to `.md` files

### 5.4 Task Metadata

A task MUST include:

- `id`
- `title`
- `status`
- `created_at`
- `updated_at`
- `closed_at` when closed
- `prd` when provided

A task MAY include:

- `type`: `task`, `bug`, `feature`, `epic`, or `chore`
- `priority`: integer `0` through `4`, where `0` is highest
- `assignee`
- `claimed_at`
- `dependencies`

Task dependencies are local workflow metadata. Blocking dependency types affect
`aiwiki task ready`; non-blocking dependency types are graph/context hints.

Supported task dependency types:

- `blocks`
- `parent_child`
- `related`
- `discovered_from`

Supported task statuses:

- `open`
- `in_progress`
- `blocked`
- `deferred`
- `done`
- `paused`
- `cancelled`

### 5.5 Task Checkpoint

Task checkpoint, decision, and blocker records are append-only JSONL events stored in
`checkpoints.jsonl`.

An event MUST include:

- `time`
- `type`

Supported checkpoint event types:

- `checkpoint`
- `decision`
- `blocker`
- `task_created`
- `task_claimed`
- `dependency_added`
- `task_discovered`
- `task_closed`

Optional fields:

- `message`
- `step`
- `status`
- `tests`
- `next`
- `files`
- `module`
- `severity`
- `actor`
- `task_id`
- `dependency_id`
- `dependency_type`
- `from`

Task event readers MUST reject corrupt JSONL with a clear error that includes the task ID and line
number.

Task `status` and `resume` outputs MUST be derivable from `checkpoints.jsonl`, not from user-edited
Markdown summary files. Markdown files such as `progress.md`, `decisions.md`, `blockers.md`,
`changed-files.md`, `tests.md`, and `resume.md` MAY be maintained as human-readable derived
summaries.

## 6. Command Surface

All commands that support `--format` MUST accept:

- `markdown`
- `json`

Unknown output formats MUST produce an error.

Positive integer options such as `--limit`, `--recent`, and `--min-count` MUST reject invalid or
non-positive values.

### 6.1 `aiwiki init`

Usage:

```bash
aiwiki init [--project-name <name>] [--force]
```

Behavior:

- MUST create `.aiwiki/` structure.
- MUST create default config, index, log, prompt templates, graph files, eval files, and AGENTS
  guidance.
- MUST initialize graph files with valid empty graph/backlinks JSON structures.
- MUST be idempotent.
- MUST NOT overwrite existing user files by default.
- `--force` MAY refresh AIWiki-managed templates that are declared forceable.
- `--force` MUST NOT delete extra user files.

### 6.1a `aiwiki prime`

Usage:

```bash
aiwiki prime [--limit <n>] [--format markdown|json]
```

Behavior:

- MUST produce a compact read-only startup dashboard for Codex.
- MUST include active task information when present.
- MUST include ready unblocked open tasks.
- MUST include AIWiki memory health summary derived from doctor checks.
- MUST include a short next-action list with runnable commands.
- MUST NOT write files.

### 6.1b `aiwiki schema`

Usage:

```bash
aiwiki schema [all|task|task-event|prime] [--format markdown|json]
```

Behavior:

- MUST expose stable machine-readable schemas for agent-facing data surfaces.
- MUST support schemas for task metadata, task events, and prime context.
- Markdown output MAY summarize available schemas; JSON output MUST include the schema objects.

### 6.2 `aiwiki search`

Usage:

```bash
aiwiki search "<query>" [--type <type>] [--limit <n>] [--format markdown|json]
```

Behavior:

- MUST scan `.aiwiki/wiki/`.
- MUST tokenize the query.
- MUST score matches across title, frontmatter, path, and body.
- MUST add priority for severity and encountered count.
- MUST penalize deprecated pages.
- MUST support filtering by wiki page type.
- MUST return an empty result set for empty query tokens or no matches.

### 6.3 `aiwiki brief`

Usage:

```bash
aiwiki brief "<task>" [--limit <n>] [--output <path>] [--force]
                    [--with-graphify] [--architecture-guard]
                    [--read-only] [--format markdown|json]
```

Behavior:

- MUST generate a no-LLM Development Brief from AIWiki memory.
- MUST read `.aiwiki/index.md` when available.
- MUST search wiki memory for task-relevant pages.
- MUST include selected docs.
- MUST include advisory staleness warnings when selected wiki memory references missing project
  files or files changed after the page's `last_updated` value.
- Markdown output MUST show at most three staleness warnings and point to JSON for full details
  when more warnings exist.
- `--with-graphify` MUST read project-local `graphify-out/` structural context when available.
- `--with-graphify` MUST degrade gracefully when Graphify output is missing or malformed.
- `--architecture-guard` MUST add an explicit Architecture Guard section without removing the
  default architecture guidance.
- `--architecture-guard` SHOULD report likely modules, high-risk files, focused test areas, and
  route/controller boundary guidance.
- `--architecture-guard` MUST NOT automatically refactor code or block the user's task.
- MUST include sections for:
  - Task
  - Goal
  - Product Questions to Confirm
  - Recommended Direction
  - Architecture Boundaries
  - Hardcoding and Configuration Risks
  - Portability Checklist
  - Module Memory to Maintain
  - Architecture Guard when `--architecture-guard` is provided
  - Graphify Structural Context when `--with-graphify` is provided
  - Relevant Modules
  - Relevant Project Memory
  - Known Pitfalls
  - Project Rules and Constraints
  - High-Risk Files
  - Suggested Must-Read Files
  - Acceptance Criteria
  - Notes for Codex
- MUST append an eval case to `.aiwiki/evals/brief-cases.jsonl` unless `--read-only` is provided.
- MUST append a log entry unless `--read-only` is provided.
- `--read-only` MUST NOT write log entries, eval cases, or output files.
- `--read-only` MUST reject `--output`.
- `--output` MUST write inside the project root.
- `--output` MUST NOT overwrite existing files unless `--force` is provided.

### 6.4 `aiwiki guard`

Usage:

```bash
aiwiki guard <file> [--limit <n>] [--with-graphify] [--architecture-guard]
                    [--format markdown|json]
```

Behavior:

- MUST reject target files outside the project root.
- MUST normalize target paths to project-local POSIX-style paths.
- MUST find exact wiki pages that reference the file.
- MUST also search by meaningful path tokens.
- MUST include advisory staleness warnings when matched wiki memory references missing project
  files or files changed after the page's `last_updated` value.
- Markdown output MUST show at most three staleness warnings and point to JSON for full details
  when more warnings exist.
- `--with-graphify` MUST read project-local `graphify-out/` structural context when available.
- `--with-graphify` MUST degrade gracefully when Graphify output is missing or malformed.
- `--architecture-guard` MUST add explicit architecture-focused checks for the target file.
- `--architecture-guard` SHOULD flag route/controller boundary risk, high-risk path signals, and
  focused test areas for state transitions, webhooks, auth, migrations, and billing when relevant.
- `--architecture-guard` MUST NOT automatically refactor code or block the user's task.
- Built-in semantic change-risk rules SHOULD prioritize Python, Java, TypeScript,
  JavaScript, and C projects without hard-coding a single repository's paths.
- Built-in semantic change-risk rules SHOULD report general risk categories such
  as dependency/build contracts, web/API boundaries, database migrations, frontend
  hydration/runtime boundaries, Java transaction or concurrency paths, and C API
  or memory-safety surfaces when file paths and content provide evidence.
- `codex --team` SHOULD use dirty git files first, then matched brief targets, and
  then representative semantic-risk files so cold-start repositories still offer
  useful `guard` targets.
- MUST sort high-severity memory before lower-severity memory.
- MUST include sections for:
  - Do Not
  - Related Modules
  - Critical Rules
  - Known Pitfalls
  - Staleness Warnings
  - Required Checks
  - Change Risks
  - File Signals
  - Related Decisions
  - Graphify Structural Context when `--with-graphify` is provided
  - Architecture Guard when `--architecture-guard` is provided
  - Suggested Tests
- MUST return a stable empty guardrail response for unknown files.

### 6.5 `aiwiki map`

Usage:

```bash
aiwiki map [--write] [--force] [--format markdown|json]
```

Behavior:

- MUST scan project files outside ignored directories.
- MUST respect root `.gitignore` and configured ignore rules.
- MUST detect stack signals from `package.json`, `tsconfig.json`, and dependencies.
- MUST detect important directories.
- MUST detect high-risk files from config, wiki pages, and risk keywords.
- MUST detect generated file candidates.
- MUST detect existing rule pages.
- MUST detect missing module page candidates.
- `--write` MUST write `.aiwiki/wiki/project-map.md`.
- `--write` MUST NOT overwrite an existing project map unless `--force` is provided.

### 6.6 `aiwiki reflect`

Usage:

```bash
aiwiki reflect [--from-git-diff] [--notes <path>] [--limit <n>]
               [--output-plan <path>] [--force] [--read-only]
               [--format markdown|json]
```

Behavior:

- MUST generate a preview only.
- MUST NOT write structured wiki pages.
- MUST read git diff only when `--from-git-diff` is provided.
- MUST include untracked project files from `git status` when `--from-git-diff` is provided.
- MUST read notes only from a project-local path.
- MUST extract changed files from git diff.
- MUST search memory using changed files and note text.
- MUST include sections for:
  - Task Summary
  - New Lessons
  - Pitfalls to Add or Update
  - Modules to Update
  - Freshness Refreshes
  - Decisions to Add or Deprecate
  - Patterns to Add or Update
  - Rules to Promote
  - Files Changed in `.aiwiki`
  - Safety
- MUST generate an `updatePlanDraft` when reusable wiki updates can be inferred.
- SHOULD extract concrete reusable lessons from changed files when safe local heuristics can infer
  them, including work graph behavior, structured JSON errors, and semantic risk lessons.
- SHOULD suggest append refresh entries for wiki pages whose `files` frontmatter references changed
  files.
- `--output-plan` MUST write the update plan draft to a project-local JSON file.
- `--output-plan` MUST NOT overwrite an existing file unless `--force` is provided.
- `--output-plan` MUST reject paths outside the project root.
- MUST append reflect eval data to `.aiwiki/evals/reflect-cases.jsonl` unless `--read-only` is
  provided.
- `--read-only` MUST NOT write eval cases or output plan files.
- `--read-only` MUST reject `--output-plan`.

Future behavior:

- SHOULD include Quality Debt.

### 6.7 `aiwiki ingest`

Usage:

```bash
aiwiki ingest <file> [--force] [--limit <n>] [--output-plan <path>]
                    [--format markdown|json]
```

Behavior:

- MUST accept a project-local Markdown note.
- MUST preserve the raw note under `.aiwiki/sources/raw-notes/`.
- MUST NOT overwrite an existing raw note unless `--force` is provided.
- MUST generate a preview with possible modules, pitfalls, decisions, patterns, rules, and related
  memory.
- MUST NOT create structured wiki pages.
- MUST generate an `updatePlanDraft` when structured wiki suggestions can be inferred.
- `--output-plan` MUST write the update plan draft to a project-local JSON file.
- `--output-plan` MUST NOT overwrite an existing file unless `--force` is provided.
- MUST instruct the user to convert accepted suggestions into an update plan and use `aiwiki apply`.

### 6.8 `aiwiki apply`

Usage:

```bash
aiwiki apply <plan.json> [--confirm] [--no-graph] [--format markdown|json]
```

Behavior:

- MUST read a project-local JSON update plan.
- MUST validate the plan schema.
- MUST support entry types:
  - `module`
  - `pitfall`
  - `decision`
  - `pattern`
  - `rule`
- MUST derive safe kebab-case slugs when not provided.
- MUST preview operations by default.
- MUST write only when `--confirm` is provided.
- MUST skip existing pages unless append sections are explicitly provided.
- MUST update `.aiwiki/index.md` after confirmed writes.
- MUST rebuild graph after confirmed writes unless `--no-graph` is provided.
- MUST reject invalid frontmatter, unknown types, unsafe slugs, malformed JSON, and outside-root
  paths.

### 6.9 `aiwiki lint`

Usage:

```bash
aiwiki lint [--format markdown|json]
```

Behavior:

- MUST check AIWiki Markdown health.
- MUST report errors and warnings.
- MUST set a non-zero process exit code when errors are present.
- MUST detect malformed frontmatter.
- MUST detect broken wiki links or markdown links.
- MUST detect duplicate pitfalls.
- MUST detect index gaps.
- MUST detect missing high-risk module pages.
- MUST warn when wiki frontmatter `files` entries point to missing project files.
- MUST warn when referenced project files changed after a wiki page's `last_updated` value.
- Staleness warnings MUST be advisory and MUST NOT set a non-zero process exit code by themselves.
- SHOULD detect orphan pages.
- SHOULD detect rule conflicts and stale decisions as the implementation matures.

### 6.10 `aiwiki graph build`

Usage:

```bash
aiwiki graph build [--format markdown|json]
```

Behavior:

- MUST build `.aiwiki/graph/graph.json`.
- MUST build `.aiwiki/graph/backlinks.json`.
- MUST append a log entry.
- MUST include wiki pages, file nodes, and module nodes.
- MUST include graph edges as defined in section 5.3.
- MUST produce deterministic ordering for nodes and edges.

### 6.11 `aiwiki graph import-graphify`

Usage:

```bash
aiwiki graph import-graphify <path> [--output <path>] [--force] [--format markdown|json]
```

Behavior:

- MUST read a project-local Graphify output directory, `GRAPH_REPORT.md`, or `graph.json`.
- MUST accept `graphify-out/GRAPH_REPORT.md` and `graphify-out/graph.json`.
- MUST preserve Graphify confidence labels when available.
- MUST treat Graphify output as structural context, not confirmed AIWiki memory.
- MUST NOT create wiki pages, rules, or confirmed memory.
- MUST tolerate missing or malformed Graphify output and report warnings.
- `--output` MUST write a project-local context pack using the selected output format.
- `--output` MUST NOT overwrite an existing file unless `--force` is provided.
- `--output` MUST reject paths outside the project root.
- JSON and Markdown command output MUST include the written output path when `--output` is provided.
- MUST support Markdown and JSON output.

### 6.12 `aiwiki graph relate`

Usage:

```bash
aiwiki graph relate <file> [--with-graphify] [--format markdown|json]
```

Behavior:

- MUST reject target files outside the project root.
- MUST normalize target paths to project-local POSIX-style paths.
- MUST build an in-memory wiki graph without writing `.aiwiki/graph/graph.json` or
  `.aiwiki/graph/backlinks.json`.
- MUST summarize wiki pages that reference the target file.
- MUST summarize related module nodes and adjacent graph edges.
- `--with-graphify` MUST add Graphify structural context when available.
- `--with-graphify` MUST degrade gracefully when Graphify output is missing or malformed.
- MUST treat graph and Graphify relations as task context, not confirmed AIWiki memory.
- MUST NOT create wiki pages, rules, context packs, or confirmed memory.
- MUST support Markdown and JSON output.
- MUST return a stable empty relation response for unknown files.

### 6.13 `aiwiki promote-rules`

Usage:

```bash
aiwiki promote-rules [--min-count <n>] [--format markdown|json]
```

Behavior:

- MUST scan pitfall pages.
- MUST identify repeated high-severity pitfalls.
- MUST use `encountered_count` and severity/risk fields.
- MUST generate preview-only rule promotion candidates.
- MUST NOT create rule pages.

### 6.14 `aiwiki task start`

Usage:

```bash
aiwiki task start "<task>" [--id <id>] [--prd <path>]
                  [--type task|bug|feature|epic|chore]
                  [--priority 0-4] [--actor <actor>]
                  [--format markdown|json]
```

Behavior:

- MUST create `.aiwiki/tasks/<task-id>/`.
- MUST create task files:
  - `task.md`
  - `brief.md`
  - `plan.md`
  - `progress.md`
  - `decisions.md`
  - `blockers.md`
  - `changed-files.md`
  - `tests.md`
  - `checkpoints.jsonl`
  - `resume.md`
  - `metadata.json`
- MUST set active task pointer.
- MUST set status to `in_progress`.
- MUST record assignee/claim metadata when an actor is available.
- MUST reject duplicate task IDs.
- MUST append a log entry.

### 6.14a `aiwiki task create`

Usage:

```bash
aiwiki task create "<task>" [--id <id>] [--prd <path>]
                   [--type task|bug|feature|epic|chore]
                   [--priority 0-4] [--format markdown|json]
```

Behavior:

- MUST create the same task file structure as `task start`.
- MUST set status to `open`.
- MUST NOT set the active task pointer.
- MUST reject duplicate task IDs.

### 6.14b `aiwiki task ready`

Usage:

```bash
aiwiki task ready [--limit <n>] [--format markdown|json]
```

Behavior:

- MUST list `open` tasks with no unfinished `blocks` or `parent_child` dependencies.
- MUST sort ready tasks by priority, then updated time.
- MUST include active task ID when present.
- MUST NOT treat `related` or `discovered_from` links as blockers.

### 6.14c `aiwiki task claim`

Usage:

```bash
aiwiki task claim [id] [--actor <actor>] [--force] [--format markdown|json]
```

Behavior:

- MUST set the selected task to `in_progress`.
- MUST set active task pointer to the claimed task.
- MUST record assignee and claimed timestamp.
- MUST treat claims as coordination hints, not locks.
- MUST reject claiming closed tasks.
- MUST reject blocked tasks unless `--force` is provided.

### 6.14d `aiwiki task discover`

Usage:

```bash
aiwiki task discover "<task>" [--id <id>] [--from <id>]
                     [--type task|bug|feature|epic|chore]
                     [--priority 0-4] [--format markdown|json]
```

Behavior:

- MUST create an `open` task for work discovered during another task.
- MUST add a `discovered_from` dependency to the provided or active source task when available.
- MUST NOT make discovered work block the source task.

### 6.14e `aiwiki task dep add`

Usage:

```bash
aiwiki task dep add <task> <dependency>
                   [--type blocks|parent_child|related|discovered_from]
                   [--format markdown|json]
```

Behavior:

- MUST add a typed dependency to task metadata.
- MUST reject missing task IDs.
- MUST reject self-dependencies.
- MUST reject cycles for blocking dependency types.
- MUST allow non-blocking knowledge links via `related` and `discovered_from`.

### 6.15 `aiwiki task list`

Usage:

```bash
aiwiki task list [--status <status>] [--recent <n>] [--format markdown|json]
```

Behavior:

- MUST list task metadata sorted by update time or creation time.
- MUST include the active task ID when present.
- MUST support status filtering.
- MUST support recent count limiting.

### 6.16 `aiwiki task status`

Usage:

```bash
aiwiki task status [id] [--format markdown|json]
```

Behavior:

- MUST resolve the provided task ID or active task.
- MUST report metadata, progress, decisions, blockers, changed files, tests, and checkpoints.
- MUST derive progress, decisions, blockers, changed files, and tests from `checkpoints.jsonl`.
- MUST report corrupt `checkpoints.jsonl` records with a clear task ID and line number.
- MUST throw a clear error if no active task exists and no ID is provided.

### 6.17 `aiwiki task close`

Usage:

```bash
aiwiki task close [--status done|paused|cancelled] [--format markdown|json]
```

Behavior:

- MUST close the active task.
- MUST reject `open`, `in_progress`, `blocked`, and `deferred` as close statuses.
- MUST update metadata and closed timestamp.
- MUST clear active task pointer.
- MUST append a log entry.

### 6.18 `aiwiki checkpoint`

Usage:

```bash
aiwiki checkpoint [--message <message>] [--step <step>] [--status <status>]
                  [--tests <tests>] [--next <next>] [--from-git-diff]
                  [--format markdown|json]
```

Behavior:

- MUST resolve the active task.
- MUST append a checkpoint event to `checkpoints.jsonl`.
- MUST update progress, changed files, tests, and resume content as derived summaries from
  `checkpoints.jsonl`.
- MUST read changed files from git only when `--from-git-diff` is provided.
- MUST tolerate missing git by recording no changed files instead of crashing.

### 6.19 `aiwiki resume`

Usage:

```bash
aiwiki resume [id] [--output <path>] [--read-only] [--format markdown|json]
```

Behavior:

- MUST resolve the provided task ID or active task.
- MUST generate a resume brief derived from `checkpoints.jsonl`.
- MUST include completed work, in-progress work, not-started work, decisions, blockers, changed
  files, tests, and next recommended steps.
- MUST remind the next agent not to restart from scratch.
- MUST write the generated resume to `.aiwiki/tasks/<id>/resume.md` by default.
- `--read-only` MUST print or return the resume brief without writing `.aiwiki/tasks/<id>/resume.md`.
- `--read-only` MUST reject `--output`.
- `--output` MUST write inside the project root.

### 6.20 `aiwiki decision`

Usage:

```bash
aiwiki decision "<decision>" [--module <module>] [--format markdown|json]
```

Behavior:

- MUST resolve the active task.
- MUST append a decision checkpoint.
- MUST update `decisions.md` and resume content as derived summaries from `checkpoints.jsonl`.
- MUST NOT immediately promote the decision into long-term wiki memory.

### 6.21 `aiwiki blocker`

Usage:

```bash
aiwiki blocker "<blocker>" [--severity low|medium|high|critical] [--format markdown|json]
```

Behavior:

- MUST resolve the active task.
- MUST append a blocker checkpoint.
- MUST update `blockers.md` and resume content as derived summaries from `checkpoints.jsonl`.
- MUST NOT immediately promote the blocker into long-term wiki memory.

### 6.22 `aiwiki eval large-repos`

Usage:

```bash
aiwiki eval large-repos [--cache-dir <path>] [--fixture <name...>] [--skip-clone]
                         [--format markdown|json]
```

Behavior:

- MUST run as a maintainer smoke eval, not as part of the normal project memory workflow.
- MUST sparse-checkout repeatable large open-source repository fixtures into a cache directory.
- MUST support fixture filtering by name.
- MUST support `--skip-clone` so CI or local runs can require pre-existing cached checkouts.
- MUST run `prime`, `codex --team`, and representative `guard` checks against each fixture.
- MUST fail the command with a non-zero exit code when expected language risk signals disappear.
- SHOULD include Python, Java, TypeScript, JavaScript, and C fixtures.
- MUST NOT write `.aiwiki/` memory into the evaluated repository fixtures.

## 7. Output Contract

### 7.1 Markdown Output

Markdown output MUST be readable by humans and directly usable as context for AI coding agents.

Markdown command output SHOULD use stable section headings so tests and downstream tools can parse
it.

### 7.2 JSON Output

JSON output MUST be valid JSON followed by a trailing newline.

JSON output SHOULD preserve the same core data as Markdown output.

### 7.3 Errors

Errors MUST be clear and actionable.

CLI errors MUST be written to stderr and exit with a non-zero code.

When the command invocation requests JSON output, CLI errors SHOULD be emitted as structured JSON
with a stable code, actionable message, optional hint, and retryable flag.

Commander parse errors MAY use Commander exit codes.

## 8. Safety and Privacy

### 8.1 Local-First Rule

All currently implemented commands MUST run without remote LLM calls.

Future provider-backed commands MUST require explicit configuration and MUST document what content
is sent to remote providers.

### 8.2 Path Safety

Commands that accept paths MUST resolve them against the project root.

Commands MUST reject writes outside the project root unless explicitly specified by a future command.

`guard` MUST reject target files outside the project root.

### 8.3 Preview-First Rule

Potentially destructive or long-term memory-changing operations MUST be preview-first.

Preview-first is not identical to read-only. A preview command MAY write runtime telemetry or
workflow records such as `.aiwiki/log.md` or `.aiwiki/evals/*.jsonl`. When a command supports
`--read-only`, that mode MUST suppress all filesystem writes for that command.

Examples:

- `apply` previews by default.
- `reflect` previews by default.
- `ingest` preserves raw notes and previews structured suggestions.
- rule promotion previews candidates by default.

### 8.4 Secrets

AIWiki MUST NOT store secrets in `.aiwiki/`.

AIWiki SHOULD ignore `.env*` and similar files by default when scanning project files.

## 9. Architecture Audit

Architecture Audit is a proactive quality layer for users who may not know how to ask for good
architecture. The current implementation exposes this as a read-only audit command and also uses
architecture guardrail text inside `aiwiki brief`.

Current command shape:

```bash
aiwiki architecture audit [--format markdown|json]
```

Requirements:

- MUST scan project source files outside ignored directories.
- MUST respect root `.gitignore` and configured ignore rules.
- SHOULD flag high-risk domains such as payment, auth, security, webhook, migration, schema, and
  billing.
- SHOULD flag large files and hardcoding risks such as secret-like literals and URL literals.
- SHOULD report configured high-risk modules that do not have module memory pages.
- MUST NOT automatically refactor code.
- MUST NOT block the user's task.
- MUST present warnings as actionable guardrails.

## 10. Module Memory Pack

Module Memory Pack is the mechanism for cross-project experience migration.

Current command shape:

```bash
aiwiki module export <module> [--output <path>] [--force] [--format markdown|json]
aiwiki module import <pack> [--as <module>] [--target-stack <stack>]
                     [--output-plan <path>] [--force] [--format markdown|json]
aiwiki module brief <module> "<task>" [--format markdown|json]
aiwiki module lint <module> [--format markdown|json]
```

Requirements:

- `export` MUST gather module pages, related pitfalls, decisions, patterns, rules, and file notes.
- `export` SHOULD include acceptance checks and migration notes.
- `import` MUST be preview-first.
- `import` MUST generate an update plan draft rather than writing target wiki pages directly.
- `import` MUST NOT overwrite an output plan unless `--force` is provided.
- `import` MUST report import risks in Markdown and JSON output.
- `import` SHOULD detect existing target wiki pages that would be skipped by apply.
- `import` SHOULD detect existing exact or similar target module memory.
- `import` SHOULD detect possible overlap between imported rules and active target-project rules.
- `import` SHOULD detect source-specific assumptions such as localhost URLs, absolute paths,
  environment-specific wording, and provider-specific assumptions.
- `import --as` MUST accept only safe lowercase kebab-case module names.
- `import --as` MUST remap imported entries from the source module to the target module in the
  generated update plan.
- `import --as` MUST include source module and target module in Markdown and JSON output.
- `import --as` MUST NOT mutate the source module pack.
- Imported pages MUST remain proposed until reviewed through `aiwiki apply`.
- Module packs MUST NOT include secrets.
- Module packs SHOULD clearly separate reusable patterns from project-specific assumptions.
- Module import output MUST instruct agents to port module contracts, rules, pitfalls,
  configuration needs, and tests rather than copying source code directly.
- `module brief` MUST scan module, pitfall, decision, pattern, rule, and file memory for the
  requested module.
- `module brief` MUST generate a read-only task brief for adapting module experience to the current
  project.
- `module brief` Markdown MUST use compact Codex-facing sections: Must Read, Do Not, Rules,
  Pitfalls, Suggested Tests, and Other Context.
- `module brief` MUST instruct agents to port module contracts, rules, pitfalls, configuration
  needs, and tests rather than copying source code directly.
- `module brief` MUST NOT write update plans, wiki pages, rules, or confirmed memory.
- `module lint` MUST scan module memory and report portability and promotion risks.
- `module lint` SHOULD detect missing portability notes, missing file references, missing test or
  acceptance notes, source-specific assumptions, and unsafe active imported rules.
- `module lint` MUST support stable output when no module memory matches.
- `module lint` MUST NOT rewrite wiki pages or change rule status.

## 11. Future Work

Unimplemented adapters and larger roadmap items live in `SPEC-FUTURE.md`.

Current implementation MUST NOT expose unimplemented future commands as complete. Future features
must remain optional, additive, local-first by default, and covered by tests before this main
specification treats them as implemented.

## 12. Testing Contract

Every command or domain service MUST have focused tests for:

- happy path
- repeated execution
- invalid input
- missing initialization when applicable
- non-overwrite behavior when writing files
- JSON output when supported
- Markdown output when supported

Current required verification commands:

```bash
npm run typecheck
npm test
npm run build
```

Future optional systems listed in `SPEC-FUTURE.md` MUST add tests before being moved into this
implemented specification.

## 13. Implementation Guidance for Coding Agents

When implementing this specification:

1. Read `prd.md` for product intent.
2. Read this `SPEC.md` for exact behavior.
3. Read `AGENTS.md` for engineering standards.
4. Prefer existing modules and patterns.
5. Keep CLI handlers thin.
6. Add schemas for user-editable data.
7. Add tests before or alongside behavior changes.
8. Preserve user-owned `.aiwiki/` data.
9. Do not introduce Web UI, cloud sync, Neo4j, or automatic code migration unless the spec is
   updated first.
