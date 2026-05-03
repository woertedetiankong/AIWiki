# Session Handoff: Session-To-Memory Preview

Date: 2026-05-03

## Current Status

AIWiki now has a conservative first slice for the user's core pain point:
capturing explicit coding-session lessons without creating another pile of
unmaintained documents.

The workflow is:

```text
Local Codex/Claude JSONL traces
  -> aiwiki session scan
  -> aiwiki session reflect --output-plan <path>
  -> aiwiki apply <path>
  -> user-reviewed apply --confirm only after approval
```

## Implemented

### Session Service

`src/session.ts` reads Codex and Claude JSONL traces, normalizes session records,
filters by current project `cwd`, and extracts conservative pitfall/decision
signals.

Important safety behavior:

- system/developer prompts are ignored;
- tool outputs are not used as candidate memory;
- test logs, subagent notifications, and broad chat summaries are filtered;
- candidate extraction requires explicit language such as `踩坑：`, `根因`,
  `pitfall`, `root cause`, or `decision`;
- generated update-plan entries are `proposed`;
- no wiki page is written by the session workflow itself.

### CLI Surface

New daily commands:

```bash
aiwiki session scan [--provider codex|claude]
aiwiki session reflect [--provider codex|claude] [--output-plan <path>]
```

Both commands support `--path`, `--since`, `--limit`, `--all-projects`, and
Markdown/JSON output. `session reflect --read-only` rejects `--output-plan`
because output plans are filesystem writes.

### Tests And Docs

Added focused tests in `tests/session.test.ts` covering current-project
matching, preview-plan generation, and read-only output-plan rejection. Updated
README, PRD, SPEC, SPEC-FUTURE, CHANGELOG, AGENTS guidance, and AIWiki memory.

## Dogfood Findings

The first dogfood run was intentionally useful: broad words like "fix", "should",
"痛点", and regular explanatory chat created noisy candidates. The extractor was
tightened so ordinary product discussion does not become long-term memory. On
the current AIWiki session, `session reflect --read-only` reports no candidates
unless explicit structured pitfall/decision language exists.

This is the right default: false negatives are better than polluting project
memory with generic chat.

## Verification

Passed on 2026-05-03:

```bash
npm run typecheck
npm run test
npm run build
node --import ./node_modules/tsx/dist/loader.mjs src/cli.ts session scan --provider codex --since 1d --limit 2
node --import ./node_modules/tsx/dist/loader.mjs src/cli.ts session reflect --provider codex --since 1d --limit 5 --read-only
aiwiki reflect --from-git-diff --read-only
aiwiki doctor
aiwiki lint
```

Full test result: 33 files passed, 217 tests passed.

## Next Work

- Improve extraction precision from reviewed real session traces.
- Add provider adapters only when trace formats are stable and tests can cover
  them.
- Consider prompting agents to emit short structured `踩坑：/根因/修复方式`
  snippets when a reusable lesson is discovered.
- Keep the workflow preview-first; do not add a daemon or automatic confirmed
  memory writes.
