#!/usr/bin/env node
import { Command } from "commander";
import { generateDevelopmentBrief } from "./brief.js";
import { AIWIKI_VERSION } from "./constants.js";
import { initAIWiki } from "./init.js";
import {
  formatSearchResponse,
  parseOutputFormat,
  parsePositiveInteger
} from "./output.js";
import { searchWikiMemory } from "./search.js";
import type { WikiPageType } from "./types.js";
import { wikiPageTypeSchema } from "./wiki-frontmatter.js";

const program = new Command();

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
  .action(
    async (
      task: string,
      options: {
        limit?: string;
        output?: string;
        force?: boolean;
        format?: string;
      }
    ) => {
      const format = parseOutputFormat(options.format);
      const result = await generateDevelopmentBrief(process.cwd(), task, {
        limit: parsePositiveInteger(options.limit),
        output: options.output,
        force: options.force,
        format
      });

      if (result.outputPath) {
        console.log(`Development Brief written to ${result.outputPath}`);
        return;
      }

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
