---
type: rule
title: Preview-first memory updates
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
# Rule: Preview-first memory updates

Memory maintenance may propose changes, but wiki pages are not rewritten until the user reviews and confirms an apply plan.

`--force` may refresh managed defaults, but it must not delete user-created files.

Related memory: [[./local-first-writes.md]], [[../modules/apply.md]].
