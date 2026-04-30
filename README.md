# AIWiki

AIWiki is a local-first CLI for AI coding memory. It keeps project memory in `.aiwiki/` as Markdown, JSON, and JSONL so Codex, Claude Code, Cursor, Gemini CLI, and humans can prepare for work, avoid known pitfalls, resume tasks, and turn finished work into reusable knowledge.

The current implementation is a Node.js 20+ TypeScript ESM CLI. It does not require a remote LLM provider, cloud sync, a database, MCP, or a Web UI.

AIWiki is designed so users do not need to memorize every command. The intended
workflow is: the user describes the requirement, and Codex uses AIWiki to fetch
context, guard risky edits, and propose reviewed memory updates.

## Install

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

For command options in npm scripts, put an extra `--` before options so npm does
not consume them:

```bash
npm run dev:aiwiki -- reflect -- --from-git-diff --read-only
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

## Quick Start

```bash
aiwiki init --project-name my-project
aiwiki map --write
aiwiki codex "implement the next feature"
aiwiki codex "implement the next feature" --team
aiwiki agent "implement the next feature"
aiwiki brief "implement the next feature"
aiwiki guard src/example.ts
```

After development, generate reviewed memory suggestions:

```bash
aiwiki reflect --from-git-diff --output-plan .aiwiki/context-packs/reflect-plan.json
aiwiki apply .aiwiki/context-packs/reflect-plan.json
aiwiki apply .aiwiki/context-packs/reflect-plan.json --confirm
```

`apply` previews by default. Confirmed writes only create or append supported wiki pages under `.aiwiki/wiki/`.

For long-running projects, periodically check memory health:

```bash
aiwiki doctor
```

`doctor` is read-only. It summarizes lint errors, stale memory, rule promotion
candidates, proposed/uncertain pages, deprecated pages, and next maintenance
actions for Codex to report back to the user.

## Codex Happy Path

For a new coding session, start with the smallest useful loop:

```bash
aiwiki codex "implement the next feature"
aiwiki agent "implement the next feature"
aiwiki brief "implement the next feature"
aiwiki guard src/path/to/file.ts
aiwiki checkpoint --step "implemented core behavior" --status done --from-git-diff
aiwiki resume
aiwiki reflect --from-git-diff --output-plan .aiwiki/context-packs/reflect-plan.json
aiwiki apply .aiwiki/context-packs/reflect-plan.json
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

Project scans combine AIWiki's built-in generated/dependency ignores, the repository `.gitignore`, and `.aiwiki/config.json` `ignore` rules. Later rules can use `!path` to re-include a file, so project owners can tune noisy or unusual repositories without changing AIWiki code.

`lint`, `brief`, and `guard` surface advisory staleness warnings when wiki memory references missing files or files that changed after the page's `last_updated` value. These warnings do not block normal output.

Most Codex sessions should only need `agent`, `brief`, `guard`, `checkpoint`, `resume`, and `reflect`. The rest of the command surface is for maintaining memory, graph relations, module packs, and reviewed updates.

When the user is not comfortable with CLI details, Codex should run `aiwiki codex
"<task>"` first and follow the generated runbook. The final answer should report
code changes, checks run, and whether AIWiki memory is current or has candidate
updates awaiting review.

For Codex-managed agent teams, use `aiwiki codex "<task>" --team`. AIWiki does
not create, schedule, or merge agents; it emits a team-aware runbook so Codex can
coordinate implementer, reviewer, and memory-steward responsibilities around the
same local project memory.

## Command Surface

