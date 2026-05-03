import { mkdir, mkdtemp, readFile, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initAIWiki } from "../src/init.js";
import { writeMarkdownFile } from "../src/markdown.js";
import { generateDevelopmentBrief } from "../src/brief.js";

async function tempProject(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "aiwiki-brief-"));
}

async function addRelevantMemory(rootDir: string): Promise<void> {
  const modulesDir = path.join(rootDir, ".aiwiki", "wiki", "modules");
  const pitfallsDir = path.join(rootDir, ".aiwiki", "wiki", "pitfalls");
  const rulesDir = path.join(rootDir, ".aiwiki", "wiki", "rules");
  await mkdir(modulesDir, { recursive: true });
  await mkdir(pitfallsDir, { recursive: true });
  await mkdir(rulesDir, { recursive: true });

  await writeMarkdownFile(
    path.join(modulesDir, "payment.md"),
    {
      type: "module",
      title: "Payment",
      modules: ["payment"],
      files: ["src/lib/stripe.ts"],
      risk: "high"
    },
    "# Module: Payment\n\nPayment uses Stripe webhook routes.\n"
  );

  await writeMarkdownFile(
    path.join(pitfallsDir, "stripe-raw-body.md"),
    {
      type: "pitfall",
      title: "Stripe webhook raw body",
      modules: ["payment"],
      files: ["src/app/api/stripe/webhook/route.ts"],
      severity: "critical",
      encountered_count: 2
    },
    "# Pitfall: Stripe webhook raw body\n\nVerify raw body before parsing.\n"
  );

  await writeMarkdownFile(
    path.join(rulesDir, "server-side-stripe.md"),
    {
      type: "rule",
      title: "Keep Stripe secrets server-side",
      modules: ["payment"],
      files: ["src/lib/stripe.ts"],
      status: "active",
      severity: "high"
    },
    "# Rule: Keep Stripe secrets server-side\n\nNever expose Stripe secrets to client code.\n"
  );
}

