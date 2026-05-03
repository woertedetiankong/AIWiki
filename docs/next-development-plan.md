# AIWiki Next Development Plan

Status: Working plan based on local dogfood feedback.
Date: 2026-04-29
Last reviewed: 2026-05-03

This document turns recent AI coding-agent feedback into an implementation
roadmap. It is intentionally narrower than `SPEC-FUTURE.md`: the goal is to make
the current local CLI workflow useful every day before expanding into larger
systems.

## Release Baseline

AIWiki is published on npm as `@superwoererte/aiwiki`. The package is scoped
because npm blocks the unscoped `aiwiki` name as too similar to `ai-wiki`; the
installed binary remains `aiwiki`. The first published version was `0.1.0`; the
source checkout is preparing the next hardened CLI iteration.

The 2026-05-02 release smoke baseline passed for macOS, Windows, and Linux
across Node.js 20, 22, and 24. Registry smoke also passed from a clean directory
with `npm install @superwoererte/aiwiki@latest`, `npx aiwiki --version`,
`npx aiwiki init --project-name registry-smoke`, and `npx aiwiki index build`.
The remaining `prebuild-install` deprecation warning from `better-sqlite3` is
accepted as non-blocking for now.

## Product Direction

AIWiki should feel like a compact local memory tool for coding agents:

- quick to run before a task;
- clear about which files, rules, and pitfalls matter;
- safe around user-owned `.aiwiki/` data;
- useful even when the user asks in Chinese;
- boring and reliable enough to use on every project.

The main near-term problem is not that AIWiki lacks features. The main problem
is that the command surface is already broad while the highest-value daily path
still needs sharper retrieval, better memory density, and clearer defaults.

## Command Strategy

Keep the full command surface, but make the everyday path obvious.

### Daily AI Coding Commands

These should be treated as the primary workflow:

```bash
aiwiki prime
aiwiki agent "<task>"
aiwiki brief "<task>"
aiwiki guard <file>
aiwiki checkpoint ...
aiwiki resume
aiwiki reflect --from-git-diff
```

These commands should stay short, stable, and highly tested. Most AI coding
sessions should not need to know about graph, module portability, rule
promotion, or import/export commands.

### Local Work Graph Commands

The Beads-inspired work graph is now part of the everyday Codex loop, but it
stays local and lightweight:

```bash
aiwiki task create "<task>" --priority 1
aiwiki task ready
aiwiki task claim <id>
aiwiki task discover "<follow-up>"
aiwiki task dep add <task> <dependency>
```

Claims are coordination hints, not locks. Blocking dependencies only affect
`task ready`; non-blocking `related` and `discovered_from` links preserve context
without turning AIWiki into a full external issue tracker.

### Memory Maintenance Commands

These are useful after work or during project setup:

```bash
aiwiki apply <plan.json>
aiwiki lint
aiwiki map --write
aiwiki search "<query>"
```

They should remain discoverable, but they do not need to be in the first mental
model for a coding agent.

### Advanced Commands

These should be documented as advanced workflows until the core loop is
excellent:

```bash
aiwiki graph ...
aiwiki module ...
aiwiki promote-rules
aiwiki ingest
aiwiki architecture audit
```

They are not useless, but they should not compete with `brief`, `guard`,
`checkpoint`, `resume`, and `reflect` for first-run attention.

## Priority 1: Seed Real Project Memory

Status: completed first slice on 2026-04-30.

The repository now has reviewed `.aiwiki/wiki` memory beyond the project map:

- module pages for `brief`, `guard`, `search`, `reflect`, `apply`, `task`,
  `doctor`, `agent`, `architecture`, and `module-pack`;
- pitfall pages for known false positives, weak ranking cases, empty-memory
  output, and command noise;
- rule pages for local-first writes, preview-first memory updates, and keeping
  command handlers thin;
- decision pages for why AIWiki stays Markdown-first and why advanced systems
  remain optional.

Follow-up acceptance criteria:

- Keep `aiwiki brief "improve Codex coding workflow"` returning project-specific
  memory instead of only generic architecture advice.
- Use `aiwiki reflect --from-git-diff` to preview refresh candidates whenever
  changed files make seeded pages stale.
- Do not confirm long-term wiki updates until the candidate memory has been
  reviewed.

## Priority 2: Improve Chinese and Unicode Retrieval

Status: completed first slice on 2026-05-03.

The basic tokenizer and search path now preserve path-friendly English tokens
while supporting Unicode and CJK queries. `search --index` also uses the derived
SQLite FTS table with BM25 ranking, then preserves Markdown-style recall by
scoring all indexed pages instead of trusting only the FTS hits.

Implemented behavior:

- Unicode-aware query tokenization.
- CJK run and bigram matching for Chinese maintenance and workflow queries.
- Chinese synonym expansion for common AIWiki maintenance concepts.
- SQLite FTS/BM25 ranking for indexed search.
- Markdown fallback when the derived SQLite index is stale, corrupt, missing, or
  FTS-drifted.

Remaining planned work:

- Broaden real-project Chinese dogfood beyond the current tokenizer and fixture
  tests.
- Tune synonym coverage only when repeated user language shows a durable pattern.
- Keep mixed Chinese/English queries useful without overfitting to this repo.

## Priority 3: Reduce Architecture Audit Noise

`architecture audit` is useful, but current hardcoded-literal detection can
over-report normal product terms such as `tokenBudget` or tests that mention
tokens. High-severity warnings should be rare enough that users trust them.

Planned work:

- include line numbers and short matched snippets in audit output;
- split secret-like detection from ordinary configuration literal detection;
- add allowlist support for safe product terms and test fixtures;
- support config overrides for ignored paths or ignored literal patterns;
- tune severities so likely false positives are medium or low, not high.

Acceptance criteria:

- Audit findings point to exact lines.
- `tokenBudget` and similar internal product terms are not reported as secrets.
- Real secret-looking literals still produce high-severity warnings.
- Markdown stays readable and JSON contains full detail.

## Priority 4: Add a First-Class Agent Entry Point

Status: implemented and continuing to refine from dogfood.

The command list is broad. AI agents need one obvious default command that
collects the right context without making them choose between many subcommands.

Implemented commands:

```bash
aiwiki prime
aiwiki agent "<task>"
aiwiki schema all --format json
```

Implemented behavior:

- `agent` internally runs a compact `brief`;
- `agent` now starts or reuses the active AIWiki task and writes a project map
  when one is missing, unless `--no-task` or `--no-map` is used;
- includes architecture guard signals when useful;
- suggests the top files where `guard` should be run next;
- prints the next 2-3 commands, not the entire command surface;
- keeps context lookup read-only, while the CLI entry point owns lightweight
  task/project-map preparation for Codex.
- supports `--read-only` so Codex can gather agent or runbook context without
  task or project-map writes;
- `prime` summarizes active work, ready work, memory health, and next commands.
- `schema` exposes machine-readable task/event/prime contracts.
- generated commands shell-quote task text safely;
- dirty working-tree guard targets are ranked so source files surface before
  low-signal docs, package metadata, and runtime artifacts;
- generated runbook guard targets are filtered to existing project files;
- `agent --runbook --team` is written as a Codex operator checklist, not a human
  command manual.

Acceptance criteria:

- A new user can run one command and understand the next action.
- Output fits in roughly one terminal screen.
- The command does not hide or bypass safety semantics from `brief` and `guard`.

## Priority 5: Make Guardrails More Specific

Status: third slice implemented.

`guard` now helps sparse-memory projects by suggesting nearby tests, reporting
file signals, recommending file notes only for useful targets, and surfacing
built-in semantic change risks.

The 2026-05-03 usability pass fixed a clear trust issue: generic payment or
webhook advisory strings in non-payment files no longer trigger the
money/payment semantic risk warning, while payment paths and amount/currency
handling code are still guarded.

The 2026-05-03 maturity pass also added `Memory Coverage` to `guard`, tightened
runbook guard target existence checks, and made the large-repo eval fail when a
target is missing from or outside a sparse checkout.

Remaining planned work:

- improve related-file detection beyond simple imports and matched memory;
- tune semantic risk wording from real-project dogfood;
- keep cold-start guard output short enough to paste into an agent prompt.

Acceptance criteria:

- `aiwiki guard src/brief.ts` continues to suggest relevant tests such as
  `tests/brief.test.ts`.
- Empty-memory guard output remains short and does not pretend to know more than
  it does.
- File path normalization and project-root safety remain tested.

## Priority 6: Improve Dev and Dogfood Ergonomics

The current local development path works, but `npm run dev -- ...` adds noise
and can be awkward across shells. AI-facing output should be as clean as
possible.

Planned work:

- document the quietest reliable local command for macOS, Linux, and Windows;
- consider adding a `bin/dev-aiwiki` or equivalent local script;
- keep README's first-run path short;
- add examples for read-only usage when Codex only needs context.

Acceptance criteria:

- The recommended dev command works with paths containing spaces.
- Windows PowerShell examples are tested or clearly marked.
- AI-facing docs emphasize the daily Codex loop first.

## Priority 7: Reflect-Driven Freshness

Status: second slice implemented.

`reflect --from-git-diff` now includes untracked files from `git status`, maps
changed files back to related wiki pages, suggests freshness refresh entries,
and extracts concrete work-graph and semantic-risk lessons when local heuristics
can infer them.

The 2026-05-03 usability pass also reduced generic update-plan noise: `reflect`
now avoids creating module drafts or append entries solely because a file path
changed unless there are notes, high-risk evidence, or a concrete reusable
lesson.

Remaining planned work:

- improve generated append text when a refresh candidate is too generic;
- keep the result preview-first through `apply`, whose confirmation now requires
  a fresh preview hash;
- avoid promoting one-off implementation details into rules.

Acceptance criteria:

- Changed files continue to produce candidate memory refreshes when related pages exist.
- No wiki page is rewritten without explicit review and confirmation.
- `brief`, `guard`, and `lint` reuse the same staleness logic.

## Defer For Now

These ideas can remain in `SPEC-FUTURE.md` until the daily loop is stronger:

- Web UI;
- MCP server;
- cloud sync;
- semantic vector index;
- deep-context recursive investigation;
- large graph workflow expansion;
- confirmed module import writes;
- prompt optimizer systems.

They may be valuable later, but they should not distract from making the local
Markdown CLI dependable.

## Suggested Implementation Order

1. Tune `architecture audit` findings and add line-level evidence.
2. Broaden real-project Chinese/Unicode retrieval dogfood beyond tokenizer and
   index basics.
3. Review the current doctor rule-promotion candidates before turning repeated
   pitfalls into active rules.
4. Continue improving `guard` related-file and semantic-risk precision from
   real-project dogfood.
5. Improve Windows/dev command ergonomics only when dogfood reveals a concrete
   copy-paste failure.
6. Keep `reflect --from-git-diff` candidate specificity under the usability and
   dogfood loop instead of adding broad memory automation.

## Verification Checklist

Before calling each slice complete, run:

```bash
npm run typecheck
npm run test
npm run build
```

For Codex-facing workflow changes, also dogfood:

```bash
aiwiki brief "<task>" --read-only
aiwiki guard <changed-file>
aiwiki reflect --from-git-diff --read-only
aiwiki eval usability
aiwiki eval large-repos --skip-clone
aiwiki doctor
```

The work is not done if the output is technically correct but too noisy for a
coding agent to use quickly.
