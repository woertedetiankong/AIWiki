import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AIWikiNotInitializedError, createDefaultConfig, loadAIWikiConfig } from "./config.js";
import { AIWIKI_VERSION } from "./constants.js";
import { resolveProjectPath, toPosixPath } from "./paths.js";
import type { WikiUpdatePlan, WikiUpdatePlanEntry } from "./apply.js";

export type SessionProvider = "codex" | "claude";

export interface SessionScanOptions {
  provider?: SessionProvider;
  path?: string;
  since?: string;
  limit?: number;
  allProjects?: boolean;
}

export interface SessionReflectOptions extends SessionScanOptions {
  outputPlan?: string;
  force?: boolean;
  readOnly?: boolean;
}

export interface SessionRecord {
  provider: SessionProvider;
  sessionId: string;
  path: string;
  startedAt?: string;
  updatedAt?: string;
  cwd?: string;
  messageCount: number;
  toolCallCount: number;
  errorCount: number;
  signalCount: number;
  contentHash: string;
  summaries: string[];
}

export interface SessionSignal {
  kind: "pitfall" | "decision";
  sessionId: string;
  provider: SessionProvider;
  timestamp?: string;
  title: string;
  summary: string;
  files: string[];
  modules: string[];
  excerpt: string;
}

export interface SessionScanResult {
  projectName: string;
  provider: SessionProvider;
  tracePath: string;
  matchedProjectOnly: boolean;
  sessions: SessionRecord[];
  markdown: string;
  json: string;
}

export interface SessionReflectPreview {
  projectName: string;
  provider: SessionProvider;
  tracePath: string;
  sessions: SessionRecord[];
  signals: SessionSignal[];
  updatePlanDraft?: WikiUpdatePlan;
  outputPlanPath?: string;
  safety: string[];
}

export interface SessionReflectResult {
  preview: SessionReflectPreview;
  markdown: string;
  json: string;
}

interface RawSession {
  record: SessionRecord;
  messages: Array<{
    role: string;
    text: string;
    timestamp?: string;
  }>;
}

const DEFAULT_PROVIDER: SessionProvider = "codex";
const DEFAULT_SCAN_LIMIT = 10;
const DEFAULT_REFLECT_LIMIT = 6;
const MAX_SCAN_SIGNAL_COUNT = 1000;
const MAX_SIGNAL_EXCERPT = 900;

const PITFALL_WORDS = [
  "踩坑",
  "坑",
  "报错",
  "错误",
  "失败",
  "根因",
  "复盘",
  "pitfall",
  "bug",
  "error",
  "failed",
  "failure",
  "regression",
  "root cause",
  "stuck"
];

const DECISION_WORDS = [
  "决定",
  "选择",
  "约定",
  "decision",
  "decided",
  "choose",
  "chose",
  "prefer"
];

const LOW_SIGNAL_WORDS = [
  "help",
  "介绍",
  "解释",
  "查询",
  "recommend",
  "推荐"
];

function defaultProjectName(rootDir: string): string {
  return path.basename(path.resolve(rootDir)) || "project";
}

function expandHome(value: string): string {
  if (value === "~") {
    return os.homedir();
  }

  if (value.startsWith("~/")) {
    return path.join(os.homedir(), value.slice(2));
  }

  return value;
}

function defaultTracePath(provider: SessionProvider): string {
  return provider === "claude"
    ? path.join(os.homedir(), ".claude", "projects")
    : path.join(os.homedir(), ".codex", "sessions");
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

async function collectJsonlFiles(directory: string): Promise<string[]> {
  if (!(await pathExists(directory))) {
    return [];
  }

  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectJsonlFiles(entryPath)));
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      files.push(entryPath);
    }
  }

  return files;
}

