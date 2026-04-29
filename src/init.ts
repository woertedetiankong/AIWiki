import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  AIWIKI_DIRECTORIES,
  AIWIKI_GITKEEP_DIRECTORIES,
  AIWIKI_VERSION,
  BACKLINKS_JSON_PATH,
  CONFIG_PATH,
  GRAPH_JSON_PATH,
  INITIAL_EVAL_FILES,
  INITIAL_GRAPH_FILES,
  LOG_PATH
} from "./constants.js";
import { createDefaultConfig } from "./config.js";
import { writeManagedFile } from "./managed-write.js";
import { resolveProjectPath } from "./paths.js";
import { createInitialTemplates } from "./templates.js";
export interface InitOptions {
  rootDir?: string;
  projectName?: string;
  force?: boolean;
}

export interface InitResult {
  rootDir: string;
  created: string[];
  skipped: string[];
  overwritten: string[];
  warnings: string[];
}

async function hasGitRepository(rootDir: string): Promise<boolean> {
  try {
    const gitPath = resolveProjectPath(rootDir, ".git");
    const git = await stat(gitPath);
    return git.isDirectory() || git.isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

function initialGraphFileContent(graphFile: string): string {
  const generatedAt = new Date().toISOString();

  if (graphFile === GRAPH_JSON_PATH) {
    return `${JSON.stringify(
      {
        version: AIWIKI_VERSION,
        generated_at: generatedAt,
        nodes: [],
        edges: []
      },
      null,
      2
    )}\n`;
  }

  if (graphFile === BACKLINKS_JSON_PATH) {
    return `${JSON.stringify(
      {
        version: AIWIKI_VERSION,
        generated_at: generatedAt,
        backlinks: {}
      },
      null,
      2
    )}\n`;
  }

  return "{}\n";
}

export async function initAIWiki(options: InitOptions = {}): Promise<InitResult> {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const projectName = options.projectName ?? path.basename(rootDir);
  const result: InitResult = {
    rootDir,
    created: [],
    skipped: [],
    overwritten: [],
    warnings: []
  };

  if (!(await hasGitRepository(rootDir))) {
    result.warnings.push(
      "Current directory is not a git repository; git diff based workflows will be limited."
    );
  }

  for (const directory of AIWIKI_DIRECTORIES) {
    await mkdir(resolveProjectPath(rootDir, directory), { recursive: true });
  }

  const config = JSON.stringify(createDefaultConfig(projectName), null, 2);
  await writeManagedFile(rootDir, CONFIG_PATH, `${config}\n`, {
    force: options.force,
    forceable: true,
    result
  });

  for (const template of createInitialTemplates(projectName)) {
    await writeManagedFile(rootDir, template.path, template.content, {
      force: options.force,
      forceable: template.forceable,
      result
    });
  }

  for (const graphFile of INITIAL_GRAPH_FILES) {
    await writeManagedFile(rootDir, graphFile, initialGraphFileContent(graphFile), {
      force: false,
      forceable: false,
      result
    });
  }

  for (const evalFile of INITIAL_EVAL_FILES) {
    await writeManagedFile(rootDir, evalFile, "", {
      force: false,
      forceable: false,
      result
    });
  }

  for (const directory of AIWIKI_GITKEEP_DIRECTORIES) {
    await writeManagedFile(rootDir, `${directory}/.gitkeep`, "", {
      force: false,
      forceable: false,
      result
    });
  }

  // Touch the log to ensure it is readable if it existed before initialization.
  await readFile(resolveProjectPath(rootDir, LOG_PATH), "utf8");

  return result;
}
