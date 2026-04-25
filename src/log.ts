import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { LOG_PATH } from "./constants.js";
import { resolveProjectPath } from "./paths.js";
import type { LogEntry } from "./types.js";

export function formatLogEntry(entry: LogEntry): string {
  const date = entry.date ?? new Date().toISOString().slice(0, 10);
  const bullets = entry.bullets?.length
    ? `${entry.bullets.map((bullet) => `- ${bullet}`).join("\n")}\n\n`
    : "";

  return `## [${date}] ${entry.action} | ${entry.title}\n${bullets}`;
}

export async function appendLogEntry(
  rootDir: string,
  entry: LogEntry
): Promise<void> {
  const logPath = resolveProjectPath(rootDir, LOG_PATH);
  await mkdir(path.dirname(logPath), { recursive: true });

  let current = "";
  try {
    current = await readFile(logPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  const separator = current.length > 0 && !current.endsWith("\n") ? "\n" : "";
  await writeFile(logPath, `${current}${separator}${formatLogEntry(entry)}`, "utf8");
}
