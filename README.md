# AIWiki

AIWiki is a local-first CLI for AI coding memory. It keeps project memory in `.aiwiki/` as Markdown, JSON, and JSONL so Codex, Claude Code, Cursor, Gemini CLI, and humans can prepare for work, avoid known pitfalls, resume tasks, and turn finished work into reusable knowledge.

The current implementation is a Node.js TypeScript ESM CLI for Node.js 20, 22,
and 24. It does not require a remote LLM provider, cloud sync, MCP, or a Web UI.
Fast local indexed search uses bundled SQLite support through `better-sqlite3`.

AIWiki is designed so users do not need to memorize every command. The intended
workflow is: the user describes the requirement, and Codex uses AIWiki to fetch
context, guard risky edits, and propose reviewed memory updates.

## Install

Use Node.js 20, 22, or 24.

```bash
npm install
npm run build
```

For local development, run commands through the source entrypoint:

```bash
npm run dev:aiwiki -- <command>
```

The legacy `npm run dev -- <command>` form still works, but `dev:aiwiki` is the
quietest cross-shell command to copy into agent sessions.

Pass the command and its options after npm's single `--` separator:

```bash
npm run dev:aiwiki -- reflect --from-git-diff --read-only
```

When dogfooding the source CLI against another local project on Windows
PowerShell, keep the target project as the current working directory and call the
AIWiki checkout's `tsx.cmd` directly. This form works with paths containing
spaces:

```powershell
cd D:\path\to\target-project
& "D:\path\to\AIWiki\node_modules\.bin\tsx.cmd" "D:\path\to\AIWiki\src\cli.ts" brief "implement the next feature"
```

After publishing or linking the package, the binary is:

```bash
aiwiki <command>
```

To make the binary available from this checkout during local development:

```bash
npm link
```

For npm package release steps, including tarball smoke tests and cross-platform
SQLite install checks, see [docs/npm-release.md](docs/npm-release.md).

## Quick Start

From a source checkout, use `npm run dev:aiwiki --`:

```bash
npm run dev:aiwiki -- init --project-name my-project
npm run dev:aiwiki -- prime
npm run dev:aiwiki -- agent "implement the next feature"
npm run dev:aiwiki -- guard src/example.ts
```

After `npm link` or package install, the same flow is:

```bash
aiwiki init --project-name my-project
aiwiki prime
aiwiki agent "implement the next feature"
aiwiki guard src/example.ts
```

Use `aiwiki agent "<task>" --runbook` when Codex needs a full runbook,
`aiwiki agent "<task>" --runbook --team` when the human explicitly wants a
multi-agent workflow, and `aiwiki brief "<task>"` when a compact development
brief is enough. `aiwiki codex "<task>"` remains a compatibility alias for the
runbook path, but `agent` is the primary entry point.

`agent` is designed as the Codex-owned entry point: by default it starts or
reuses the active AIWiki task and writes an initial project map when one is
missing. Humans should not need to remember those setup commands. Use
`--no-task` or `--no-map` only for diagnostic runs that must avoid those writes.

After development, generate reviewed memory suggestions:

```bash
aiwiki reflect --from-git-diff --output-plan .aiwiki/context-packs/reflect-plan.json
aiwiki apply .aiwiki/context-packs/reflect-plan.json
aiwiki apply .aiwiki/context-packs/reflect-plan.json --confirm
```

Only run `aiwiki apply <plan>` when `reflect` says a plan was written. `apply`
previews by default and explains what the plan is, how many pages it would
create, append, or skip, what each memory means in plain language, and what to
review before confirmation. Confirmed writes only create or append supported wiki
pages under `.aiwiki/wiki/`.

For long-running projects, periodically check memory health:

```bash
aiwiki doctor
```

`doctor` is read-only. It summarizes lint errors, stale memory, rule promotion
candidates, proposed/uncertain pages, deprecated pages, and next maintenance
actions for Codex to report back to the user.

