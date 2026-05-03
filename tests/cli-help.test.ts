import { execFile } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

function cliArgs(...args: string[]): string[] {
  const cliPath = path.resolve("src", "cli.ts");
  const tsxLoader = pathToFileURL(
    path.resolve("node_modules", "tsx", "dist", "loader.mjs")
  ).href;
  return ["--import", tsxLoader, cliPath, ...args];
}

describe("CLI help surface", () => {
  it("keeps top-level help focused on daily and maintenance commands", async () => {
    const { stdout } = await execFileAsync(process.execPath, cliArgs("--help"));

    expect(stdout).toContain("agent [options] <task>");
    expect(stdout).toContain("guard [options] <file>");
    expect(stdout).toContain("reflect [options]");
    expect(stdout).toContain("maintain [options]");
    expect(stdout).toContain("doctor [options]");
    expect(stdout).not.toContain("advanced");
    expect(stdout).not.toContain("codex [options]");
    expect(stdout).not.toContain("ingest [options]");
    expect(stdout).not.toContain("schema [options]");
    expect(stdout).not.toContain("module");
    expect(stdout).not.toContain("eval");
  });

  it("lists hidden compatibility and advanced commands under help advanced", async () => {
    const { stdout } = await execFileAsync(
      process.execPath,
      cliArgs("help", "advanced")
    );

    expect(stdout).toContain("aiwiki codex");
    expect(stdout).toContain("aiwiki agent \"<task>\" --runbook");
    expect(stdout).toContain("aiwiki reflect --notes <file> --save-raw");
    expect(stdout).toContain("aiwiki module export");
    expect(stdout).toContain("aiwiki eval large-repos");
    expect(stdout).toContain("aiwiki eval usability");
  });
});
