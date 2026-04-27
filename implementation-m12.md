# AIWiki M12 实现记录

## 概览

本轮完成 PRD Milestone 12：Apply Preview 与 Plan 保存。AIWiki 现在可以把 `reflect` / `ingest` 生成的 `updatePlanDraft` 直接保存成可审查、可编辑、可复用的 JSON update plan，并让 `aiwiki apply` dry-run 显示更清楚的 diff-style 预览。

整体链路变为：

```bash
aiwiki reflect --from-git-diff --output-plan .aiwiki/context-packs/reflect-plan.json
aiwiki ingest old-note.md --output-plan .aiwiki/context-packs/ingest-plan.json
aiwiki apply .aiwiki/context-packs/reflect-plan.json
aiwiki apply .aiwiki/context-packs/reflect-plan.json --confirm
```

该链路仍然保持 preview-first：保存 update plan 不会写长期 wiki 页面，`apply` 默认也只预览，只有显式 `--confirm` 才会创建或追加 `.aiwiki/wiki/` 页面。

## 已实现能力

### Reflect output plan

`aiwiki reflect` 新增：

```bash
aiwiki reflect --notes notes/today.md --output-plan .aiwiki/context-packs/reflect-plan.json
aiwiki reflect --from-git-diff --output-plan .aiwiki/context-packs/reflect-plan.json --force
```

实现行为：

- 当存在 `updatePlanDraft` 时，将草案保存为 project-local JSON 文件。
- 保存内容是可直接传给 `aiwiki apply <plan.json>` 的 `WikiUpdatePlan`，不是完整 preview wrapper。
- 默认拒绝覆盖已有 output plan。
- `--force` 可覆盖已有 output plan。
- 输出路径使用 project-local path safety，`../outside.json` 会被拒绝。
- Markdown 输出会显示保存路径，并提示先运行 `aiwiki apply <path>` 预览，再运行 `aiwiki apply <path> --confirm`。

### Ingest output plan

`aiwiki ingest` 新增：

```bash
aiwiki ingest old-note.md --output-plan .aiwiki/context-packs/ingest-plan.json
aiwiki ingest old-note.md --output-plan .aiwiki/context-packs/ingest-plan.json --force
```

实现行为：

- 继续保留 raw note copy 行为。
- 当存在 `updatePlanDraft` 时，将草案保存为 project-local JSON 文件。
- 默认拒绝覆盖已有 output plan。
- `--force` 同时适用于 raw note copy 覆盖和 output plan 覆盖。
- 在写 raw note copy 前先检查 output plan 路径，避免 output plan 无法写入时留下额外 raw note 副本。
- 保存 output plan 不会创建 module / pitfall / decision / pattern / rule 页面。

### Apply diff-style preview

`aiwiki apply <plan.json>` 的 dry-run preview 现在会展示更细的审查信息：

- `create` operation 显示：
  - target path
  - type / title / source / reason
  - frontmatter preview
  - body preview
- `append` operation 显示：
  - target path
  - type / title / source / reason
  - append section heading
  - append body preview
- `skip` operation 显示：
  - target path
  - type / title / source / reason

预览文本会截断较长 body，避免 dry-run 输出过长。`apply --confirm` 的写入行为保持不变：新页面不覆盖已有文件，已有页面只有显式 append sections 时才追加。

## 主要文件

### 源码

- `src/reflect.ts`：新增 `outputPlan` / `force` 选项、output plan 安全写入、Markdown 提示。
- `src/ingest.ts`：新增 `outputPlan` 选项、output plan 安全写入、提前检查输出路径、Markdown 提示。
- `src/apply.ts`：扩展 `WikiUpdateOperation`，新增 frontmatter / body / append preview，并更新 Markdown formatter。
- `src/cli.ts`：为 `reflect` 和 `ingest` 注册 `--output-plan`，为 `reflect` 注册 `--force`。

### 测试

- `tests/reflect.test.ts`
- `tests/ingest.test.ts`
- `tests/apply.test.ts`

新增覆盖内容：

- `reflect --output-plan` 在有草案时写入合法 JSON。
- `reflect --output-plan` 默认不覆盖，`--force` 可覆盖。
- `reflect --output-plan ../outside.json` 会失败。
- `ingest --output-plan` 能保存草案，且不创建结构化 wiki 页面。
- `ingest --output-plan` 默认不覆盖，`--force` 可覆盖。
- `ingest --output-plan ../outside.json` 会失败。
- `apply` dry-run 对 create 显示 frontmatter 和 body preview。
- `apply` dry-run 对 append 显示 append preview。
- `apply` skip 显示明确跳过原因。

## 公开 API / 类型

新增或扩展：

- `ReflectOptions.outputPlan?: string`
- `ReflectOptions.force?: boolean`
- `ReflectPreview.outputPlanPath?: string`
- `IngestOptions.outputPlan?: string`
- `IngestPreview.outputPlanPath?: string`
- `WikiUpdateOperation.frontmatterPreview?: Record<string, unknown>`
- `WikiUpdateOperation.bodyPreview?: string`
- `WikiUpdateOperation.appendPreview?: Array<{ heading: string; bodyPreview: string }>`

CLI 新增：

```bash
aiwiki reflect --output-plan <path>
aiwiki reflect --output-plan <path> --force
aiwiki ingest <file> --output-plan <path>
aiwiki ingest <file> --output-plan <path> --force
```

## 验收结果

已执行并通过：

```bash
npm run typecheck
npm run test
npm run build
git diff --check
```

测试结果：

```text
Test Files  16 passed (16)
Tests       55 passed (55)
```

## 当前边界

本轮未实现：

- 交互式确认 UI。
- 智能 merge 已有 wiki 页面。
- `lint --fix` 低风险自动修复。
- graph related / hotspots / conflicts。
- agent 规则文件同步确认流程。
- LLM 辅助总结。
- SQLite FTS / BM25 / 向量搜索。

说明：

- `updatePlanDraft` 仍是 no-LLM 草案，不是最终事实。
- `--output-plan` 只保存草案，不写长期 wiki。
- `aiwiki apply` 仍必须显式 `--confirm` 才写入。
- 所有 output plan 路径必须在项目根目录内。

## 后续建议

下一轮建议优先：

1. 进入 Milestone 13：记忆质量字段和 lifecycle lint。
2. 增加 `lint --fix`，仅修复 index/backlinks/格式等低风险问题。
3. 增强 graph related / hotspots / conflicts。
4. 增加检索反馈记录与 retrieval tuning。
