---
type: module
title: Architecture
status: active
modules:
  - architecture
files:
  - src/architecture.ts
  - tests/architecture.test.ts
tags:
  - audit
  - portability
risk: medium
last_updated: '2026-04-30'
---
# Module: Architecture

Architecture audit and brief guardrails are advisory signals for portability, hardcoding, large files, and missing module memory. High-severity findings should be rare and backed by line-level evidence.

Avoid turning ordinary product terms or test fixtures into secret warnings; false positives make agents ignore the audit.

Related memory: [[../pitfalls/audit-false-positive-secrets.md]], [[../rules/thin-command-handlers.md]].
