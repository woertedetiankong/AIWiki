# AIWiki M11 实现记录

## 概览

本轮完成 `reflect` / `ingest` 的 `WikiUpdatePlan` 草案生成，并统一规则升级 preview 的草案命名。AIWiki 现在可以把复盘和旧笔记导入从“只给建议”推进到“生成可保存、可预览、可确认写入的 update plan 草案”。

整体链路变为：

```bash
aiwiki reflect --format json
aiwiki ingest <file> --format json
aiwiki apply <plan.json>
aiwiki apply <plan.json> --confirm
```

所有草案仍然是 preview-first，不会直接写长期 wiki。

## 已实现能力

### Reflect update plan draft

`aiwiki reflect --format json` 输出新增 `updatePlanDraft`。

实现行为：

- 根据 notes、git diff changed files、相关 wiki pages 生成候选 entry。
- 已匹配到相关 pitfall / decision / pattern 时，优先生成 append entry。
- 根据 changed files 推断模块候选。
- 高风险 changed files 且没有匹配 pitfall 时，生成 pitfall 候选。
- notes 中出现 decision / pattern / rule 相关关键词时，生成对应候选。
- 草案 entry 均带 `source: "reflect"`。
- Markdown 输出显示 update plan draft 条数，并提示先运行 `aiwiki apply <plan.json>` 预览。

### Ingest update plan draft

`aiwiki ingest <file> --format json` 输出新增 `updatePlanDraft`。

实现行为：

- 根据旧 Markdown 的 frontmatter、标题、正文首段、tags、files、modules 生成草案。
- 已匹配到相关 wiki page 时，优先生成 append entry，避免盲目创建重复页面。
- 没有匹配页面时，根据内容关键词生成 pitfall / decision / pattern / rule 候选。
- raw note copy 行为不变。
- 草案 entry 均带 `source: "ingest"`。
- Markdown 输出显示 update plan draft 条数，并提示先运行 `aiwiki apply <plan.json>` 预览。

### Promote rules 统一

`aiwiki promote-rules` 保留既有 `updatePlan`，同时新增同内容别名 `updatePlanDraft`，并为 rule entry 标记 `source: "promote-rules"`。

### Apply preview 来源展示

`aiwiki apply` 的 preview operation 新增 source：

```md
- create: .aiwiki/wiki/pitfalls/example.md
  - Type: pitfall
  - Title: Example
  - Source: reflect
  - Reason: Target wiki page does not exist.
```

这让用户可以看到每条写入建议来自 reflect、ingest、promote-rules 或 manual。

### 轻量结构化检索增强

本轮没有引入 SQLite、BM25、向量库或远程 embedding。

新增的改动是：`reflect` 从 changed file path 推断模块时，不再只看路径前两级，而是扫描整条路径并过滤 `src`、`app`、`api`、`route` 等低信号 token。例如：

```text
src/app/api/auth/route.ts -> auth
```

## 主要文件

### 源码

- `src/reflect.ts`：新增 `updatePlanDraft` 生成和路径模块候选增强。
- `src/ingest.ts`：新增 `updatePlanDraft` 生成。
- `src/promote-rules.ts`：新增 `updatePlanDraft` 别名和 `source` 字段。
- `src/apply.ts`：`WikiUpdatePlanEntry` 新增 `source`，apply preview 显示 source。
- `src/index.ts`：导出 `WikiUpdateSource` 类型。

### 测试

- `tests/reflect.test.ts`
- `tests/ingest.test.ts`
- `tests/apply.test.ts`
- `tests/promote-rules.test.ts`

新增覆盖内容：

- notes-based reflect 生成 append 草案。
- git diff reflect 根据高风险 changed files 生成 module / pitfall 草案。
- ingest 对已有相关页面生成 append 草案。
- ingest 对无匹配旧笔记生成新 rule 草案。
- 草案可直接传给 `apply` dry-run。
- apply preview 显示 operation source。
- confirmed apply 后页面可被 search、brief、guard 检索到。
- promote-rules 输出 `updatePlanDraft` 且 entry source 为 `promote-rules`。

## 公开 API / 类型

新增或扩展：

- `ReflectPreview.updatePlanDraft?: WikiUpdatePlan`
- `IngestPreview.updatePlanDraft?: WikiUpdatePlan`
- `RulePromotionPreview.updatePlanDraft?: WikiUpdatePlan`
- `WikiUpdatePlanEntry.source?: "reflect" | "ingest" | "promote-rules" | "manual"`
- `WikiUpdateOperation.source?: WikiUpdateSource`
- `WikiUpdateSource`

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
Tests       51 passed (51)
```

## 当前边界

本轮未实现：

- LLM 辅助总结。
- SQLite FTS / BM25 / 向量搜索。
- 复杂 diff-style apply preview。
- 智能 merge 已有 wiki 页面。
- 交互式确认 UI。
- agent 规则文件同步。

说明：

- `updatePlanDraft` 是 no-LLM 草案，不是最终事实。
- 用户仍应先运行 `aiwiki apply <plan.json>` 审核操作，再用 `--confirm` 写入。
- 已有页面优先 append，不覆盖。

## 后续建议

下一轮建议优先：

1. 为 `aiwiki apply` 增加 diff-style preview，让 append / create 的正文预览更清楚。
2. 为 `reflect` / `ingest` 增加 `--output-plan <path>`，直接把草案保存成 JSON 文件。
3. 做 `lint --fix`，只修复 index/backlinks/格式等低风险问题。
4. 增强 graph relate / hotspots / conflicts。