For larger memory sets, the advanced `aiwiki index build` command creates a
derived hybrid index:
`.aiwiki/cache/index.sqlite` for fast local queries and
`.aiwiki/snapshots/wiki-pages.jsonl` as a line-oriented snapshot. Markdown under
`.aiwiki/wiki/` remains the source of truth; the SQLite index can be rebuilt at
any time. `aiwiki index status` compares the SQLite rows back to current
Markdown and reports stale, missing, or extra pages. `aiwiki search --index`
prints the same freshness signal so indexed results do not silently drift.

## Codex Happy Path

For a new coding session, start with the smallest useful loop:

```bash
aiwiki prime
aiwiki agent "implement the next feature" --runbook
aiwiki agent "implement the next feature"
aiwiki guard src/path/to/file.ts
aiwiki checkpoint --step "implemented core behavior" --status done
aiwiki resume
aiwiki reflect --from-git-diff --output-plan .aiwiki/context-packs/reflect-plan.json
aiwiki apply .aiwiki/context-packs/reflect-plan.json  # only if reflect wrote the plan
```

When Codex only needs context and should not write runtime logs, eval cases,
task resume files, or output plans, use the pure read-only variant:

```bash
aiwiki brief "implement the next feature" --read-only
aiwiki guard src/path/to/file.ts
aiwiki resume --read-only
aiwiki reflect --from-git-diff --read-only
```

`brief` and `guard` are safe to run before initialization. In that cold-start mode they perform a read-only project scan, print setup guidance, and do not create `.aiwiki/` files. Run `aiwiki init --project-name <name>` and `aiwiki map --write` when the project is ready to keep durable local memory.

AIWiki's built-in semantic guard rules prioritize Python, Java, TypeScript,
JavaScript, C, and SQL/database change surfaces. They look for general
change-risk categories such as dependency/build contracts, web/API boundaries,
migrations, hydration/runtime boundaries, Java transaction/concurrency paths,
and C API or memory-safety surfaces. Project-specific memory can add sharper
rules later, but the default rules are intended to work across many repositories
without hard-coded project names.

Project scans combine AIWiki's built-in generated/dependency ignores, the repository `.gitignore`, and `.aiwiki/config.json` `ignore` rules. Later rules can use `!path` to re-include a file, so project owners can tune noisy or unusual repositories without changing AIWiki code.

`lint`, `brief`, and `guard` surface advisory staleness warnings when wiki memory references missing files or files that changed after the page's `last_updated` value. These warnings do not block normal output.

`reflect --from-git-diff` uses both `git diff` and `git status` so untracked
files can contribute to review, while local artifacts such as `.aiwiki/`,
virtualenvs, dependencies, build output, and lockfile churn are ignored. It can
draft concrete memory candidates for work-graph changes, structured JSON errors,
and semantic risk lessons, and it reports freshness refreshes for wiki pages
whose `files` frontmatter references changed code. Freshness refreshes stay
advisory unless notes or diff heuristics produce a concrete reusable lesson,
which keeps update plans reviewable instead of filling memory with generic
append entries. These are still candidates: use `aiwiki apply <plan.json>` to
preview and only confirm after review.

`checkpoint` is optimized for handoff by default. When git is available, it
captures changed files from `git diff` and `git status`; if `--tests` or
`--next` are omitted, it records suggested test commands and a concrete next
action instead of leaving the next session blank. `--summary` is accepted as a
plain-language alias for `--message`. Use `--no-from-git-diff` only when a
checkpoint should avoid changed-file capture.

`resume` starts with `下一步做什么 / Next Action` so a fresh AI session can pick up
the true next action before reading the rest of the brief. `prime` combines the
active task, ready work, stale-memory health, and guard targets from active task
state and the current working tree. If a project already has `.beads/`, `prime`
will read `bd ready --json` and `bd status --json` when the `bd` CLI is
available, but AIWiki does not write to or reimplement Beads.

Most Codex sessions should only need `prime`, `agent`, `brief`, `guard`,
`checkpoint`, `resume`, `reflect`, and the lightweight `task` subcommands when
work needs coordination. The top-level help intentionally keeps that daily path
visible and moves graph relations, module packs, eval fixtures, indexes, and
compatibility aliases behind `aiwiki help advanced`.

