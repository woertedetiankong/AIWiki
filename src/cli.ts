#!/usr/bin/env node
import { stat } from "node:fs/promises";
import { Command } from "commander";
import { generateAgentContext } from "./agent.js";
import { applyWikiUpdatePlan, readWikiUpdatePlanFile } from "./apply.js";
import { generateArchitectureAudit } from "./architecture.js";
import { generateDevelopmentBrief } from "./brief.js";
import { generateCodexRunbook } from "./codex.js";
import { AIWIKI_VERSION, PROJECT_MAP_PATH } from "./constants.js";
import { doctorWiki } from "./doctor.js";
import { toStructuredCliError, wantsJsonError } from "./errors.js";
import { buildWikiGraph, relateGraphFile } from "./graph.js";
import { importGraphifyContext } from "./graphify.js";
import { generateFileGuardrails } from "./guard.js";
import {
  buildHybridIndex,
  formatHybridIndexBuildResult,
  formatHybridIndexStatus,
  getHybridIndexStatus
} from "./hybrid-index.js";
import { initAIWiki } from "./init.js";
import {
  formatSearchResponse,
  parseOutputFormat,
  parsePositiveInteger
} from "./output.js";
import { resolveProjectPath } from "./paths.js";
import { runLargeRepoEval } from "./large-repo-eval.js";
import { lintWiki } from "./lint.js";
import {
  exportModulePack,
  generateModuleImportPreview,
  generateModuleMemoryBrief,
  lintModuleMemory
} from "./module-pack.js";
import { generateProjectMap } from "./project-map.js";
import { generatePrimeContext } from "./prime.js";
import { generateRulePromotionPreview } from "./promote-rules.js";
import { generateReflectPreview } from "./reflect.js";
import { getSchemaResult, parseSchemaName } from "./schema.js";
import { searchWikiMemory } from "./search.js";
import {
  addTaskDependency,
  checkpointTask,
  closeTask,
  claimTask,
  createTask,
  discoverTask,
  ensureActiveTask,
  getTaskStatus,
  listTasks,
  readyTasks,
  recordTaskBlocker,
  recordTaskDecision,
  resumeTask,
  startTask
} from "./task.js";
import type {
  RiskLevel,
  TaskDependencyType,
  TaskStatus,
  TaskType,
  WikiPageType
} from "./types.js";
import { wikiPageTypeSchema } from "./wiki-frontmatter.js";

const program = new Command();

function parseTaskStatus(value: string | undefined): TaskStatus | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (
    value === "in_progress" ||
    value === "open" ||
    value === "blocked" ||
    value === "deferred" ||
    value === "done" ||
    value === "paused" ||
    value === "cancelled"
  ) {
    return value;
  }

  throw new Error(`Unsupported task status: ${value}`);
}

function parseTaskType(value: string | undefined): TaskType | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    value === "task" ||
    value === "bug" ||
    value === "feature" ||
    value === "epic" ||
    value === "chore"
  ) {
    return value;
  }

  throw new Error(`Unsupported task type: ${value}`);
}

function parseDependencyType(value: string | undefined): TaskDependencyType | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    value === "blocks" ||
    value === "parent_child" ||
    value === "related" ||
    value === "discovered_from"
  ) {
    return value;
  }

  throw new Error(`Unsupported dependency type: ${value}`);
}

function parsePriority(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 4) {
    throw new Error(`Task priority must be an integer from 0 to 4, received: ${value}`);
  }

  return parsed;
}

function parseRiskLevel(value: string | undefined): RiskLevel | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "critical"
  ) {
    return value;
  }

  throw new Error(`Unsupported severity: ${value}`);
}

function parseFixtureNames(values: string[] | undefined): string[] | undefined {
  const names = values
    ?.flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return names && names.length > 0 ? names : undefined;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      return false;
    }

    throw error;
  }
}

async function ensureProjectMap(rootDir: string): Promise<void> {
  const projectMapPath = resolveProjectPath(rootDir, PROJECT_MAP_PATH);
  if (await fileExists(projectMapPath)) {
    return;
  }

  await generateProjectMap(rootDir, { write: true });
}

async function prepareAgentWorkflow(
  rootDir: string,
  task: string,
  options: {
    task?: boolean;
    map?: boolean;
  }
): Promise<void> {
  if (options.task !== false) {
    await ensureActiveTask(rootDir, task, { assignee: "codex" });
  }

  if (options.map !== false) {
    await ensureProjectMap(rootDir);
  }
}

async function writeAgentContext(
  task: string,
  options: {
    limit?: string;
    withGraphify?: boolean;
    architectureGuard?: boolean;
    format?: string;
    task?: boolean;
    map?: boolean;
  }
): Promise<void> {
  await prepareAgentWorkflow(process.cwd(), task, options);
  const format = parseOutputFormat(options.format);
  const result = await generateAgentContext(process.cwd(), task, {
    limit: parsePositiveInteger(options.limit),
    withGraphify: options.withGraphify,
    architectureGuard: options.architectureGuard,
    format
  });

  process.stdout.write(format === "json" ? result.json : result.markdown);
}

