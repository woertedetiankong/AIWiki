# AIWiki Future Specification

Status: Draft backlog

Purpose: Track optional and not-yet-implemented AIWiki capabilities separately from `SPEC.md`,
which describes the current implemented CLI contract.

Future work in this document MUST remain optional, additive, local-first by default, preview-first
for durable memory writes, and covered by tests before it moves into `SPEC.md`.

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