function parseJsonLine(line: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(line) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function parseTimestamp(value: unknown): Date | undefined {
  const text = asString(value);
  if (!text) {
    return undefined;
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function earliest(left: string | undefined, right: unknown): string | undefined {
  const rightDate = parseTimestamp(right);
  if (!rightDate) {
    return left;
  }
  if (!left) {
    return rightDate.toISOString();
  }

  const leftDate = parseTimestamp(left);
  return leftDate && leftDate <= rightDate ? left : rightDate.toISOString();
}

function latest(left: string | undefined, right: unknown): string | undefined {
  const rightDate = parseTimestamp(right);
  if (!rightDate) {
    return left;
  }
  if (!left) {
    return rightDate.toISOString();
  }

  const leftDate = parseTimestamp(left);
  return leftDate && leftDate >= rightDate ? left : rightDate.toISOString();
}

function textFromContent(content: unknown): string | undefined {
  if (typeof content === "string") {
    return content.trim() || undefined;
  }

  if (!Array.isArray(content)) {
    return undefined;
  }

  const parts = content
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }
      const block = asObject(item);
      if (!block) {
        return undefined;
      }
      return asString(block.text) ?? asString(block.content);
    })
    .filter((item): item is string => Boolean(item));

  const text = parts.join("\n").trim();
  return text.length > 0 ? text : undefined;
}

function isProjectSession(rootDir: string, cwd: string | undefined): boolean {
  if (!cwd) {
    return false;
  }

  const root = path.resolve(rootDir);
  const absoluteCwd = path.resolve(expandHome(cwd));
  return absoluteCwd === root || absoluteCwd.startsWith(`${root}${path.sep}`);
}

function fileSessionId(filePath: string): string {
  return path.basename(filePath, ".jsonl").replace(/^rollout-[^-]+-/u, "");
}

async function parseCodexSession(filePath: string): Promise<RawSession | undefined> {
  const raw = await readFile(filePath, "utf8");
  const lines = raw.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return undefined;
  }

  let sessionId = fileSessionId(filePath);
  let cwd: string | undefined;
  let startedAt: string | undefined;
  let updatedAt: string | undefined;
  let toolCallCount = 0;
  let errorCount = 0;
  const messages: RawSession["messages"] = [];

  for (const line of lines) {
    const entry = parseJsonLine(line);
    if (!entry) {
      continue;
    }

    const payload = asObject(entry.payload);
    startedAt = earliest(startedAt, entry.timestamp ?? payload?.timestamp);
    updatedAt = latest(updatedAt, entry.timestamp ?? payload?.timestamp);

    if (entry.type === "session_meta" && payload) {
      sessionId = asString(payload.id) ?? sessionId;
      cwd = asString(payload.cwd) ?? cwd;
      continue;
    }

    if (entry.type === "event_msg" && payload) {
      const eventType = asString(payload.type);
      const role = eventType === "user_message"
        ? "user"
        : eventType === "agent_message"
          ? "assistant"
          : undefined;
      const text = asString(payload.message);
      if (role && text) {
        messages.push({ role, text, timestamp: asString(entry.timestamp) });
      }
      continue;
    }

    if (entry.type !== "response_item" || !payload) {
      continue;
    }

    const payloadType = asString(payload.type);
    if (payloadType === "function_call") {
      toolCallCount += 1;
      continue;
    }
    if (payloadType === "function_call_output") {
      const output = String(payload.output ?? "");
      if (/error|failed|exception|traceback/iu.test(output)) {
        errorCount += 1;
      }
      continue;
    }
    if (payloadType !== "message") {
      continue;
    }

    const role = asString(payload.role);
    if (role !== "user" && role !== "assistant") {
      continue;
    }

    const text = textFromContent(payload.content);
    if (text) {
      messages.push({ role, text, timestamp: asString(entry.timestamp) });
    }
  }

  return {
    record: {
      provider: "codex",
      sessionId,
      path: filePath,
      startedAt,
      updatedAt,
      cwd,
      messageCount: messages.length,
      toolCallCount,
      errorCount,
      signalCount: 0,
      contentHash: hashText(raw),
      summaries: []
    },
    messages
  };
}

