# AIWiki Changelog

This file summarizes the implementation history that used to live in root-level
`implementation-m*.md` files. Full milestone notes are archived under `docs/archive/`.

## 2026-05-01

### Codex Work Graph

- Added `aiwiki prime` as a compact startup dashboard for active task, ready work, memory health, and next commands.
- Added local ready-work task flow: `task create`, `task ready`, `task claim`, `task discover`, and `task dep add`.
- Extended task metadata with type, priority, assignee, claim time, and typed dependencies.
- Extended task JSONL events with task lifecycle, claim, dependency, discovery, and close events.
- Added `aiwiki schema` for task metadata, task event, and prime JSON schemas.
- Added structured JSON error output when commands are invoked with `--format json`.

### Reflect, Guard, and Doctor Hardening

- Improved `reflect --from-git-diff` so it includes untracked files from `git status`, supports cold-start read-only previews, extracts concrete work-graph and semantic-risk lessons, and suggests freshness refreshes for wiki pages that reference changed files.
- Added grouped `doctor` stale-memory findings so repeated file warnings are summarized by page.
- Improved `prime` memory-health wording so stale warnings are not described as lint errors.
- Added built-in semantic guard risk signals for database, frontend hydration, browser-only runtime, Python, Java, JavaScript/TypeScript, and C change surfaces.
- Added `aiwiki eval large-repos` as a maintainer smoke eval for cold-start `prime`, `codex --team`, and representative `guard` behavior across sparse large-repository fixtures.

## 2026-04-29

### Current CLI Surface

- Added Graphify structural context support through `aiwiki graph import-graphify`, `aiwiki graph relate`, `brief --with-graphify`, and `guard --with-graphify`.
- Added architecture guardrails through `aiwiki architecture audit`, `brief --architecture-guard`, and `guard --architecture-guard`.
- Added module portability workflows through `aiwiki module export`, `aiwiki module import`, `aiwiki module brief`, and `aiwiki module lint`.
- Hardened task continuity so task status and resume output are derived from `checkpoints.jsonl`.
- Added `SPEC.md`, `SPEC-FUTURE.md`, and `README.md` as the current documentation set.
- Hardened Codex-facing `brief`, `guard`, `lint`, and `module brief` output with compact sections, advisory staleness warnings, and stable empty states.
- Improved cold-start project scans across mixed frontend/backend and Python repositories with Python cache ignores, `.gitignore` support, config ignore overrides, and task-relevant file ranking.
- Dogfooded cold-start `brief` and `guard` on `D:\newproject\lianjiepeizhi\pms` and `D:\llm\pydantic-deepagents` without creating `.aiwiki/` in those target projects.

Verification recorded during documentation cleanup:

```bash
npm run typecheck
npm run test
npm run build
```

Result: 20 test files passed, 110 tests passed.

## Milestone Summary

### M1 + M2: Project Skeleton and Markdown Storage

- Established Node.js + npm + TypeScript ESM project structure.
- Added `aiwiki init`.
- Added `.aiwiki/` layout generation, config loading, Markdown frontmatter helpers, managed writes, and project engineering standards.
- Archived full notes: `docs/archive/implementation-m1-m2.md`.

### M3: Search and Brief

- Added `aiwiki search`.
- Added no-LLM `aiwiki brief`.
- Added Markdown/JSON output handling and brief eval logging.
- Archived full notes: `docs/archive/implementation-m3.md`.

### M4: Guard and Map

- Added `aiwiki guard <file>`.
- Added `aiwiki map`.
- Added project scan defaults, generated-file detection, important-directory detection, and high-risk file signals.
- Archived full notes: `docs/archive/implementation-m4.md`.

### M5: Reflect and Ingest

- Added no-LLM `aiwiki reflect`.
- Added `aiwiki ingest <file>` with raw note preservation.
- Kept structured wiki writes preview-only.
- Archived full notes: `docs/archive/implementation-m5.md`.

### M6: Lint and Graph

- Added `aiwiki lint`.
- Added `aiwiki graph build`.
- Added graph JSON and backlinks generation from wiki frontmatter, links, modules, and file references.
- Archived full notes: `docs/archive/implementation-m6.md`.

### M7: Rule Promotion Preview

- Added `aiwiki promote-rules`.
- Generated rule promotion candidates from repeated high-severity pitfalls.
- Kept rule promotion preview-only.
- Archived full notes: `docs/archive/implementation-m7.md`.

### M8: Task Continuity

- Added `aiwiki task start`, `task list`, `task status`, `task close`, `checkpoint`, and `resume`.
- Created `.aiwiki/tasks/<task-id>/` task files and active task pointer.
- Kept task state separate from long-term wiki memory.
- Archived full notes: `docs/archive/implementation-m8.md`.

### M9: Decisions and Blockers

- Added `aiwiki decision`.
- Added `aiwiki blocker`.
- Stored decisions and blockers as task events, not confirmed long-term wiki memory.
- Archived full notes: `docs/archive/implementation-m9.md`.

### M10: Confirmed Apply

- Added `aiwiki apply <plan.json>`.
- Added `WikiUpdatePlan` schema, dry-run preview, confirmed writes, index rebuild, log append, and graph rebuild.
- Kept long-term wiki writes behind explicit `--confirm`.
- Archived full notes: `docs/archive/implementation-m10.md`.

### M11: Update Plan Drafts

- Added `updatePlanDraft` output to reflect, ingest, and promote-rules flows.
- Added operation source labels for apply previews.
- Improved changed-file path module inference.
- Archived full notes: `docs/archive/implementation-m11.md`.

### M12: Output Plan and Apply Preview

- Added `--output-plan` to reflect and ingest.
- Improved apply dry-run review details.
- Preserved non-overwrite defaults for output plans.
- Archived full notes: `docs/archive/implementation-m12.md`.

### M13: Architecture Audit

- Added `aiwiki architecture audit`.
- Added architecture context for brief and guard workflows.
- Reported large files, hardcoding risks, high-risk file paths, and missing high-risk module memory.
- Archived full notes: `docs/archive/implementation-m13.md`.

### M14: Module Porting Packs

- Added portable module memory pack export.
- Added module pack import preview and output plan generation.
- Added module-specific brief and lint workflows.
- Kept module migration preview-first and code-copy resistant.
- Archived full notes: `docs/archive/implementation-m14.md`.
