# AIWiki Future Specification

Status: Draft backlog, refreshed after Codex-owned usability hardening on 2026-05-03.

Purpose: Track optional and not-yet-implemented AIWiki capabilities separately from `SPEC.md`,
which describes the current implemented CLI contract.

Future work in this document MUST remain optional, additive, local-first by default, preview-first
for durable memory writes, and covered by tests before it moves into `SPEC.md`.

## Current Dogfood Baseline

The 2026-04-29 Codex dogfood pass made the current local CLI usable as an alpha
Codex project-memory workflow, the 2026-05-01 pass added work-graph, reflect,
guard, doctor, and large-repo eval hardening, and the 2026-05-03 pass tightened
the Codex-owned usability loop. The following should be treated as implemented
baseline, not future backlog:

- `brief` and `guard` can run in read-only cold-start mode before `.aiwiki/`
  exists.
- `brief` Markdown is compact by default and points to `--format json` for full
  context.
- `resume` starts with the most actionable next step and limits long lists.
- `reflect` quotes generated `aiwiki apply "<path>"` commands for Windows paths
  with spaces.
- `reflect` previews candidate wiki writes and scopes module candidates to the
  files that inferred the module.
- `map --write` regenerates `.aiwiki/index.md` so `lint` does not report a stale
  missing project-map entry.
- `.aiwiki/` dogfood memory is initialized for this repository, with runtime
  artifacts ignored by `.gitignore`.
- `AGENTS.md` now requires dogfood testing for Codex-facing workflow changes.
- `lint` warns when wiki frontmatter `files` entries point to missing project
  files or files newer than the page's `last_updated` value.
- `brief` and `guard` include compact advisory `Staleness Warnings` for selected
  memory, with full warning details in JSON output.
- `brief`, `reflect`, and `resume` support explicit `--read-only` mode for
  Codex context gathering with no filesystem writes.
- `module brief` uses the same compact Codex-facing section style as `brief` and
  `guard`.
- `prime` provides a compact Codex startup dashboard with active task, ready
  work, memory health, and next commands.
- The task layer supports local ready-work flow with open tasks, blocking
  dependencies, claim hints, and discovered follow-up tasks.
- `schema` exposes task metadata, task event, and prime JSON schemas for agent
  integrations.
- `doctor` groups stale referenced-file warnings by wiki page so stale-memory
  output stays concise.
- `guard` includes built-in semantic risk signals for database, frontend
  hydration, browser-only runtime, Python, Java, JavaScript/TypeScript, and C
  changes.
- `reflect --from-git-diff` includes untracked files from `git status`, supports
  cold-start read-only previews, extracts concrete work-graph and semantic-risk
  lessons, and suggests refresh entries for wiki pages whose `files`
  frontmatter references changed files.
- `eval large-repos` provides a maintainer smoke eval for cold-start `prime`,
  `codex --team`, and representative `guard` behavior across sparse large-repo
  fixtures.
- `eval usability` provides a local maintainer loop for natural-language resume,
  payment guard precision, module import preview safety, and
  maintainability/hardcoding guidance without remote providers.
- `agent` and Codex runbooks are written for Codex as the operator; the human can
  stay in natural language and does not need to remember the AIWiki command path.
- Generated AIWiki commands shell-quote task text safely.
- Dirty-file guard target ranking prefers changed source files before low-signal
  docs, package metadata, and runtime artifacts.
- Cold-start `brief` distinguishes built-in generic guardrails from project
  memory so an empty project does not look like it has fake historical lessons.
- `reflect --from-git-diff` avoids generic module drafts and append-only update
  entries when it lacks concrete notes or reusable lessons.
- Project scans combine built-in generated/dependency ignores, repository
  `.gitignore`, and `.aiwiki/config.json` `ignore` overrides.
- Cold-start `brief` ranking was dogfooded and tuned on a mixed PMS repository
  and the Python `pydantic-deepagents` repository without writing `.aiwiki/` into
  those target projects.

## Next Implementation Order

Start implementation work here before taking on larger adapters:

1. Improve Chinese/Unicode retrieval for `search`, `brief`, and `guard`.
2. Tune `architecture audit` line-level evidence and false-positive severity.
3. Continue real-project dogfood when changing ranking, scan heuristics, or
   Codex-owned workflow output.
4. Keep improving `reflect --from-git-diff` candidate specificity when new
   dogfood cases reveal generic text.
5. Only then consider optional adapters such as code-context, semantic memory, or
   deep-context.

## Near-Term Hardening Before Future Adapters

The next implementation phase should improve the current CLI before adding large optional systems
such as code-context, semantic indexing, prompt optimization, or deep-context.

### Continuing Codex Usability Pass

Goal: make AIWiki outputs consistently useful to Codex across projects, not only
inside the AIWiki repository.

Implemented first slice:

- `brief` can run read-only before `.aiwiki/` exists and reports cold-start mode.
- `brief` ranking downranks package-name noise, generated/dependency directories,
  unrelated app/example/CLI subprojects, and tests for non-test tasks.
- `brief` prefers implementation files for common fix tasks while preserving JSON
  detail for fuller context.
