import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { resolveProjectPath, toPosixPath } from "./paths.js";
import { shellQuote } from "./shell-quote.js";

export interface SuggestedProjectTestOptions {
  maxCommands?: number;
}

const JS_TS_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts"
]);

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function normalizePath(filePath: string): string {
  return toPosixPath(filePath).replace(/^\.\//u, "");
}

function quotePath(filePath: string): string {
  return /^[A-Za-z0-9_./-]+$/u.test(filePath) ? filePath : shellQuote(filePath);
}

async function projectFileExists(rootDir: string, relativePath: string): Promise<boolean> {
  try {
    const fileStat = await stat(resolveProjectPath(rootDir, relativePath));
    return fileStat.isFile();
  } catch {
    return false;
  }
}

async function readOptionalProjectFile(rootDir: string, relativePath: string): Promise<string> {
  try {
    return await readFile(resolveProjectPath(rootDir, relativePath), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return "";
    }

    throw error;
  }
}

async function packageTestCommand(rootDir: string): Promise<string | undefined> {
  const raw = await readOptionalProjectFile(rootDir, "package.json");
  if (!raw) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(raw) as { scripts?: Record<string, unknown> };
    return typeof parsed.scripts?.test === "string" ? "npm run test" : undefined;
  } catch {
    return undefined;
  }
}

async function projectUsesPytest(rootDir: string): Promise<boolean> {
  const configFiles = [
    "pyproject.toml",
    "pytest.ini",
    "tox.ini",
    "setup.cfg",
    "requirements.txt",
    "requirements-dev.txt"
  ];
  for (const file of configFiles) {
    const content = await readOptionalProjectFile(rootDir, file);
    if (/\bpytest\b/iu.test(content)) {
      return true;
    }
  }

  return false;
}

function extension(filePath: string): string {
  return path.posix.extname(normalizePath(filePath)).toLowerCase();
}

function isJsTsFile(filePath: string): boolean {
  return JS_TS_EXTENSIONS.has(extension(filePath));
}

function isPythonFile(filePath: string): boolean {
  return extension(filePath) === ".py";
}

function basenameWithoutExtension(filePath: string): string {
  return path.posix.basename(filePath, path.posix.extname(filePath));
}

async function existingCandidates(rootDir: string, candidates: string[]): Promise<string[]> {
  const existing: string[] = [];
  for (const candidate of unique(candidates.map(normalizePath))) {
    if (await projectFileExists(rootDir, candidate)) {
      existing.push(candidate);
    }
  }

  return existing;
}

async function testFilesForSource(rootDir: string, filePath: string): Promise<string[]> {
  const file = normalizePath(filePath);
  const parsed = path.posix.parse(file);
  const base = basenameWithoutExtension(file);

  if (isJsTsFile(file)) {
    const extensions = [".test.ts", ".test.tsx", ".spec.ts", ".spec.tsx", ".test.js", ".spec.js"];
    return existingCandidates(rootDir, [
      ...extensions.map((suffix) => path.posix.join("tests", `${base}${suffix}`)),
      ...extensions.map((suffix) => path.posix.join(parsed.dir, `${base}${suffix}`))
    ]);
  }

  if (isPythonFile(file) && !base.startsWith("test_")) {
    return existingCandidates(rootDir, [
      path.posix.join(parsed.dir, `test_${base}.py`),
      path.posix.join("tests", `test_${base}.py`)
    ]);
  }

  return [];
}

async function commandForTestFile(rootDir: string, testFile: string): Promise<string | undefined> {
  const file = normalizePath(testFile);
  if (isJsTsFile(file)) {
    const command = await packageTestCommand(rootDir);
    return command ? `${command} -- ${quotePath(file)}` : undefined;
  }

  if (isPythonFile(file)) {
    if (await projectUsesPytest(rootDir)) {
      return `python -m pytest ${quotePath(file)}`;
    }

    return `python -m unittest discover -s ${quotePath(path.posix.dirname(file) || ".")} -p ${quotePath(path.posix.basename(file))}`;
  }

  return undefined;
}

async function fallbackTestCommands(rootDir: string, files: string[]): Promise<string[]> {
  const normalizedFiles = files.map(normalizePath);
  const hasJsTsTarget = normalizedFiles.some(isJsTsFile);
  const hasPythonTarget = normalizedFiles.some(isPythonFile);
  const commands: string[] = [];

  if (hasPythonTarget) {
    if (await projectUsesPytest(rootDir)) {
      commands.push("python -m pytest");
    } else {
      commands.push("python -m unittest discover");
    }
  }

  const npmCommand = await packageTestCommand(rootDir);
  if (npmCommand && (hasJsTsTarget || (!hasPythonTarget && normalizedFiles.length === 0))) {
    commands.push(npmCommand);
  }

  if (commands.length === 0 && npmCommand) {
    commands.push(npmCommand);
  }

  return commands;
}

export async function suggestProjectTestCommands(
  rootDir: string,
  files: string[],
  options: SuggestedProjectTestOptions = {}
): Promise<string[]> {
  const maxCommands = options.maxCommands ?? 3;
  const commands: string[] = [];

  for (const file of files.map(normalizePath)) {
    const directTestFiles = isJsTsFile(file) || isPythonFile(file)
      ? await testFilesForSource(rootDir, file)
      : [];
    const testFiles = isJsTsFile(file) || isPythonFile(file)
      ? directTestFiles.length > 0 ? directTestFiles : [file].filter((candidate) =>
          /(?:^|\/)(?:test_|.+\.(?:test|spec)\.)/u.test(candidate.toLowerCase())
        )
      : [];

    for (const testFile of testFiles) {
      const command = await commandForTestFile(rootDir, testFile);
      if (command) {
        commands.push(command);
      }
    }
  }

  if (commands.length === 0) {
    commands.push(...(await fallbackTestCommands(rootDir, files)));
  }

  return unique(commands).slice(0, maxCommands);
}
