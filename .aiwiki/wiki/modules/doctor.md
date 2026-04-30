---
type: module
title: Doctor
status: active
modules:
  - doctor
files:
  - src/doctor.ts
  - tests/doctor.test.ts
tags:
  - memory-governance
  - daily-command
risk: high
last_updated: '2026-04-30'
---
# Module: Doctor

`doctor` is the read-only memory governance command for long-running projects. It summarizes lint health, stale memory, repeated pitfall rule-promotion candidates, page status distribution, and next actions.

Codex should run `aiwiki doctor` near the end of AIWiki-affecting tasks and report whether memory is healthy, stale, or waiting for user-reviewed updates.

Related memory: [[./agent.md]], [[../rules/preview-first-memory-updates.md]].
