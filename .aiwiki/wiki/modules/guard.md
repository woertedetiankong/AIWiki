---
type: module
title: Guard
status: active
modules:
  - guard
files:
  - src/guard.ts
  - tests/guard.test.ts
tags:
  - daily-command
  - safety
risk: high
last_updated: '2026-04-30'
---
# Module: Guard

`guard` prepares file-specific editing constraints. It should surface matching rules, pitfalls, decisions, staleness warnings, related files, focused tests, and architecture signals without pretending sparse memory knows more than it does.

Guard output must stay short enough to paste into an AI coding session before editing a file.

Related memory: [[../pitfalls/command-noise.md]], [[../rules/preview-first-memory-updates.md]].
