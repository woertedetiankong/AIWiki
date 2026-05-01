import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { resolveProjectPath } from "./paths.js";

const execFileAsync = promisify(execFile);

export interface BeadsItem {
  id?: string;
  title?: string;
  status?: string;
  priority?: number;
}

export interface BeadsContext {
  detected: boolean;
  available: boolean;
  ready: BeadsItem[];
  statusSummary?: string;
  warnings: string[];
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      return false;
    }
    throw error;
  }
}

function itemFromUnknown(value: unknown): BeadsItem | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string"
    ? record.id
    : typeof record.issue_id === "string"
      ? record.issue_id
      : undefined;
  const title = typeof record.title === "string"
    ? record.title
    : typeof record.summary === "string"
      ? record.summary
      : undefined;
  const status = typeof record.status === "string" ? record.status : undefined;
  const priority = typeof record.priority === "number" ? record.priority : undefined;

  if (!id && !title) {
    return undefined;
  }

  return { id, title, status, priority };
}

function arrayCandidates(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (!value || typeof value !== "object") {
    return [];
  }
  const record = value as Record<string, unknown>;
  for (const key of ["ready", "issues", "items", "tasks", "data"]) {
    const candidate = record[key];
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }
  return [];
}

function parseReady(stdout: string, limit: number): BeadsItem[] {
  try {
    const parsed = JSON.parse(stdout) as unknown;
    return arrayCandidates(parsed)
      .map(itemFromUnknown)
      .filter((item): item is BeadsItem => Boolean(item))
      .slice(0, limit);
  } catch {
    return [];
  }
}

function compactStatus(stdout: string): string | undefined {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      const open = record.open ?? record.open_count;
      const inProgress = record.in_progress ?? record.in_progress_count;
      const blocked = record.blocked ?? record.blocked_count;
      const parts = [
        typeof open === "number" ? `open ${open}` : undefined,
        typeof inProgress === "number" ? `in_progress ${inProgress}` : undefined,
        typeof blocked === "number" ? `blocked ${blocked}` : undefined
      ].filter(Boolean);
      if (parts.length > 0) {
        return parts.join(", ");
      }
    }
  } catch {
    // Fall through to a compact text summary.
  }

  return trimmed.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 3).join(" | ");
}

async function runBd(rootDir: string, args: string[]): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("bd", args, {
      cwd: rootDir,
      maxBuffer: 1024 * 1024,
      shell: process.platform === "win32"
    });
    return stdout;
  } catch {
    return undefined;
  }
}

export async function readBeadsContext(
  rootDir: string,
  limit = 5
): Promise<BeadsContext> {
  const detected = await pathExists(resolveProjectPath(rootDir, ".beads"));
  if (!detected) {
    return { detected: false, available: false, ready: [], warnings: [] };
  }

  const readyStdout = await runBd(rootDir, ["ready", "--json"]);
  const statusStdout = await runBd(rootDir, ["status", "--json"]);
  const ready = readyStdout ? parseReady(readyStdout, limit) : [];
  const statusSummary = statusStdout ? compactStatus(statusStdout) : undefined;
  const available = Boolean(readyStdout || statusStdout);

  return {
    detected,
    available,
    ready,
    statusSummary,
    warnings: available
      ? []
      : [
          `.beads was detected at ${path.join(".beads")}, but the bd CLI was not available or returned no JSON.`
        ]
  };
}
