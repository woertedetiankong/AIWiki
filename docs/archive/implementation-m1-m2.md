# AIWiki M1+M2 实现记录

## 概览

本轮已完成 PRD 第 37 节建议的 Milestone 1 + Milestone 2：搭建 Node+npm + TypeScript CLI 项目，并实现 AIWiki 的本地 Markdown 工作流基础能力。

当前实现重点是为后续 `brief`、`guard`、`reflect`、`ingest`、`search`、`lint`、`graph build` 等命令打基础，不包含 LLM Provider 接入、MCP、Web UI、GEPA 或 RLM。

后续根据代码审查又做了一轮架构优化：集中产品常量、拆出模板、抽象受控写入、增加 wiki frontmatter 校验，并新增根目录 `AGENTS.md` 作为 AIWiki 自身的工程规范。

## 已实现能力

### CLI 骨架

新增 Node ESM + TypeScript CLI 项目。

支持命令：

```bash
aiwiki init
aiwiki init --project-name <name>
aiwiki init --force
```

新增 npm scripts：

```bash
npm run build
npm run test
npm run typecheck
npm run dev -- <args>
```

主要依赖：

- `commander`：CLI 命令解析
- `gray-matter`：Markdown frontmatter 读写
- `zod`：配置校验与默认值合并
- `vitest`：测试
- `tsx`：本地开发运行 TypeScript

### `aiwiki init`

`aiwiki init` 会在当前目录生成 `.aiwiki/` 目录结构：

```text
.aiwiki/
  config.json
  AGENTS.md
  index.md
  log.md
  sessions/
  sources/
    raw-notes/
    git-diffs/
    ai-summaries/
  wiki/
    modules/
    pitfalls/
    decisions/
    patterns/
    rules/
    files/
  graph/
    graph.json
    backlinks.json
  context-packs/
  prompts/
    brief.md
    reflect.md
    ingest.md
    guard.md
    lint.md
  evals/
    brief-cases.jsonl
    reflect-cases.jsonl
    context-feedback.jsonl
```

实现行为：

- 默认不覆盖已有文件。
- `--force` 只刷新 AIWiki 管理的默认模板文件。
- 不删除用户额外创建的文件。
- 当前目录不是 git repo 时仍可初始化，但会输出 git 工作流受限的 warning。
- 默认 provider 为 `none`，首版不要求配置 API key。

### 配置读取

已实现 `.aiwiki/config.json` 读取与校验。

默认配置包含：

- `version: "0.1.0"`
- `provider: "none"`
- `tokenBudget.brief: 8000`
- `tokenBudget.guard: 3000`
- `tokenBudget.reflect: 10000`
- `rulesTargets.agentsMd: true`
- 默认 ignore：`.env*`、`node_modules`、`.git`、`dist`、`build`、`.next`

未初始化时会抛出明确错误，提示运行：

```bash
aiwiki init
```

### Markdown 存储层

已实现基础 Markdown/frontmatter 能力：

- 解析 Markdown frontmatter。
- 写入标准 frontmatter + body 格式。
- 扫描 `.aiwiki/wiki/**/*.md`。
- 返回结构化 `WikiPage`。
- 支持按 `type`、`module`、`file` 过滤页面。
- 使用 Zod 校验 wiki page frontmatter，非法 `type`、`status`、`severity` 等会被拒绝。

这些能力会供后续 `brief`、`guard`、`search` 等命令复用。

### 架构优化

为减少硬编码和提升扩展性，本轮补充了以下结构：

- `src/constants.ts`：集中 `.aiwiki/` 路径、默认目录、默认 token budget、默认 ignore、版本号等产品约定。
- `src/templates.ts`：集中 prompt 模板、`.aiwiki/AGENTS.md`、默认 `index.md`、默认 `log.md`。
- `src/managed-write.ts`：集中“不覆盖用户文件”和 `--force` 受控覆盖策略。
- `src/wiki-frontmatter.ts`：集中 wiki page frontmatter schema 和校验逻辑。
- 根目录 `AGENTS.md`：记录 AIWiki 项目的产品级工程规范，强调可扩展性、数据安全、避免散落硬编码。

