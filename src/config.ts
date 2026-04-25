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
    highRiskModules: z.array(z.string()).default([])
  })
  .strict();

export class AIWikiNotInitializedError extends Error {
  constructor(rootDir: string) {
    super(
      `AIWiki is not initialized in ${rootDir}. Run "aiwiki init" first.`
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
    highRiskModules: []
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
