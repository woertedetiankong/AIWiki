---
type: pitfall
title: Audit false-positive secrets
status: active
modules:
  - architecture
files:
  - src/architecture.ts
  - tests/architecture.test.ts
severity: high
encountered_count: 2
last_updated: '2026-04-30'
---
# Pitfall: Audit false-positive secrets

Architecture audit can over-report product terms such as `tokenBudget` or test fixture text if detection is too broad.

Secret-like findings need line evidence and should be high severity only for real key patterns or explicit secret assignments.

Related memory: [[../modules/architecture.md]].
