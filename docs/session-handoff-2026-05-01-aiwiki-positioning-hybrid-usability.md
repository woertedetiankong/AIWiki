# Session Handoff: AIWiki Positioning, Hybrid Index, and Usability Dogfood

Date: 2026-05-01

## Why This Handoff Exists

The conversation context is near full. The user plans to start a new Codex
session and continue AIWiki development.

This handoff captures the important product conclusions, implementation state,
validation results, and next safe actions. It is intentionally written for a new
agent that has not read the prior chat.

## Product Direction Decided In This Session

The user compared AIWiki with:

- `beads` / `beads_rust`
- `lerim-cli`
- OpenAI `symphony`
- native Codex capabilities and likely future Codex memory/workflow features

The current positioning should stay narrow:

> AIWiki is repo-owned AI coding memory and guardrails for long-lived codebases.

Do not position AIWiki as:

- a full local issue tracker competing with `beads_rust`;
- an automatic background memory daemon competing with Lerim;
- an agent orchestration system competing with Symphony;
- a generic replacement for Codex context intelligence.

The defensible wedge is:

- before editing: `prime`, `agent`/`brief`, `guard <file>`;
- during long work: `task`, `checkpoint`, `resume`;
- after editing: `reflect -> apply preview`, `doctor`, `lint`;
- always: local-first, Markdown-first, preview-first, user-owned `.aiwiki/`.

Useful one-line positioning:

> AIWiki helps Codex edit long-lived codebases without forgetting project rules
> or silently corrupting project memory.

## What Was Implemented In This Session

### Hybrid SQLite + JSONL Index

Added a Beads-inspired but AIWiki-safe hybrid index:

- Markdown under `.aiwiki/wiki/` remains the source of truth.
- SQLite is a derived local cache for faster indexed search.
- JSONL is a derived snapshot, not canonical memory.

Key changes:

- New dependency: `better-sqlite3`
- New dev dependency: `@types/better-sqlite3`
- New constants:
  - `.aiwiki/cache`
  - `.aiwiki/snapshots`
  - `.aiwiki/cache/index.sqlite`
  - `.aiwiki/snapshots/wiki-pages.jsonl`
- New implementation: `src/hybrid-index.ts`
- New commands:
  - `aiwiki index build [--no-jsonl]`
  - `aiwiki index status`
  - `aiwiki search "<query>" --index`

Important behavior:

- `index build` now requires initialized AIWiki config.
- `index status` reports freshness by comparing SQLite rows back to current
  Markdown content hashes.
- Status detects stale, missing, and extra pages.
- `search --index` falls back to Markdown when SQLite is unavailable and says so
  clearly.

Runtime artifacts are ignored:

```gitignore
.aiwiki/cache/*.sqlite
.aiwiki/cache/*.sqlite-*
.aiwiki/snapshots/*.jsonl
```

The `.aiwiki/snapshots/*.jsonl` ignore was added during dogfood because
`wiki-pages.jsonl` polluted `reflect --from-git-diff` as a changed file.

### Agent Team Usability Fixes

The user explicitly asked to use an agent team to test whether AIWiki is useful.
Two explorer agents tested:

- black-box CLI flow;
- README/help/new-user discoverability.

Fixes implemented from their feedback:

- `guard` no longer overmatches generic missing-file path tokens.
- `search` empty results now explain that search only scans `.aiwiki/wiki`, not
  source files, and suggests `brief`, `guard`, or `map --write`.
- CLI argument errors now show a help hint via Commander.
- Structured JSON errors gained better codes/hints for invalid priority,
  invalid positive integers, non-git reflect, and would-overwrite cases.
- `task claim/status/dep/discover` can resolve unique short task ids such as
  `improve-search-ux` for full ids like `2026-05-01-improve-search-ux`.
- Ambiguous short task ids are rejected.
- `task status` was compacted so it no longer embeds `# Progress` /
  `# Decisions` derived markdown files.
- `reflect --from-git-diff` now rejects non-git projects with a short recovery
  hint instead of surfacing raw git usage.
- `reflect` expands untracked directories into files.
- `guard` and risk rules now detect money/payment flow risks from checkout,
  charge, amount, currency, invoice, and subscription signals.
