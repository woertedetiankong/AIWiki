---
type: module
title: Module Pack
status: active
modules:
  - module-pack
files:
  - src/module-pack.ts
  - tests/module-pack.test.ts
tags:
  - advanced-command
  - portability
risk: medium
last_updated: '2026-04-30'
---
# Module: Module Pack

Module pack commands support advanced export, import preview, module briefs, and module linting. Keep them discoverable but secondary to the daily loop.

Do not let module import bypass preview-first safety or overwrite project memory without explicit confirmation.

Related memory: [[../decisions/advanced-systems-optional.md]], [[../rules/preview-first-memory-updates.md]].
