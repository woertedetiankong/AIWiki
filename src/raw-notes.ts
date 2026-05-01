import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { RAW_NOTES_DIR } from "./constants.js";
import { resolveProjectPath, toPosixPath } from "./paths.js";

export interface SaveRawNoteOptions {
  force?: boolean;
}

export interface SavedRawNote {
  sourcePath: string;
  rawNotePath: string;
  absolutePath: string;
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

function rawNoteFileName(sourcePath: string): string {
  const parsed = path.parse(sourcePath);
  const baseName = parsed.name
    .replace(/[^a-zA-Z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .toLowerCase();
  const extension = parsed.ext || ".md";
  return `${baseName || "note"}${extension}`;
}

async function nextRawNotePath(
  rootDir: string,
  sourcePath: string,
  force: boolean
): Promise<string> {
  const fileName = rawNoteFileName(sourcePath);
  const parsed = path.parse(fileName);
  const relativePath = `${RAW_NOTES_DIR}/${fileName}`;
  const absolutePath = resolveProjectPath(rootDir, relativePath);

  if (force || !(await pathExists(absolutePath))) {
    return relativePath;
  }

  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${RAW_NOTES_DIR}/${parsed.name}-${index}${parsed.ext}`;
    if (!(await pathExists(resolveProjectPath(rootDir, candidate)))) {
      return candidate;
    }
  }

  throw new Error(`Unable to find available raw note path for ${sourcePath}`);
}

export function normalizeRawNoteSourcePath(rootDir: string, sourcePath: string): string {
  const absolutePath = resolveProjectPath(rootDir, sourcePath);
  return toPosixPath(path.relative(rootDir, absolutePath));
}

export async function saveRawNote(
  rootDir: string,
  sourcePath: string,
  raw: string,
  options: SaveRawNoteOptions = {}
): Promise<SavedRawNote> {
  const normalizedSourcePath = normalizeRawNoteSourcePath(rootDir, sourcePath);
  const rawNotePath = await nextRawNotePath(
    rootDir,
    normalizedSourcePath,
    options.force ?? false
  );
  const absolutePath = resolveProjectPath(rootDir, rawNotePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, raw, "utf8");

  return {
    sourcePath: normalizedSourcePath,
    rawNotePath,
    absolutePath
  };
}
