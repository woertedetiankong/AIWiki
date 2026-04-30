---
type: module
title: Brief
status: active
modules:
  - brief
files:
  - src/brief.ts
  - tests/brief.test.ts
tags:
  - daily-command
  - context
risk: high
last_updated: '2026-04-30'
---
# Module: Brief

`brief` is the main task-preparation command for coding agents. It combines wiki search results, discovered source or Markdown entry files, staleness warnings, and architecture guidance into compact Markdown or JSON.

Keep `src/brief.ts` service-owned. CLI code should only parse options and print output. Use `--read-only` when Codex only needs context because normal brief runs append log and eval records.

Related memory: [[../rules/thin-command-handlers.md]], [[../pitfalls/empty-memory-output.md]], [[./agent.md]].