describe("generateDevelopmentBrief", () => {
  it("generates a read-only cold-start brief when AIWiki is not initialized", async () => {
    const rootDir = await tempProject();
    await mkdir(path.join(rootDir, "src"), { recursive: true });
    await writeFile(
      path.join(rootDir, "src", "billing-webhook.ts"),
      "export function billingWebhook() { return 'stripe webhook'; }\n",
      "utf8"
    );

    const result = await generateDevelopmentBrief(rootDir, "stripe webhook");

    expect(result.markdown).toContain("## Setup");
    expect(result.markdown).toContain("Cold-start mode");
    expect(result.markdown).toContain("aiwiki init --project-name <name>");
    expect(result.markdown).toContain("src/billing-webhook.ts");
  });

  it("respects project .gitignore during cold-start discovery", async () => {
    const rootDir = await tempProject();
    await mkdir(path.join(rootDir, "src"), { recursive: true });
    await mkdir(path.join(rootDir, "ignored"), { recursive: true });
    await writeFile(path.join(rootDir, ".gitignore"), "ignored/\n", "utf8");
    await writeFile(
      path.join(rootDir, "src", "billing-webhook.ts"),
      "export function billingWebhook() { return 'stripe webhook'; }\n",
      "utf8"
    );
    await writeFile(
      path.join(rootDir, "ignored", "stripe-webhook.ts"),
      "export function ignoredWebhook() { return 'stripe webhook billing'; }\n",
      "utf8"
    );

    const result = await generateDevelopmentBrief(rootDir, "stripe webhook");

    expect(result.markdown).toContain("src/billing-webhook.ts");
    expect(result.markdown).not.toContain("ignored/stripe-webhook.ts");
  });

  it("generates a no-LLM brief with relevant memory sections", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await addRelevantMemory(rootDir);

    const result = await generateDevelopmentBrief(rootDir, "stripe webhook");

    expect(result.markdown).toContain("# Development Brief: stripe webhook");
    expect(result.markdown).toContain("## Must Read");
    expect(result.markdown).toContain("## Do Not");
    expect(result.markdown).toContain("## Memory Coverage");
    expect(result.markdown).toContain("## Rules");
    expect(result.markdown).toContain("## Pitfalls");
    expect(result.markdown).toContain("## Suggested Tests");
    expect(result.markdown.indexOf("## Must Read")).toBeLessThan(
      result.markdown.indexOf("## Do Not")
    );
    expect(result.markdown.indexOf("## Do Not")).toBeLessThan(
      result.markdown.indexOf("## Rules")
    );
    expect(result.markdown.indexOf("## Rules")).toBeLessThan(
      result.markdown.indexOf("## Pitfalls")
    );
    expect(result.markdown).toContain("Stripe webhook raw body");
    expect(result.markdown).toContain("Keep Stripe secrets server-side");
    expect(result.markdown).toContain("AIWiki memory page(s).");
    expect(result.markdown).toContain("Do not treat this brief as exact code instructions.");
    expect(result.markdown).not.toContain("Step 1");
    expect(result.markdown).not.toContain("Edit ");

    const log = await readFile(path.join(rootDir, ".aiwiki", "log.md"), "utf8");
    expect(log).toContain("brief | stripe webhook");

    const evals = await readFile(
      path.join(rootDir, ".aiwiki", "evals", "brief-cases.jsonl"),
      "utf8"
    );
    expect(evals).toContain("\"task\":\"stripe webhook\"");
  });

  it("supports read-only briefs without appending log or eval data", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await addRelevantMemory(rootDir);
    const logPath = path.join(rootDir, ".aiwiki", "log.md");
    const evalPath = path.join(rootDir, ".aiwiki", "evals", "brief-cases.jsonl");
    const initialLog = await readFile(logPath, "utf8");
    const initialEvals = await readFile(evalPath, "utf8");

    const result = await generateDevelopmentBrief(rootDir, "stripe webhook", {
      readOnly: true
    });

    expect(result.markdown).toContain("# Development Brief: stripe webhook");
    expect(await readFile(logPath, "utf8")).toBe(initialLog);
    expect(await readFile(evalPath, "utf8")).toBe(initialEvals);
  });

  it("rejects read-only briefs that request output files", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });

    await expect(
      generateDevelopmentBrief(rootDir, "stripe webhook", {
        readOnly: true,
        output: ".aiwiki/context-packs/current.md"
      })
    ).rejects.toThrow("Cannot use --read-only with --output");

    await expect(
      readFile(path.join(rootDir, ".aiwiki", "context-packs", "current.md"), "utf8")
    ).rejects.toThrow();
  });

  it("includes architecture, hardcoding, portability, and module memory guidance by default", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await addRelevantMemory(rootDir);

    await mkdir(path.join(rootDir, "src", "app", "api", "stripe", "webhook"), {
      recursive: true
    });
    await writeFile(
      path.join(rootDir, "src", "app", "api", "stripe", "webhook", "route.ts"),
      Array.from({ length: 430 }, (_, index) => `export const line${index} = ${index};`).join("\n"),
      "utf8"
    );

    const result = await generateDevelopmentBrief(
      rootDir,
      "add stripe payment provider webhook"
    );
    const parsed = JSON.parse(result.json) as {
      selectedDocs: string[];
      sections: Array<{ title: string; items: string[] }>;
    };
    const moduleMemory = parsed.sections.find(
      (section) => section.title === "Module Memory to Maintain"
    );

    expect(result.markdown).toContain("## Other Context");
    expect(result.markdown).toContain("payment");
    expect(result.markdown).toContain("provider");
    expect(result.markdown).toContain("webhook");
    expect(result.markdown).toContain("secrets");
    expect(result.markdown).toContain("pricing");
    expect(result.markdown).toContain("src/app/api/stripe/webhook/route.ts");
    expect(result.markdown).toContain("Large file");
    expect(result.markdown).toContain("more item(s) omitted from markdown");
    expect(moduleMemory?.items.join("\n")).toContain("reflect");
  });

  it("keeps architecture guidance stable when no project risks are detected", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });

    const result = await generateDevelopmentBrief(rootDir, "add settings page", {
      format: "json"
    });
    const parsed = JSON.parse(result.json) as {
      selectedDocs: string[];
      sections: Array<{ title: string; items: string[] }>;
    };
    const sectionTitles = parsed.sections.map((section) => section.title);

    expect(sectionTitles).toContain("Architecture Boundaries");
    expect(sectionTitles).toContain("Memory Coverage");
    expect(sectionTitles).toContain("Hardcoding and Configuration Risks");
    expect(sectionTitles).toContain("Portability Checklist");
    expect(sectionTitles).toContain("Module Memory to Maintain");
    expect(result.markdown).toContain("## Built-In Generic Guardrails");
    expect(result.markdown).toContain("## Memory Coverage");
    expect(result.markdown).toContain("No task-specific AIWiki memory pages matched this request.");
    expect(result.markdown).toContain("Do not infer project-specific constraints from generic guardrails");
    expect(result.markdown).toContain("No high-confidence rule pages matched.");
    expect(result.markdown).toContain("No high-confidence pitfall pages matched.");
    expect(result.markdown).toContain("No selected AIWiki pages to check for staleness.");
    expect(result.markdown).toContain("## Other Context");
    expect(result.markdown).toContain("No additional context matched this task.");
    expect(result.markdown).toContain("No large-file structure warnings detected.");
    expect(result.markdown).toContain("more item(s) omitted from markdown");
    expect(parsed.sections.find(
      (section) => section.title === "Module Memory to Maintain"
    )?.items.join("\n")).toContain("Record reusable module decisions after implementation.");
    expect(parsed.sections.find(
      (section) => section.title === "Recommended Direction"
    )?.items.join("\n")).toContain("source code, tests, and the user's request as the source of truth");
    expect(parsed.selectedDocs).toEqual([]);
  });

  it("keeps low-confidence memory out of must-read and surfaces it as hints", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await mkdir(path.join(rootDir, ".aiwiki", "wiki", "pitfalls"), { recursive: true });
    await writeMarkdownFile(
      path.join(rootDir, ".aiwiki", "wiki", "pitfalls", "generic-unrelated-note.md"),
      {
        type: "pitfall",
        title: "Generic unrelated note",
        modules: ["search"],
        files: ["src/search.ts"],
        severity: "high"
      },
      "# Pitfall: Generic unrelated note\n\nA body-only mention of settings page should remain advisory.\n"
    );

    const result = await generateDevelopmentBrief(rootDir, "add settings page", {
      format: "json"
    });
    const parsed = JSON.parse(result.json) as {
      selectedDocs: string[];
      sections: Array<{ title: string; items: string[] }>;
    };
    const hints = parsed.sections.find((section) => section.title === "Memory Hints");

    expect(parsed.selectedDocs).toEqual([]);
    expect(result.markdown).toContain("## Memory Hints");
    expect(result.markdown).toContain("Generic unrelated note");
    expect(result.markdown).toContain("No high-confidence pitfall pages matched.");
    expect(result.markdown).not.toContain("wiki/pitfalls/generic-settings-note.md\n");
    expect(hints?.items.join("\n")).toContain("matched body");
  });

  it("discovers task-matching source entry files for cold-start projects", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await mkdir(path.join(rootDir, "components"), { recursive: true });
    await mkdir(path.join(rootDir, "lib"), { recursive: true });
    await mkdir(path.join(rootDir, ".wrangler", "tmp"), { recursive: true });
    await writeFile(
      path.join(rootDir, "components", "NovelEditor.tsx"),
      "export function NovelEditor() { return 'editor'; }\n",
      "utf8"
    );
    await writeFile(
      path.join(rootDir, "lib", "appearance.ts"),
      "export const THEME_OPTIONS = ['default', 'editorial'];\n",
      "utf8"
    );
    await writeFile(
      path.join(rootDir, ".wrangler", "tmp", "ProxyServerWorker.js"),
      "export const generated = 'editor theme';\n",
      "utf8"
    );

    const result = await generateDevelopmentBrief(
      rootDir,
      "check whether editor supports different styles"
    );
    const parsed = JSON.parse(result.json) as {
      sections: Array<{ title: string; items: string[] }>;
    };
    const discovered = parsed.sections.find(
      (section) => section.title === "Discovered Entry Files"
    );

    expect(discovered?.items.join("\n")).toContain("components/NovelEditor.tsx");
    expect(discovered?.items.join("\n")).toContain("lib/appearance.ts");
    expect(discovered?.items.join("\n")).not.toContain(".wrangler");
    expect(result.markdown).toContain("components/NovelEditor.tsx");
  });

  it("keeps markdown briefs compact while preserving full JSON context", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await mkdir(path.join(rootDir, "src"), { recursive: true });

    for (let index = 0; index < 12; index += 1) {
      await writeFile(
        path.join(rootDir, "src", `CodexFeature${index}.ts`),
        "export const codexFeature = true;\n",
        "utf8"
      );
    }

    const result = await generateDevelopmentBrief(
      rootDir,
      "improve codex feature discovery"
    );
    const parsed = JSON.parse(result.json) as {
      sections: Array<{ title: string; items: string[] }>;
    };
    const discovered = parsed.sections.find(
      (section) => section.title === "Discovered Entry Files"
    );

    expect(result.markdown).toContain("more item(s) omitted from markdown");
    expect(result.markdown).toContain("--format json");
    expect(discovered?.items.length).toBeGreaterThan(8);
  });

  it("scopes architecture warnings to task-relevant subprojects in mixed repositories", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "mixed-pms" });
    await mkdir(path.join(rootDir, "pms_web", "PMS", "src", "pages", "otherModel"), {
      recursive: true
    });
    await mkdir(path.join(rootDir, "pms_web", "PMS", "src", "components", "base"), {
      recursive: true
    });
    await mkdir(path.join(rootDir, "pms-app", "pages", "maintain"), {
      recursive: true
    });
    await writeFile(
      path.join(rootDir, "pms_web", "PMS", "src", "pages", "otherModel", "mesConnectConfig.vue"),
      "<template><div>mes connection</div></template>\n<script>export default { name: 'MesConnectConfig' };</script>\n",
      "utf8"
    );
    await writeFile(
      path.join(rootDir, "pms_web", "PMS", "src", "components", "base", "SubTable.vue"),
      Array.from({ length: 900 }, (_, index) => `<div>${index}</div>`).join("\n"),
      "utf8"
    );
    await writeFile(
      path.join(rootDir, "pms-app", "pages", "maintain", "maintMain.vue"),
      Array.from({ length: 900 }, (_, index) => `<view>${index}</view>`).join("\n"),
      "utf8"
    );

    const result = await generateDevelopmentBrief(
      rootDir,
      "update PMS web MES connection config page behavior"
    );

    expect(result.markdown).toContain("pms_web/PMS/src/pages/otherModel/mesConnectConfig.vue");
    expect(result.markdown).not.toContain("pms-app/pages/maintain/maintMain.vue");
    expect(result.markdown).not.toContain("pms_web/PMS/src/components/base/SubTable.vue");
  });

  it("treats project and package name tokens as low-signal in cold-start discovery", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "pydantic-deep" });
    await writeFile(
      path.join(rootDir, "pyproject.toml"),
      '[project]\nname = "pydantic-deep"\n',
      "utf8"
    );
    await mkdir(path.join(rootDir, "pydantic_deep", "toolsets"), { recursive: true });
    await mkdir(path.join(rootDir, "pydantic_deep", "toolsets", "plan"), { recursive: true });
    await mkdir(path.join(rootDir, "pydantic_deep", "toolsets", "skills"), { recursive: true });
    await mkdir(path.join(rootDir, "cli"), { recursive: true });
    await mkdir(path.join(rootDir, "apps", "deepresearch"), { recursive: true });
    await mkdir(path.join(rootDir, "examples"), { recursive: true });
    await writeFile(
      path.join(rootDir, "pydantic_deep", "toolsets", "context.py"),
      "class ContextToolset:\n    '''context toolset memory behavior'''\n",
      "utf8"
    );
    await writeFile(
      path.join(rootDir, "pydantic_deep", "toolsets", "memory.py"),
      "class MemoryToolset:\n    '''agent memory toolset behavior'''\n",
      "utf8"
    );
    await writeFile(
      path.join(rootDir, "apps", "deepresearch", "pydantic_deep_agent.py"),
      "class DeepResearchAgent:\n    '''agent context only'''\n",
      "utf8"
    );
    await writeFile(
      path.join(rootDir, "examples", "subagents.py"),
      "class ExampleSubagents:\n    '''agent context only'''\n",
      "utf8"
    );
    await writeFile(
      path.join(rootDir, "pydantic_deep", "toolsets", "skills", "toolset.py"),
      "class SkillsToolset:\n    '''agent context toolset'''\n",
      "utf8"
    );
    await writeFile(
      path.join(rootDir, "pydantic_deep", "toolsets", "plan", "toolset.py"),
      "class PlanToolset:\n    '''agent context toolset'''\n",
      "utf8"
    );
    await writeFile(
      path.join(rootDir, "cli", "agent.py"),
      "class CliAgent:\n    '''agent context memory toolset'''\n",
      "utf8"
    );

    const result = await generateDevelopmentBrief(
      rootDir,
      "modify pydantic deep agent context toolset and memory behavior"
    );
    const parsed = JSON.parse(result.json) as {
      sections: Array<{ title: string; items: string[] }>;
    };
    const discovered = parsed.sections.find(
      (section) => section.title === "Discovered Entry Files"
    )?.items.join("\n") ?? "";

    expect(discovered.indexOf("pydantic_deep/toolsets/context.py")).toBeLessThan(
      discovered.indexOf("cli/agent.py")
    );
    expect(discovered.indexOf("pydantic_deep/toolsets/memory.py")).toBeLessThan(
      discovered.indexOf("pydantic_deep/toolsets/skills/toolset.py")
    );
    expect(discovered.indexOf("pydantic_deep/toolsets/context.py")).toBeLessThan(
      discovered.indexOf("pydantic_deep/toolsets/plan/toolset.py")
    );
    expect(discovered).not.toContain("apps/deepresearch/pydantic_deep_agent.py");
    expect(discovered).not.toContain("examples/subagents.py");
  });

  it("prefers implementation files over test files for non-test cold-start tasks", async () => {
    const rootDir = await tempProject();
    await mkdir(path.join(rootDir, "cli"), { recursive: true });
    await mkdir(path.join(rootDir, "tests"), { recursive: true });
    await writeFile(
      path.join(rootDir, "cli", "interactive.py"),
      "def render_picker_display():\n    return 'interactive picker display'\n",
      "utf8"
    );
    await writeFile(
      path.join(rootDir, "tests", "test_cli_interactive.py"),
      "def test_render_picker_display():\n    assert 'interactive picker display'\n",
      "utf8"
    );

    const result = await generateDevelopmentBrief(
      rootDir,
      "fix interactive CLI picker display behavior",
      { format: "json" }
    );
    const parsed = JSON.parse(result.json) as {
      sections: Array<{ title: string; items: string[] }>;
    };
    const discovered = parsed.sections.find(
      (section) => section.title === "Discovered Entry Files"
    )?.items.join("\n") ?? "";

    expect(discovered.indexOf("cli/interactive.py")).toBeLessThan(
      discovered.indexOf("tests/test_cli_interactive.py")
    );
  });

  it("surfaces compact staleness warnings for selected memory", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await mkdir(path.join(rootDir, "src"), { recursive: true });
    await mkdir(path.join(rootDir, ".aiwiki", "wiki", "modules"), { recursive: true });

    for (let index = 0; index < 4; index += 1) {
      const filePath = path.join(rootDir, "src", `checkout-${index}.ts`);
      await writeFile(filePath, `export const checkout${index} = true;\n`, "utf8");
      await utimes(
        filePath,
        new Date("2026-04-01T00:00:00Z"),
        new Date("2026-04-01T00:00:00Z")
      );
      await writeMarkdownFile(
        path.join(rootDir, ".aiwiki", "wiki", "modules", `checkout-${index}.md`),
        {
          type: "module",
          title: `Checkout stale ${index}`,
          modules: ["checkout"],
          files: [`src/checkout-${index}.ts`],
          last_updated: "2026-03-01"
        },
        `# Checkout stale ${index}\n\ncheckout memory.\n`
      );
    }

    const result = await generateDevelopmentBrief(rootDir, "checkout", {
      format: "json"
    });
    const parsed = JSON.parse(result.json) as {
      stalenessWarnings: Array<{ code: string; file: string }>;
    };

    expect(result.markdown).toContain("## Staleness Warnings");
    expect(result.markdown).toContain("stale_referenced_file");
    expect(result.markdown).toContain("1 more staleness warning(s) omitted from markdown");
    expect(result.markdown).toContain("--format json");
    expect(parsed.stalenessWarnings).toHaveLength(4);
    expect(parsed.stalenessWarnings[0]?.code).toBe("stale_referenced_file");
  });

  it("discovers task-matching markdown docs for document cleanup tasks", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await mkdir(path.join(rootDir, "docs"), { recursive: true });
    await mkdir(path.join(rootDir, ".history"), { recursive: true });
    await writeFile(
      path.join(rootDir, "requirements.md"),
      "# Requirements\n\nCurrent PMS requirements and handoff notes.\n",
      "utf8"
    );
    await writeFile(
      path.join(rootDir, "docs", "deployment-checklist.md"),
      "# Deployment Checklist\n\nCurrent deployment verification docs.\n",
      "utf8"
    );
    await writeFile(
      path.join(rootDir, ".history", "requirements_20260401.md"),
      "# Old Requirements\n\nStale copy.\n",
      "utf8"
    );
    await mkdir(path.join(rootDir, "src"), { recursive: true });
    await writeFile(
      path.join(rootDir, "src", "DocumentController.ts"),
      "export const documentController = true;\n",
      "utf8"
    );

    const result = await generateDevelopmentBrief(
      rootDir,
      "梳理 Markdown 文档，判断 requirements 和 checklist 是否过时"
    );
    const parsed = JSON.parse(result.json) as {
      sections: Array<{ title: string; items: string[] }>;
    };
    const docs = parsed.sections.find(
      (section) => section.title === "Discovered Markdown Docs"
    );

    expect(docs?.items.join("\n")).toContain("requirements.md");
    expect(docs?.items.join("\n")).toContain("docs/deployment-checklist.md");
    expect(docs?.items.join("\n")).not.toContain(".history");
    expect(result.markdown).not.toContain("src/DocumentController.ts");
    expect(result.markdown).toContain("requirements.md");
  });

  it("adds an explicit architecture guard section when requested", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await addRelevantMemory(rootDir);

    const result = await generateDevelopmentBrief(
      rootDir,
      "add stripe payment webhook",
      {
        architectureGuard: true,
        format: "json"
      }
    );
    const parsed = JSON.parse(result.json) as {
      sections: Array<{ title: string; items: string[] }>;
    };
    const titles = parsed.sections.map((section) => section.title);
    const architectureGuard = parsed.sections.find(
      (section) => section.title === "Architecture Guard"
    );

    expect(titles).toContain("Architecture Boundaries");
    expect(titles).toContain("Architecture Guard");
    expect(architectureGuard?.items.join("\n")).toContain("Likely modules: payment");
    expect(architectureGuard?.items.join("\n")).toContain("billing/payment");
    expect(result.markdown).toContain("## Architecture Guard");
  });

  it("returns stable json output", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await addRelevantMemory(rootDir);

    const result = await generateDevelopmentBrief(rootDir, "stripe webhook", {
      format: "json"
    });
    const parsed = JSON.parse(result.json) as {
      task: string;
      projectName: string;
      selectedDocs: string[];
      sections: Array<{ title: string; items: string[] }>;
    };

    expect(parsed.task).toBe("stripe webhook");
    expect(parsed.projectName).toBe("demo");
    expect(parsed.selectedDocs).toContain("wiki/pitfalls/stripe-raw-body.md");
    expect(parsed.sections.map((section) => section.title)).toContain(
      "Notes for Codex"
    );
  });

  it("does not overwrite output files unless force is set", async () => {
    const rootDir = await tempProject();
    await initAIWiki({ rootDir, projectName: "demo" });
    await addRelevantMemory(rootDir);

    await generateDevelopmentBrief(rootDir, "stripe webhook", {
      output: ".aiwiki/context-packs/current.md"
    });

    await expect(
      generateDevelopmentBrief(rootDir, "stripe webhook again", {
        output: ".aiwiki/context-packs/current.md"
      })
    ).rejects.toThrow("Refusing to overwrite");

    await writeFile(
      path.join(rootDir, ".aiwiki", "context-packs", "current.md"),
      "custom\n",
      "utf8"
    );

    await generateDevelopmentBrief(rootDir, "stripe webhook forced", {
      output: ".aiwiki/context-packs/current.md",
      force: true
    });

    const output = await readFile(
      path.join(rootDir, ".aiwiki", "context-packs", "current.md"),
      "utf8"
    );
    expect(output).toContain("# Development Brief: stripe webhook forced");
  });
});
