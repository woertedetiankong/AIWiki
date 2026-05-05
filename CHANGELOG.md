# AIWiki Changelog

This file summarizes the implementation history that used to live in root-level
`implementation-m*.md` files. Full milestone notes are archived under `docs/archive/`.

## 2026-05-04

### npm 0.2.0 Release: Offline Hybrid Retrieval

- Added local-first semantic retrieval that fuses dense-vector cosine similarity with FTS BM25, plus length normalization, hard min-score, and near-duplicate dedup. Markdown under `.aiwiki/wiki/` remains the source of truth and embeddings are derived data.
- Bundled the quantized `Xenova/multilingual-e5-small` model through `@huggingface/transformers`. The model downloads lazily on first `aiwiki index build` (~80MB) into `.aiwiki/cache/models/`; `npm install` and `aiwiki init` do not require network access.
- Bumped the SQLite index to schema v2 with a new `wiki_page_embeddings` table. Older `v1` indexes are detected and rebuilt automatically; embeddings stay derived data and are dropped/rebuilt on schema change.
- Made `search`, `brief`, `guard`, `reflect`, and `ingest` automatically benefit from hybrid retrieval when the index is fresh and an embedder is available, with three-layer fallback (hybrid → BM25 → Markdown) when prerequisites are missing.
- Added a `summary` field to wiki page frontmatter (≤500 chars) so semantic input includes a curated description; existing pages keep working without the field.
- Added `aiwiki search --mode auto|bm25|hybrid|markdown` and `aiwiki index build --no-embeddings` for explicit control over the retrieval path. `aiwiki index status` now reports embedding coverage, embedding freshness, and the embedding model id.
- Added a `semantic` config block under `.aiwiki/config.json` (`enabled`, `model`, `cacheDir`, `vectorWeight`, `bm25Weight`, `minScore`, `lengthNormAnchor`, `dedupThreshold`) so users can tune or disable the hybrid path. Defaults: `enabled=true`, weights 0.7 / 0.3, min score 0.35, length anchor 500, dedup threshold 0.92.
- Updated `aiwiki init` to surface a one-time warning explaining that semantic retrieval is enabled by default and that `aiwiki index build` triggers the model download.
- Documented the new contract in `README.md`, `SPEC.md` (§4 Search Layer, §6.2 search, §6.2a index, §3.3 dependencies), `SPEC-FUTURE.md` §7 (rescoped to remaining backlog), and `prd.md`.
- Verified with `npm run release:check`, `npm run typecheck`, the full vitest suite (247 tests), and the new `tests/embedder.test.ts`, `tests/hybrid-index.test.ts`, and hybrid scenarios in `tests/search.test.ts`.

## 2026-05-03

### npm 0.1.4 Release

- Published `@superwoererte/aiwiki@0.1.4` to npm and pushed the matching `v0.1.4` Git tag.
- Shipped the session-to-memory preview workflow as the current npm `latest` release.
- Polished apply previews so plans without an explicit summary show the first useful Markdown body line as the plain-language meaning.
- Updated Codex runbooks so projects outside Git repositories receive notes-based reflection guidance instead of unusable `--from-git-diff` commands.
- Verified with `npm run release:check`, npm `prepublishOnly`, `npm view @superwoererte/aiwiki version`, and `node dist/cli.js --version`; all report `0.1.4`.

### Session-To-Memory Preview

- Added first-class `aiwiki session scan` and `aiwiki session reflect` commands for local Codex and Claude JSONL traces.
- Matched session traces to the current project by recorded `cwd`, with `--all-projects` available for diagnostics.
- Kept session-derived memory preview-first: session reflection creates proposed update-plan entries and never writes `.aiwiki/wiki/` pages directly.
- Filtered system/developer prompts, tool outputs, test logs, subagent notifications, and broad chat summaries so explicit `踩坑：`, `根因`, `pitfall`, `root cause`, and decision signals are required before candidates appear.
- Documented the session workflow in README, PRD, SPEC, future/backlog docs, and AIWiki project memory.
- Verified with `npm run typecheck`, `npm run test`, `npm run build`, `aiwiki session scan --provider codex --since 1d --limit 2`, `aiwiki session reflect --provider codex --since 1d --limit 5 --read-only`, `aiwiki reflect --from-git-diff --read-only`, `aiwiki doctor`, and `aiwiki lint`.

