# AIWiki M10 实现记录

## 概览

本轮完成确认式 Wiki 写入工作流：新增 `aiwiki apply <plan.json>`，把 AIWiki 从 preview-only 推进到 preview-first、confirm-then-write。

该能力用于把用户或 Codex 审核后的结构化 `WikiUpdatePlan` 安全写入长期 wiki。默认只预览，不写文件；只有显式传入 `--confirm` 才会创建或追加 `.aiwiki/wiki/` 页面，并维护 `index.md`、`log.md` 和 graph。

## 已实现能力

### `WikiUpdatePlan`

新增结构化更新计划，支持以下长期 wiki 页面类型：

- `module`
- `pitfall`
- `decision`
- `pattern`
- `rule`

计划示例：

```json
{
  "title": "Stripe memory",
  "entries": [
    {
      "type": "pitfall",
      "title": "Stripe webhook raw body",
      "slug": "stripe-webhook-raw-body",
      "modules": ["payment"],
      "files": ["src/app/api/stripe/webhook/route.ts"],
      "severity": "critical",
      "frontmatter": {
        "encountered_count": 2
      },
      "body": "# Pitfall: Stripe webhook raw body\n\nVerify raw body before JSON parsing.\n"
    }
  ]
}
```

安全约束：

- 使用 Zod 校验 plan、entry、frontmatter 和 slug。
- 只允许安全 kebab-case slug。
- 目标路径由 `type + slug` 推导，不接受任意输出路径。
- 写入范围限制在项目根目录内。
- 支持的目标目录仅限 `.aiwiki/wiki/modules`、`.aiwiki/wiki/pitfalls`、`.aiwiki/wiki/decisions`、`.aiwiki/wiki/patterns`、`.aiwiki/wiki/rules`。

### `aiwiki apply`

新增命令：

```bash
aiwiki apply plan.json
aiwiki apply plan.json --confirm
aiwiki apply plan.json --confirm --no-graph
aiwiki apply plan.json --format json
```

实现行为：

- 默认 dry-run，仅输出将要执行的操作。
- `--confirm` 后才写入。
- 新页面使用 `wx` 写入，避免覆盖竞态。
- 已存在页面默认 `skip`，不覆盖用户内容。
- 已存在页面只有提供显式 `append` sections 时才追加。
- 确认写入后重建 `.aiwiki/index.md`。
- 确认写入后追加 `.aiwiki/log.md`。
- 确认写入后默认运行 graph build，更新 `.aiwiki/graph/graph.json` 和 `.aiwiki/graph/backlinks.json`。
- `--no-graph` 可跳过 graph 重建。

### Reflect / Ingest / Promote Rules 对接

`aiwiki reflect` 和 `aiwiki ingest` 仍保持 preview-first，不直接写长期 wiki，但输出中新增 confirmed apply workflow 提示：

```bash
aiwiki apply <plan.json>
aiwiki apply <plan.json> --confirm
```

`aiwiki promote-rules` 现在会在 preview 数据中生成 `updatePlan` 草案。规则升级仍不直接写 `AGENTS.md`、`CLAUDE.md` 或 `.cursor/rules`，实际写入通过 `aiwiki apply --confirm` 进入 `.aiwiki/wiki/rules/`。

## 主要文件

### 源码

- `src/apply.ts`：新增 `WikiUpdatePlan` schema、dry-run preview、确认写入、index 重建、log 追加、graph 重建。
- `src/cli.ts`：注册 `apply` 命令。
- `src/index.ts`：导出新增 API 和类型。
- `src/reflect.ts`：补充 confirmed apply workflow 输出。
- `src/ingest.ts`：补充 confirmed apply workflow 输出。
- `src/promote-rules.ts`：为规则升级候选生成 `updatePlan` 草案。

### 测试

- `tests/apply.test.ts`
- `tests/promote-rules.test.ts`

新增覆盖内容：

- dry-run 不写任何文件。
- `--confirm` 只创建 `.aiwiki/wiki/` 内的合法页面。
- 已存在页面默认不覆盖。
- 已存在页面提供 `append` 时只追加指定章节。
- malformed JSON、未知 page type、非法 slug、非法 frontmatter 均报错。
- 写入后更新 `index.md`、`log.md`、graph。
- 写入后的页面可被 `search` 和 `brief` 检索到。
- `promote-rules` 输出 rule update-plan 草案。

## 公开 API / 类型

新增导出：

- `WikiUpdatePlan`
- `WikiUpdatePlanEntry`
- `WikiUpdatePreview`
- `WikiUpdateOperation`
- `WikiUpdateApplyOptions`
- `WikiUpdateApplyResult`
- `generateWikiUpdatePreview`
- `applyWikiUpdatePlan`
- `readWikiUpdatePlanFile`
- `formatWikiUpdateApplyMarkdown`
- `wikiUpdatePlanSchema`
- `wikiUpdatePlanEntrySchema`

## 验收结果

已执行并通过：

```bash
npm run typecheck
npm run test
npm run build
```

测试结果：

```text
Test Files  16 passed (16)
Tests       49 passed (49)
```

额外 smoke test：

```bash
node dist/cli.js init --project-name smoke
node dist/cli.js apply plan.json
node dist/cli.js apply plan.json --confirm --format json
```

该 smoke test 已在临时目录中通过，验证 apply preview、confirmed JSON apply 和页面写入可以串起来使用。

## 当前边界

本轮未实现：

- `reflect` 自动生成完整可执行 update-plan。
- `ingest` 自动生成完整可执行 update-plan。
- 交互式确认 UI。
- 智能 merge 已有 wiki 页面。
- 同步 rule 到项目根 `AGENTS.md`、`CLAUDE.md` 或 `.cursor/rules`。
- `graph related`、`graph hotspots`、`graph conflicts`。

说明：

- `aiwiki apply` 是通用确认式写入边界。
- 长期 wiki 写入必须显式 `--confirm`。
- 第一版只做安全创建、跳过和显式追加，不做自动覆盖或复杂合并。

## 后续建议

下一轮建议优先让 preview 命令生成更完整的 update-plan：

1. 让 `reflect --format json` 输出可保存的 `WikiUpdatePlan` 草案。
2. 让 `ingest --format json` 输出可保存的 `WikiUpdatePlan` 草案。
3. 为 `apply` 增加更清晰的 diff-style preview。
4. 继续做 `lint --fix`，只修复 index/backlinks/格式等低风险问题。