```bash
aiwiki init [--project-name <name>] [--force]
aiwiki codex "<task>" [--limit <n>] [--with-graphify] [--architecture-guard] [--team] [--format markdown|json]
aiwiki agent "<task>" [--limit <n>] [--with-graphify] [--architecture-guard] [--format markdown|json]
aiwiki search "<query>" [--type <type>] [--limit <n>] [--format markdown|json]
aiwiki brief "<task>" [--limit <n>] [--output <path>] [--force] [--with-graphify] [--architecture-guard] [--read-only] [--format markdown|json]
aiwiki guard <file> [--limit <n>] [--with-graphify] [--architecture-guard] [--format markdown|json]
aiwiki map [--write] [--force] [--format markdown|json]
aiwiki architecture audit [--format markdown|json]
aiwiki reflect [--from-git-diff] [--notes <path>] [--limit <n>] [--output-plan <path>] [--force] [--read-only] [--format markdown|json]
aiwiki ingest <file> [--force] [--limit <n>] [--output-plan <path>] [--format markdown|json]
aiwiki apply <plan.json> [--confirm] [--no-graph] [--format markdown|json]
aiwiki lint [--format markdown|json]
aiwiki doctor [--min-rule-count <n>] [--format markdown|json]
aiwiki graph build [--format markdown|json]
aiwiki graph import-graphify <path> [--output <path>] [--force] [--format markdown|json]
aiwiki graph relate <file> [--with-graphify] [--format markdown|json]
aiwiki promote-rules [--min-count <n>] [--format markdown|json]
aiwiki module export <module> [--output <path>] [--force] [--format markdown|json]
aiwiki module import <pack> [--as <module>] [--target-stack <stack>] [--output-plan <path>] [--force] [--format markdown|json]
aiwiki module brief <module> "<task>" [--format markdown|json]
aiwiki module lint <module> [--format markdown|json]
aiwiki task start "<task>" [--id <id>] [--prd <path>] [--format markdown|json]
aiwiki task list [--status in_progress|done|paused|cancelled] [--recent <n>] [--format markdown|json]
aiwiki task status [id] [--format markdown|json]
aiwiki task close [--status done|paused|cancelled] [--format markdown|json]
aiwiki checkpoint [--message <message>] [--step <step>] [--status <status>] [--tests <tests>] [--next <next>] [--from-git-diff] [--format markdown|json]
aiwiki resume [id] [--output <path>] [--read-only] [--format markdown|json]
aiwiki decision "<decision>" [--module <module>] [--format markdown|json]
aiwiki blocker "<blocker>" [--severity low|medium|high|critical] [--format markdown|json]
```

## Project Layout

Important source files:

- `src/cli.ts`: command registration and option parsing.
- `src/constants.ts`: product paths, default directories, ignore lists, token budgets, and scan constants.
- `src/ignore.ts`: shared project scan ignore rules, including `.gitignore` and config overrides.
- `src/templates.ts`: default `.aiwiki/` Markdown and prompt templates.
- `src/managed-write.ts`: non-overwrite and forceable-template write policy.
- `src/brief.ts`, `src/guard.ts`, `src/reflect.ts`, `src/ingest.ts`, `src/apply.ts`: core memory workflow services.
- `src/graph.ts`, `src/graphify.ts`, `src/architecture.ts`, `src/module-pack.ts`, `src/task.ts`: graph, external context, architecture, module portability, and task-continuity services.

Product and implementation documents:

- `AGENTS.md`: engineering standards for coding agents working in this repo.
- `SPEC.md`: implementation contract for the current CLI.
- `SPEC-FUTURE.md`: optional backlog not yet part of the current contract.
- `prd.md`: concise product direction and roadmap.
- `CHANGELOG.md`: milestone summary and verification history.
- `docs/archive/`: full historical PRD, milestone implementation records, and background material.

Next development focus:

- Continue improving current CLI usability for Codex from real-project dogfood feedback.
- Add `reflect --from-git-diff` suggestions for wiki pages made stale by changed files.
- Improve Windows local dogfood command ergonomics and document the most reliable source-entrypoint command.
- Treat larger items in `SPEC-FUTURE.md` as backlog until the current CLI feels fast, short, and trustworthy across multiple projects.

## Verify

```bash
npm run typecheck
npm run test
npm run build
```

Keep `.aiwiki/` user-owned. New write paths should be preview-first or non-destructive by default, and tests should cover repeated execution plus non-overwrite behavior.
