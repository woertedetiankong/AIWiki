import path from "node:path";

export function resolveProjectPath(rootDir: string, ...segments: string[]): string {
  const root = path.resolve(rootDir);
  const resolved = path.resolve(root, ...segments);

  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Refusing to access path outside project root: ${resolved}`);
  }

  return resolved;
}

export function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}
