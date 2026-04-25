import { z } from "zod";
import type { WikiPageFrontmatter } from "./types.js";

export const wikiPageTypeSchema = z.enum([
  "project_map",
  "module",
  "pitfall",
  "decision",
  "pattern",
  "rule",
  "file",
  "source"
]);

const wikiPageStatusSchema = z.enum([
  "active",
  "deprecated",
  "proposed",
  "uncertain"
]);

const riskLevelSchema = z.enum(["low", "medium", "high", "critical"]);

export const wikiPageFrontmatterSchema = z
  .object({
    type: wikiPageTypeSchema,
    status: wikiPageStatusSchema.optional(),
    title: z.string().optional(),
    modules: z.array(z.string()).optional(),
    files: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    severity: riskLevelSchema.optional(),
    risk: riskLevelSchema.optional(),
    related_pitfalls: z.array(z.string()).optional(),
    related_decisions: z.array(z.string()).optional(),
    related_patterns: z.array(z.string()).optional(),
    supersedes: z.array(z.string()).optional(),
    conflicts_with: z.array(z.string()).optional(),
    source_sessions: z.array(z.string()).optional(),
    encountered_count: z.number().int().nonnegative().optional(),
    created_at: z.string().optional(),
    last_updated: z.string().optional()
  })
  .catchall(z.unknown());

export function parseWikiPageFrontmatter(
  value: unknown
): WikiPageFrontmatter {
  return wikiPageFrontmatterSchema.parse(value);
}
