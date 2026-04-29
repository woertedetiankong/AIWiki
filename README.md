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

## Verify

```bash
npm run typecheck
npm run test
npm run build
```

Keep `.aiwiki/` user-owned. New write paths should be preview-first or non-destructive by default, and tests should cover repeated execution plus non-overwrite behavior.