async function parseClaudeSession(filePath: string): Promise<RawSession | undefined> {
  const raw = await readFile(filePath, "utf8");
  const lines = raw.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return undefined;
  }

  let sessionId = fileSessionId(filePath);
  let cwd: string | undefined;
  let startedAt: string | undefined;
  let updatedAt: string | undefined;
  let toolCallCount = 0;
  let errorCount = 0;
  const summaries: string[] = [];
  const messages: RawSession["messages"] = [];

  for (const line of lines) {
    const entry = parseJsonLine(line);
    if (!entry) {
      continue;
    }

    sessionId = asString(entry.sessionId) ?? asString(entry.uuid) ?? sessionId;
    cwd = asString(entry.cwd) ?? cwd;
    startedAt = earliest(startedAt, entry.timestamp);
    updatedAt = latest(updatedAt, entry.timestamp);

    if (entry.type === "summary") {
      const summary = asString(entry.summary);
      if (summary) {
        summaries.push(summary);
      }
      continue;
    }

    const entryType = asString(entry.type);
    if (entryType !== "user" && entryType !== "assistant") {
      continue;
    }

    const message = asObject(entry.message);
    const text = message
      ? textFromContent(message.content)
      : textFromContent(entry.message);
    if (text) {
      messages.push({ role: entryType, text, timestamp: asString(entry.timestamp) });
    }

    const content = message?.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        const item = asObject(block);
        if (item?.type === "tool_use") {
          toolCallCount += 1;
        }
        if (item?.type === "tool_result" && item.is_error) {
          errorCount += 1;
        }
      }
    }
  }

  return {
    record: {
      provider: "claude",
      sessionId,
      path: filePath,
      startedAt,
      updatedAt,
      cwd,
      messageCount: messages.length,
      toolCallCount,
      errorCount,
      signalCount: 0,
      contentHash: hashText(raw),
      summaries
    },
    messages
  };
}

