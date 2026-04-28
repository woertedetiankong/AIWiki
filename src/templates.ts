import {
  AGENTS_PATH,
  INDEX_PATH,
  LOG_PATH,
  PROMPTS_DIR
} from "./constants.js";

export interface ManagedTemplate {
  path: string;
  content: string;
  forceable: boolean;
}

export function defaultAgentsMd(): string {
  return `# AIWiki Usage for Coding Agents

Before starting a non-trivial task:
1. Run or ask the user to run \`aiwiki brief "<task>"\`.
2. Treat the brief as project memory and constraints.
3. Confirm module boundaries, configuration boundaries, and portability risks before editing code.
4. Create your own implementation plan before editing code.
5. Do not hardcode provider names, secrets, URLs, pricing, status mappings, business constants, or file paths in business logic.
6. Keep reusable modules small enough to migrate: separate provider adapters, API/webhook handling, persistence, UI, configuration, and tests.

Before editing a high-risk file:
1. Run \`aiwiki guard <file>\`.
2. Follow critical rules and checks.

After completing a task:
1. Run or ask the user to run \`aiwiki reflect --from-git-diff\`.
2. Do not promote rules without user confirmation.
3. Preserve durable module boundaries, patterns, pitfalls, decisions, and rules that would help future migrations.
`;
}

export function defaultIndexMd(projectName: string): string {
  return `# AIWiki Index: ${projectName}

This index is maintained by AIWiki commands.

## Project Map

- No project map has been generated yet.

## Modules

- No module pages yet.

## Pitfalls

- No pitfall pages yet.

## Decisions

- No decision pages yet.

## Patterns

- No pattern pages yet.

## Rules

- No rule pages yet.
`;
}

export function defaultLogMd(): string {
  return `# AIWiki Log

Chronological record of AIWiki activity.

`;
}

export const PROMPT_TEMPLATES = {
  "brief.md": `# AIWiki Brief Prompt

Generate a Development Brief from the task, relevant wiki pages, project map, index summary, and token budget.

Rules:
- Do not generate concrete code implementation steps.
- Do not replace the coding agent's implementation plan.
- Surface user questions, historical pitfalls, project rules, risk files, and acceptance criteria.
- Surface module boundaries, hardcoding/configuration risks, portability checks, and module memory to maintain.
- Warn when a task risks mixing provider SDK calls, API/webhook handling, persistence, UI, and configuration in one file.
- Remind the coding agent to create its own implementation plan before editing code.
`,
  "reflect.md": `# AIWiki Reflect Prompt

Generate structured update suggestions from git diff, user notes, session events, and relevant wiki pages.

Rules:
- Separate one-off incidents from reusable lessons.
- Do not promote temporary workarounds into rules.
- Include confidence and a file-change preview.
`,
  "ingest.md": `# AIWiki Ingest Prompt

Turn a raw note into proposed module, pitfall, decision, pattern, or rule updates.

Rules:
- Preserve the source note as raw source.
- Prefer reusable project memory over chronological summaries.
- Ask for confirmation before writing structured wiki updates.
`,
  "guard.md": `# AIWiki Guard Prompt

Generate concise guardrails for editing a file from related wiki pages and graph neighbors.

Rules:
- Prioritize critical and high-severity memory.
- Include checks before and after editing.
- Keep the output focused on the requested file.
`,
  "lint.md": `# AIWiki Lint Prompt

Inspect wiki health and report missing frontmatter, broken links, orphan pages, stale knowledge, duplicate pitfalls, and rule conflicts.

Rules:
- Low-risk index/backlink repairs may be suggested automatically.
- Rule promotion, deleting pages, and deprecating decisions require user confirmation.
`
} as const;

export function createInitialTemplates(projectName: string): ManagedTemplate[] {
  return [
    {
      path: AGENTS_PATH,
      content: defaultAgentsMd(),
      forceable: true
    },
    {
      path: INDEX_PATH,
      content: defaultIndexMd(projectName),
      forceable: true
    },
    {
      path: LOG_PATH,
      content: defaultLogMd(),
      forceable: false
    },
    ...Object.entries(PROMPT_TEMPLATES).map(([fileName, content]) => ({
      path: `${PROMPTS_DIR}/${fileName}`,
      content,
      forceable: true
    }))
  ];
}
