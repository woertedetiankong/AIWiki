export const AIWIKI_VERSION = "0.1.0";

export const AIWIKI_DIR = ".aiwiki";
export const CONFIG_PATH = `${AIWIKI_DIR}/config.json`;
export const AGENTS_PATH = `${AIWIKI_DIR}/AGENTS.md`;
export const INDEX_PATH = `${AIWIKI_DIR}/index.md`;
export const LOG_PATH = `${AIWIKI_DIR}/log.md`;
export const WIKI_DIR = `${AIWIKI_DIR}/wiki`;
export const PROMPTS_DIR = `${AIWIKI_DIR}/prompts`;
export const BRIEF_EVALS_PATH = `${AIWIKI_DIR}/evals/brief-cases.jsonl`;

export const DEFAULT_TOKEN_BUDGET = {
  brief: 8000,
  guard: 3000,
  reflect: 10000
} as const;

export const DEFAULT_RULES_TARGETS = {
  agentsMd: true,
  claudeMd: false,
  cursorRules: false
} as const;

export const DEFAULT_IGNORE = [
  ".env*",
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next"
] as const;

export const AIWIKI_DIRECTORIES = [
  AIWIKI_DIR,
  `${AIWIKI_DIR}/sessions`,
  `${AIWIKI_DIR}/sources/raw-notes`,
  `${AIWIKI_DIR}/sources/git-diffs`,
  `${AIWIKI_DIR}/sources/ai-summaries`,
  `${WIKI_DIR}/modules`,
  `${WIKI_DIR}/pitfalls`,
  `${WIKI_DIR}/decisions`,
  `${WIKI_DIR}/patterns`,
  `${WIKI_DIR}/rules`,
  `${WIKI_DIR}/files`,
  `${AIWIKI_DIR}/graph`,
  `${AIWIKI_DIR}/context-packs`,
  PROMPTS_DIR,
  `${AIWIKI_DIR}/evals`
] as const;

export const AIWIKI_GITKEEP_DIRECTORIES = AIWIKI_DIRECTORIES.filter(
  (directory) => directory !== AIWIKI_DIR
);

export const INITIAL_GRAPH_FILES = [
  `${AIWIKI_DIR}/graph/graph.json`,
  `${AIWIKI_DIR}/graph/backlinks.json`
] as const;

export const INITIAL_EVAL_FILES = [
  BRIEF_EVALS_PATH,
  `${AIWIKI_DIR}/evals/reflect-cases.jsonl`,
  `${AIWIKI_DIR}/evals/context-feedback.jsonl`
] as const;