function sinceDate(value: string | undefined): Date | undefined {
  if (!value) {
    return undefined;
  }

  const duration = /^(\d+)([hdw])$/iu.exec(value.trim());
  if (duration) {
    const amount = Number(duration[1]);
    const unit = duration[2].toLowerCase();
    const hours = unit === "h" ? amount : unit === "d" ? amount * 24 : amount * 24 * 7;
    return new Date(Date.now() - hours * 60 * 60 * 1000);
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Unsupported --since value: ${value}. Use an ISO date or a duration like 24h, 7d, or 2w.`);
  }

  return parsed;
}

async function loadRawSessions(
  rootDir: string,
  options: SessionScanOptions
): Promise<{ provider: SessionProvider; tracePath: string; sessions: RawSession[] }> {
  const provider = options.provider ?? DEFAULT_PROVIDER;
  const tracePath = path.resolve(expandHome(options.path ?? defaultTracePath(provider)));
  const start = sinceDate(options.since);
  const files = await collectJsonlFiles(tracePath);
  const parser = provider === "claude" ? parseClaudeSession : parseCodexSession;
  const sessions: RawSession[] = [];

  for (const file of files) {
    const parsed = await parser(file);
    if (!parsed) {
      continue;
    }

    if (!options.allProjects && !isProjectSession(rootDir, parsed.record.cwd)) {
      continue;
    }

    const updatedAt = parseTimestamp(parsed.record.updatedAt ?? parsed.record.startedAt);
    if (start && updatedAt && updatedAt < start) {
      continue;
    }

    sessions.push(parsed);
  }

  sessions.sort((left, right) =>
    String(right.record.updatedAt ?? right.record.startedAt ?? "").localeCompare(
      String(left.record.updatedAt ?? left.record.startedAt ?? "")
    )
  );

  return {
    provider,
    tracePath,
    sessions: sessions.slice(0, options.limit ?? DEFAULT_SCAN_LIMIT)
  };
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function containsAny(value: string, words: string[]): boolean {
  const lower = value.toLowerCase();
  return words.some((word) => lower.includes(word.toLowerCase()));
}

function shouldSkipLowSignal(value: string): boolean {
  const normalized = value.toLowerCase();
  if (
    normalized.length > 5000 ||
    normalized.includes("<instructions>") ||
    normalized.includes("<subagent_notification>") ||
    normalized.startsWith("# agents.md instructions") ||
    normalized.startsWith("chunk id:") ||
    normalized.startsWith("✓ ") ||
    normalized.includes("test files") ||
    normalized.includes("duration ") ||
    normalized.includes("# aiwiki engineering standards")
  ) {
    return true;
  }

  return containsAny(normalized, LOW_SIGNAL_WORDS) &&
    !containsAny(normalized, [...PITFALL_WORDS, ...DECISION_WORDS]);
}

function assistantHasExplicitMemoryShape(value: string): boolean {
  return /^\s*#*\s*(?:Pitfall|踩坑|Root Cause|根因|问题现象|修复方式)\s*[:：]?/iu.test(value) ||
    /^\s*#*\s*(?:Decision|决定|决策)\s*[:：]/iu.test(value);
}

function hasPitfallSignal(value: string): boolean {
  return /(?:踩坑|坑点|问题现象|根因|修复方式)\s*[:：]/u.test(value) ||
    /\b(?:pitfall|root cause|bug|error|failed|failure|regression|stuck)\b/iu.test(value) ||
    /(?:报错|错误|失败|复盘)/u.test(value);
}

function hasDecisionSignal(value: string): boolean {
  return /(?:决定|决策|约定)\s*[:：]/u.test(value) ||
    /\b(?:decision|decided|choose|chose|prefer)\b/iu.test(value) ||
    /选择.+(?:方案|路线|实现|做法)/u.test(value);
}

function titleFromText(text: string, kind: SessionSignal["kind"]): string {
  const firstLine = text
    .split("\n")
    .map((line) => line.trim().replace(/^#+\s*/u, ""))
    .find((line) => line.length > 0) ?? (kind === "pitfall" ? "Session pitfall" : "Session decision");
  const cleaned = normalizeWhitespace(firstLine)
    .replace(/^[-*]\s*/u, "")
    .replace(/^问题现象[:：]\s*/u, "")
    .replace(/^根因[:：]\s*/u, "")
    .replace(/^修复方式[:：]\s*/u, "")
    .replace(/^decision[:：]\s*/iu, "")
    .replace(/^pitfall[:：]\s*/iu, "");
  const clipped = cleaned.length > 72 ? `${cleaned.slice(0, 72).trim()}...` : cleaned;
  return clipped || (kind === "pitfall" ? "Session pitfall" : "Session decision");
}

function summaryFromText(text: string, kind: SessionSignal["kind"]): string {
  const clipped = normalizeWhitespace(text).slice(0, 240).trim();
  if (kind === "pitfall") {
    return `Session suggested a reusable pitfall: ${clipped}`;
  }

  return `Session suggested a durable decision or rule: ${clipped}`;
}

function extractFiles(rootDir: string, text: string): string[] {
  const matches = new Set<string>();
  const filePattern = /\b(?:src|app|lib|tests?|docs|pages|components|scripts|bin|config)\/[A-Za-z0-9._/@+-]+|\b(?:README|SPEC|CHANGELOG|AGENTS|package|tsconfig)[A-Za-z0-9._-]*/gu;
  for (const match of text.matchAll(filePattern)) {
    const cleaned = match[0]
      .replace(/[),.;:'"`\]]+$/u, "")
      .replace(/^\.\//u, "");
    if (!cleaned.includes("..")) {
      matches.add(toPosixPath(cleaned));
    }
  }

  return [...matches].filter((file) => {
    const absolute = resolveProjectPath(rootDir, file);
    return absolute.startsWith(path.resolve(rootDir));
  }).slice(0, 8);
}

