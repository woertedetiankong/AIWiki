---
type: decision
title: Keep AIWiki Markdown-first
status: active
modules:
  - apply
  - search
  - reflect
files:
  - src/markdown.ts
  - src/wiki-store.ts
last_updated: '2026-04-30'
---
# Decision: Keep AIWiki Markdown-first

AIWiki stores durable memory as local Markdown with frontmatter because it is inspectable, editable, versionable, and easy for coding agents to quote.

Use JSON and JSONL for plans, graphs, evals, and event logs where structured data is needed.

Related memory: [[../rules/local-first-writes.md]], [[../modules/search.md]].
