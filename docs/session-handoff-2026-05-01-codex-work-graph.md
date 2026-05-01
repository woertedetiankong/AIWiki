# Session Handoff: Codex Work Graph and Memory Hardening

Date: 2026-05-01

## Context

The user is building AIWiki as a local-first memory and context tool for Codex
and other coding agents. This work compared AIWiki with Beads-style local task
graphs, then added the useful coordination pieces without turning AIWiki into a
full issue tracker.

The product direction remains:

- AIWiki is a memory, guardrail, task-continuity, and Codex workflow layer.
- It stays local-first, explicit, preview-first, and Markdown/JSON friendly.
- Do not add Dolt, daemon processes, git hooks, cloud sync, or MCP until the
  daily CLI loop is much sharper.

## What Changed

Implemented a lightweight local work graph:

- `aiwiki task create "<task>"` creates open work without claiming it.
- `aiwiki task ready` lists open tasks with no unfinished blocking dependencies.
- `aiwiki task claim [id]` claims an unblocked task and makes it active.
- `aiwiki task discover "<follow-up>"` records newly discovered work with a
  non-blocking `discovered_from` link.
- `aiwiki task dep add <task> <dependency>` adds typed dependencies.

Added Codex startup and agent-facing surfaces:

- `aiwiki prime` summarizes active task, ready work, memory health, and next
  commands.
- `aiwiki schema [all|task|task-event|prime] --format json` exposes
  machine-readable contracts.
- Structured JSON errors now appear when command output is requested as JSON.
- `codex --team` references `prime`, `task ready`, `task claim`, and
  blocked-task `--force` behavior.
- `codex --team` now chooses guard targets from dirty git files, matched brief
  targets, and representative semantic-risk files.

Hardened reflection, guardrails, and memory health:

- `reflect --from-git-diff` includes untracked files from `git status`.
- `reflect --from-git-diff --read-only` works before `.aiwiki/` is initialized.
- `reflect` extracts concrete work-graph lessons, structured-error lessons, and
  semantic-risk lessons from local diffs.
- `reflect` suggests freshness refresh entries for wiki pages whose `files`
  frontmatter references changed files.
- `guard` reports nearby tests, file signals, useful file-note recommendations,
  and built-in semantic change risks.
- `doctor` groups stale referenced-file findings by wiki page.
- `prime` now says stale memory warnings when that is the actual issue instead
  of implying lint errors.
- `aiwiki eval large-repos` sparse-checks representative large repositories and
  verifies cold-start `prime`, `codex --team`, and `guard` behavior.

## Files Changed

Core implementation:

- `src/cli.ts`
- `src/codex.ts`
- `src/doctor.ts`
- `src/errors.ts`
- `src/guard.ts`
- `src/index.ts`
- `src/large-repo-eval.ts`
- `src/prime.ts`
- `src/reflect.ts`
- `src/risk-rules.ts`
- `src/schema.ts`
- `src/task.ts`
- `src/types.ts`

Tests:

- `tests/codex.test.ts`
- `tests/doctor.test.ts`
- `tests/errors.test.ts`
- `tests/guard.test.ts`
- `tests/large-repo-eval.test.ts`
- `tests/prime.test.ts`
- `tests/reflect.test.ts`
- `tests/risk-rules.test.ts`
- `tests/schema.test.ts`
- `tests/task.test.ts`

Docs:

- `README.md`
- `SPEC.md`
- `SPEC-FUTURE.md`
- `CHANGELOG.md`
- `prd.md`
- `docs/next-development-plan.md`
- `docs/session-handoff-2026-05-01-codex-work-graph.md`

Other:

- `package.json` adds `eval:large-repos`.

## Validation

Latest checks in this cleanup all passed:

```bash
npm run typecheck
npm run test
npm run build
git diff --check
```

Latest full test result:

```text
Test Files  28 passed (28)
Tests       157 passed (157)
```

Dogfood checks run during cleanup:

```bash
npm run dev:aiwiki -- agent "sync documentation with the current AIWiki work graph, reflect, guard, doctor, schema, and eval changes"
npm run dev:aiwiki -- guard docs/session-handoff-2026-05-01-codex-work-graph.md
npm run dev:aiwiki -- guard README.md
npm run dev:aiwiki -- guard SPEC-FUTURE.md
npm run dev:aiwiki -- guard CHANGELOG.md
npm run dev:aiwiki -- guard prd.md
npm run dev:aiwiki -- guard docs/next-development-plan.md
npm run dev:aiwiki -- guard SPEC.md
npm run dev:aiwiki -- reflect --from-git-diff --read-only
npm run dev:aiwiki -- reflect --from-git-diff --output-plan .aiwiki/context-packs/neat-freak-2026-05-01-reflect-plan.json --force
npm run dev:aiwiki -- apply .aiwiki/context-packs/neat-freak-2026-05-01-reflect-plan.json
npm run dev:aiwiki -- doctor
npm run dev:aiwiki -- prime
```

## Current Working Tree

The working tree intentionally still has uncommitted implementation and docs
changes. As of this handoff, notable changed paths are:

- Modified docs: `CHANGELOG.md`, `README.md`, `SPEC-FUTURE.md`, `SPEC.md`,
  `docs/next-development-plan.md`, `prd.md`.
- New doc: `docs/session-handoff-2026-05-01-codex-work-graph.md`.
- Modified implementation/tests: `src/cli.ts`, `src/codex.ts`, `src/doctor.ts`,
  `src/guard.ts`, `src/index.ts`, `src/reflect.ts`, `src/task.ts`,
  `src/types.ts`, and matching tests.
- New implementation/tests: `src/errors.ts`, `src/large-repo-eval.ts`,
  `src/prime.ts`, `src/risk-rules.ts`, `src/schema.ts`,
  `tests/errors.test.ts`, `tests/large-repo-eval.test.ts`,
  `tests/prime.test.ts`, `tests/risk-rules.test.ts`, `tests/schema.test.ts`.
- Ignored local AIWiki runtime artifacts include the generated reflect plan under
  `.aiwiki/context-packs/`, eval logs, task runs, and `.aiwiki/log.md`.

## Memory Health

`aiwiki doctor` currently reports:

- Lint errors: 0
- Lint warnings: 0
- Stale warnings: 28
- Rule promotion candidates: 2

The cleanup created and previewed
`.aiwiki/context-packs/neat-freak-2026-05-01-reflect-plan.json`, but did not run
`apply --confirm`. Useful candidate memory includes `prime`, `schema`,
structured JSON errors, work-graph claim semantics, and semantic-risk guard
lessons. The preview also shows some overly broad refresh append text, which is
exactly the next quality target.

## Next Optimization Targets

1. Review the generated reflect plan and decide which memory candidates should
   be confirmed, rewritten, or discarded.
2. Improve `reflect` append text for stale-page refreshes so it captures the
   durable lesson instead of listing every changed file.
3. Improve Chinese/Unicode retrieval; this remains high value because the user
   often describes tasks in Chinese.
4. Continue tuning `architecture audit` false positives and guard semantic-risk
   wording from real-project dogfood.
5. Keep `eval large-repos` as a maintainer smoke test, not a normal daily
   coding command.

## Recommended Next Session Start

```bash
cd /Users/superstorm/Documents/Code/memory/llmwiki
npm run dev:aiwiki -- prime
npm run dev:aiwiki -- doctor
npm run dev:aiwiki -- apply .aiwiki/context-packs/neat-freak-2026-05-01-reflect-plan.json
```

Then inspect the implementation diff:

```bash
git diff -- src/task.ts src/cli.ts src/codex.ts src/prime.ts src/schema.ts src/errors.ts src/reflect.ts src/guard.ts src/doctor.ts src/risk-rules.ts src/large-repo-eval.ts
```

Before committing:

```bash
npm run typecheck
npm run test
npm run build
git diff --check
```

Suggested commit message:

```bash
git commit -m "feat: add Codex work graph and memory hardening"
```