### Mature Workflow Hardening

- Split `brief` retrieval into high-confidence `Must Read` memory and lower-confidence `Memory Hints`, so weak recall no longer reads as mandatory implementation guidance.
- Added `Memory Coverage` wording to `brief` and `guard` so sparse project memory is explicit instead of pretending AIWiki has target-specific lessons.
- Clarified `agent`, `codex`, and `resume` read-only/write mode boundaries; read-only agent runs now avoid task and project-map writes, while normal agent runs prepare workflow state for Codex.
- Hardened team runbooks and guard targets so generated guard commands reference files that actually exist.
- Upgraded indexed search to use the derived SQLite FTS table with BM25 ranking while preserving Markdown-style substring recall, and made stale, corrupt, or drifted FTS indexes automatically fall back to Markdown search.
- Added apply preview freshness state under `.aiwiki/cache/apply-previews`; confirmed apply now requires a fresh preview and refuses append writes if the target page changed after preview.
- Strengthened `aiwiki eval large-repos` so guard targets must exist inside the sparse checkout and be covered by fixture sparse paths.
- Verified the hardened loop with `npm run release:check`, `npm run dev:aiwiki -- eval large-repos --skip-clone --format json`, `npm run dev:aiwiki -- eval usability --format json`, `npm run dev:aiwiki -- doctor --format json`, and `npm run dev:aiwiki -- index status --format json`.

## 2026-05-02

### Codex-Owned Usability Loop

- Added a hidden `aiwiki eval usability` maintainer loop covering natural-language resume, payment guard precision, module import preview safety, and maintainability/hardcoding requests.
- Tuned money/payment semantic risk detection so generic advisory text in non-payment files no longer triggers payment-flow warnings, while real checkout/amount/currency paths remain guarded.
- Updated `agent` and Codex runbooks so AIWiki reads as Codex-owned workflow support, not a command list the human user must operate.
- Added shell-safe quoting for generated AIWiki commands.
- Ranked dirty working-tree guard targets so changed source files surface before low-signal docs, package metadata, and runtime artifacts.
- Clarified cold-start behavior: AIWiki starts with workflow scaffolding and built-in generic guardrails, not fabricated project history.
- Reduced generic `reflect --from-git-diff` memory candidates so update plans prefer concrete reusable lessons over append text such as "Reflection candidate for X".
- Added `aiwiki maintain` as a Codex-owned memory maintenance review that combines doctor checks, read-only reflection, optional output-plan generation, stale-page refresh append proposals, and explicit apply-confirmation safety.
- Verified the loop with `npm run typecheck`, `npm run test`, `npm run build`, and `npm run dev:aiwiki -- eval usability`.

### npm Release

- Published the first public npm package as `@superwoererte/aiwiki@0.1.0`.
- Kept the installed CLI binary as `aiwiki` even though the npm package is
  scoped.
- Documented that the unscoped `aiwiki` package name is blocked by npm because
  it is too similar to the existing `ai-wiki` package.
- Added MIT licensing and finalized package metadata for public distribution.
- Verified registry installation from a clean directory with
  `npm install @superwoererte/aiwiki@latest`, `npx aiwiki --version`,
  `npx aiwiki init --project-name registry-smoke`, and
  `npx aiwiki index build`.
- Kept SQLite indexing as a core feature through `better-sqlite3`; the
  `prebuild-install` deprecation warning is expected during installation and is
  non-blocking when the install and SQLite smoke test pass.
- Updated release smoke CI so scoped package tarballs such as
  `superwoererte-aiwiki-0.1.0.tgz` install correctly on macOS, Windows, and
  Linux across Node.js 20, 22, and 24.

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
