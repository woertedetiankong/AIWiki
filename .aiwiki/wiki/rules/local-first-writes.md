---
type: rule
title: Local-first writes only
status: active
modules:
  - apply
  - reflect
files:
  - src/apply.ts
  - src/reflect.ts
severity: high
last_updated: '2026-04-30'
---
# Rule: Local-first writes only

Do not send code, diffs, notes, or wiki content to remote providers unless a command and configuration make that explicit.

AIWiki defaults to local Markdown, JSON, and JSONL workflows.

Related memory: [[../decisions/markdown-first.md]], [[./preview-first-memory-updates.md]].
