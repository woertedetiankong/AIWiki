# AIWiki Engineering Standards

This project is a local-first AI coding memory tool. Code should be written like product infrastructure: boring in the best way, easy to extend, explicit about data boundaries, and resistant to accidental user data loss.



## Encoding Requirement
Save all text files using UTF-8 encoding (prefer UTF-8 without BOM) to prevent Chinese character garbling in Windows editors and IDEs.

Note: When reading UTF-8 files in PowerShell, use Get-Content -Encoding UTF8; the default codepage may garble Chinese text.
## Product Principles

- Build the actual local CLI workflow first. Do not add Web UI, cloud sync, MCP, GEPA, or deep-context systems before the core Markdown workflow is solid.
- Preserve user trust. Never overwrite, delete, deprecate, or promote project memory without an explicit code path and tests for that behavior.
- Treat `.aiwiki/` as user-owned data. Commands may generate and maintain files there, but user edits must be respected.
- Default to local-only behavior. Do not send code, diffs, notes, or wiki content to a remote provider unless the command and configuration make that explicit.
- Keep Codex implementation plans separate from AIWiki development briefs. Briefs provide memory and constraints; they do not become step-by-step code-edit instructions.

## Architecture Rules

- Keep product conventions centralized. Directory names, default files, default token budgets, default ignore lists, and version constants belong in `src/constants.ts` or a similarly focused module; ignore matching and `.gitignore` integration belong in `src/ignore.ts`.
- Keep templates out of orchestration code. Prompt text, default Markdown pages, and agent instructions belong in template modules or template files, not inside command handlers.
- Keep command handlers thin. CLI files should parse input, call domain functions, and format output. They should not contain business logic.
- Prefer small reusable services over command-specific logic. Search, Markdown parsing, wiki scanning, log writing, config loading, and managed writes should be shared by commands.
- Validate external and user-editable data at the boundary. Config JSON, Markdown frontmatter, JSONL events, and future provider responses should have schemas.
- Avoid hardcoding paths in feature modules. Use shared layout constants and path helpers.
- Avoid hidden global state. Pass `rootDir`, config, and options explicitly so tests and future integrations can run in isolated workspaces.
- Do not introduce heavy infrastructure for MVP features. Prefer Markdown, JSON, JSONL, and simple scans until there is a concrete scale problem.

## Hardcoding Policy

- Acceptable hardcoding: stable product defaults from the PRD, such as `.aiwiki/`, initial wiki categories, and default token budgets.
- Risky hardcoding: prompt bodies, generated document bodies, provider-specific assumptions, file paths repeated across modules, model names, output formats, and scoring weights.
- When adding a new constant, ask whether users may reasonably configure it later. If yes, keep the code path ready for config overrides even if the first version uses a default.
- Never duplicate the same literal across unrelated modules. Extract it before it becomes a migration problem.

## Data Safety

- Write operations must be preview-first or non-destructive by default.
- `--force` may refresh AIWiki-managed defaults, but it must not delete user-created files.
- High-risk operations require explicit confirmation in future interactive flows: global agent rules, `.cursor/rules`, deprecating decisions, deleting pages, and bulk merges.
- All filesystem writes must stay inside the project root unless the user explicitly asks otherwise.
- Secrets and build artifacts must remain ignored by default.

## Testing Expectations

- Every command should have tests for the happy path, repeated execution, user-edited existing files, and invalid input.
- Every parser should have tests for valid data and malformed user-editable data.
- Every write path should test non-overwrite behavior.
- Prefer temp directories for filesystem tests. Do not depend on the developer's real `.aiwiki/`.
- Run `npm run typecheck`, `npm run test`, and `npm run build` before considering implementation complete.

## Dogfood Workflow

- When changing Codex-facing workflows, test AIWiki on this repository before calling the work done.
- Prefer a tight loop: run `aiwiki brief "<task>"`, inspect whether the output helps implementation, edit the smallest useful improvement, then run the command again.
- For file-specific changes, run `aiwiki guard <file>` and verify the output is short, relevant, and actionable.
- For task-continuity changes, run `aiwiki checkpoint` and `aiwiki resume` and verify the resume brief starts with the true next action.
- For memory-capture changes, run `aiwiki reflect --from-git-diff --output-plan <path>` and `aiwiki apply <path>` as a preview. Do not use `--confirm` unless the candidate memory has been reviewed.
- Treat dogfood findings as product feedback: if CLI output is noisy, misleading, stale, or hard to copy into Codex, fix the workflow or document the limitation.
- Keep generated runtime artifacts out of commits unless they are stable project memory. Eval logs, graph outputs, context-pack drafts, and task run state are local artifacts by default.

## Style

- Use TypeScript strict mode and exported types for public internal APIs.
- Keep functions narrow and names plain. A future maintainer should understand the code without reading the whole project.
- Add comments only where they explain non-obvious product safety decisions.
- Keep Markdown output easy to copy into coding agents.
- Prefer Markdown as the default output format and design JSON output alongside it when adding user-facing commands.
