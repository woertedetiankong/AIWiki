---
type: rule
title: Keep command handlers thin
status: active
modules:
  - cli
files:
  - src/cli.ts
severity: medium
last_updated: '2026-04-30'
---
# Rule: Keep command handlers thin

CLI handlers should parse input, call domain services, and format output. Business logic belongs in focused modules such as `brief`, `guard`, `reflect`, `agent`, or `architecture`.

When adding a command, add a reusable service API and export it from `src/index.ts`.

Related memory: [[../modules/brief.md]], [[../modules/guard.md]].