async function writeRunbook(
  task: string,
  options: {
    limit?: string;
    withGraphify?: boolean;
    architectureGuard?: boolean;
    team?: boolean;
    format?: string;
    task?: boolean;
    map?: boolean;
  }
): Promise<void> {
  await prepareAgentWorkflow(process.cwd(), task, options);
  const format = parseOutputFormat(options.format);
  const result = await generateCodexRunbook(process.cwd(), task, {
    limit: parsePositiveInteger(options.limit),
    withGraphify: options.withGraphify,
    architectureGuard: options.architectureGuard,
    team: options.team,
    format
  });

  process.stdout.write(format === "json" ? result.json : result.markdown);
}

function formatAdvancedHelp(): string {
  return [
    "# AIWiki Advanced Commands",
    "",
    "These commands remain available, but they are hidden from the top-level help so daily agent workflows stay focused.",
    "",
    "## Agent Aliases",
    "- aiwiki codex \"<task>\" [--team] (alias direction: aiwiki agent \"<task>\" --runbook [--team])",
    "- aiwiki agent \"<task>\" [--no-task] [--no-map] (skip automatic task/project-map preparation)",
    "",
    "## Machine Contracts and Indexes",
    "- aiwiki schema [all|task|task-event|prime]",
    "- aiwiki index build [--no-jsonl]",
    "- aiwiki index status",
    "",
    "## Architecture, Graph, and Module Workflows",
    "- aiwiki architecture audit",
    "- aiwiki graph build",
    "- aiwiki graph import-graphify <path>",
    "- aiwiki graph relate <file>",
    "- aiwiki module export <module>",
    "- aiwiki module import <pack>",
    "- aiwiki module brief <module> \"<task>\"",
    "- aiwiki module lint <module>",
    "",
    "## Memory Maintenance Internals",
    "- aiwiki ingest <file> (alias direction: aiwiki reflect --notes <file> --save-raw)",
    "- aiwiki promote-rules",
    "",
    "## Task Event Shortcuts",
    "- aiwiki decision \"<decision>\"",
    "- aiwiki blocker \"<blocker>\"",
    "",
    "## Maintainer Evals",
    "- aiwiki eval large-repos",
    ""
  ].join("\n");
}

program
  .name("aiwiki")
  .description("Local-first AI coding memory and context engineering CLI.")
  .version(AIWIKI_VERSION)
  .showHelpAfterError("(run `aiwiki <command> --help` for command usage)");

const advancedCommand = program
  .command("advanced", { hidden: true })
  .description("Show advanced and compatibility commands hidden from top-level help.")
  .action(() => {
    process.stdout.write(formatAdvancedHelp());
  });

advancedCommand.addHelpText("after", `\n${formatAdvancedHelp()}`);

program
  .command("prime")
  .description("Show the compact AIWiki startup context for Codex.")
  .option("--limit <n>", "Maximum number of ready tasks to include")
  .option("--format <format>", "Output format: markdown or json", "markdown")
  .action(async (options: { limit?: string; format?: string }) => {
    const format = parseOutputFormat(options.format);
    const result = await generatePrimeContext(process.cwd(), {
      limit: parsePositiveInteger(options.limit)
    });
    process.stdout.write(format === "json" ? result.json : result.markdown);
  });

program
  .command("schema", { hidden: true })
  .description("Print JSON schemas for AIWiki agent-facing data.")
  .argument("[name]", "Schema name: all, task, task-event, or prime", "all")
  .option("--format <format>", "Output format: markdown or json", "markdown")
  .action(async (name: string | undefined, options: { format?: string }) => {
    const format = parseOutputFormat(options.format);
    const result = getSchemaResult(parseSchemaName(name));
    process.stdout.write(format === "json" ? result.json : result.markdown);
  });

program
  .command("codex", { hidden: true })
  .description("Compatibility alias for `aiwiki agent <task> --runbook`.")
  .argument("<task>", "User requirement or task description")
  .option("--limit <n>", "Maximum number of wiki pages to include")
  .option("--with-graphify", "Include graphify-out structural context when available", false)
  .option("--architecture-guard", "Include explicit architecture guard signals", false)
  .option("--team", "Include a team-aware runbook for Codex-managed agent teams", false)
  .option("--no-task", "Do not start or claim an active AIWiki task")
  .option("--no-map", "Do not bootstrap .aiwiki/wiki/project-map.md")
  .option("--format <format>", "Output format: markdown or json", "markdown")
  .action(
    async (
      task: string,
      options: {
        limit?: string;
        withGraphify?: boolean;
        architectureGuard?: boolean;
        team?: boolean;
        task?: boolean;
        map?: boolean;
        format?: string;
      }
    ) => {
      await writeRunbook(task, options);
    }
  );

