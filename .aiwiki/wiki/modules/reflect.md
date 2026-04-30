---
type: module
title: Reflect
status: active
modules:
  - reflect
files:
  - src/reflect.ts
  - src/staleness.ts
  - tests/reflect.test.ts
tags:
  - memory-maintenance
  - preview-first
risk: high
last_updated: '2026-04-30'
---
# Module: Reflect

`reflect` turns notes and git diff signals into preview-first memory update candidates. It must never rewrite wiki pages directly; reviewed changes go through `apply`.

When changed files match wiki `files` frontmatter, reflect should suggest refreshing those existing pages instead of creating duplicate long-term memory.

Related memory: [[../rules/preview-first-memory-updates.md]], [[../decisions/markdown-first.md]].