When the user is not comfortable with CLI details, Codex should run
`aiwiki agent "<task>" --runbook` first and follow the generated runbook. The
final answer should report code changes, checks run, and whether AIWiki memory
is current or has candidate updates awaiting review.

For Codex-managed agent teams, use `aiwiki agent "<task>" --runbook --team`.
AIWiki does not create, schedule, or merge agents; it emits a team-aware runbook
so Codex can coordinate implementer, reviewer, and memory-steward
responsibilities around the same local project memory.

## Codex Work Graph

AIWiki includes a lightweight local work graph inspired by Beads-style agent
workflows. It is intentionally smaller than an issue tracker: tasks live under
`.aiwiki/tasks/`, blocking dependencies are local metadata, and claims are
coordination hints rather than locks.

```bash
aiwiki task create "Improve Chinese retrieval" --type feature --priority 1
aiwiki task create "Seed search memory" --type task --priority 1
aiwiki task dep add "improve-chinese-retrieval" "seed-search-memory"
aiwiki task ready --format json
aiwiki task claim "seed-search-memory" --actor codex
aiwiki task discover "Reflect output is too broad" --from "seed-search-memory"
```

`aiwiki prime` is the startup dashboard for Codex. It summarizes the active task,
ready unblocked work, guard targets, optional read-only Beads context, memory
health, and the next few commands. Use
`aiwiki schema all --format json` when an agent needs stable machine-readable
contracts for task metadata, task events, and prime output.

## Command Surface

Top-level help focuses on daily coding and memory maintenance:

```bash
aiwiki init [--project-name <name>] [--force]
aiwiki prime [--limit <n>] [--format markdown|json]
aiwiki agent "<task>" [--runbook] [--team] [--no-task] [--no-map] [--limit <n>] [--with-graphify] [--architecture-guard] [--format markdown|json]
aiwiki search "<query>" [--type <type>] [--limit <n>] [--index] [--format markdown|json]
aiwiki brief "<task>" [--limit <n>] [--output <path>] [--force] [--with-graphify] [--architecture-guard] [--read-only] [--format markdown|json]
aiwiki guard <file> [--limit <n>] [--with-graphify] [--architecture-guard] [--format markdown|json]
aiwiki map [--write] [--force] [--format markdown|json]
aiwiki reflect [--from-git-diff] [--notes <path>] [--save-raw] [--limit <n>] [--output-plan <path>] [--force] [--read-only] [--format markdown|json]
aiwiki apply <plan.json> [--confirm] [--no-graph] [--format markdown|json]
aiwiki lint [--format markdown|json]
aiwiki doctor [--min-rule-count <n>] [--format markdown|json]
aiwiki task create "<task>" [--id <id>] [--prd <path>] [--type task|bug|feature|epic|chore] [--priority 0-4] [--format markdown|json]
aiwiki task start "<task>" [--id <id>] [--prd <path>] [--type task|bug|feature|epic|chore] [--priority 0-4] [--actor <actor>] [--format markdown|json]
aiwiki task ready [--limit <n>] [--format markdown|json]
aiwiki task claim [id] [--actor <actor>] [--force] [--format markdown|json]
aiwiki task discover "<task>" [--id <id>] [--from <id>] [--type task|bug|feature|epic|chore] [--priority 0-4] [--format markdown|json]
aiwiki task dep add <task> <dependency> [--type blocks|parent_child|related|discovered_from] [--format markdown|json]
aiwiki task list [--status open|in_progress|blocked|deferred|done|paused|cancelled] [--recent <n>] [--format markdown|json]
aiwiki task status [id] [--format markdown|json]
aiwiki task close [--status done|paused|cancelled] [--format markdown|json]
aiwiki checkpoint [--message <message>] [--summary <summary>] [--step <step>] [--status <status>] [--tests <tests>] [--next <next>] [--from-git-diff] [--no-from-git-diff] [--format markdown|json]
aiwiki resume [id] [--output <path>] [--read-only] [--format markdown|json]
```

