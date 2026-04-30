---
type: pitfall
title: Command output noise
status: active
modules:
  - brief
  - guard
  - agent
files:
  - src/brief.ts
  - src/guard.ts
  - src/agent.ts
severity: medium
last_updated: '2026-04-30'
---
# Pitfall: Command output noise

AI-facing commands lose value when output needs scrolling before an agent can act.

Daily commands should lead with must-read files, rules, pitfalls, focused tests, and next commands; advanced command lists belong later in docs. Prefer `aiwiki codex "<task>"` when the user only described a requirement and should not need to remember AIWiki commands.

Related memory: [[../modules/brief.md]], [[../modules/guard.md]].
