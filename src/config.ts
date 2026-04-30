import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  AIWIKI_VERSION,
  CONFIG_PATH,
  DEFAULT_IGNORE,
  DEFAULT_RULES_TARGETS,
  DEFAULT_TOKEN_BUDGET
} from "./constants.js";
import { resolveProjectPath } from "./paths.js";
import type { AIWikiConfig } from "./types.js";

export const CONFIG_VERSION = AIWIKI_VERSION;

const tokenBudgetSchema = z
  .object({
    brief: z.number().int().positive().optional(),
    guard: z.number().int().positive().optional(),
    reflect: z.number().int().positive().optional()
  })
  .default({})
  .transform((value) => ({
    brief: value.brief ?? DEFAULT_TOKEN_BUDGET.brief,
    guard: value.guard ?? DEFAULT_TOKEN_BUDGET.guard,
    reflect: value.reflect ?? DEFAULT_TOKEN_BUDGET.reflect
  }));

const rulesTargetsSchema = z
  .object({
    agentsMd: z.boolean().optional(),
    claudeMd: z.boolean().optional(),
    cursorRules: z.boolean().optional()
  })
  .default({})
  .transform((value) => ({
    agentsMd: value.agentsMd ?? DEFAULT_RULES_TARGETS.agentsMd,
    claudeMd: value.claudeMd ?? DEFAULT_RULES_TARGETS.claudeMd,
    cursorRules: value.cursorRules ?? DEFAULT_RULES_TARGETS.cursorRules
  }));

const architectureAuditSchema = z
  .object({
    ignorePaths: z.array(z.string()).optional(),
    ignoreLiteralPatterns: z.array(z.string()).optional()
  })
  .default({})
  .transform((value) => ({
    ignorePaths: value.ignorePaths ?? [],
    ignoreLiteralPatterns: value.ignoreLiteralPatterns ?? []
  }));

export const aiWikiConfigSchema = z
  .object({
    version: z.string().default(CONFIG_VERSION),
    projectName: z.string().min(1),
    provider: z
      .enum(["openai", "anthropic", "openai-compatible", "none"])
      .default("none"),
    defaultModel: z.string().optional(),
    baseUrl: z.string().url().optional(),
    tokenBudget: tokenBudgetSchema,
    rulesTargets: rulesTargetsSchema,
    ignore: z.array(z.string()).default(() => [...DEFAULT_IGNORE]),
    riskFiles: z.array(z.string()).default([]),
    highRiskModules: z.array(z.string()).default([]),
    architectureAudit: architectureAuditSchema
  })
  .strict();

export class AIWikiNotInitializedError extends Error {
  constructor(rootDir: string) {
    super(
      [
        `AIWiki is not initialized in ${rootDir}.`,
        "Run aiwiki init --project-name <name> to create local project memory.",
        "Then run aiwiki map --write so brief, guard, resume, and reflect have durable context."
      ].join("\n")
    );
    this.name = "AIWikiNotInitializedError";
  }
}

export function createDefaultConfig(projectName: string): AIWikiConfig {
  return aiWikiConfigSchema.parse({
    version: CONFIG_VERSION,
    projectName,
    provider: "none",
    tokenBudget: {
      ...DEFAULT_TOKEN_BUDGET
    },
    rulesTargets: {
      ...DEFAULT_RULES_TARGETS
    },
    ignore: [...DEFAULT_IGNORE],
    riskFiles: [],
    highRiskModules: [],
    architectureAudit: {
      ignorePaths: [],
      ignoreLiteralPatterns: []
    }
  });
}

export async function loadAIWikiConfig(
  rootDir = process.cwd()
): Promise<AIWikiConfig> {
  const configPath = resolveProjectPath(rootDir, CONFIG_PATH);

  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new AIWikiNotInitializedError(path.resolve(rootDir));
    }

    throw error;
  }

  const parsed = JSON.parse(raw) as unknown;
  return aiWikiConfigSchema.parse(parsed);
}
