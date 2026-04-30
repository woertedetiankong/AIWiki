---
type: pitfall
title: Weak search ranking from ASCII-only tokens
status: active
modules:
  - search
files:
  - src/search.ts
  - tests/search.test.ts
severity: high
encountered_count: 2
last_updated: '2026-04-30'
---
# Pitfall: Weak search ranking from ASCII-only tokens

ASCII-only tokenization makes Chinese tasks such as `编码 工作流` miss useful wiki pages even when memory exists.

Keep CJK and path-friendly token tests together so Unicode fixes do not break source-file retrieval.

Related memory: [[../modules/search.md]].