program
  .command("agent")
  .description("Generate compact context or a runbook for an AI coding agent.")
  .argument("<task>", "Task description")
  .option("--limit <n>", "Maximum number of wiki pages to include")
  .option("--with-graphify", "Include graphify-out structural context when available", false)
  .option("--architecture-guard", "Include explicit architecture guard signals", false)
  .option("--runbook", "Generate the full Codex-style runbook instead of compact context", false)
  .option("--team", "Include a team-aware runbook; implies --runbook", false)
  .option("--no-task", "Do not start or claim an active AIWiki task")
  .option("--no-map", "Do not bootstrap .aiwiki/wiki/project-map.md")
  .option("--format <format>", "Output format: markdown or json", "markdown")
  .action(
    async (
      task: string,
      options: {
        limit?: string;
        withGraphify?: boolean;
        architectureGuard?: boolean;
        runbook?: boolean;
        team?: boolean;
        task?: boolean;
        map?: boolean;
        format?: string;
      }
    ) => {
      if (options.runbook || options.team) {
        await writeRunbook(task, options);
        return;
      }

      await writeAgentContext(task, options);
    }
  );

program
  .command("init")
  .description("Initialize AIWiki in the current project.")
  .option("--project-name <name>", "Project name to write into .aiwiki/config.json")
  .option("--force", "Refresh default AIWiki template files", false)
  .action(async (options: { projectName?: string; force?: boolean }) => {
    const result = await initAIWiki({
      projectName: options.projectName,
      force: options.force
    });

    for (const warning of result.warnings) {
      console.warn(`Warning: ${warning}`);
    }

    console.log(`AIWiki initialized at ${result.rootDir}`);
    console.log(`Created: ${result.created.length}`);
    console.log(`Skipped: ${result.skipped.length}`);
    console.log(`Overwritten: ${result.overwritten.length}`);
  });

program
  .command("search")
  .description("Search AIWiki project memory.")
  .argument("<query>", "Search query")
  .option("--type <type>", "Restrict results to a wiki page type")
  .option("--limit <n>", "Maximum number of results")
  .option("--index", "Search the derived SQLite index when it exists", false)
  .option("--format <format>", "Output format: markdown or json", "markdown")
  .action(
    async (
      query: string,
      options: { type?: string; limit?: string; index?: boolean; format?: string }
    ) => {
      const format = parseOutputFormat(options.format);
      const parsedType = options.type
        ? wikiPageTypeSchema.parse(options.type)
        : undefined;
      const response = await searchWikiMemory(process.cwd(), query, {
        type: parsedType as WikiPageType | undefined,
        limit: parsePositiveInteger(options.limit),
        useIndex: options.index
      });

      process.stdout.write(formatSearchResponse(response, format));
    }
  );

program
  .command("brief")
  .description("Generate a no-LLM Development Brief from AIWiki memory.")
  .argument("<task>", "Task description")
  .option("--limit <n>", "Maximum number of wiki pages to include")
  .option("--output <path>", "Write the brief to a project-local file")
  .option("--force", "Overwrite the output file if it already exists", false)
  .option("--format <format>", "Output format: markdown or json", "markdown")
  .option("--with-graphify", "Include graphify-out structural context when available", false)
  .option("--architecture-guard", "Include explicit architecture guard signals", false)
  .option("--read-only", "Do not write logs, evals, or output files", false)
  .action(
    async (
      task: string,
      options: {
        limit?: string;
        output?: string;
        force?: boolean;
        format?: string;
        withGraphify?: boolean;
        architectureGuard?: boolean;
        readOnly?: boolean;
      }
    ) => {
      const format = parseOutputFormat(options.format);
      const result = await generateDevelopmentBrief(process.cwd(), task, {
        limit: parsePositiveInteger(options.limit),
        output: options.output,
        force: options.force,
        format,
        withGraphify: options.withGraphify,
        architectureGuard: options.architectureGuard,
        readOnly: options.readOnly
      });

      if (result.outputPath) {
        console.log(`Development Brief written to ${result.outputPath}`);
        return;
      }

      process.stdout.write(format === "json" ? result.json : result.markdown);
    }
  );

program
  .command("guard")
  .description("Show AIWiki guardrails for editing a file.")
  .argument("<file>", "Project-local file path")
  .option("--limit <n>", "Maximum number of related pages to search")
  .option("--format <format>", "Output format: markdown or json", "markdown")
  .option("--with-graphify", "Include graphify-out structural context when available", false)
  .option("--architecture-guard", "Include explicit architecture guard signals", false)
  .action(
    async (
      file: string,
      options: {
        limit?: string;
        format?: string;
        withGraphify?: boolean;
        architectureGuard?: boolean;
      }
    ) => {
      const format = parseOutputFormat(options.format);
      const result = await generateFileGuardrails(process.cwd(), file, {
        limit: parsePositiveInteger(options.limit),
        withGraphify: options.withGraphify,
        architectureGuard: options.architectureGuard
      });

      process.stdout.write(format === "json" ? result.json : result.markdown);
    }
  );

