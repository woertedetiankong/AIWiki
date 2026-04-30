---
type: module
title: Search
status: active
modules:
  - search
files:
  - src/search.ts
  - src/output.ts
  - tests/search.test.ts
tags:
  - retrieval
  - unicode
risk: medium
last_updated: '2026-04-30'
---
# Module: Search

Search ranks Markdown memory pages by title, frontmatter, path, and body matches. It must preserve path-friendly English tokens while supporting Unicode and CJK queries such as `编码 工作流`.

Ranking changes affect `brief`, `guard`, `reflect`, `search`, and `agent`, so keep tests broad when changing tokenizer or scoring behavior.

Related memory: [[../pitfalls/weak-search-ranking.md]], [[../decisions/markdown-first.md]].
