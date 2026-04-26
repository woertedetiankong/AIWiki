# AIWiki M5 实现记录

## 概览

本轮已完成 PRD Milestone 5 的 no-LLM 最小闭环：Reflect 与 Ingest。AIWiki 现在可以根据用户 notes 和 / 或 git diff 生成开发后复盘 preview，也可以导入旧 Markdown 原始笔记并生成结构化 wiki 建议。

本轮继续保持数据安全边界：`reflect` 默认不写结构化 wiki 页面；`ingest` 只保存 raw source，并输出建议，不自动新增 pitfall、module、decision、pattern 或 rule。

## 已实现能力

### `aiwiki reflect`

新增命令：

```bash
aiwiki reflect
aiwiki reflect --notes notes/today.md
aiwiki reflect --from-git-diff
aiwiki reflect --from-git-diff --notes notes/today.md
aiwiki reflect --format json
```

实现行为：

- 读取 `.aiwiki/config.json`，未初始化时给出既有初始化错误。
- 可读取 project-local notes 文件。
- 可通过 `git diff -- .` 读取当前工作区 diff。
- 从 git diff 中提取 changed files。
- 使用 notes 和 changed files 检索相关 wiki pages。
- 输出结构化复盘 preview：
  - Task Summary
  - New Lessons
  - Pitfalls to Add or Update
  - Modules to Update
  - Decisions to Add or Deprecate
  - Patterns to Add or Update
  - Rules to Promote
  - Files Changed in `.aiwiki`
- 对 auth、payment、stripe、migration、security 等高风险路径给出 pitfall 复查建议。
- 明确标注本 preview 不写结构化 wiki 页面。

### `aiwiki ingest`

新增命令：

```bash
aiwiki ingest <file>
aiwiki ingest <file> --force
aiwiki ingest <file> --format json
```

实现行为：

- 读取 project-local Markdown note。
- 解析 frontmatter、标题、正文首行、modules、files、tags。
- 将原始笔记复制到 `.aiwiki/sources/raw-notes/`。
- 默认不覆盖已有 raw note；同名文件会写成 `name-2.md`、`name-3.md`。
- `--force` 可覆盖 raw note copy。
- 根据 note 内容检索相关 wiki pages。
- 输出结构化建议：
  - Source Summary
  - Possible Modules
  - Possible Pitfalls
  - Possible Decisions
  - Possible Patterns
  - Possible Rules
  - Related Existing Memory
- 不自动写入结构化 wiki 页面。

## 主要文件

### 源码

- `src/reflect.ts`：notes / git diff 读取、changed files 提取、复盘 preview 生成。
- `src/ingest.ts`：raw note 保存、Markdown 解析、ingest preview 生成。
- `src/cli.ts`：注册 `reflect` 和 `ingest` 命令。
- `src/constants.ts`：新增 `REFLECT_EVALS_PATH` 和 `RAW_NOTES_DIR`。
- `src/index.ts`：导出 M5 新增公共 API 和类型。

### 测试

- `tests/reflect.test.ts`
- `tests/ingest.test.ts`

覆盖内容：

- notes-based reflect preview。
- git diff changed files 提取。
- high-risk changed files pitfall 建议。
- reflect markdown / json 输出。
- ingest raw note copy。
- ingest 默认不覆盖 raw note copy。
- ingest `--force` 覆盖 raw note copy。
- ingest 相关 wiki memory 检索。

## 公开 API / 类型

新增导出：

- `generateReflectPreview`
- `formatReflectPreviewMarkdown`
- `ReflectOptions`
- `ReflectPreview`
- `ReflectResult`
- `ReflectSection`
- `generateIngestPreview`
- `formatIngestPreviewMarkdown`
- `IngestOptions`
- `IngestPreview`
- `IngestResult`
- `IngestSection`
- `REFLECT_EVALS_PATH`
- `RAW_NOTES_DIR`

## 验收结果

已执行并通过：

```bash
npm run typecheck
npm run test
npm run build
```

测试结果：

```text
Test Files  11 passed (11)
Tests       33 passed (33)
```

额外 smoke test：

```bash
node dist/cli.js init --project-name smoke
node dist/cli.js reflect --notes notes/lesson.md --format json
node dist/cli.js ingest notes/lesson.md --format json
```

该 smoke test 已在临时目录中通过，验证 `init`、`reflect`、`ingest` 可以串起来使用。

## 当前边界

本轮未实现：

- 真实 LLM Provider 调用。
- reflect / ingest 的交互式确认写入。
- 自动创建或更新 pitfall / module / decision / pattern / rule 页面。
- 完整 index 自动重建。
- graph build / backlinks。
- lint。
- task continuity。

说明：

- `reflect` 是 preview-first，不写结构化 wiki 页面。
- `ingest` 只保存 raw source，结构化 wiki 更新仍需要用户确认后由后续写入工作流执行。
- git diff 读取依赖本地 `git` 命令；非 git 项目不适合使用 `--from-git-diff`。

## 后续建议

下一轮建议进入 Milestone 6：Lint 与 Graph，或先补通用 preview / confirmation 写入工作流。

优先顺序：

1. 实现 `aiwiki lint` 的 frontmatter、index、orphan page 基础检查。
2. 实现 `aiwiki graph build`，生成 `graph.json` 和 `backlinks.json`。
3. 抽象通用 write preview / confirmation，为 reflect / ingest 的确认写入做准备。
4. 后续再实现 task continuity：`task start / checkpoint / resume / status / close`。
