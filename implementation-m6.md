# AIWiki M6 实现记录

## 概览

本轮已完成 PRD Milestone 6：Lint 与 Graph。AIWiki 现在可以检查 `.aiwiki/wiki/` 的基础健康问题，也可以基于 Markdown frontmatter 和链接生成轻量图谱文件。

本轮继续保持 MVP 边界：不引入图数据库、不做自动修复、不自动重写用户 wiki 页面。`lint` 默认只报告；`graph build` 只生成 `.aiwiki/graph/graph.json` 和 `.aiwiki/graph/backlinks.json`。

## 已实现能力

### `aiwiki lint`

新增命令：

```bash
aiwiki lint
aiwiki lint --format json
```

实现行为：

- 容错扫描 `.aiwiki/wiki/**/*.md`。
- 报告 malformed frontmatter，而不是让命令崩溃。
- 检查 `index.md` 是否遗漏 wiki 页面。
- 检查 Markdown 双链和 `.md` 链接的断链。
- 检查 frontmatter 关系字段的断链：
  - `related_pitfalls`
  - `related_decisions`
  - `related_patterns`
  - `supersedes`
  - `conflicts_with`
  - `source_pitfalls`
- 检查孤立页面。
- 检查重复 pitfall 标题。
- 检查 config `highRiskModules` 是否缺少 module page。
- 有 error 时 CLI 退出码为 1。

### `aiwiki graph build`

新增命令：

```bash
aiwiki graph build
aiwiki graph build --format json
```

实现行为：

- 扫描合法 wiki pages。
- 为 wiki pages 生成节点。
- 为 frontmatter `files` 生成 file 节点和 `references_file` 边。
- 为 frontmatter `modules` 生成 module 节点和 `relates_to` 边。
- 解析关系字段，生成 `relates_to`、`supersedes`、`conflicts_with`、`promoted_from` 边。
- 解析 Markdown 双链 `[[...]]` 和普通 `.md` 链接。
- 写入：
  - `.aiwiki/graph/graph.json`
  - `.aiwiki/graph/backlinks.json`
- 写入成功后追加 `.aiwiki/log.md`。

## 主要文件

### 源码

- `src/lint.ts`：wiki 健康检查、容错扫描、Markdown 链接解析、报告格式化。
- `src/graph.ts`：图谱节点 / 边构建、backlinks 生成、graph 文件写入。
- `src/cli.ts`：注册 `lint` 和 `graph build` 命令。
- `src/constants.ts`：新增 graph 路径常量。
- `src/types.ts`：新增 graph 节点、边、JSON 类型。
- `src/index.ts`：导出 M6 新增公共 API 和类型。

### 测试

- `tests/lint.test.ts`
- `tests/graph.test.ts`

覆盖内容：

- lint 报告 invalid frontmatter。
- lint 报告 broken links。
- lint 报告 duplicate pitfalls。
- lint 报告 index missing page。
- lint 报告 high-risk module 缺少 module page。
- graph build 生成 page / file / module 节点。
- graph build 生成 relation / file reference 边。
- graph build 生成 backlinks。
- graph build 写入 graph 和 backlinks 文件。

## 公开 API / 类型

新增导出：

- `lintWiki`
- `formatLintReportMarkdown`
- `LintIssue`
- `LintReport`
- `LintResult`
- `LintSeverity`
- `buildWikiGraph`
- `formatGraphJson`
- `formatBacklinksJson`
- `BacklinksJson`
- `GraphBuildOptions`
- `GraphBuildResult`
- `GraphNode`
- `GraphEdge`
- `GraphJson`
- `GraphNodeType`
- `GraphEdgeType`
- `GRAPH_DIR`
- `GRAPH_JSON_PATH`
- `BACKLINKS_JSON_PATH`

## 验收结果

已执行并通过：

```bash
npm run typecheck
npm run test
npm run build
```

测试结果：

```text
Test Files  13 passed (13)
Tests       37 passed (37)
```

额外 smoke test：

```bash
node dist/cli.js init --project-name smoke
node dist/cli.js graph build --format json
node dist/cli.js lint --format json
```

该 smoke test 已在临时目录中通过，验证 `init`、`graph build`、`lint` 可以串起来使用。

## 当前边界

本轮未实现：

- `aiwiki lint --fix`。
- graph related / hotspots / conflicts。
- 自动修复 index、backlinks 或格式。
- 自动合并重复 pitfall。
- 自动升级规则。
- task continuity。

说明：

- `lint` 是报告型命令，不修改用户文件。
- `graph build` 会写 graph JSON 文件，但不修改 wiki 页面。
- malformed frontmatter 会被 lint 报告；graph build 仍要求 wiki pages frontmatter 合法。

## 后续建议

下一轮建议进入 Milestone 7：规则升级，或先补任务连续性系统。

优先顺序：

1. 实现 `aiwiki promote-rules`，扫描 high severity / repeated pitfalls 并生成 rule candidates。
2. 为规则升级添加 preview-first 输出，不自动修改 `AGENTS.md`。
3. 实现 `aiwiki task start / checkpoint / resume / status / close`，解决长任务跨会话接力。
4. 后续补 `lint --fix` 的低风险修复，仅限 index/backlinks/格式类操作。
