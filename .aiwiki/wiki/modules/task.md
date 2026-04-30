---
type: module
title: Task
status: active
modules:
  - task
files:
  - src/task.ts
  - tests/task.test.ts
tags:
  - continuity
  - daily-command
risk: medium
last_updated: '2026-04-30'
---
# Module: Task

Task commands record checkpoints, decisions, blockers, and resume briefs for coding-session continuity. `checkpoint` and `resume` are daily commands; task storage remains local under `.aiwiki/tasks`.

Resume output should start from the true next action and should remind the next agent not to restart from scratch.

Related memory: [[../decisions/advanced-systems-optional.md]].
