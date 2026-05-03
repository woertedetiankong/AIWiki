import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyWikiUpdatePlan } from "../src/apply.js";
import { initAIWiki } from "../src/init.js";
import {
  reflectAgentSessions,
  scanAgentSessions
} from "../src/session.js";

async function tempProject(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "aiwiki-session-"));
}

async function writeJsonl(filePath: string, entries: unknown[]): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
    "utf8"
  );
}

function codexSession(
  rootDir: string,
  id: string,
  message: string
): unknown[] {
  return [
    {
      timestamp: "2026-05-03T10:00:00.000Z",
      type: "session_meta",
      payload: {
        id,
        cwd: rootDir,
        timestamp: "2026-05-03T10:00:00.000Z"
      }
    },
    {
      timestamp: "2026-05-03T10:01:00.000Z",
      type: "event_msg",
      payload: {
        type: "user_message",
        message
      }
    },
    {
      timestamp: "2026-05-03T10:02:00.000Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: "exec_command",
        arguments: "{}"
      }
    },
    {
      timestamp: "2026-05-03T10:03:00.000Z",
      type: "event_msg",
      payload: {
        type: "agent_message",
        message: "Fixed the issue and kept the apply preview path review-first."
      }
    }
  ];
}

describe("session workflows", () => {
  it("scans Codex sessions for the current project without writing wiki memory", async () => {
    const rootDir = await tempProject();
    const tracesDir = path.join(rootDir, "traces");
    await writeJsonl(
      path.join(tracesDir, "rollout-demo-session.jsonl"),
      codexSession(
        rootDir,
        "demo-session",
        "踩坑：src/session.ts 的 output plan 不能绕过 apply 预览，根因是 session 自动读取容易污染长期记忆。"
      )
    );
    await writeJsonl(
      path.join(tracesDir, "rollout-other-session.jsonl"),
      codexSession(
        path.join(os.tmpdir(), "other-project"),
        "other-session",
        "踩坑：src/other.ts 报错。"
      )
    );

    const result = await scanAgentSessions(rootDir, {
      provider: "codex",
      path: tracesDir
    });

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]).toMatchObject({
      sessionId: "demo-session",
      messageCount: 2,
      toolCallCount: 1,
      signalCount: 1
    });
    expect(result.markdown).toContain("# Session Scan");
    expect(result.markdown).toContain("current project only");
  });

  it("generates reviewable apply plans from session pitfall signals", async () => {
    const rootDir = await tempProject();
    const tracesDir = path.join(rootDir, "traces");
    await initAIWiki({ rootDir, projectName: "demo" });
    await writeJsonl(
      path.join(tracesDir, "rollout-demo-session.jsonl"),
      codexSession(
        rootDir,
        "demo-session",
        "踩坑：src/session.ts 读取 Codex session 时不要保存完整工具输出。根因是工具输出可能包含噪声或私密内容，修复方式是只生成 proposed pitfall。"
      )
    );

    const result = await reflectAgentSessions(rootDir, {
      provider: "codex",
      path: tracesDir,
      outputPlan: ".aiwiki/context-packs/session-plan.json"
    });

    expect(result.preview.signals).toHaveLength(1);
    expect(result.preview.updatePlanDraft?.entries[0]).toMatchObject({
      type: "pitfall",
      status: "proposed",
      source: "reflect",
      tags: ["session-reflect", "codex", "pitfall"],
      files: ["src/session.ts"]
    });
    expect(result.preview.outputPlanPath).toContain("session-plan.json");
    expect(result.markdown).toContain("# Session Reflect Preview");
    expect(result.markdown).toContain("No wiki pages are written");

    const plan = JSON.parse(
      await readFile(path.join(rootDir, ".aiwiki/context-packs/session-plan.json"), "utf8")
    ) as unknown;
    const apply = await applyWikiUpdatePlan(rootDir, plan);
    expect(apply.preview.operations[0]).toMatchObject({
      action: "create",
      type: "pitfall",
      source: "reflect"
    });
  });

  it("rejects read-only session reflection when an output plan would be written", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });

    await expect(
      reflectAgentSessions(rootDir, {
        readOnly: true,
        outputPlan: ".aiwiki/context-packs/session-plan.json"
      })
    ).rejects.toThrow("Cannot use --read-only with --output-plan");
  });
});