program
  .command("map")
  .description("Generate a no-LLM AIWiki project map.")
  .option("--write", "Write the project map to .aiwiki/wiki/project-map.md", false)
  .option("--force", "Overwrite an existing project map when writing", false)
  .option("--format <format>", "Output format: markdown or json", "markdown")
  .action(
    async (options: { write?: boolean; force?: boolean; format?: string }) => {
      const format = parseOutputFormat(options.format);
      const result = await generateProjectMap(process.cwd(), {
        write: options.write,
        force: options.force
      });

      if (result.outputPath && format === "markdown") {
        console.log(`Project Map written to ${result.outputPath}`);
        return;
      }

      process.stdout.write(format === "json" ? result.json : result.markdown);
    }
  );

const architectureCommand = program
  .command("architecture", { hidden: true })
  .description("Inspect architecture health and portability risks.");

const indexCommand = program
  .command("index", { hidden: true })
  .description("Manage the AIWiki hybrid SQLite index and JSONL snapshot.");

indexCommand
  .command("build")
  .description("Rebuild the derived SQLite wiki index and JSONL snapshot.")
  .option("--no-jsonl", "Skip writing the JSONL snapshot")
  .option("--format <format>", "Output format: markdown or json", "markdown")
  .action(async (options: { jsonl?: boolean; format?: string }) => {
    const format = parseOutputFormat(options.format);
    const result = await buildHybridIndex(process.cwd(), {
      exportJsonl: options.jsonl
    });
    process.stdout.write(formatHybridIndexBuildResult(result, format));
  });

indexCommand
  .command("status")
  .description("Show whether the hybrid SQLite index and JSONL snapshot exist.")
  .option("--format <format>", "Output format: markdown or json", "markdown")
  .action(async (options: { format?: string }) => {
    const format = parseOutputFormat(options.format);
    const status = await getHybridIndexStatus(process.cwd());
    process.stdout.write(formatHybridIndexStatus(status, format));
  });

architectureCommand
  .command("audit")
  .description("Report architecture, hardcoding, and module memory risks.")
  .option("--format <format>", "Output format: markdown or json", "markdown")
  .action(async (options: { format?: string }) => {
    const format = parseOutputFormat(options.format);
    const result = await generateArchitectureAudit(process.cwd());
    process.stdout.write(format === "json" ? result.json : result.markdown);
  });

const evalCommand = program
  .command("eval", { hidden: true })
  .description("Run AIWiki quality evals against repeatable fixtures.");

evalCommand
  .command("large-repos")
  .description("Smoke-test AIWiki on sparse checkouts of large open-source repositories.")
  .option("--cache-dir <path>", "Directory for cached fixture checkouts")
  .option("--fixture <name...>", "Fixture name(s) to run; can be repeated or comma-separated")
  .option("--skip-clone", "Use existing cached checkouts without cloning missing repos", false)
  .option("--format <format>", "Output format: markdown or json", "markdown")
  .action(
    async (
      options: {
        cacheDir?: string;
        fixture?: string[];
        skipClone?: boolean;
        format?: string;
      }
    ) => {
      const format = parseOutputFormat(options.format);
      const result = await runLargeRepoEval({
        cacheDir: options.cacheDir,
        fixtureNames: parseFixtureNames(options.fixture),
        skipClone: options.skipClone,
        format
      });
      process.stdout.write(format === "json" ? result.json : result.markdown);
      if (!result.passed) {
        process.exitCode = 1;
      }
    }
  );

const moduleCommand = program
  .command("module", { hidden: true })
  .description("Export and import portable AIWiki module memory.");

moduleCommand
  .command("export")
  .description("Export wiki memory for a module into a portable pack.")
  .argument("<module>", "Module name to export")
  .option("--output <path>", "Write the pack to a project-local JSON file")
  .option("--force", "Overwrite the output pack if it already exists", false)
  .option("--format <format>", "Output format: markdown or json", "markdown")
  .action(
    async (
      moduleName: string,
      options: { output?: string; force?: boolean; format?: string }
    ) => {
      const format = parseOutputFormat(options.format);
      const result = await exportModulePack(process.cwd(), moduleName, {
        output: options.output,
        force: options.force
      });
      process.stdout.write(format === "json" ? result.json : result.markdown);
    }
  );

