# PRD: AIWiki

Status: Current product direction as of 2026-04-29.

AIWiki is a local-first project memory and context compiler for AI coding agents.
It stores durable project knowledge in `.aiwiki/` and turns that knowledge into
task-specific brief, guard, reflect, resume, graph, architecture, and module
portability workflows.

The full historical PRD is archived at `docs/archive/prd-full-2026-04-29.md`.
The implementation contract lives in `SPEC.md`. Future optional systems live in
`SPEC-FUTURE.md`.

## Product Positioning

AIWiki helps Codex, Claude Code, Cursor, Gemini CLI, and humans answer:

- What should I know before changing this project?
- What historical pitfalls and rules apply to this task or file?
- What happened in an unfinished task, and how should the next session resume?
- What lessons from this module are reusable in another project?
- Which architecture and portability risks should be visible before implementation?

AIWiki is not a coding agent. It does not edit business code, run subagents,
replace the agent's implementation plan, or make remote LLM calls in the current
CLI contract.

## Product Principles

- Local-first by default.
- Markdown, JSON, and JSONL are the source formats.
- `.aiwiki/` is user-owned project data.
- Write paths are preview-first or non-destructive by default.
- Long-term memory writes require explicit confirmation.
- Agent rules, global rules, and cross-project imports require extra caution.
- External adapters provide context, not confirmed facts.
- The current CLI workflow matters more than Web UI, cloud sync, MCP, or heavy
  retrieval infrastructure.

## Core Workflows

### Start a Project

```bash
aiwiki init --project-name my-project
aiwiki map --write
```

`init` creates the local `.aiwiki/` structure. `map` builds a no-LLM project map
from files and existing memory.

### Prepare for Work

```bash
aiwiki brief "implement team invite resend"
aiwiki brief "refactor payment webhook" --with-graphify --architecture-guard
```

Briefs compile relevant memory, project map context, architecture boundaries,
high-risk files, portability checks, known pitfalls, and acceptance criteria.
They are input to the coding agent's own plan, not a replacement for it.

### Guard a File

```bash
aiwiki guard src/app/api/stripe/webhook/route.ts --architecture-guard
aiwiki graph relate src/app/api/stripe/webhook/route.ts --with-graphify
```

Guardrails surface critical rules, known pitfalls, related decisions, required
checks, graph relations, and architecture signals before editing a file.

### Reflect After Work

```bash
aiwiki reflect --from-git-diff --output-plan .aiwiki/context-packs/reflect-plan.json
aiwiki apply .aiwiki/context-packs/reflect-plan.json
aiwiki apply .aiwiki/context-packs/reflect-plan.json --confirm
```

Reflect generates preview-only update suggestions. Apply previews by default and
writes only with `--confirm`.

### Preserve Old Notes

```bash
aiwiki ingest notes/session.md --output-plan .aiwiki/context-packs/ingest-plan.json
```

Ingest preserves raw Markdown notes and generates structured suggestions without
directly creating long-term wiki pages.

### Resume Long Tasks

```bash
aiwiki task start "build module portability" --id module-portability --prd prd.md
aiwiki checkpoint --step "export command" --status done --from-git-diff
aiwiki decision "module imports stay proposed until review" --module module-pack
aiwiki blocker "Need import conflict policy" --severity high
aiwiki resume
aiwiki task close --status done
```

Task state lives under `.aiwiki/tasks/`. Task events are separate from long-term
wiki memory until reflect/apply promotes reusable lessons.

### Move Module Experience Across Projects

```bash
aiwiki module export payment
aiwiki module import .aiwiki/module-packs/payment.aiwiki-pack.json --as billing
aiwiki module brief billing "implement billing in the target project"
aiwiki module lint billing
```

Module packs migrate experience, not source code. Imported pages remain proposed
until reviewed and applied.

## Current Implemented Scope

The current CLI includes:

