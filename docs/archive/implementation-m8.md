# AIWiki M8 实现记录

## 概览

本轮已完成 PRD 第 37 节的任务连续性与新会话接力 MVP。AIWiki 现在可以记录当前开发任务、追加 checkpoint、查看状态、生成 resume brief，并关闭任务。

该能力用于记录“当前任务开发到哪里了”，不等同于长期项目记忆。任务记录保存在 `.aiwiki/tasks/`，只有后续 `reflect` 才会把可复用经验沉淀到 wiki。

## 已实现能力

### `aiwiki task start`

新增命令：

```bash
aiwiki task start "实现团队邀请 resend invite"
aiwiki task start "根据 PRD 开发 AIWiki MVP" --id aiwiki-mvp
aiwiki task start "根据 PRD 开发 AIWiki MVP" --prd prd.md
aiwiki task start "..." --format json
```

实现行为：

- 创建 `.aiwiki/tasks/<task-id>/`。
- 写入 `metadata.json`、`task.md`、`progress.md`、`decisions.md`、`blockers.md`、`changed-files.md`、`tests.md`、`checkpoints.jsonl`、`resume.md`。
- `--prd` 会额外初始化 `prd-progress.md` 空模板。
- 写入 `.aiwiki/tasks/active-task`。
- 追加 `.aiwiki/log.md`。

### `aiwiki task list`

新增命令：

```bash
aiwiki task list
aiwiki task list --status in_progress
aiwiki task list --recent 10
aiwiki task list --format json
```

实现行为：

- 列出任务 metadata。
- 显示 active task。
- 支持按 status 过滤。
- 支持 recent 数量限制。

### `aiwiki task status`

新增命令：

```bash
aiwiki task status
aiwiki task status <task-id>
aiwiki task status --format json
```

实现行为：

- 默认读取 active task。
- 输出 task metadata、progress、changed files、tests、blockers、checkpoints。

### `aiwiki checkpoint`

新增命令：

```bash
aiwiki checkpoint --message "完成 init 命令"
aiwiki checkpoint --step "Milestone 1" --status done
aiwiki checkpoint --tests "npm run test passing"
aiwiki checkpoint --next "实现 resume"
aiwiki checkpoint --from-git-diff
aiwiki checkpoint --format json
```

实现行为：

- 找到 active task。
- 追加 `checkpoints.jsonl`。
- 更新 `progress.md`。
- 更新 `changed-files.md`。
- 更新 `tests.md`。
- 重新生成 `resume.md`。
- `--from-git-diff` 会读取 `git diff --name-only -- .`，失败时降级为空文件列表。

### `aiwiki resume`

新增命令：

```bash
aiwiki resume
aiwiki resume <task-id>
aiwiki resume --output .aiwiki/tasks/<task-id>/resume.md
aiwiki resume --format json
```

实现行为：

- 默认读取 active task。
- 根据 progress、decisions、blockers、changed-files、tests、checkpoints 生成 Codex 接力简报。
- 默认刷新 `.aiwiki/tasks/<task-id>/resume.md`。
- 可通过 `--output` 写入 project-local 指定路径。

### `aiwiki task close`

新增命令：

```bash
aiwiki task close
aiwiki task close --status done
aiwiki task close --status paused
aiwiki task close --status cancelled
aiwiki task close --format json
```

实现行为：

- 更新 task status。
- 写入 `closed_at`。
- 重新生成 resume brief。
- 如果关闭的是 active task，则删除 `.aiwiki/tasks/active-task`。
- 追加 `.aiwiki/log.md`。
- 输出建议：关闭后运行 `aiwiki reflect --from-git-diff`，再决定是否沉淀长期记忆。

## 主要文件

### 源码

- `src/task.ts`：任务创建、列表、状态、checkpoint、resume、关闭。
- `src/cli.ts`：注册 `task start/list/status/close`、`checkpoint`、`resume`。
- `src/constants.ts`：新增 `TASKS_DIR`、`ACTIVE_TASK_PATH`。
- `src/types.ts`：新增 task metadata、status、checkpoint 类型。
- `src/index.ts`：导出任务连续性相关 API 和类型。

### 测试

- `tests/task.test.ts`

覆盖内容：

- start task 初始化所有任务文件。
- `--prd` 初始化 `prd-progress.md`。
- checkpoint 更新 progress、tests 和 resume。
- `--from-git-diff` 记录 changed files。
- task list 显示 active / recent tasks。
- task close 更新状态并清理 active task。

## 公开 API / 类型

新增导出：

- `startTask`
- `listTasks`
- `getTaskStatus`
- `checkpointTask`
- `resumeTask`
- `closeTask`
- `TASK_FILES`
- `TaskStartOptions`
- `TaskListOptions`
- `TaskStatusData`
- `TaskCheckpointOptions`
- `TaskResumeOptions`
- `TaskCloseOptions`
- `TaskCommandResult`
- `TaskMetadata`
- `TaskStatus`
- `TaskCheckpoint`
- `TASKS_DIR`
- `ACTIVE_TASK_PATH`

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
Tests       44 passed (44)
```

额外 smoke test：

```bash
node dist/cli.js init --project-name smoke
node dist/cli.js task start "Smoke task" --id smoke-task --format json
node dist/cli.js task list --format json
node dist/cli.js checkpoint --message "Made progress" --status done --tests "npm run test passing" --next "Continue implementation" --format json
node dist/cli.js resume --format json
node dist/cli.js task status --format json
node dist/cli.js task close --status paused --format json
```

该 smoke test 已在临时目录中通过。

## 当前边界

本轮未实现：

- `aiwiki decision`
- `aiwiki blocker`
- 自动 PRD checklist 解析。
- 自动测试结果解析。
- checkpoint 的交互式编辑。
- close 时交互式询问是否先运行 reflect。

说明：

- task 记录是当前任务状态，不污染长期 wiki。
- task close 只建议运行 reflect，不自动执行 reflect。
- resume brief 会提醒新 Codex 会话不要从头开始，并先核对仓库实际状态。

## 后续建议

下一轮建议补两个方向之一：

1. 任务连续性增强：`aiwiki decision`、`aiwiki blocker`、PRD checklist 基础维护。
2. 写入确认工作流：为 `reflect`、`ingest`、`promote-rules` 添加用户确认后的结构化写入。
