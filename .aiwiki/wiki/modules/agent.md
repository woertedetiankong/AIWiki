---
type: module
title: Agent
status: active
modules:
  - agent
  - codex
files:
  - src/agent.ts
  - src/codex.ts
  - tests/agent.test.ts
  - tests/codex.test.ts
tags:
  - daily-command
  - codex-autopilot
risk: high
last_updated: '2026-04-30'
---
# Module: Agent

`agent` provides compact read-only task context. `codex` wraps that context in an explicit runbook so Codex can use AIWiki without requiring the user to remember commands.

The product goal is: users describe requirements, Codex runs AIWiki before editing, guards concrete files, reflects after implementation, checks memory health with `doctor`, and only confirms memory writes after explicit user approval.

Related memory: [[../pitfalls/command-noise.md]], [[../rules/preview-first-memory-updates.md]].
