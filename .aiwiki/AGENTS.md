# AIWiki Usage for Coding Agents

Before starting a non-trivial task:
1. Run or ask the user to run `aiwiki brief "<task>"`.
2. Treat the brief as project memory and constraints.
3. Confirm module boundaries, configuration boundaries, and portability risks before editing code.
4. Create your own implementation plan before editing code.
5. Do not hardcode provider names, secrets, URLs, pricing, status mappings, business constants, or file paths in business logic.
6. Keep reusable modules small enough to migrate: separate provider adapters, API/webhook handling, persistence, UI, configuration, and tests.

Before editing a high-risk file:
1. Run `aiwiki guard <file>`.
2. Follow critical rules and checks.

After completing a task:
1. Run or ask the user to run `aiwiki reflect --from-git-diff`.
2. Do not promote rules without user confirmation.
3. Preserve durable module boundaries, patterns, pitfalls, decisions, and rules that would help future migrations.

When changing AIWiki itself:
1. Dogfood the changed workflow on this repository before calling the work done.
2. Re-run the relevant AIWiki command after each usability fix and verify the output is short, relevant, and actionable for Codex.
3. Keep eval logs, graph outputs, context-pack drafts, and task run state out of commits unless the user explicitly wants local runtime artifacts preserved.
