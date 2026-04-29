# AIWiki

AIWiki is a local-first CLI for AI coding memory. It keeps project memory in `.aiwiki/` as Markdown, JSON, and JSONL so Codex, Claude Code, Cursor, Gemini CLI, and humans can prepare for work, avoid known pitfalls, resume tasks, and turn finished work into reusable knowledge.

The current implementation is a Node.js 20+ TypeScript ESM CLI. It does not require a remote LLM provider, cloud sync, a database, MCP, or a Web UI.

## Install

```bash
npm install
npm run build
```

For local development, run commands through the source entrypoint:

```bash
npm run dev -- <command>
```

When dogfooding the source CLI against another local project on Windows
PowerShell, keep the target project as the current working directory and call the
AIWiki checkout's `tsx.cmd` directly:

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

## Codex Happy Path

For a new coding session, start with the smallest useful loop:

```bash
aiwiki brief "implement the next feature"
aiwiki guard src/path/to/file.ts
aiwiki checkpoint --step "implemented core behavior" --status done --from-git-diff
aiwiki resume
aiwiki reflect --from-git-diff --output-plan .aiwiki/context-packs/reflect-plan.json
aiwiki apply .aiwiki/context-packs/reflect-plan.json
```

`brief` and `guard` are safe to run before initialization. In that cold-start mode they perform a read-only project scan, print setup guidance, and do not create `.aiwiki/` files. Run `aiwiki init --project-name <name>` and `aiwiki map --write` when the project is ready to keep durable local memory.

Project scans combine AIWiki's built-in generated/dependency ignores, the repository `.gitignore`, and `.aiwiki/config.json` `ignore` rules. Later rules can use `!path` to re-include a file, so project owners can tune noisy or unusual repositories without changing AIWiki code.

`lint`, `brief`, and `guard` surface advisory staleness warnings when wiki memory references missing files or files that changed after the page's `last_updated` value. These warnings do not block normal output.

Most Codex sessions should only need `brief`, `guard`, `checkpoint`, `resume`, and `reflect`. The rest of the command surface is for maintaining memory, graph relations, module packs, and reviewed updates.

## Command Surface

```bash
aiwiki init [--project-name <name>] [--force]
aiwiki search "<query>" [--type <type>] [--limit <n>] [--format markdown|json]
aiwiki brief "<task>" [--limit <n>] [--output <path>] [--force] [--with-graphify] [--architecture-guard] [--format markdown|json]
aiwiki guard <file> [--limit <n>] [--with-graphify] [--architecture-guard] [--format markdown|json]
aiwiki map [--write] [--force] [--format markdown|json]
aiwiki architecture audit [--format markdown|json]
aiwiki reflect [--from-git-diff] [--notes <path>] [--limit <n>] [--output-plan <path>] [--force] [--format markdown|json]
aiwiki ingest <file> [--force] [--limit <n>] [--output-plan <path>] [--format markdown|json]
aiwiki apply <plan.json> [--confirm] [--no-graph] [--format markdown|json]
aiwiki lint [--format markdown|json]
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
aiwiki resume [id] [--output <path>] [--format markdown|json]
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
