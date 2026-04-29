# AIWiki M3 实现记录

## 概览

本轮已完成 PRD Milestone 3：搜索与 Brief。AIWiki 现在具备本地 Markdown 记忆检索能力，并能在不调用 LLM 的情况下生成 Development Brief。

本轮仍保持 MVP 边界：不接真实 LLM Provider、不实现 MCP、不做 Web UI、不实现 guard / reflect / ingest / lint / graph / task continuity。所有能力继续围绕本地 `.aiwiki/` Markdown 工作流展开。

## 已实现能力

### `aiwiki search`

新增命令：

```bash
aiwiki search "<query>"
aiwiki search "<query>" --type pitfall
aiwiki search "<query>" --limit 5
aiwiki search "<query>" --format json
```

实现行为：

- 扫描 `.aiwiki/wiki/**/*.md`。
- 基于标题、frontmatter、文件路径、正文关键词进行简单相关性打分。
- 支持按 wiki page type 过滤。
- 支持 Markdown 和 JSON 输出。
- 高 severity 页面加权。
- `encountered_count` 最多加权 3 分。
- `deprecated` 页面降权。
- 空 wiki 或无匹配时输出稳定空结果。

### `aiwiki brief`

新增命令：

```bash
aiwiki brief "<task>"
aiwiki brief "<task>" --limit 8
aiwiki brief "<task>" --format json
aiwiki brief "<task>" --output .aiwiki/context-packs/current.md
aiwiki brief "<task>" --output .aiwiki/context-packs/current.md --force
```

实现行为：

- 读取 `.aiwiki/config.json` 和 `.aiwiki/index.md`。
- 复用搜索服务选择相关 wiki pages。
- 生成 no-LLM Development Brief。
- 输出 PRD 要求的主要章节：Task、Goal、Product Questions、Recommended Direction、Relevant Modules、Relevant Project Memory、Known Pitfalls、Project Rules and Constraints、High-Risk Files、Suggested Must-Read Files、Acceptance Criteria、Notes for Codex。
- 明确提醒 Codex：brief 是项目记忆和约束，不是具体代码实现计划。
- `--output` 写入项目内路径，默认拒绝覆盖已有文件。
- `--force` 可覆盖指定输出文件。
- 成功生成 brief 后追加 `.aiwiki/log.md`。
- 成功生成 brief 后追加 `.aiwiki/evals/brief-cases.jsonl`。

### 输出与 Provider 边界

新增共享输出解析：

- `--format markdown`
- `--format json`
- `--limit <n>` 正整数校验

新增轻量 provider 接口：

```ts
interface LLMProvider {
  generateText(input: GenerateTextInput): Promise<string>;
}
```

本轮只预留接口，不调用远程模型，不读取 API key。

## 主要文件

### 源码

- `src/search.ts`：本地 wiki 检索、打分、排序。
- `src/brief.ts`：no-LLM Development Brief 生成、输出写入、log/eval 追加。
- `src/output.ts`：Markdown/JSON 输出格式化和 CLI 参数解析。
- `src/provider.ts`：轻量 LLM provider 接口。
- `src/cli.ts`：注册 `search` 和 `brief` 命令。
- `src/constants.ts`：新增 `BRIEF_EVALS_PATH`。
- `src/wiki-frontmatter.ts`：导出 `wikiPageTypeSchema` 供 CLI 参数校验复用。
- `src/index.ts`：导出 M3 新增公共 API 和类型。

### 测试

- `tests/search.test.ts`
- `tests/brief.test.ts`

覆盖内容：

- 搜索打分和排序。
- `--type` 类型过滤。
- 空 wiki / 无匹配结果。
- Markdown / JSON 搜索输出。
- 未初始化时 brief 报错。
- brief 填充相关 pitfall、rule、module。
- brief 不生成具体代码编辑步骤。
- brief JSON 结构稳定。
- `--output` 默认不覆盖，`--force` 可覆盖。

## 公开 API / 类型

新增导出：

- `searchWikiMemory`
- `SearchResult`
- `SearchResponse`
- `SearchOptions`
- `SearchMatchedField`
- `generateDevelopmentBrief`
- `formatDevelopmentBriefMarkdown`
- `GenerateTextInput`
- `LLMProvider`
- `parseOutputFormat`
- `parsePositiveInteger`
- `formatSearchResponse`
- `BRIEF_EVALS_PATH`
- `wikiPageTypeSchema`

## 验收结果

已执行并通过：

```bash
npm run typecheck
npm run test
npm run build
```

测试结果：

```text
Test Files  7 passed (7)
Tests       19 passed (19)
```

额外 smoke test：

```bash
node dist/cli.js init --project-name smoke
node dist/cli.js search stripe --format json
node dist/cli.js brief "stripe webhook"
```

该 smoke test 已在临时目录中通过，验证 `init`、`search`、`brief` 可以串起来使用。

## 当前边界

本轮未实现：

- 真实 LLM Provider 调用。
- `aiwiki guard`
- `aiwiki reflect`
- `aiwiki ingest`
- `aiwiki lint`
- `aiwiki graph build`
- `aiwiki task start / checkpoint / resume / status / close`
- 完整 index 自动重建。
- 通用 preview/diff 写入工作流。

说明：当前目录不是 git repo，因此本轮不依赖 git diff，也没有实现 git diff 摘要。

## 后续建议

下一轮建议进入两个方向之一：

1. Milestone 4：实现 `aiwiki guard <file>` 和 `aiwiki map`，复用现有搜索与 wiki filtering。
2. 第 37 节任务连续性最小闭环：实现 `task start`、`checkpoint`、`resume`、`task status`。

如果目标是尽快让 Codex 修改高风险文件前获得护栏，优先做 `guard`。如果目标是长任务跨会话接力，优先做 task continuity。
