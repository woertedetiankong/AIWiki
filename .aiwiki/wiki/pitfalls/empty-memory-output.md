---
type: pitfall
title: Empty memory output can sound generic
status: active
modules:
  - brief
  - guard
files:
  - src/brief.ts
  - src/guard.ts
severity: medium
last_updated: '2026-04-30'
---
# Pitfall: Empty memory output can sound generic

When wiki memory is sparse, `brief` and `guard` must say what they found and avoid inventing confidence.

Prefer short fallback text, concrete discovered files, and clear setup guidance over long generic architecture advice.

Related memory: [[../modules/brief.md]], [[../modules/guard.md]].
