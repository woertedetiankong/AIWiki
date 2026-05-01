export type SchemaName = "all" | "task" | "task-event" | "prime";

export interface SchemaResult {
  name: SchemaName;
  schemas: Record<string, unknown>;
  markdown: string;
  json: string;
}

const taskMetadataSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "AIWiki Task Metadata",
  type: "object",
  required: ["id", "title", "status", "created_at", "updated_at"],
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    status: {
      type: "string",
      enum: ["open", "in_progress", "blocked", "deferred", "done", "paused", "cancelled"]
    },
    type: {
      type: "string",
      enum: ["task", "bug", "feature", "epic", "chore"]
    },
    priority: { type: "integer", minimum: 0, maximum: 4 },
    assignee: { type: "string" },
    claimed_at: { type: "string", format: "date-time" },
    created_at: { type: "string", format: "date-time" },
    updated_at: { type: "string", format: "date-time" },
    closed_at: { type: "string", format: "date-time" },
    prd: { type: "string" },
    dependencies: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "type", "created_at"],
        properties: {
          id: { type: "string" },
          type: {
            type: "string",
            enum: ["blocks", "parent_child", "related", "discovered_from"]
          },
          created_at: { type: "string", format: "date-time" }
        }
      }
    }
  }
};

const taskEventSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "AIWiki Task Event",
  type: "object",
  required: ["time", "type"],
  properties: {
    time: { type: "string", format: "date-time" },
    type: {
      type: "string",
      enum: [
        "checkpoint",
        "decision",
        "blocker",
        "task_created",
        "task_claimed",
        "dependency_added",
        "task_discovered",
        "task_closed"
      ]
    },
    message: { type: "string" },
    step: { type: "string" },
    status: { type: "string" },
    tests: { type: "array", items: { type: "string" } },
    next: { type: "array", items: { type: "string" } },
    files: { type: "array", items: { type: "string" } },
    module: { type: "string" },
    severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
    actor: { type: "string" },
    task_id: { type: "string" },
    dependency_id: { type: "string" },
    dependency_type: {
      type: "string",
      enum: ["blocks", "parent_child", "related", "discovered_from"]
    },
    from: { type: "string" }
  }
};

const primeSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "AIWiki Prime Context",
  type: "object",
  required: ["projectName", "initialized", "readyTasks", "memoryHealth", "actions"],
  properties: {
    projectName: { type: "string" },
    initialized: { type: "boolean" },
    activeTask: taskMetadataSchema,
    readyTasks: { type: "array", items: taskMetadataSchema },
    memoryHealth: {
      type: "object",
      required: ["lintErrors", "lintWarnings", "staleWarnings", "nextActions"],
      properties: {
        lintErrors: { type: "integer" },
        lintWarnings: { type: "integer" },
        staleWarnings: { type: "integer" },
        nextActions: { type: "array", items: { type: "string" } }
      }
    },
    actions: {
      type: "array",
      items: {
        type: "object",
        required: ["kind", "title", "reason", "command"],
        properties: {
          kind: {
            type: "string",
            enum: [
              "resume_task",
              "claim_ready_task",
              "memory_health",
              "start_context",
              "initialize_memory",
              "build_project_map"
            ]
          },
          title: { type: "string" },
          reason: { type: "string" },
          command: { type: "string" }
        }
      }
    }
  }
};

function schemaMap(name: SchemaName): Record<string, unknown> {
  const all = {
    task: taskMetadataSchema,
    "task-event": taskEventSchema,
    prime: primeSchema
  };

  return name === "all" ? all : { [name]: all[name] };
}

function formatMarkdown(name: SchemaName, schemas: Record<string, unknown>): string {
  return [
    `# AIWiki Schema: ${name}`,
    "",
    ...Object.keys(schemas).map((schemaName) => `- ${schemaName}`),
    "",
    "Use `--format json` for machine-readable JSON Schema."
  ].join("\n") + "\n";
}

export function parseSchemaName(value: string | undefined): SchemaName {
  if (value === undefined || value === "all") {
    return "all";
  }
  if (value === "task" || value === "task-event" || value === "prime") {
    return value;
  }

  throw new Error(`Unsupported schema: ${value}`);
}

export function getSchemaResult(name: SchemaName): SchemaResult {
  const schemas = schemaMap(name);
  return {
    name,
    schemas,
    markdown: formatMarkdown(name, schemas),
    json: `${JSON.stringify({ name, schemas }, null, 2)}\n`
  };
}
