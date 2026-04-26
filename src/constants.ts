export const AIWIKI_VERSION = "0.1.0";

export const AIWIKI_DIR = ".aiwiki";
export const CONFIG_PATH = `${AIWIKI_DIR}/config.json`;
export const AGENTS_PATH = `${AIWIKI_DIR}/AGENTS.md`;
export const INDEX_PATH = `${AIWIKI_DIR}/index.md`;
export const LOG_PATH = `${AIWIKI_DIR}/log.md`;
export const WIKI_DIR = `${AIWIKI_DIR}/wiki`;
export const GRAPH_DIR = `${AIWIKI_DIR}/graph`;
export const GRAPH_JSON_PATH = `${GRAPH_DIR}/graph.json`;
export const BACKLINKS_JSON_PATH = `${GRAPH_DIR}/backlinks.json`;
export const TASKS_DIR = `${AIWIKI_DIR}/tasks`;
export const ACTIVE_TASK_PATH = `${TASKS_DIR}/active-task`;
export const PROMPTS_DIR = `${AIWIKI_DIR}/prompts`;
export const BRIEF_EVALS_PATH = `${AIWIKI_DIR}/evals/brief-cases.jsonl`;
export const REFLECT_EVALS_PATH = `${AIWIKI_DIR}/evals/reflect-cases.jsonl`;
export const PROJECT_MAP_PATH = `${WIKI_DIR}/project-map.md`;
export const RAW_NOTES_DIR = `${AIWIKI_DIR}/sources/raw-notes`;

export const DEFAULT_TOKEN_BUDGET = {
  brief: 8000,
  guard: 3000,
  reflect: 10000
} as const;

export const DEFAULT_RULE_PROMOTION_MIN_COUNT = 2;

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
  TASKS_DIR,
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
  GRAPH_JSON_PATH,
  BACKLINKS_JSON_PATH
] as const;

export const INITIAL_EVAL_FILES = [
  BRIEF_EVALS_PATH,
  REFLECT_EVALS_PATH,
  `${AIWIKI_DIR}/evals/context-feedback.jsonl`
] as const;

export const PROJECT_SCAN_EXCLUDED_PATHS = [
  AIWIKI_DIR,
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  "coverage"
] as const;

export const GENERATED_FILE_CANDIDATES = [
  "dist",
  "build",
  ".next",
  "coverage",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock"
] as const;

export const IMPORTANT_DIRECTORY_CANDIDATES = [
  "src",
  "app",
  "pages",
  "components",
  "lib",
  "server",
  "api",
  "tests",
  "test",
  "prisma",
  "db",
  "supabase",
  "migrations"
] as const;

export const RISK_FILE_KEYWORDS = [
  "auth",
  "permission",
  "rbac",
  "role",
  "billing",
  "payment",
  "stripe",
  "webhook",
  "migration",
  "schema",
  "security",
  "secret",
  "token"
] as const;