当前仍保留一些合理的产品默认值，例如 `.aiwiki/`、初始目录结构和 token budget，但它们已经集中管理，不再散落在命令实现里。

### Index / Log 基础能力

已实现：

- 初始化 `index.md` 分类索引骨架。
- 初始化 `log.md` 时间线日志。
- `formatLogEntry` 生成 PRD 风格日志条目。
- `appendLogEntry` 向 `.aiwiki/log.md` 追加记录。

日志格式示例：

```md
## [2026-04-25] reflect | Stripe refund webhook
- Updated: [[wiki/modules/payment.md]]
- Added: [[wiki/pitfalls/stripe-webhook-raw-body.md]]
```

## 主要文件

### 项目配置

- `AGENTS.md`
- `package.json`
- `package-lock.json`
- `tsconfig.json`
- `tsconfig.typecheck.json`
- `.gitignore`

### 源码

- `src/cli.ts`：CLI 入口与 `init` 命令。
- `src/init.ts`：`.aiwiki/` 初始化流程编排。
- `src/constants.ts`：产品常量和默认目录结构。
- `src/templates.ts`：默认 Markdown 和 prompt 模板。
- `src/managed-write.ts`：受控写入策略。
- `src/config.ts`：配置 schema、默认配置、配置读取。
- `src/markdown.ts`：Markdown frontmatter 解析与写入。
- `src/wiki-frontmatter.ts`：wiki page frontmatter schema 与校验。
- `src/wiki-store.ts`：wiki 页面扫描与过滤。
- `src/log.ts`：日志格式化与追加。
- `src/paths.ts`：项目内路径安全解析。
- `src/types.ts`：核心类型定义。
- `src/index.ts`：公开导出。

### 测试

- `tests/init.test.ts`
- `tests/config.test.ts`
- `tests/markdown.test.ts`
- `tests/wiki-store.test.ts`
- `tests/log.test.ts`

## 公开类型

已导出核心类型：

- `AIWikiConfig`
- `WikiPageFrontmatter`
- `WikiPage`
- `LogEntry`
- `AIWikiProvider`
- `WikiPageType`
- `WikiPageStatus`
- `RiskLevel`

## 验收结果

已执行并通过：

```bash
npm run typecheck
npm run test
npm run build
```

测试结果：

```text
Test Files  5 passed (5)
Tests       11 passed (11)
```

额外 smoke test：

```bash
node /Users/superstorm/Documents/Code/llmwiki/dist/cli.js init --project-name smoke
```

该命令已在临时目录中成功生成 `.aiwiki/` 结构，并验证重复运行不会覆盖已有内容。

## 当前边界

本轮未实现以下命令：

- `aiwiki brief`
- `aiwiki guard`
- `aiwiki reflect`
- `aiwiki ingest`
- `aiwiki search`
- `aiwiki lint`
- `aiwiki graph build`

本轮也未实现：

- LLM Provider 调用
- MCP Server
- Web UI
- GEPA / prompt 自优化
- RLM / deep-context
- 自动修改用户项目的 agent 规则文件

说明：根目录 `AGENTS.md` 已作为本仓库自身的工程规范创建；`.aiwiki/AGENTS.md` 仍由 `aiwiki init` 生成，用于目标项目中的 AIWiki 使用说明。

## 后续建议

下一轮建议进入 Milestone 3：搜索与 Brief。

优先顺序：

1. 实现 `aiwiki search "<query>"` 的简单关键词检索。
2. 基于现有 wiki store 实现相关页面打分。
3. 实现 `aiwiki brief "<task>"` 的 no-LLM 模板输出。
4. 保留 provider 抽象，但先不强制接入真实模型。
5. 添加 markdown/json 输出格式支持。