moduleCommand
  .command("import")
  .description("Preview importing a portable module pack into this project.")
  .argument("<pack>", "Path to a module pack JSON file")
  .option("--as <module>", "Import the pack under a safe target module name")
  .option("--target-stack <stack>", "Target project stack or framework")
  .option("--output-plan <path>", "Write an AIWiki update plan draft to a project-local JSON file")
  .option("--force", "Overwrite the output plan if it already exists", false)
  .option("--format <format>", "Output format: markdown or json", "markdown")
  .action(
    async (
      pack: string,
      options: {
        as?: string;
        targetStack?: string;
        outputPlan?: string;
        force?: boolean;
        format?: string;
      }
    ) => {
      const format = parseOutputFormat(options.format);
      const result = await generateModuleImportPreview(process.cwd(), pack, {
        as: options.as,
        targetStack: options.targetStack,
        outputPlan: options.outputPlan,
        force: options.force
      });
      process.stdout.write(format === "json" ? result.json : result.markdown);
    }
  );

moduleCommand
  .command("brief")
  .description("Generate a module-specific brief for adapting memory to a task.")
  .argument("<module>", "Module name")
  .argument("<task>", "Task description")
  .option("--format <format>", "Output format: markdown or json", "markdown")
  .action(
    async (
      moduleName: string,
      task: string,
      options: { format?: string }
    ) => {
      const format = parseOutputFormat(options.format);
      const result = await generateModuleMemoryBrief(process.cwd(), moduleName, task);
      process.stdout.write(format === "json" ? result.json : result.markdown);
    }
  );

moduleCommand
  .command("lint")
  .description("Check module memory portability and promotion risks.")
  .argument("<module>", "Module name")
  .option("--format <format>", "Output format: markdown or json", "markdown")
  .action(async (moduleName: string, options: { format?: string }) => {
    const format = parseOutputFormat(options.format);
    const result = await lintModuleMemory(process.cwd(), moduleName);
    process.stdout.write(format === "json" ? result.json : result.markdown);
  });

program
  .command("reflect")
  .description("Generate a no-LLM reflection preview from notes and/or git diff.")
  .option("--from-git-diff", "Read the current git diff", false)
  .option("--notes <path>", "Read user notes from a project-local Markdown file")
  .option("--limit <n>", "Maximum number of related wiki pages to include")
  .option("--output-plan <path>", "Write the update plan draft to a project-local JSON file")
  .option("--force", "Overwrite the output plan if it already exists", false)
  .option("--format <format>", "Output format: markdown or json", "markdown")
  .option("--read-only", "Do not write evals or output plan files", false)
  .option("--save-raw", "Copy --notes into .aiwiki/sources/raw-notes before previewing", false)
  .action(
    async (
      options: {
        fromGitDiff?: boolean;
        notes?: string;
        limit?: string;
        outputPlan?: string;
        force?: boolean;
        format?: string;
        readOnly?: boolean;
        saveRaw?: boolean;
      }
    ) => {
      const format = parseOutputFormat(options.format);
      const result = await generateReflectPreview(process.cwd(), {
        fromGitDiff: options.fromGitDiff,
        notes: options.notes,
        limit: parsePositiveInteger(options.limit),
        outputPlan: options.outputPlan,
        force: options.force,
        readOnly: options.readOnly,
        saveRaw: options.saveRaw
      });

      process.stdout.write(format === "json" ? result.json : result.markdown);
    }
  );

program
  .command("ingest", { hidden: true })
  .description("Compatibility alias direction: use `reflect --notes <file> --save-raw`.")
  .argument("<file>", "Project-local Markdown note to ingest")
  .option("--force", "Overwrite the raw note copy and output plan if either destination exists", false)
  .option("--limit <n>", "Maximum number of related wiki pages to include")
  .option("--output-plan <path>", "Write the update plan draft to a project-local JSON file")
  .option("--format <format>", "Output format: markdown or json", "markdown")
  .action(
    async (
      file: string,
      options: {
        force?: boolean;
        limit?: string;
        outputPlan?: string;
        format?: string;
      }
    ) => {
      const format = parseOutputFormat(options.format);
      const result = await generateReflectPreview(process.cwd(), {
        notes: file,
        saveRaw: true,
        force: options.force,
        limit: parsePositiveInteger(options.limit),
        outputPlan: options.outputPlan
      });

      process.stdout.write(format === "json" ? result.json : result.markdown);
    }
  );

program
  .command("apply")
  .description("Preview or apply a confirmed AIWiki update plan.")
  .argument("<plan>", "Project-local JSON update plan")
  .option("--confirm", "Write the planned wiki updates", false)
  .option("--no-graph", "Skip graph rebuild after confirmed writes")
  .option("--format <format>", "Output format: markdown or json", "markdown")
  .action(
    async (
      planPath: string,
      options: { confirm?: boolean; graph?: boolean; format?: string }
    ) => {
      const format = parseOutputFormat(options.format);
      const plan = await readWikiUpdatePlanFile(process.cwd(), planPath);
      const result = await applyWikiUpdatePlan(process.cwd(), plan, {
        confirm: options.confirm,
        rebuildGraph: options.graph
      });

      process.stdout.write(format === "json" ? result.json : result.markdown);
    }
  );