- `init`
- `search`
- `brief`
- `guard`
- `map`
- `architecture audit`
- `reflect`
- `ingest`
- `apply`
- `lint`
- `graph build`
- `graph import-graphify`
- `graph relate`
- `promote-rules`
- `module export`
- `module import`
- `module brief`
- `module lint`
- `task start`
- `task list`
- `task status`
- `task close`
- `checkpoint`
- `resume`
- `decision`
- `blocker`

See `README.md` for command usage and `SPEC.md` for exact behavior.

## Non-Goals

- No Web UI in the current product line.
- No cloud sync or remote database requirement.
- No default remote LLM calls.
- No automatic code migration between projects.
- No automatic promotion of rules, decisions, or imported memory.
- No hidden global state.
- No graph database requirement.
- No MCP server until the Markdown CLI workflow is stable.

## Documentation Map

- `README.md`: setup, quick start, command reference, and project layout.
- `AGENTS.md`: engineering standards for AI coding agents.
- `SPEC.md`: current implementation contract.
- `SPEC-FUTURE.md`: future optional capabilities and promotion rules.
- `CHANGELOG.md`: concise implementation history.
- `docs/archive/`: historical full PRD, milestone logs, and background material.

## Roadmap

Near-term:

- Codex usability pass for the existing CLI.
- Freshness / staleness checks so wiki memory does not silently drift away from code.
- `aiwiki lint --fix` for low-risk index/backlink/format repair.
- Graph hotspots and conflicts using the existing graph model.
- Retrieval feedback and tuning for brief, guard, reflect, and module workflows.

Later:

- PRD checklist support for task continuity.
- Confirmed module import workflow after write semantics are fully specified.
- Optional code context adapter.
- Optional semantic memory index.
- Optional prompt/workflow optimizer.
- Optional deep-context / recursive investigation.
- MCP server after the local Markdown workflow remains stable.

## Next Session Focus

The next development session should not start with large systems from
`SPEC-FUTURE.md`. First make the current CLI more useful to Codex and safer
against stale memory.

### 1. Codex Usability Pass

Goal: make Codex want to run AIWiki because it is faster and clearer than
manually searching the repo.

Focus commands:

- `aiwiki brief "<task>"`
- `aiwiki guard <file>`
- `aiwiki resume`
- `aiwiki reflect --from-git-diff --output-plan <path>`
- `aiwiki module brief <module> "<task>"`

Acceptance criteria:

- Markdown output starts with the most useful actions, not product explanation.
- `brief` and `guard` fit in roughly one to one-and-a-half terminal screens for
  common cases.
- Outputs clearly separate `Must Read`, `Do Not`, `Rules`, `Pitfalls`, and
  `Suggested Tests`.
- JSON output can remain complete, but Markdown output should be optimized for
  agent decision-making.
- Unknown or empty states stay stable and short.
- `brief` and `guard` provide useful read-only cold-start output before `.aiwiki/`
  is initialized.
- Tests pin the new section order and empty-state behavior.

### 2. Freshness / Staleness Pass

Goal: make stale project memory visible before it misleads Codex.

Minimum useful checks:

- `aiwiki lint` reports wiki frontmatter `files` entries that no longer exist.
- `aiwiki lint` reports wiki pages whose referenced files changed after the
  page `last_updated` value.
- `brief` and `guard` display a compact `Staleness Warnings` section when
  relevant memory may be outdated.
- `reflect --from-git-diff` finds wiki pages related to changed files and
  suggests updating them in the output plan draft.
- Staleness warnings are advisory and must not block the user's task.

A future version may add richer lifecycle metadata, but the first pass should be
simple, local, tested, and based on existing Markdown plus git data.

## Success Criteria

AIWiki succeeds when a new agent session can inspect the repo, run a small set of
local commands, and quickly understand:

- the project rules and safety boundaries;
- the relevant module memory;
- known pitfalls and decisions;
- high-risk files and architecture risks;
- task continuity state;
- which lessons are durable enough to apply or export.
