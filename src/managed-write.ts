import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveProjectPath } from "./paths.js";

export interface ManagedWriteResult {
  created: string[];
  skipped: string[];
  overwritten: string[];
}

export interface ManagedWriteOptions {
  force?: boolean;
  forceable?: boolean;
  result: ManagedWriteResult;
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

export async function writeManagedFile(
  rootDir: string,
  relativePath: string,
  content: string,
  options: ManagedWriteOptions
): Promise<void> {
  const filePath = resolveProjectPath(rootDir, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });

  if (await pathExists(filePath)) {
    if (options.force && options.forceable) {
      await writeFile(filePath, content, "utf8");
      options.result.overwritten.push(relativePath);
      return;
    }

    options.result.skipped.push(relativePath);
    return;
  }

  await writeFile(filePath, content, "utf8");
  options.result.created.push(relativePath);
}
