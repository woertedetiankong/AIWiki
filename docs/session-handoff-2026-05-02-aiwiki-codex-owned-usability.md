# Session Handoff: AIWiki Codex-Owned Usability Optimization

Date: 2026-05-03

## Current Status

This handoff was originally written on 2026-05-02 as the plan for improving
AIWiki as a Codex-owned workflow. The planned slice has now been implemented and
verified.

The product model to preserve is:

```text
Human user
  -> describes product or code work in natural language
  -> Codex chooses and runs the right AIWiki commands
  -> AIWiki returns local memory, guardrails, task state, and reviewable updates
  -> Codex edits code and reports the result
```

Ordinary users should not need to memorize `aiwiki` commands. AIWiki should make
Codex more reliable on long-lived projects by surfacing local memory, avoiding
known pitfalls, preserving task continuity, and proposing reviewed memory
updates after work.

## Implemented In This Slice

### Codex-Owned Workflow Eval

Added a hidden maintainer eval:

```bash
aiwiki eval usability [--scenario <name...>] [--format markdown|json]
```

The eval uses temporary local projects and does not call a remote LLM provider.
It covers:

- `resume-first`: a natural-language continuation request should surface the
  active task and resume next action before broad implementation.
- `guard-payment-precision`: generic advisory text in a non-payment file should
  not trigger the money/payment warning, while real checkout amount/currency code
  remains guarded.
- `module-import-preview`: imported module memory remains proposed and preview
  only.
- `maintainability-request`: Codex runbooks surface hardcoding guidance,
  architecture boundaries, compact next commands, and source-file guard targets.

Implemented files:

- `src/usability-eval.ts`
- `tests/usability-eval.test.ts`
- `src/cli.ts`
- `src/index.ts`
- `package.json`

### Payment Guard Precision

Fixed the noisy payment false positive from `aiwiki guard src/brief.ts`.

The money/payment semantic risk rule now requires path or code evidence such as
payment/checkout/billing/webhook paths, amount/currency handling, or provider
flow identifiers. Generic documentation, prompt, regex, or advisory text in
non-payment files no longer triggers the payment-flow warning.

Implemented files:

- `src/risk-rules.ts`
- `tests/risk-rules.test.ts`
- `tests/guard.test.ts`

### Codex Runbook and Agent Wording

Updated `agent` and Codex runbooks so they speak to Codex as the operator rather
than asking the human user to choose a long command sequence.

Important wording now preserved in output:

- The user only needs to describe the requirement.
- Codex chooses the AIWiki commands.
- Team runbooks guide Codex-managed implementer, reviewer, and memory-steward
  roles; AIWiki does not create or schedule agents.

Implemented files:

- `src/agent.ts`
- `src/codex.ts`
- `tests/agent.test.ts`
- `tests/codex.test.ts`

### Shell-Safe Generated Commands

Generated `aiwiki agent` and Codex runbook commands now shell-quote task text
safely. This protects copied commands containing quotes, apostrophes, dollar
substitution, or other shell-sensitive characters.

Implemented files:

- `src/shell-quote.ts`
- `src/agent.ts`
- `src/codex.ts`
- `tests/agent.test.ts`
- `tests/codex.test.ts`

### Source-First Guard Target Ranking

Dirty working-tree guard targets are now ranked so source files surface before
low-signal docs, package metadata, generated artifacts, and runtime files. This
keeps `prime` and team runbooks focused when many files are dirty.

Implemented files:

- `src/git-guard-targets.ts`
- `src/prime.ts`
- `src/codex.ts`
- `tests/prime.test.ts`
- `tests/codex.test.ts`

### Cold-Start Memory Semantics

Clarified that a new project starts with AIWiki workflow scaffolding and built-in
generic guardrails, not fabricated historical lessons.

Cold-start `brief`, `guard`, and `agent --no-task --no-map` were checked against
an empty project. They do not claim project-specific rules, pitfalls, or module
memory exist when `.aiwiki/wiki/` is empty.

Implemented files:

- `src/brief.ts`
- `tests/brief.test.ts`
- `README.md`

### Reflect Candidate Specificity

Reduced generic `reflect --from-git-diff` memory noise. Reflect no longer drafts
module memories or append entries solely because a path changed unless there are
explicit notes, high-risk evidence, or a concrete reusable lesson.

The current preview plan from this slice contains only two entries:

- skip existing `wiki/modules/prime.md`
- create proposed `wiki/modules/schema.md`

The plan was previewed with `aiwiki apply`; no `apply --confirm` was run.

Implemented files:

- `src/reflect.ts`
- `tests/reflect.test.ts`
- `README.md`

## Verification

The following checks passed on 2026-05-03:

```bash
npm run typecheck
npm run test
npm run build
npm run dev:aiwiki -- eval usability
```

Full test result:

```text
31 test files passed
197 tests passed
```

Dogfood and memory maintenance checks run:

```bash
npm run dev:aiwiki -- guard src/brief.ts
npm run dev:aiwiki -- guard src/risk-rules.ts
npm run dev:aiwiki -- guard src/guard.ts
npm run dev:aiwiki -- reflect --from-git-diff --output-plan .aiwiki/context-packs/codex-owned-usability-loop-reflect-plan.json --force --format json
npm run dev:aiwiki -- apply .aiwiki/context-packs/codex-owned-usability-loop-reflect-plan.json --format json
npm run dev:aiwiki -- doctor --format json
```

Doctor result:

```text
lint errors: 0
lint warnings: 0
stale warnings: 32
rule promotion candidates: 2
proposed pages: 1
```

## Current Working Tree

The repository intentionally contains uncommitted implementation and docs work.

Modified tracked files include:

- `README.md`
- `CHANGELOG.md`
- `SPEC.md`
- `SPEC-FUTURE.md`
- `AGENTS.md`
- `.aiwiki/AGENTS.md`
- `docs/next-development-plan.md`
- `docs/session-handoff-2026-05-02-aiwiki-codex-owned-usability.md`
- `prd.md`
- `package.json`
- `src/agent.ts`
- `src/brief.ts`
- `src/cli.ts`
- `src/codex.ts`
- `src/index.ts`
- `src/prime.ts`
- `src/reflect.ts`
- `src/risk-rules.ts`
- matching tests

Untracked implementation/test files include:

- `src/git-guard-targets.ts`
- `src/shell-quote.ts`
- `src/usability-eval.ts`
- `tests/usability-eval.test.ts`

Local runtime artifact:

- `.aiwiki/context-packs/codex-owned-usability-loop-reflect-plan.json`

The runtime artifact is a preview plan only and should stay out of commits unless
the user explicitly wants to preserve it.

## Memory State

Two task checkpoints were recorded in local AIWiki task state:

- `Agent-team polish: prioritized guard targets and shell-safe commands`
- `Clarified cold-start memory versus generic guardrails and reduced generic reflect candidates`

The reflect/apply preview did not confirm durable wiki memory. Long-term
`.aiwiki/wiki/` updates still require explicit user review and `apply --confirm`.

## Remaining Work

Good next implementation targets:

1. Improve Chinese/Unicode retrieval for `search`, `brief`, and `guard`.
2. Tune `architecture audit` line-level evidence and false-positive severity.
3. Continue real-project dogfood when changing ranking, scan heuristics, or
   Codex-owned workflow output.
4. Keep improving `reflect --from-git-diff` specificity only when dogfood reveals
   generic candidate text.

Avoid:

- Web UI.
- MCP.
- Cloud sync.
- Default remote LLM calls.
- Broad refactors before eval or dogfood coverage protects the behavior.
- `aiwiki apply --confirm` without explicit reviewed approval.
