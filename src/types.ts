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
  architectureAudit: {
    ignorePaths: string[];
    ignoreLiteralPatterns: string[];
  };
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

export type GraphNodeType = WikiPageType | "file" | "session";

export type GraphEdgeType =
  | "relates_to"
  | "applies_to"
  | "fixed_by"
  | "caused_by"
  | "supersedes"
  | "conflicts_with"
  | "promoted_from"
  | "references_file";

export interface GraphNode {
  id: string;
  type: GraphNodeType;
  label: string;
  path?: string;
  status?: string;
  severity?: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  type: GraphEdgeType;
  source?: string;
}

export interface GraphJson {
  version: string;
  generated_at: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export type TaskStatus =
  | "open"
  | "in_progress"
  | "blocked"
  | "deferred"
  | "done"
  | "paused"
  | "cancelled";

export type TaskType = "task" | "bug" | "feature" | "epic" | "chore";

export type TaskDependencyType =
  | "blocks"
  | "parent_child"
  | "related"
  | "discovered_from";

export interface TaskDependency {
  id: string;
  type: TaskDependencyType;
  created_at: string;
}

export interface TaskMetadata {
  id: string;
  title: string;
  status: TaskStatus;
  type?: TaskType;
  priority?: number;
  assignee?: string;
  claimed_at?: string;
  created_at: string;
  updated_at: string;
  closed_at?: string;
  prd?: string;
  dependencies?: TaskDependency[];
}

export interface TaskCheckpoint {
  time: string;
  type:
    | "checkpoint"
    | "decision"
    | "blocker"
    | "task_created"
    | "task_claimed"
    | "dependency_added"
    | "task_discovered"
    | "task_closed";
  message?: string;
  step?: string;
  status?: string;
  tests?: string[];
  next?: string[];
  files?: string[];
  module?: string;
  severity?: RiskLevel;
  actor?: string;
  task_id?: string;
  dependency_id?: string;
  dependency_type?: TaskDependencyType;
  from?: string;
}
