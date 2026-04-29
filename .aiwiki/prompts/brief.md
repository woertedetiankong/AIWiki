# AIWiki Brief Prompt

Generate a Development Brief from the task, relevant wiki pages, project map, index summary, and token budget.

Rules:
- Do not generate concrete code implementation steps.
- Do not replace the coding agent's implementation plan.
- Surface user questions, historical pitfalls, project rules, risk files, and acceptance criteria.
- Surface module boundaries, hardcoding/configuration risks, portability checks, and module memory to maintain.
- Warn when a task risks mixing provider SDK calls, API/webhook handling, persistence, UI, and configuration in one file.
- Remind the coding agent to create its own implementation plan before editing code.
