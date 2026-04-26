# AIWiki M9 实现记录

## 概览

本轮完成任务连续性增强：新增 `aiwiki decision` 和 `aiwiki blocker`。这两个命令用于在开发任务过程中记录用户已确认的决策和当前阻塞问题，帮助新的 AI 会话准确接力。

这些记录仍属于当前任务状态，不会自动写入长期 wiki。后续只有经过 `reflect` 和用户确认后，才应沉淀为 decision / pitfall / rule 等长期记忆。

## 已实现能力

### `aiwiki decision`

新增命令：

```bash
aiwiki decision "MVP 使用 TypeScript + commander，不做 Web UI"
aiwiki decision "resend invite 时刷新 token，并让旧 token 失效" --module team
aiwiki decision "..." --format json
```

实现行为：

- 找到当前 active task。
- 追加到 `.aiwiki/tasks/<task-id>/decisions.md`。
- 追加 decision 事件到 `checkpoints.jsonl`。
- 更新 task `metadata.json` 的 `updated_at`。
- 重新生成 `resume.md`。
- 标记该决策可能具备长期 wiki 更新价值，但不自动写入 `wiki/decisions/`。

### `aiwiki blocker`

新增命令：

```bash
aiwiki blocker "reflect 写入是否默认需要用户确认？"
aiwiki blocker "LLM provider 是否第一版支持 Anthropic？" --severity high
aiwiki blocker "..." --format json
```

实现行为：

- 找到当前 active task。
- 追加到 `.aiwiki/tasks/<task-id>/blockers.md`。
- 追加 blocker 事件到 `checkpoints.jsonl`。
- 支持 `--severity low|medium|high|critical`。
- 更新 task `metadata.json` 的 `updated_at`。
- 重新生成 `resume.md`。

## 主要文件

### 源码

- `src/task.ts`：新增 `recordTaskDecision`、`recordTaskBlocker`。
- `src/cli.ts`：注册 `decision` 和 `blocker` 命令。
- `src/types.ts`：扩展 task event 类型，支持 `decision` 和 `blocker`。
- `src/index.ts`：导出新增 API 和类型。

### 测试

- `tests/task.test.ts`

新增覆盖内容：

- decision 写入 `decisions.md`。
- blocker 写入 `blockers.md`。
- decision / blocker 事件写入 `checkpoints.jsonl`。
- resume brief 包含 decision 和 blocker。

## 公开 API / 类型

新增导出：

- `recordTaskDecision`
- `recordTaskBlocker`
- `TaskDecisionOptions`
- `TaskBlockerOptions`

## 验收结果

已执行并通过：

```bash
npm run typecheck
npm run test
npm run build
```

测试结果：

```text
Test Files  15 passed (15)
Tests       45 passed (45)
```

额外 smoke test：

```bash
node dist/cli.js init --project-name smoke
node dist/cli.js task start "Context task" --id context-task --format json
node dist/cli.js decision "Use preview-first writes" --module tasks --format json
node dist/cli.js blocker "Need confirmation before agent rule writes" --severity high --format json
node dist/cli.js resume --format json
```

该 smoke test 已在临时目录中通过。

## 当前边界

本轮未实现：

- 自动 PRD checklist 解析。
- `aiwiki decision` 自动升级到 `wiki/decisions/`。
- `aiwiki blocker` 自动生成用户确认交互。
- checkpoint / decision / blocker 的交互式编辑。

说明：

- decision / blocker 是任务接力信息，不是长期项目记忆。
- 长期沉淀仍应通过 `aiwiki reflect` 和用户确认完成。

## 后续建议

下一轮建议优先补写入确认工作流：

1. 为 `promote-rules` 添加用户确认后写入 `wiki/rules/`。
2. 为 `reflect` / `ingest` 添加结构化写入 preview 和确认。
3. 或者继续增强 task PRD tracker，维护 `prd-progress.md` 的 checklist。