program
  .command("lint")
  .description("Check AIWiki Markdown health.")
  .option("--format <format>", "Output format: markdown or json", "markdown")
  .action(async (options: { format?: string }) => {
    const format = parseOutputFormat(options.format);
    const result = await lintWiki(process.cwd());
    process.stdout.write(format === "json" ? result.json : result.markdown);

    if (result.report.summary.errors > 0) {
      process.exitCode = 1;
    }
  });

program
  .command("doctor")
  .description("Diagnose long-term AIWiki memory health and maintenance needs.")
  .option("--min-rule-count <n>", "Minimum pitfall encountered_count for rule promotion candidates")
  .option("--format <format>", "Output format: markdown or json", "markdown")
  .action(async (options: { minRuleCount?: string; format?: string }) => {
    const format = parseOutputFormat(options.format);
    const result = await doctorWiki(process.cwd(), {
      minRulePromotionCount: parsePositiveInteger(options.minRuleCount)
    });
    process.stdout.write(format === "json" ? result.json : result.markdown);

    if (result.report.summary.lintErrors > 0) {
      process.exitCode = 1;
    }
  });

const graphCommand = program
  .command("graph", { hidden: true })
  .description("Build and inspect the AIWiki graph.");

graphCommand
  .command("build")
  .description("Build .aiwiki/graph/graph.json and backlinks.json.")
  .option("--format <format>", "Output format: markdown or json", "markdown")
  .action(async (options: { format?: string }) => {
    const format = parseOutputFormat(options.format);
    const result = await buildWikiGraph(process.cwd(), { write: true });

    if (format === "json") {
      process.stdout.write(result.json);
      return;
    }

    console.log(`Graph written to ${result.outputPaths?.graph}`);
    console.log(`Backlinks written to ${result.outputPaths?.backlinks}`);
    console.log(`Nodes: ${result.graph.nodes.length}`);
    console.log(`Edges: ${result.graph.edges.length}`);
  });

graphCommand
  .command("import-graphify")
  .description("Read Graphify output as temporary structural context.")
  .argument("<path>", "Project-local graphify-out directory, GRAPH_REPORT.md, or graph.json")
  .option("--output <path>", "Write the imported context to a project-local file")
  .option("--force", "Overwrite the output file if it already exists", false)
  .option("--format <format>", "Output format: markdown or json", "markdown")
  .action(async (
    graphifyPath: string,
    options: { output?: string; force?: boolean; format?: string }
  ) => {
    const format = parseOutputFormat(options.format);
    const result = await importGraphifyContext(process.cwd(), graphifyPath, {
      output: options.output,
      force: options.force,
      format
    });
    process.stdout.write(format === "json" ? result.json : result.markdown);
  });

graphCommand
  .command("relate")
  .description("Summarize wiki graph relations for a project-local file.")
  .argument("<file>", "Project-local file path")
  .option("--with-graphify", "Include graphify-out structural context when available", false)
  .option("--format <format>", "Output format: markdown or json", "markdown")
  .action(
    async (
      file: string,
      options: { withGraphify?: boolean; format?: string }
    ) => {
      const format = parseOutputFormat(options.format);
      const result = await relateGraphFile(process.cwd(), file, {
        withGraphify: options.withGraphify
      });
      process.stdout.write(format === "json" ? result.json : result.markdown);
    }
  );

program
  .command("promote-rules", { hidden: true })
  .description("Preview rule promotion candidates from repeated high-severity pitfalls.")
  .option("--min-count <n>", "Minimum encountered_count required", "2")
  .option("--format <format>", "Output format: markdown or json", "markdown")
  .action(async (options: { minCount?: string; format?: string }) => {
    const format = parseOutputFormat(options.format);
    const result = await generateRulePromotionPreview(process.cwd(), {
      minCount: parsePositiveInteger(options.minCount)
    });

    process.stdout.write(format === "json" ? result.json : result.markdown);
  });

const taskCommand = program
  .command("task")
  .description("Record and resume AIWiki project tasks.");

taskCommand
  .command("start")
  .description("Start a new AIWiki task.")
  .argument("<task>", "Task title or original request")
  .option("--id <id>", "Explicit task id")
  .option("--prd <path>", "Project-local PRD/source document path")
  .option("--type <type>", "Task type: task, bug, feature, epic, chore")
  .option("--priority <n>", "Priority 0-4 where 0 is highest")
  .option("--actor <actor>", "Assignee/actor claiming the task")
  .option("--format <format>", "Output format: markdown or json", "markdown")
  .action(
    async (
      task: string,
      options: {
        id?: string;
        prd?: string;
        type?: string;
        priority?: string;
        actor?: string;
        format?: string;
      }
    ) => {
      const format = parseOutputFormat(options.format);
      const result = await startTask(process.cwd(), task, {
        id: options.id,
        prd: options.prd,
        type: parseTaskType(options.type),
        priority: parsePriority(options.priority),
        assignee: options.actor
      });
      process.stdout.write(format === "json" ? result.json : result.markdown);
    }
  );

