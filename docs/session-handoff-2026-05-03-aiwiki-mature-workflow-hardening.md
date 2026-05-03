# Session Handoff: AIWiki Mature Workflow Hardening

Date: 2026-05-03

## Current Status

This slice hardened AIWiki from a useful Codex-owned alpha workflow into a more
trustworthy local CLI product. The core loop now makes confidence, write mode,
index freshness, and sparse-repository assumptions explicit.

The product model to preserve is:

```text
Human user
  -> describes work naturally
  -> Codex runs AIWiki for context, guardrails, and task state
  -> AIWiki separates strong memory from weak hints
  -> Codex edits code, tests, reflects, and reports memory health
```

## Implemented In This Slice

### Brief Confidence Tiers

`brief` now keeps high-confidence context in `Must Read` and moves weaker recall
to `Memory Hints`. Both `brief` and `guard` report `Memory Coverage` so sparse
memory is explicit before Codex treats output as constraints.

Implemented files:

- `src/brief.ts`
- `src/guard.ts`
- `tests/brief.test.ts`
- `tests/guard.test.ts`

### Agent And Resume Mode Boundaries

`agent`, `codex`, and `resume` now make read-only versus write mode clearer.
Read-only agent runs do not start or claim tasks or bootstrap project-map state.
Runbooks and resume briefs include mode-boundary guidance for Codex.

Implemented files:

- `src/agent.ts`
- `src/codex.ts`
- `src/task.ts`
- `tests/agent.test.ts`
- `tests/codex.test.ts`
- `tests/task.test.ts`

### SQLite FTS/BM25 With Markdown Fallback

Indexed search now uses the SQLite FTS table with BM25 ranking when the derived
index is fresh. It still scores all indexed pages to preserve Markdown-style
substring recall, and it falls back to Markdown search when the index is stale,
corrupt, missing, or FTS-drifted.

Implemented files:

- `src/search.ts`
- `src/hybrid-index.ts`
- `src/output.ts`
- `tests/search.test.ts`
- `tests/hybrid-index.test.ts`

### Apply Preview Freshness

`apply` preview writes confirmation freshness state under
`.aiwiki/cache/apply-previews`. Confirmed apply requires a fresh matching preview
and refuses append writes if the target wiki page changed after preview.

Implemented files:

- `src/apply.ts`
- `src/cli.ts`
- `tests/apply.test.ts`

### Large-Repo Eval Strictness

`eval large-repos` now verifies that generated guard targets exist in the sparse
checkout and are covered by fixture sparse paths. Cached sparse fixtures passed
for Django, Spring, TypeScript, React, and curl.

Implemented files:

- `src/large-repo-eval.ts`
- `tests/large-repo-eval.test.ts`

## Verification

The following checks passed on 2026-05-03:

```bash
npm run release:check
npm run dev:aiwiki -- eval large-repos --skip-clone --format json
npm run dev:aiwiki -- eval usability --format json
npm run dev:aiwiki -- doctor --format json
npm run dev:aiwiki -- index status --format json
```

Verification result highlights:

- `release:check`: typecheck, 214 tests, build, and npm pack dry-run passed.
- `eval large-repos`: 5 sparse fixtures passed.
- `eval usability`: passed.
- `doctor`: 0 lint errors, 0 lint warnings, 0 stale warnings; 2 rule-promotion
  candidates remain informational.
- `index status`: fresh.

## Product Assessment

AIWiki now meets the current Codex requirements for the local-first CLI loop:

- ordinary users can stay in natural language;
- Codex has a clear `prime` / `agent` / `guard` / `reflect` / `doctor` path;
- weak memory recall no longer becomes a false must-read instruction;
- confirmed memory writes are protected by preview freshness;
- indexed search is fast but still rebuildable and subordinate to Markdown;
- large-repository evals protect sparse checkout assumptions.

The remaining work is polish rather than a blocker for the current product line:

- tune `architecture audit` evidence and false-positive severity;
- broaden real-project Chinese/Unicode dogfood beyond tokenizer fixtures;
- review doctor rule-promotion candidates before making new active rules;
- keep `reflect --from-git-diff` candidate specificity under dogfood.

## Memory State

This handoff and the `.aiwiki/wiki/` page updates were edited directly during
the knowledge cleanup. No `aiwiki apply --confirm` was run.