Advanced and compatibility commands remain available, but are hidden from the
top-level help. Use `aiwiki help advanced` to list them:

```bash
aiwiki codex "<task>" [--team]  # compatibility alias for agent --runbook
aiwiki schema [all|task|task-event|prime] [--format markdown|json]
aiwiki index build [--no-jsonl] [--format markdown|json]
aiwiki index status [--format markdown|json]
aiwiki architecture audit [--format markdown|json]
aiwiki graph build [--format markdown|json]
aiwiki graph import-graphify <path> [--output <path>] [--force] [--format markdown|json]
aiwiki graph relate <file> [--with-graphify] [--format markdown|json]
aiwiki module export <module> [--output <path>] [--force] [--format markdown|json]
aiwiki module import <pack> [--as <module>] [--target-stack <stack>] [--output-plan <path>] [--force] [--format markdown|json]
aiwiki module brief <module> "<task>" [--format markdown|json]
aiwiki module lint <module> [--format markdown|json]
aiwiki ingest <file> [--force] [--limit <n>] [--output-plan <path>] [--format markdown|json]  # compatibility path; prefer reflect --notes --save-raw
aiwiki promote-rules [--min-count <n>] [--format markdown|json]
aiwiki decision "<decision>" [--module <module>] [--format markdown|json]
aiwiki blocker "<blocker>" [--severity low|medium|high|critical] [--format markdown|json]
aiwiki eval large-repos [--cache-dir <path>] [--fixture <name...>] [--skip-clone] [--format markdown|json]
```

`aiwiki eval large-repos` is a maintainer smoke test, not part of the normal
daily coding loop. It sparse-checks out representative large open-source
repositories into a cache directory, runs `prime`, `agent --runbook --team`,
and `guard`, then fails if the expected language risk signals disappear.

## Project Layout

Important source files:

- `src/cli.ts`: command registration and option parsing.
- `src/constants.ts`: product paths, default directories, ignore lists, token budgets, and scan constants.
- `src/ignore.ts`: shared project scan ignore rules, including `.gitignore` and config overrides.
- `src/templates.ts`: default `.aiwiki/` Markdown and prompt templates.
- `src/managed-write.ts`: non-overwrite and forceable-template write policy.
- `src/hybrid-index.ts`: derived SQLite wiki index and JSONL snapshot generation.
- `src/brief.ts`, `src/guard.ts`, `src/reflect.ts`, `src/ingest.ts`, `src/apply.ts`: core memory workflow services.
- `src/errors.ts`, `src/risk-rules.ts`: structured JSON CLI errors and reusable semantic risk heuristics.
- `src/graph.ts`, `src/graphify.ts`, `src/architecture.ts`, `src/module-pack.ts`, `src/task.ts`, `src/prime.ts`, `src/schema.ts`, `src/large-repo-eval.ts`: graph, external context, architecture, module portability, task work graph, startup dashboard, agent-facing schemas, and large-repository smoke evals.

Product and implementation documents:

- `AGENTS.md`: engineering standards for coding agents working in this repo.
- `SPEC.md`: implementation contract for the current CLI.
- `SPEC-FUTURE.md`: optional backlog not yet part of the current contract.
- `prd.md`: concise product direction and roadmap.
- `CHANGELOG.md`: milestone summary and verification history.
- `docs/archive/`: full historical PRD, milestone implementation records, and background material.

Next development focus:

- Continue improving current CLI usability for Codex from real-project dogfood feedback.
- Review generated `reflect --from-git-diff` refresh candidates and improve their specificity when they are too generic.
- Improve Windows local dogfood command ergonomics and document the most reliable source-entrypoint command.
- Treat larger items in `SPEC-FUTURE.md` as backlog until the current CLI feels fast, short, and trustworthy across multiple projects.

## Verify

```bash
npm run typecheck
npm run test
npm run build
npm run release:check
```

Keep `.aiwiki/` user-owned. New write paths should be preview-first or non-destructive by default, and tests should cover repeated execution plus non-overwrite behavior.