taskCommand
  .command("create")
  .description("Create an open AIWiki task without claiming it.")
  .argument("<task>", "Task title or original request")
  .option("--id <id>", "Explicit task id")
  .option("--prd <path>", "Project-local PRD/source document path")
  .option("--type <type>", "Task type: task, bug, feature, epic, chore")
  .option("--priority <n>", "Priority 0-4 where 0 is highest")
  .option("--format <format>", "Output format: markdown or json", "markdown")
  .action(
    async (
      task: string,
      options: {
        id?: string;
        prd?: string;
        type?: string;
        priority?: string;
        format?: string;
      }
    ) => {
      const format = parseOutputFormat(options.format);
      const result = await createTask(process.cwd(), task, {
        id: options.id,
        prd: options.prd,
        type: parseTaskType(options.type),
        priority: parsePriority(options.priority)
      });
      process.stdout.write(format === "json" ? result.json : result.markdown);
    }
  );

taskCommand
  .command("list")
  .description("List AIWiki tasks.")
  .option("--status <status>", "Filter by status: open, in_progress, blocked, deferred, done, paused, cancelled")
  .option("--recent <n>", "Maximum number of recent tasks")
  .option("--format <format>", "Output format: markdown or json", "markdown")
  .action(
    async (options: { status?: string; recent?: string; format?: string }) => {
      const format = parseOutputFormat(options.format);
      const result = await listTasks(process.cwd(), {
        status: parseTaskStatus(options.status),
        recent: parsePositiveInteger(options.recent)
      });
      process.stdout.write(format === "json" ? result.json : result.markdown);
    }
  );

taskCommand
  .command("ready")
  .description("List open tasks with no unfinished blocking dependencies.")
  .option("--limit <n>", "Maximum number of ready tasks")
  .option("--format <format>", "Output format: markdown or json", "markdown")
  .action(async (options: { limit?: string; format?: string }) => {
    const format = parseOutputFormat(options.format);
    const result = await readyTasks(process.cwd(), {
      limit: parsePositiveInteger(options.limit)
    });
    process.stdout.write(format === "json" ? result.json : result.markdown);
  });

taskCommand
  .command("claim")
  .description("Claim an open task as the active Codex task.")
  .argument("[id]", "Task id; defaults to the active task")
  .option("--actor <actor>", "Actor name to write as assignee")
  .option("--force", "Claim even when blocking dependencies are unfinished", false)
  .option("--format <format>", "Output format: markdown or json", "markdown")
  .action(async (id: string | undefined, options: { actor?: string; force?: boolean; format?: string }) => {
    const format = parseOutputFormat(options.format);
    const result = await claimTask(process.cwd(), id, {
      actor: options.actor,
      force: options.force
    });
    process.stdout.write(format === "json" ? result.json : result.markdown);
  });

taskCommand
  .command("discover")
  .description("Create an open task discovered during current work.")
  .argument("<task>", "Discovered task title")
  .option("--id <id>", "Explicit task id")
  .option("--from <id>", "Source task id; defaults to active task when present")
  .option("--type <type>", "Task type: task, bug, feature, epic, chore")
  .option("--priority <n>", "Priority 0-4 where 0 is highest")
  .option("--format <format>", "Output format: markdown or json", "markdown")
  .action(
    async (
      task: string,
      options: {
        id?: string;
        from?: string;
        type?: string;
        priority?: string;
        format?: string;
      }
    ) => {
      const format = parseOutputFormat(options.format);
      const result = await discoverTask(process.cwd(), task, {
        id: options.id,
        from: options.from,
        type: parseTaskType(options.type),
        priority: parsePriority(options.priority)
      });
      process.stdout.write(format === "json" ? result.json : result.markdown);
    }
  );

const taskDepCommand = taskCommand
  .command("dep")
  .description("Manage AIWiki task dependencies.");

taskDepCommand
  .command("add")
  .description("Add a dependency from a task to another task.")
  .argument("<task>", "Task id that is blocked or related")
  .argument("<dependency>", "Dependency/source task id")
  .option("--type <type>", "Dependency type: blocks, parent_child, related, discovered_from", "blocks")
  .option("--format <format>", "Output format: markdown or json", "markdown")
  .action(
    async (
      task: string,
      dependency: string,
      options: { type?: string; format?: string }
    ) => {
      const format = parseOutputFormat(options.format);
      const result = await addTaskDependency(process.cwd(), task, dependency, {
        type: parseDependencyType(options.type)
      });
      process.stdout.write(format === "json" ? result.json : result.markdown);
    }
  );

