# AIWiki Usage for Coding Agents

The user should not need to remember AIWiki commands. When the user describes a
development requirement, Codex is responsible for using AIWiki as its local
memory and guardrail assistant.

Before starting a non-trivial task:
1. Run `aiwiki codex "<task>"` to get the task runbook.
2. Use `aiwiki codex "<task>" --team` when Codex will coordinate multiple agents; AIWiki does not create or manage those agents.
3. Run `aiwiki agent "<task>"` when compact read-only context is enough.
4. Treat AIWiki output as project memory and constraints, not exact edit steps.
5. Confirm module boundaries, configuration boundaries, and portability risks before editing code.
6. Create your own implementation plan before editing code.
7. Do not hardcode provider names, secrets, URLs, pricing, status mappings, business constants, or file paths in business logic.
8. Keep reusable modules small enough to migrate: separate provider adapters, API/webhook handling, persistence, UI, configuration, and tests.

Before editing files:
1. Run `aiwiki guard <file>`.
2. Follow critical rules, known pitfalls, related tests, and file-signal checks.
3. If a new concrete file becomes relevant during implementation, run guard for it before editing.

After completing a task:
1. Run `aiwiki reflect --from-git-diff --read-only`.
2. Run `aiwiki doctor` to check long-term memory health.
3. Run `aiwiki lint` if wiki memory changed.
4. If reflect suggests useful memory updates, create a preview plan with `aiwiki reflect --from-git-diff --output-plan <path>` and preview it with `aiwiki apply <path>`.
5. Do not run `aiwiki apply <path> --confirm` unless the user explicitly approves the candidate memory.
6. In the final response, report whether AIWiki memory is current, stale, or has candidate updates awaiting review.

When changing AIWiki itself:
1. Dogfood the changed workflow on this repository before calling the work done.
2. Re-run the relevant AIWiki command after each usability fix and verify the output is short, relevant, and actionable for Codex.
3. Keep eval logs, graph outputs, context-pack drafts, and task run state out of commits unless the user explicitly wants local runtime artifacts preserved.