- README Quick Start now distinguishes source checkout commands from linked
  `aiwiki` binary usage.

### Dogfood Run

Dogfood path exercised:

```bash
npm run dev:aiwiki -- prime
npm run dev:aiwiki -- agent "dogfood current AIWiki usability fixes before handing off"
npm run dev:aiwiki -- index build
npm run dev:aiwiki -- index status
npm run dev:aiwiki -- search "command output noise" --index --limit 3
npm run dev:aiwiki -- search "编码 工作流" --index --limit 3
npm run dev:aiwiki -- task start "Dogfood current AIWiki usability fixes" --id dogfood-usability-fixes --type task --priority 1 --actor codex
npm run dev:aiwiki -- checkpoint ...
npm run dev:aiwiki -- resume --read-only
npm run dev:aiwiki -- guard src/task.ts
npm run dev:aiwiki -- guard src/reflect.ts
npm run dev:aiwiki -- guard src/hybrid-index.ts
npm run dev:aiwiki -- reflect --from-git-diff --read-only
npm run dev:aiwiki -- doctor
npm run dev:aiwiki -- lint
npm run dev:aiwiki -- task close --status done
```

Dogfood observations:

- Indexed search works when run after `index build`; first parallel run raced
  with index creation, and fallback output made the issue understandable.
- `task status` and `resume` are now suitable as agent handoff material.
- Do not run write commands and immediate read commands in parallel when the read
  depends on the write. Sequential `checkpoint -> status/resume` works.
- `reflect` correctly stopped listing `.aiwiki/snapshots/wiki-pages.jsonl` after
  `.gitignore` was updated and generated artifacts were cleaned.

Generated SQLite/JSONL index artifacts were removed after dogfood:

```bash
rm -f .aiwiki/cache/index.sqlite .aiwiki/cache/index.sqlite-* .aiwiki/snapshots/wiki-pages.jsonl
```

There is no active task file:

```text
.aiwiki/tasks/active-task missing
```

The closed dogfood task directory remains under `.aiwiki/tasks/` as local
runtime state and is ignored by git.

## Important Existing Work From The Previous Phase

The working tree already contained broader uncommitted changes before the final
hybrid-index/usability pass. Do not assume every dirty file was changed in the
latest mini-task.

Earlier changes include:

- lightweight AIWiki work graph;
- `prime`;
- `schema`;
- structured JSON errors;
- semantic risk rules;
- large-repo eval fixture command;
- stronger `codex --team` runbook behavior;
- doctor/reflect/guard hardening;
- docs and spec updates.

The previous handoff is:

```text
docs/session-handoff-2026-05-01-codex-work-graph.md
```

Read it before editing broad work graph or agent-facing surfaces.

## Current Working Tree Summary

The repository is intentionally dirty. Notable changed or untracked paths:

- Modified docs: `README.md`, `CHANGELOG.md`, `SPEC.md`, `SPEC-FUTURE.md`,
  `docs/next-development-plan.md`, `prd.md`
- Existing new doc:
  `docs/session-handoff-2026-05-01-codex-work-graph.md`
- This handoff doc:
  `docs/session-handoff-2026-05-01-aiwiki-positioning-hybrid-usability.md`
- Modified implementation:
  `src/cli.ts`, `src/constants.ts`, `src/guard.ts`, `src/output.ts`,
  `src/reflect.ts`, `src/search.ts`, `src/task.ts`, plus prior-phase files
  such as `src/codex.ts`, `src/doctor.ts`, `src/index.ts`, `src/types.ts`
- New implementation:
  `src/errors.ts`, `src/hybrid-index.ts`, `src/large-repo-eval.ts`,
  `src/prime.ts`, `src/risk-rules.ts`, `src/schema.ts`
- Modified/new tests across `tests/*`
- Untracked `.opensource-explorer/` progress from open-source comparison work

Do not revert unrelated dirty files.

## Validation State

Latest full validation after code changes:

```bash
npm run test
npm run typecheck
npm run build
```

Result:

```text
Test Files  29 passed (29)
Tests       168 passed (168)
```