taskCommand
  .command("status")
  .description("Show current or selected AIWiki task status.")
  .argument("[id]", "Task id")
  .option("--format <format>", "Output format: markdown or json", "markdown")
  .action(async (id: string | undefined, options: { format?: string }) => {
    const format = parseOutputFormat(options.format);
    const result = await getTaskStatus(process.cwd(), id);
    process.stdout.write(format === "json" ? result.json : result.markdown);
  });

taskCommand
  .command("close")
  .description("Close the active AIWiki task.")
  .option("--status <status>", "Close status: done, paused, cancelled", "done")
  .option("--format <format>", "Output format: markdown or json", "markdown")
  .action(async (options: { status?: string; format?: string }) => {
    const status = parseTaskStatus(options.status);
    if (
      status === "in_progress" ||
      status === "open" ||
      status === "blocked" ||
      status === "deferred"
    ) {
      throw new Error("Close status must be done, paused, or cancelled.");
    }

    const format = parseOutputFormat(options.format);
    const result = await closeTask(process.cwd(), { status });
    process.stdout.write(format === "json" ? result.json : result.markdown);
  });

program
  .command("checkpoint")
  .description("Record a checkpoint for the active AIWiki task.")
  .option("--message <message>", "Checkpoint message")
  .option("--summary <summary>", "Alias for --message")
  .option("--step <step>", "Step or milestone name")
  .option("--status <status>", "Step status, such as done or in_progress")
  .option("--tests <tests>", "Test note, one per line if multiple")
  .option("--next <next>", "Next recommended step, one per line if multiple")
  .option("--from-git-diff", "Record changed files from git diff and status; this is now the default")
  .option("--no-from-git-diff", "Skip automatic changed-file capture")
  .option("--format <format>", "Output format: markdown or json", "markdown")
  .action(
    async (options: {
      message?: string;
      summary?: string;
      step?: string;
      status?: string;
      tests?: string;
      next?: string;
      fromGitDiff?: boolean;
      format?: string;
    }) => {
      const format = parseOutputFormat(options.format);
      const result = await checkpointTask(process.cwd(), {
        message: options.message ?? options.summary,
        step: options.step,
        status: options.status,
        tests: options.tests ? [options.tests] : undefined,
        next: options.next ? [options.next] : undefined,
        fromGitDiff: options.fromGitDiff
      });
      process.stdout.write(format === "json" ? result.json : result.markdown);
    }
  );

program
  .command("resume")
  .description("Generate a resume brief for the active or selected AIWiki task.")
  .argument("[id]", "Task id")
  .option("--output <path>", "Write resume brief to a project-local path")
  .option("--format <format>", "Output format: markdown or json", "markdown")
  .option("--read-only", "Do not write or refresh resume files", false)
  .action(
    async (
      id: string | undefined,
      options: { output?: string; format?: string; readOnly?: boolean }
    ) => {
      const format = parseOutputFormat(options.format);
      const result = await resumeTask(process.cwd(), id, {
        output: options.output,
        readOnly: options.readOnly
      });

      if (options.output && format === "markdown") {
        console.log(`Resume Brief written to ${result.data.outputPath}`);
        return;
      }

      process.stdout.write(format === "json" ? result.json : result.markdown);
    }
  );

program
  .command("decision", { hidden: true })
  .description("Record a user decision for the active AIWiki task.")
  .argument("<decision>", "Decision text")
  .option("--module <module>", "Related module")
  .option("--format <format>", "Output format: markdown or json", "markdown")
  .action(
    async (
      decision: string,
      options: { module?: string; format?: string }
    ) => {
      const format = parseOutputFormat(options.format);
      const result = await recordTaskDecision(process.cwd(), decision, {
        module: options.module
      });
      process.stdout.write(format === "json" ? result.json : result.markdown);
    }
  );

program
  .command("blocker", { hidden: true })
  .description("Record a blocker or open question for the active AIWiki task.")
  .argument("<blocker>", "Blocker or question text")
  .option("--severity <severity>", "Severity: low, medium, high, critical")
  .option("--format <format>", "Output format: markdown or json", "markdown")
  .action(
    async (
      blocker: string,
      options: { severity?: string; format?: string }
    ) => {
      const format = parseOutputFormat(options.format);
      const result = await recordTaskBlocker(process.cwd(), blocker, {
        severity: parseRiskLevel(options.severity)
      });
      process.stdout.write(format === "json" ? result.json : result.markdown);
    }
  );

program.exitOverride();

try {
  await program.parseAsync(process.argv);
} catch (error) {
  if (error instanceof Error && "code" in error) {
    const commanderError = error as Error & { code?: string; exitCode?: number };
    if (commanderError.code?.startsWith("commander.")) {
      process.exit(commanderError.exitCode ?? 1);
    }
  }

  if (wantsJsonError(process.argv)) {
    console.error(JSON.stringify(toStructuredCliError(error), null, 2));
  } else {
    console.error(error instanceof Error ? error.message : String(error));
  }
  process.exit(1);
}
