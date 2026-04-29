#!/usr/bin/env node
import { Command } from "commander";
import { applyWikiUpdatePlan, readWikiUpdatePlanFile } from "./apply.js";
import { generateArchitectureAudit } from "./architecture.js";
import { generateDevelopmentBrief } from "./brief.js";
import { AIWIKI_VERSION } from "./constants.js";
import { buildWikiGraph, relateGraphFile } from "./graph.js";
import { importGraphifyContext } from "./graphify.js";
import { generateFileGuardrails } from "./guard.js";
import { initAIWiki } from "./init.js";
import {
  formatSearchResponse,
  parseOutputFormat,
  parsePositiveInteger
} from "./output.js";
import { generateIngestPreview } from "./ingest.js";
import { lintWiki } from "./lint.js";
import {
  exportModulePack,
  generateModuleImportPreview,
  generateModuleMemoryBrief,
  lintModuleMemory
} from "./module-pack.js";
import { generateProjectMap } from "./project-map.js";
import { generateRulePromotionPreview } from "./promote-rules.js";
import { generateReflectPreview } from "./reflect.js";
import { searchWikiMemory } from "./search.js";
import {
  checkpointTask,
  closeTask,
  getTaskStatus,
  listTasks,
  recordTaskBlocker,
  recordTaskDecision,
  resumeTask,
  startTask
} from "./task.js";
import type { RiskLevel, TaskStatus, WikiPageType } from "./types.js";
import { wikiPageTypeSchema } from "./wiki-frontmatter.js";

const program = new Command();

function parseTaskStatus(value: string | undefined): TaskStatus | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (
    value === "in_progress" ||
    value === "done" ||
    value === "paused" ||
    value === "cancelled"
  ) {
    return value;
  }

  throw new Error(`Unsupported task status: ${value}`);
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

program
  .name("aiwiki")
  .description("Local-first AI coding memory and context engineering CLI.")
  .version(AIWIKI_VERSION);

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
  .option("--format <format>", "Output format: markdown or json", "markdown")
  .action(
    async (
      query: string,
      options: { type?: string; limit?: string; format?: string }
    ) => {
      const format = parseOutputFormat(options.format);
      const parsedType = options.type
        ? wikiPageTypeSchema.parse(options.type)
        : undefined;
      const response = await searchWikiMemory(process.cwd(), query, {
        type: parsedType as WikiPageType | undefined,
        limit: parsePositiveInteger(options.limit)
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
      }
    ) => {
      const format = parseOutputFormat(options.format);
      const result = await generateDevelopmentBrief(process.cwd(), task, {
        limit: parsePositiveInteger(options.limit),
        output: options.output,
        force: options.force,
        format,
        withGraphify: options.withGraphify,
        architectureGuard: options.architectureGuard
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
  .command("architecture")
  .description("Inspect architecture health and portability risks.");

architectureCommand
  .command("audit")
  .description("Report architecture, hardcoding, and module memory risks.")
  .option("--format <format>", "Output format: markdown or json", "markdown")
  .action(async (options: { format?: string }) => {
    const format = parseOutputFormat(options.format);
    const result = await generateArchitectureAudit(process.cwd());
    process.stdout.write(format === "json" ? result.json : result.markdown);
  });

const moduleCommand = program
  .command("module")
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
  .action(
    async (
      options: {
        fromGitDiff?: boolean;
        notes?: string;
        limit?: string;
        outputPlan?: string;
        force?: boolean;
        format?: string;
      }
    ) => {
      const format = parseOutputFormat(options.format);
      const result = await generateReflectPreview(process.cwd(), {
        fromGitDiff: options.fromGitDiff,
        notes: options.notes,
        limit: parsePositiveInteger(options.limit),
        outputPlan: options.outputPlan,
        force: options.force
      });

      process.stdout.write(format === "json" ? result.json : result.markdown);
    }
  );

program
  .command("ingest")
  .description("Preserve a raw Markdown note and generate no-LLM wiki suggestions.")
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
      const result = await generateIngestPreview(process.cwd(), file, {
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

const graphCommand = program
  .command("graph")
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
  .command("promote-rules")
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
  .option("--format <format>", "Output format: markdown or json", "markdown")
  .action(
    async (
      task: string,
      options: { id?: string; prd?: string; format?: string }
    ) => {
      const format = parseOutputFormat(options.format);
      const result = await startTask(process.cwd(), task, {
        id: options.id,
        prd: options.prd
      });
      process.stdout.write(format === "json" ? result.json : result.markdown);
    }
  );

taskCommand
  .command("list")
  .description("List AIWiki tasks.")
  .option("--status <status>", "Filter by status: in_progress, done, paused, cancelled")
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
    if (status === "in_progress") {
      throw new Error("Close status cannot be in_progress.");
    }

    const format = parseOutputFormat(options.format);
    const result = await closeTask(process.cwd(), { status });
    process.stdout.write(format === "json" ? result.json : result.markdown);
  });

program
  .command("checkpoint")
  .description("Record a checkpoint for the active AIWiki task.")
  .option("--message <message>", "Checkpoint message")
  .option("--step <step>", "Step or milestone name")
  .option("--status <status>", "Step status, such as done or in_progress")
  .option("--tests <tests>", "Test note, one per line if multiple")
  .option("--next <next>", "Next recommended step, one per line if multiple")
  .option("--from-git-diff", "Record changed files from git diff", false)
  .option("--format <format>", "Output format: markdown or json", "markdown")
  .action(
    async (options: {
      message?: string;
      step?: string;
      status?: string;
      tests?: string;
      next?: string;
      fromGitDiff?: boolean;
      format?: string;
    }) => {
      const format = parseOutputFormat(options.format);
      const result = await checkpointTask(process.cwd(), {
        message: options.message,
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
  .action(
    async (
      id: string | undefined,
      options: { output?: string; format?: string }
    ) => {
      const format = parseOutputFormat(options.format);
      const result = await resumeTask(process.cwd(), id, {
        output: options.output
      });

      if (options.output && format === "markdown") {
        console.log(`Resume Brief written to ${result.data.outputPath}`);
        return;
      }

      process.stdout.write(format === "json" ? result.json : result.markdown);
    }
  );

program
  .command("decision")
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
  .command("blocker")
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

  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
