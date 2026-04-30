---
type: module
title: Apply
status: active
modules:
  - apply
files:
  - src/apply.ts
  - tests/apply.test.ts
tags:
  - preview-first
  - writes
risk: high
last_updated: '2026-04-30'
---
# Module: Apply

`apply` is the reviewed write path for AIWiki memory update plans. Preview mode must show exact operations; confirmed mode may write wiki pages, index, log, and graph updates.

Never let `--force` or confirmation delete user-created memory pages as part of routine updates.

Related memory: [[../rules/preview-first-memory-updates.md]], [[../rules/local-first-writes.md]].