- Project scans respect built-in defaults, root `.gitignore`, and config ignore
  overrides.

Remaining requirements:

- Codex-facing Markdown output SHOULD continue to distinguish `Must Read`, `Do
  Not`, `Rules`, `Pitfalls`, `Suggested Tests`, and `Staleness Warnings` when
  applicable.
- Common `brief`, `guard`, `resume`, and `reflect` outputs SHOULD fit in roughly
  one to one-and-a-half terminal screens.
- JSON output MAY remain more complete than Markdown output.
- Empty and unknown states MUST remain stable, short, and tested.
- Tests SHOULD continue to pin section order and representative concise output.
- README development commands SHOULD be reliable on Windows PowerShell. If
  `npm run dev -- ...` argument forwarding remains fragile, document `npx tsx
  src/cli.ts ...` as the preferred local dogfood command.

### Remaining Freshness / Staleness Work

Goal: make stale wiki memory visible before it misleads a coding agent.

Implemented first slice:

- `aiwiki lint` warns when wiki frontmatter `files` entries point to missing
  project files.
- `aiwiki lint` warns when referenced files changed after a wiki page's
  `last_updated` value, using local filesystem modification time.
- `aiwiki brief` and `aiwiki guard` include compact staleness warnings for
  selected memory and keep full warning details in JSON output.
- Staleness warnings are advisory and do not block normal command output.
- Checks stay local and do not require semantic indexing or remote services.

Remaining planned behavior:

- `aiwiki reflect --from-git-diff` SHOULD keep improving candidate text quality
  for related wiki-page refreshes, especially when several changed files map to
  the same memory page.
- Future freshness checks MAY use git history when it improves precision, but
  MUST keep filesystem-only behavior available.
- Future commands that show selected memory SHOULD reuse the shared staleness
  helper instead of reimplementing file/date checks.

### Multi-Project Dogfood Pass

Goal: prove the workflow is useful outside AIWiki itself before larger feature
work begins.

Completed first slice:

- Tested against `D:\newproject\lianjiepeizhi\pms`, including frontend files
  added under the same project root.
- Tested against `D:\llm\pydantic-deepagents`, including Python virtualenv/cache
  noise and package-name ranking noise.
- Captured and fixed generalized findings in ignore handling, cold-start ranking,
  and architecture warning focus.

Ongoing requirements:

- Re-run real-project dogfood whenever ranking or scan heuristics change.
- Capture where `reflect` proposes overly broad module memory.
- Do not add project-specific heuristics unless they generalize across local
  codebases.
- Record reusable findings in reviewed `.aiwiki/wiki/` pages only after preview.

### Runtime Artifact Policy

Goal: keep committed AIWiki memory durable while leaving local run artifacts
private by default.

Requirements:

- `.aiwiki/config.json`, `.aiwiki/AGENTS.md`, `.aiwiki/index.md`, prompt
  templates, `.gitkeep` structure files, and reviewed wiki pages MAY be
  committed.
- `.aiwiki/evals/*.jsonl`, `.aiwiki/graph/*.json`,
  `.aiwiki/context-packs/*.json`, `.aiwiki/log.md`, and `.aiwiki/tasks/*` SHOULD
  remain local runtime artifacts unless the user explicitly asks to preserve a
  run.
- Future commands that create new runtime artifact paths SHOULD update the
  default ignore guidance and tests.

## 1. Promotion Rules

A future capability may move from this document into `SPEC.md` only when:

- The CLI command or API is implemented.
- Markdown and JSON output contracts are tested when supported.
- Invalid input, missing initialization, non-overwrite behavior, and path safety are tested.
- The feature does not make remote calls unless the command and configuration make that explicit.
- The feature does not write confirmed wiki memory without an explicit confirmation path.

## 2. Graphify Adapter Enhancements

The core Graphify adapter is implemented in `SPEC.md` as `aiwiki graph import-graphify` with
context-pack output, `aiwiki graph relate`, `brief --with-graphify`, and `guard --with-graphify`.
Future work should deepen the integration without making Graphify required or authoritative.

Possible future command shape:

```bash
aiwiki graph relate-module <module> [--with-graphify] [--format markdown|json]
```

Requirements:

- SHOULD support richer Graphify schemas as they are encountered.
- MAY add relation-focused summaries for a module or subsystem.
- MUST NOT convert inferred Graphify edges into project rules without user confirmation.

## 3. Architecture Guard Enhancements

The implemented architecture features are `aiwiki architecture audit`, `brief --architecture-guard`,
and `guard --architecture-guard`. Future enhancements MAY add richer architectural signals.

Planned command shape:

```bash
aiwiki architecture audit [--rules <path>] [--format markdown|json]
```

Requirements:

- SHOULD use project map signals more deeply when detecting likely modules.
- SHOULD flag route/controller files with too much business logic using source-level heuristics.
- SHOULD support configurable architecture rules when the config contract is defined.
- MUST NOT automatically refactor code or block the user's task.

## 4. Module Memory Pack Enhancements

The implemented commands are `aiwiki module export`, `aiwiki module import`, `aiwiki module import
--as`, `aiwiki module brief`, and `aiwiki module lint`. Future work MAY add direct import
confirmation after its write semantics are defined.