function moduleNameFromFile(file: string): string | undefined {
  const parts = toPosixPath(file)
    .replace(/\.[^.]+$/u, "")
    .split(/[/.\\_-]+/u)
    .map((part) => part.toLowerCase())
    .filter((part) =>
      part.length > 2 &&
      !["src", "app", "lib", "test", "tests", "docs", "index", "route", "page", "readme", "spec", "package"].includes(part)
    );

  return parts.at(-1);
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function signalFromMessage(
  rootDir: string,
  session: RawSession,
  message: RawSession["messages"][number]
): SessionSignal | undefined {
  const text = normalizeWhitespace(message.text);
  if (text.length < 24 || shouldSkipLowSignal(text)) {
    return undefined;
  }
  if (message.role === "assistant" && !assistantHasExplicitMemoryShape(message.text)) {
    return undefined;
  }

  const isPitfall = hasPitfallSignal(message.text);
  const isDecision = hasDecisionSignal(message.text);
  if (!isPitfall && !isDecision) {
    return undefined;
  }

  const kind: SessionSignal["kind"] = isPitfall ? "pitfall" : "decision";
  const files = extractFiles(rootDir, message.text);
  const modules = unique(files.map(moduleNameFromFile));
  return {
    kind,
    sessionId: session.record.sessionId,
    provider: session.record.provider,
    timestamp: message.timestamp,
    title: titleFromText(message.text, kind),
    summary: summaryFromText(message.text, kind),
    files,
    modules,
    excerpt: text.length > MAX_SIGNAL_EXCERPT
      ? `${text.slice(0, MAX_SIGNAL_EXCERPT).trim()}...`
      : text
  };
}

function extractSignals(rootDir: string, sessions: RawSession[], limit: number): SessionSignal[] {
  const signals: SessionSignal[] = [];
  const seen = new Set<string>();

  for (const session of sessions) {
    for (const message of session.messages) {
      const signal = signalFromMessage(rootDir, session, message);
      if (!signal) {
        continue;
      }

      const key = `${signal.kind}:${signal.title.toLowerCase()}:${signal.files.join(",")}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      signals.push(signal);
      if (signals.length >= limit) {
        return signals;
      }
    }
  }

  return signals;
}

function safeSlug(value: string, fallback: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");
  if (slug) {
    return slug;
  }

  return `${fallback}-${hashText(value).slice(0, 8)}`;
}

function bodyForSignal(signal: SessionSignal): string {
  if (signal.kind === "decision") {
    return [
      `# Decision: ${signal.title}`,
      "",
      "## Context",
      "",
      signal.excerpt,
      "",
      "## Decision",
      "",
      "Review this session-derived candidate before treating it as durable project memory.",
      "",
      "## Consequences",
      "",
      "Use `aiwiki apply` preview output to decide whether this belongs in the target project.",
      "",
      "## Source",
      "",
      `- Provider: ${signal.provider}`,
      `- Session: ${signal.sessionId}`,
      signal.timestamp ? `- Timestamp: ${signal.timestamp}` : undefined
    ].filter((line): line is string => line !== undefined).join("\n");
  }

  return [
    `# Pitfall: ${signal.title}`,
    "",
    "## Symptom",
    "",
    signal.excerpt,
    "",
    "## Root Cause",
    "",
    "Review this session-derived candidate and fill in the root cause before confirming.",
    "",
    "## Correct Fix",
    "",
    "Review the related diff or session before confirming this candidate.",
    "",
    "## Avoid",
    "",
    "Do not promote this pitfall until it describes a reusable future hazard, not a one-off chat detail.",
    "",
    "## Related",
    "",
    signal.files.length > 0 ? signal.files.map((file) => `- ${file}`).join("\n") : "- No file references detected.",
    "",
    "## Source",
    "",
    `- Provider: ${signal.provider}`,
    `- Session: ${signal.sessionId}`,
    signal.timestamp ? `- Timestamp: ${signal.timestamp}` : undefined
  ].filter((line): line is string => line !== undefined).join("\n");
}

function planFromSignals(projectName: string, signals: SessionSignal[]): WikiUpdatePlan | undefined {
  if (signals.length === 0) {
    return undefined;
  }

  const entries: WikiUpdatePlanEntry[] = signals.map((signal) => ({
    type: signal.kind,
    title: signal.title,
    slug: safeSlug(signal.title, signal.kind),
    status: "proposed",
    modules: signal.modules,
    files: signal.files,
    tags: unique(["session-reflect", signal.provider, signal.kind]),
    severity: signal.kind === "pitfall" ? "medium" : undefined,
    source: "reflect",
    frontmatter: {
      source_sessions: [`${signal.provider}:${signal.sessionId}`]
    },
    summary: signal.summary,
    body: bodyForSignal(signal)
  }));

  return {
    version: AIWIKI_VERSION,
    title: `Session reflection candidates for ${projectName}`,
    entries
  };
}

function sessionRecords(rawSessions: RawSession[], signals: SessionSignal[]): SessionRecord[] {
  const counts = new Map<string, number>();
  for (const signal of signals) {
    counts.set(signal.sessionId, (counts.get(signal.sessionId) ?? 0) + 1);
  }

  return rawSessions.map((session) => ({
    ...session.record,
    signalCount: counts.get(session.record.sessionId) ?? 0
  }));
}

function formatList(values: string[], fallback: string): string {
  return values.length > 0 ? values.map((value) => `- ${value}`).join("\n") : `- ${fallback}`;
}

export function formatSessionScanMarkdown(result: Omit<SessionScanResult, "markdown" | "json">): string {
  const rows = result.sessions.map((session) =>
    [
      session.sessionId,
      `  - Updated: ${session.updatedAt ?? session.startedAt ?? "unknown"}`,
      `  - CWD: ${session.cwd ?? "unknown"}`,
      `  - Messages: ${session.messageCount}; tools: ${session.toolCallCount}; errors: ${session.errorCount}`,
      `  - Signals: ${session.signalCount}`
    ].join("\n")
  );

  return `# Session Scan

## Source
- Project: ${result.projectName}
- Provider: ${result.provider}
- Trace path: ${result.tracePath}
- Scope: ${result.matchedProjectOnly ? "current project only" : "all projects"}
- Sessions: ${result.sessions.length}

## Sessions
${formatList(rows, "No matching sessions found.")}
`;
}

function scanToJson(result: Omit<SessionScanResult, "markdown" | "json">): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

export async function scanAgentSessions(
  rootDir: string,
  options: SessionScanOptions = {}
): Promise<SessionScanResult> {
  const config = await loadAIWikiConfig(rootDir).catch((error: unknown) => {
    if (error instanceof AIWikiNotInitializedError) {
      return createDefaultConfig(defaultProjectName(rootDir));
    }
    throw error;
  });
  const loaded = await loadRawSessions(rootDir, options);
  const signals = extractSignals(rootDir, loaded.sessions, MAX_SCAN_SIGNAL_COUNT);
  const base = {
    projectName: config.projectName,
    provider: loaded.provider,
    tracePath: loaded.tracePath,
    matchedProjectOnly: options.allProjects !== true,
    sessions: sessionRecords(loaded.sessions, signals)
  };
  return {
    ...base,
    markdown: formatSessionScanMarkdown(base),
    json: scanToJson(base)
  };
}

async function writeOutputPlanFile(
  rootDir: string,
  outputPlan: string,
  plan: WikiUpdatePlan,
  force: boolean
): Promise<string> {
  const outputPath = resolveProjectPath(rootDir, outputPlan);
  if (!force && (await pathExists(outputPath))) {
    throw new Error(`Refusing to overwrite existing output plan: ${outputPlan}`);
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  return outputPath;
}

export function formatSessionReflectMarkdown(preview: SessionReflectPreview): string {
  const signalLines = preview.signals.map((signal) =>
    [
      `${signal.kind}: ${signal.title}`,
      `  - Summary: ${signal.summary}`,
      `  - Files: ${signal.files.length > 0 ? signal.files.join(", ") : "none detected"}`,
      `  - Session: ${signal.provider}:${signal.sessionId}`
    ].join("\n")
  );

  const planLine = preview.updatePlanDraft
    ? preview.outputPlanPath
      ? `- Update plan draft entries: ${preview.updatePlanDraft.entries.length}. Saved to ${preview.outputPlanPath}. Run \`aiwiki apply "${preview.outputPlanPath}"\` before any confirmation.`
      : `- Update plan draft entries: ${preview.updatePlanDraft.entries.length}. Use --output-plan to save a reviewable plan.`
    : "- No update plan draft was generated.";

  return `# Session Reflect Preview

## Source
- Project: ${preview.projectName}
- Provider: ${preview.provider}
- Trace path: ${preview.tracePath}
- Sessions scanned: ${preview.sessions.length}

## Review First
${formatList(preview.safety, "No safety guidance generated.")}

## Candidate Memories
${formatList(signalLines, "No reusable pitfall or decision signals found in matching sessions.")}

## Update Plan Draft
${planLine}

## Apply Safely
- Session reflection never writes wiki pages directly.
- Preview with \`aiwiki apply <plan.json>\`.
- Confirm with \`aiwiki apply <plan.json> --confirm\` only after reviewing the candidate memory.
`;
}

function reflectToJson(preview: SessionReflectPreview): string {
  return `${JSON.stringify(preview, null, 2)}\n`;
}

export async function reflectAgentSessions(
  rootDir: string,
  options: SessionReflectOptions = {}
): Promise<SessionReflectResult> {
  if (options.readOnly && options.outputPlan) {
    throw new Error("Cannot use --read-only with --output-plan because --output-plan writes a file.");
  }

  let initialized = true;
  let config;
  try {
    config = await loadAIWikiConfig(rootDir);
  } catch (error) {
    if (!(error instanceof AIWikiNotInitializedError)) {
      throw error;
    }
    initialized = false;
    config = createDefaultConfig(defaultProjectName(rootDir));
  }

  if (!initialized && options.outputPlan) {
    throw new Error("Cannot use --output-plan before AIWiki is initialized. Run aiwiki init --project-name <name> first.");
  }

  const loaded = await loadRawSessions(rootDir, {
    ...options,
    limit: options.limit ?? DEFAULT_REFLECT_LIMIT
  });
  const signals = extractSignals(rootDir, loaded.sessions, options.limit ?? DEFAULT_REFLECT_LIMIT);
  const updatePlanDraft = initialized
    ? planFromSignals(config.projectName, signals)
    : undefined;
  const preview: SessionReflectPreview = {
    projectName: config.projectName,
    provider: loaded.provider,
    tracePath: loaded.tracePath,
    sessions: sessionRecords(loaded.sessions, signals),
    signals,
    updatePlanDraft,
    safety: [
      "Session traces are external context, not confirmed AIWiki memory.",
      "Tool outputs and system/developer prompts are not used as candidate memory.",
      "Generated candidates are proposed only; review source assumptions before confirming.",
      "No wiki pages are written until `aiwiki apply --confirm` is run on a fresh preview."
    ]
  };

  if (options.outputPlan && preview.updatePlanDraft) {
    preview.outputPlanPath = await writeOutputPlanFile(
      rootDir,
      options.outputPlan,
      preview.updatePlanDraft,
      options.force ?? false
    );
  }

  return {
    preview,
    markdown: formatSessionReflectMarkdown(preview),
    json: reflectToJson(preview)
  };
}