Focused validation after the final usability fixes:

```bash
npm run test -- tests/task.test.ts tests/reflect.test.ts tests/hybrid-index.test.ts tests/guard.test.ts tests/search.test.ts tests/errors.test.ts
npm run typecheck
```

Result:

```text
Test Files  6 passed (6)
Tests       58 passed (58)
```

After the final `.gitignore`-only dogfood tweak, code tests were not rerun
because no source/test code changed after the last full pass. `doctor`, `lint`,
and `reflect --from-git-diff --read-only` were rerun.

Memory health:

```text
doctor: 0 lint errors, 0 lint warnings, 29 stale warnings, 2 rule promotion candidates
lint:   0 errors, 29 warnings
```

The stale warnings are expected while the broader uncommitted implementation
diff remains unreviewed against `.aiwiki/wiki`.

## Memory Plans Created But Not Confirmed

Do not run `apply --confirm` without explicit user approval.

Existing preview plans:

```text
.aiwiki/context-packs/implement-beads-rust-style-hybrid-index-reflect-plan.json
.aiwiki/context-packs/aiwiki-usability-agent-team-reflect-plan.json
.aiwiki/context-packs/neat-freak-2026-05-01-reflect-plan.json
.aiwiki/context-packs/reflect-plan-work-graph-specificity.json
```

The latest reflect preview still reports 17 candidate wiki updates. Some are
useful, but append text can be overly broad. Review and rewrite candidates
before confirming long-term memory.

## Product Conclusions To Preserve

These conclusions matter for future design:

- AIWiki should not chase `beads_rust` as a full issue tracker.
- AIWiki should not chase Lerim as an automatic background memory daemon.
- AIWiki should not chase Symphony as an agent orchestration system.
- The best wedge is `guard <file>` plus reviewed project memory lifecycle.
- The user is worried Codex may make AIWiki obsolete. The answer is: generic
  Codex memory/search is risky, but repo-owned guardrails and preview-first
  memory governance remain more defensible.
- Borrowing from open source is still useful, but AIWiki's role is not making
  Codex understand a repo once; it is making the project remember the reasoning
  and constraints later.

## Suggested Next Session Start

Start with:

```bash
cd /Users/superstorm/Documents/Code/memory/llmwiki
npm run dev:aiwiki -- prime
npm run dev:aiwiki -- doctor
git status --short
```

Then read:

```bash
sed -n '1,260p' docs/session-handoff-2026-05-01-codex-work-graph.md
sed -n '1,260p' docs/session-handoff-2026-05-01-aiwiki-positioning-hybrid-usability.md
```

Useful diff inspection:

```bash
git diff -- .gitignore README.md package.json package-lock.json src/constants.ts src/hybrid-index.ts src/search.ts src/output.ts tests/hybrid-index.test.ts tests/search.test.ts
git diff -- src/task.ts src/guard.ts src/reflect.ts src/risk-rules.ts src/errors.ts tests/task.test.ts tests/guard.test.ts tests/reflect.test.ts tests/errors.test.ts
```

Before any commit:

```bash
npm run typecheck
npm run test
npm run build
git diff --check
```

## Recommended Next Work

Recommended priorities:

1. Decide whether the current large dirty working tree should become one commit
   or be split into at least two commits:
   - work graph / prime / schema / errors / risk rules;
   - hybrid index / indexed search / usability hardening.
2. Review the latest reflect candidate plans and decide what memory should be
   confirmed, rewritten, or discarded.
3. Improve reflect candidate quality so stale-page refreshes capture durable
   lessons instead of listing every changed file.
4. Continue sharpening `guard <file>` as the main differentiated feature.
5. Consider a future `Borrowing Brief` or `study` workflow for safely adapting
   ideas from open-source projects, but do not implement it before the current
   CLI loop is committed and stable.

Avoid:

- adding daemon/background sync;
- adding cloud or remote provider behavior;
- turning task into a full `beads_rust` clone;
- confirming `.aiwiki` memory writes without user review;
- committing generated runtime artifacts from `.aiwiki/cache`, `.aiwiki/tasks`,
  `.aiwiki/evals`, or `.aiwiki/context-packs`.