Planned command shape:

```bash
aiwiki module import <path> [--confirm] [--format markdown|json]
```

Requirements:

- `import --confirm` MUST still preserve preview-first behavior and MUST NOT overwrite existing
  memory without explicit confirmation.
- Direct confirmed import MUST keep imported pages proposed unless the user explicitly promotes
  them through a reviewed confirmation path.

## 5. Event Log Extensions

AIWiki now uses `checkpoints.jsonl` as the append-only event source for task status and resume
summaries. Future work should extend event-derived workflows beyond the current task continuity
surface.

Requirements:

- Task start and close MAY become explicit lifecycle events when the metadata compatibility policy
  is defined.
- Reflect and module export SHOULD become derivable from task events where task history is relevant.
- Event-derived workflows SHOULD keep Markdown files available for humans.
- Future event schemas MUST preserve compatibility with existing `checkpoint`, `decision`, and
  `blocker` records.

## 6. Code Context Adapter

Code Context Adapter is an optional integration layer for semantic code retrieval systems such as
claude-context-style indexing and MCP semantic search.

Planned command shape:

```bash
aiwiki code-context status [--format markdown|json]
aiwiki code-context search "<query>" [--limit <n>] [--format markdown|json]
aiwiki brief "<task>" --with-code-context
aiwiki guard <file> --with-code-context
```

Requirements:

- MUST be provider-neutral at the AIWiki domain boundary.
- MUST degrade gracefully when no provider or index is configured.
- MUST NOT require cloud services by default.
- MUST NOT index or transmit `.env*`, secrets, ignored build output, or `.aiwiki/` private task
  records unless explicitly configured.
- MUST treat retrieval results as task context, not confirmed long-term memory.
- MUST include source file paths and line/range metadata when available.
- SHOULD include retrieval score, provider name, and query in JSON output.
- MUST NOT write retrieved code snippets into `.aiwiki/wiki/` without explicit confirmation.

Suggested provider-neutral result shape:

```ts
interface CodeContextResult {
  provider: string;
  query: string;
  results: Array<{
    file: string;
    startLine?: number;
    endLine?: number;
    symbol?: string;
    score?: number;
    excerpt?: string;
    reason?: string;
  }>;
}
```

## 7. Semantic Memory Index

Semantic Memory Index is an optional acceleration layer for AIWiki Markdown memory. The Markdown
wiki MUST remain the source of truth, and the index MUST be rebuildable from `.aiwiki/`.

Planned command shape:

```bash
aiwiki memory index [--format markdown|json]
aiwiki search "<query>" --semantic [--limit <n>] [--format markdown|json]
aiwiki memory stats [--format markdown|json]
aiwiki memory decay-preview [--format markdown|json]
```

Requirements:

- MUST be disabled unless configured or explicitly invoked.
- MUST store source page path, source page hash, index version, and indexed timestamp.
- MUST NOT become the only copy of project memory.
- MUST NOT auto-capture conversations into long-term memory without review.
- MUST support deletion and full rebuild.
- MUST ignore secrets and generated files.
- SHOULD support scope, lifecycle metadata, and hybrid retrieval when available.

## 8. Prompt / Workflow Optimizer

Prompt / Workflow Optimizer is an optional offline optimization pipeline for AIWiki prompt templates
and workflow instructions.

Planned command shape:

```bash
aiwiki optimize prompt <name> --cases <path> [--output <path>] [--format markdown|json]
aiwiki optimize eval <name> [--format markdown|json]
```

Requirements:

- MUST be offline or explicitly invoked.
- MUST NOT mutate prompt templates by default.
- MUST produce a candidate diff and evaluation report.
- MUST require eval data before optimizing.
- MUST preserve product safety rules and required section headings.
- MUST provide rollback instructions or preserve the previous prompt version.
- MUST NOT optimize from private user data unless the user explicitly opts in.

## 9. Deep Context / Recursive Investigation

Deep Context is an optional investigation engine for large AIWiki memory stores and project corpora.

Planned command shape:

```bash
aiwiki investigate "<question>" [--max-depth <n>] [--budget <tokens-or-cost>] [--format markdown|json]
aiwiki deep-context "<question>" [--sources wiki,tasks,graph,code-context] [--format markdown|json]
```

Requirements:

- MUST be optional and explicitly invoked.
- MUST NOT replace normal `brief`, `guard`, `reflect`, or `search`.
- MUST define readable sources before execution.
- MUST support budget and recursion/depth limits.
- MUST produce an auditable trajectory or event log.
- MUST clearly distinguish extracted facts from inferred conclusions.
- MUST degrade to non-recursive search when deep-context runtime is unavailable.

## 10. Shared Adapter Principles

All future adapters MUST:

- Be optional and additive.
- Be provider-neutral at the AIWiki domain boundary.
- Degrade gracefully when missing.
- Keep `.aiwiki/` confirmed memory as the authoritative project memory.
- Avoid writing external output into long-term wiki/rules without confirmation.
- Mark source, provider, and confidence when available.
- Be covered by tests before being treated as implemented.
