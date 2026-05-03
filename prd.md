# PRD: AIWiki

Status: Current product direction as of 2026-05-03.

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
- Session traces can seed candidate memory, but long-term writes still require
  preview and explicit confirmation.
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
High-confidence context belongs in `Must Read`; weaker retrieval belongs in
`Memory Hints`. Briefs are input to the coding agent's own plan, not a
replacement for it.

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
aiwiki apply .aiwiki/context-packs/reflect-plan.json --confirm  # only after reviewed approval
```

Reflect generates preview-only update suggestions. Apply previews by default,
records preview freshness, and writes only with `--confirm` after a fresh
matching preview.

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
- `prime`
- `schema`
- `codex`
- `agent`
- `search`
- `brief`
- `guard`
- `map`
- `architecture audit`
- `reflect`
- `ingest`
- `apply`
- `lint`
- `doctor`
- `maintain`
- `session scan`
- `session reflect`
- `index build`
- `index status`
- `graph build`
- `graph import-graphify`
- `graph relate`
- `promote-rules`
- `module export`
- `module import`
- `module brief`
- `module lint`
- `task create`
- `task start`
- `task ready`
- `task claim`
- `task discover`
- `task dep add`
- `task list`
- `task status`
- `task close`
- `checkpoint`
- `resume`
- `decision`
- `blocker`
- `eval large-repos`
- `eval usability`

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

- Tune `architecture audit` line-level evidence and false-positive severity.
- Broaden real-project Chinese/Unicode retrieval dogfood beyond tokenizer and indexed-search basics.
- Review doctor rule-promotion candidates before turning repeated pitfalls into active rules.
- Continue improving the specificity of `reflect --from-git-diff` memory refresh and semantic-risk candidates.
- `aiwiki lint --fix` for low-risk index/backlink/format repair.
- Graph hotspots and conflicts using the existing graph model.
- Retrieval feedback and tuning for brief, guard, reflect, and module workflows.
- Broaden session trace extraction beyond conservative pitfall/decision
  heuristics while preserving preview-first review.

Later:

- PRD checklist support for task continuity.
- Confirmed module import workflow after write semantics are fully specified.
- Optional code context adapter.
- Optional semantic memory index.
- Optional prompt/workflow optimizer.
- Optional deep-context / recursive investigation.
- MCP server after the local Markdown workflow remains stable.

## Next Development Focus

The next development work should not start with large systems from
`SPEC-FUTURE.md`. The 2026-04-29, 2026-05-02, and 2026-05-03 dogfood passes made
cold-start `brief`/`guard`, the Codex-owned `agent` path, preview-hash apply
safety, indexed search fallback, and the local eval loops usable enough to
protect further tuning. Next, tighten the remaining local Markdown workflow
before adding optional adapters.

### 1. Architecture Audit Precision

Goal: make audit findings concrete enough that users trust high-severity output.

Acceptance criteria:

- Findings include useful line-level evidence.
- Product terms and test fixtures do not look like secrets.
- Real secret-like literals still produce high-severity warnings.

### 2. Retrieval And Guard Dogfood

Goal: keep retrieval quality measurable across real projects and languages.

Acceptance criteria:

- Chinese/Unicode queries are checked against more than synthetic fixtures.
- `Memory Hints` stays weak and does not become a fake must-read constraint.
- Guard targets from runbooks exist in sparse checkouts and stay actionable.

### 3. Reflect-Driven Freshness

Goal: keep changed code connected to wiki pages that may need refresh, while
making the generated candidates concrete enough for review.

Focus commands:

- `aiwiki reflect --from-git-diff --output-plan <path>`
- `aiwiki apply <path>`
- `aiwiki lint`

Acceptance criteria:

- `reflect --from-git-diff` keeps finding wiki pages related to changed files and
  suggesting update plan entries for review.
- Generated append text should explain the durable lesson or refresh reason, not
  only list changed files.
- Suggestions remain preview-first and do not rewrite wiki pages without review.
- `lint`, `brief`, and `guard` continue to show advisory staleness warnings.
- Staleness warnings are advisory and must not block the user's task.

### 4. Command Ergonomics and Retrieval Feedback

Goal: make local dogfood reliable and make ranking improvements measurable.

Acceptance criteria:

- README documents the most reliable Windows PowerShell command for running the
  source CLI against another project.
- Dogfood notes capture false-positive and false-negative `brief` selections
  without turning project-specific paths into product rules.
- Any new ranking heuristic is tested with small synthetic repositories and
  checked against at least one real project.

## Success Criteria

AIWiki succeeds when a new agent session can inspect the repo, run a small set of
local commands, and quickly understand:

- the project rules and safety boundaries;
- the relevant module memory;
- known pitfalls and decisions;
- high-risk files and architecture risks;
- task continuity state;
- which lessons are durable enough to apply or export.
