# AIWiki Next Development Plan

Status: Working plan based on local dogfood feedback.
Date: 2026-04-29

This document turns recent AI coding-agent feedback into an implementation
roadmap. It is intentionally narrower than `SPEC-FUTURE.md`: the goal is to make
the current local CLI workflow useful every day before expanding into larger
systems.

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
aiwiki brief "<task>"
aiwiki guard <file>
aiwiki checkpoint ...
aiwiki resume
aiwiki reflect --from-git-diff
```

These commands should stay short, stable, and highly tested. Most AI coding
sessions should not need to know about graph, module portability, rule
promotion, or import/export commands.

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

Current `.aiwiki/` memory has a project map, but no durable module, pitfall,
decision, pattern, or rule pages. That makes `brief` and `guard` safe but too
generic.

Build a reviewed memory seed for this repository:

- module pages for `brief`, `guard`, `search`, `reflect`, `apply`, `task`,
  `architecture`, and `module-pack`;
- pitfall pages for known false positives, weak ranking cases, empty-memory
  output, and command noise;
- rule pages for local-first writes, preview-first memory updates, and keeping
  command handlers thin;
- decision pages for why AIWiki stays Markdown-first and why advanced systems
  remain optional.

Acceptance criteria:

- `aiwiki brief "improve Codex coding workflow"` returns real project memory,
  not only generic architecture advice.
- `aiwiki guard src/brief.ts` and `aiwiki guard src/search.ts` surface specific
  risks and related tests.
- `aiwiki lint` passes after the memory pages are added.

## Priority 2: Improve Chinese and Unicode Retrieval

Chinese tasks currently lose most search value because the tokenizer only keeps
ASCII-style tokens. This makes `aiwiki search "编码 工作流"` return no useful
results even when the user is asking a meaningful question.

Planned work:

- replace the current search tokenizer with a Unicode-aware tokenizer;
- preserve path-friendly tokens for source files;
- add simple CJK matching, likely character bigrams or substring fallback;
- add tests for Chinese titles, Chinese body text, and mixed Chinese/English
  file references.

Acceptance criteria:

- Chinese queries can match Chinese wiki page titles and bodies.
- Mixed queries such as `Codex 编码 工作流` still match English source references.
- Existing English/path search tests continue to pass.

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

The command list is broad. AI agents need one obvious default command that
collects the right context without making them choose between many subcommands.

Candidate command:

```bash
aiwiki agent "<task>"
```

Possible behavior:

- internally runs a compact `brief`;
- includes architecture guard signals when useful;
- suggests the top files where `guard` should be run next;
- prints the next 2-3 commands, not the entire command surface;
- supports `--read-only` so context gathering can avoid runtime writes.

Acceptance criteria:

- A new user can run one command and understand the next action.
- Output fits in roughly one terminal screen.
- The command does not hide or bypass safety semantics from `brief` and `guard`.

## Priority 5: Make Guardrails More Specific

`guard` is valuable when memory exists, but it should also help when memory is
sparse.

Planned work:

- detect nearby test files and suggest concrete test commands;
- include related implementation files based on filename, imports, or project
  map signals;
- surface whether the target file is large or central;
- recommend a file note path only when it is likely useful.

Acceptance criteria:

- `aiwiki guard src/brief.ts` suggests relevant tests such as
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
- AI-facing docs emphasize the five daily commands first.

## Priority 7: Reflect-Driven Freshness

`reflect --from-git-diff` should help keep memory current when code changes.

Planned work:

- map changed files back to related wiki pages;
- suggest refresh entries for pages whose `files` frontmatter references changed
  code;
- keep the result preview-first through `apply`;
- avoid promoting one-off implementation details into rules.

Acceptance criteria:

- Changed files produce candidate memory refreshes when related pages exist.
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

1. Add reviewed `.aiwiki/wiki` seed memory for this repository.
2. Fix Unicode and Chinese retrieval.
3. Tune `architecture audit` findings and add line-level evidence.
4. Improve `guard` test/file specificity.
5. Add or prototype `aiwiki agent "<task>"`.
6. Tighten README and dev command ergonomics.
7. Extend `reflect --from-git-diff` freshness suggestions.

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
```

The work is not done if the output is technically correct but too noisy for a
coding agent to use quickly.
