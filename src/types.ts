export type AIWikiProvider =
  | "openai"
  | "anthropic"
  | "openai-compatible"
  | "none";

export type WikiPageType =
  | "project_map"
  | "module"
  | "pitfall"
  | "decision"
  | "pattern"
  | "rule"
  | "file"
  | "source";

export type WikiPageStatus =
  | "active"
  | "deprecated"
  | "proposed"
  | "uncertain";

export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface AIWikiConfig {
  version: string;
  projectName: string;
  provider: AIWikiProvider;
  defaultModel?: string;
  baseUrl?: string;
  tokenBudget: {
    brief: number;
    guard: number;
    reflect: number;
  };
  rulesTargets: {
    agentsMd: boolean;
    claudeMd: boolean;
    cursorRules: boolean;
  };
  ignore: string[];
  riskFiles: string[];
  highRiskModules: string[];
}

export interface WikiPageFrontmatter {
  type: WikiPageType;
  status?: WikiPageStatus;
  title?: string;
  modules?: string[];
  files?: string[];
  tags?: string[];
  severity?: RiskLevel;
  risk?: RiskLevel;
  related_pitfalls?: string[];
  related_decisions?: string[];
  related_patterns?: string[];
  supersedes?: string[];
  conflicts_with?: string[];
  source_sessions?: string[];
  encountered_count?: number;
  created_at?: string;
  last_updated?: string;
  [key: string]: unknown;
}

export interface WikiPage {
  path: string;
  relativePath: string;
  frontmatter: WikiPageFrontmatter;
  body: string;
}

export interface LogEntry {
  action: string;
  title: string;
  date?: string;
  bullets?: string[];
}
