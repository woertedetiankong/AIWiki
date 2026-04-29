# AIWiki M4 实现记录

## 概览

本轮已完成 PRD Milestone 4：Guard 与 Map。AIWiki 现在可以在修改某个文件前输出本地记忆护栏，也可以基于项目文件树和 `.aiwiki/` 记忆生成轻量 Project Map。

本轮继续保持 MVP 边界：不接真实 LLM Provider、不实现 MCP、不做 Web UI、不引入数据库或 AST 级扫描。`guard` 和 `map` 都是 no-LLM、本地优先、Markdown 驱动的能力。

## 已实现能力

### `aiwiki guard`

新增命令：

```bash
aiwiki guard <file>
aiwiki guard <file> --limit 5
aiwiki guard <file> --format json
```

实现行为：

- 根据 frontmatter `files` 精确匹配相关 wiki pages。
- 使用文件路径中的高信息关键词补充检索，避免只靠精确匹配漏掉相关规则。
- 输出 PRD 要求的固定章节：
  - Related Modules
  - Critical Rules
  - Known Pitfalls
  - Required Checks
  - Related Decisions
  - Suggested Tests
- high / critical rule 和 pitfall 优先展示。
- deprecated 页面降权排序。
- 未知文件输出稳定空结果，并建议可创建的 `wiki/files/<slug>.md` file note。
- 只读 `.aiwiki/` 记忆，不自动创建 file note。

### `aiwiki map`

新增命令：

```bash
aiwiki map
aiwiki map --format json
aiwiki map --write
aiwiki map --write --force
```

实现行为：

- 扫描项目文件树，排除 `.aiwiki/`、`.git`、`node_modules`、构建产物、环境变量文件和 config ignore。
- 从 `package.json`、`tsconfig.json`、依赖和目录结构识别技术栈。
- 识别重要目录、生成文件 / do-not-edit candidates。
- 汇总已有 module pages、rule pages、config `riskFiles`、config `highRiskModules`。
- 从 high / critical severity 或 risk 的 wiki pages 汇总高风险文件。
- 输出 PRD 要求的 Project Map 章节：
  - Stack
  - Modules
  - Important Directories
  - High-Risk Files
  - Generated Files / Do-Not-Edit Candidates
  - Existing Rules
  - Missing Module Pages
- `--write` 写入 `.aiwiki/wiki/project-map.md`。
- 默认拒绝覆盖已有 project map，`--force` 才覆盖。
- 写入成功后追加 `.aiwiki/log.md`。

### 输出与架构边界

- `guard` 和 `map` 均支持 `--format markdown/json`。
- CLI 命令层只负责参数解析和输出。
- 业务逻辑分别集中在 `src/guard.ts` 和 `src/project-map.ts`。
- 共享产品默认值集中在 `src/constants.ts`，包括项目扫描排除项、生成物候选、重要目录候选和风险关键词。

## 主要文件

### 源码

- `src/guard.ts`：文件护栏生成、相关页面合并、排序、Markdown/JSON 输出。
- `src/project-map.ts`：项目扫描、stack 识别、Project Map 生成、受控写入。
- `src/cli.ts`：注册 `guard` 和 `map` 命令。
- `src/constants.ts`：新增 M4 相关集中常量。
- `src/index.ts`：导出 M4 新增公共 API 和类型。

### 测试

- `tests/guard.test.ts`
- `tests/project-map.test.ts`

覆盖内容：

- `guard` 能按文件路径匹配 pitfall / rule / module / decision。
- high / critical 内容优先展示。
- 未知文件输出稳定空结果。
- `guard` markdown / json 输出可用。
- `map` 能识别 Node.js / TypeScript / Commander / Vitest 等栈信息。
- `map` 会排除 ignored、build、env 和 `.aiwiki/` 文件。
- `map` 能合并 config 和 wiki-derived high-risk files。
- `map --write` 默认不覆盖，`--force` 可覆盖。

## 公开 API / 类型

新增导出：

- `generateFileGuardrails`
- `formatFileGuardrailsMarkdown`
- `FileGuardrails`
- `FileGuardrailSection`
- `FileGuardrailsOptions`
- `FileGuardrailsResult`
- `generateProjectMap`
- `formatProjectMapMarkdown`
- `ProjectMap`
- `ProjectMapOptions`
- `ProjectMapResult`
- `PROJECT_MAP_PATH`
- `PROJECT_SCAN_EXCLUDED_PATHS`
- `GENERATED_FILE_CANDIDATES`
- `IMPORTANT_DIRECTORY_CANDIDATES`
- `RISK_FILE_KEYWORDS`

## 验收结果

已执行并通过：

```bash
npm run typecheck
npm run test
npm run build
```

测试结果：

```text
Test Files  9 passed (9)
Tests       27 passed (27)
```

额外 smoke test：

```bash
node dist/cli.js init --project-name smoke
node dist/cli.js map --format json
node dist/cli.js guard src/example.ts
```

该 smoke test 已在临时目录中通过，验证 `init`、`map`、`guard` 可以串起来使用。

## 当前边界

本轮未实现：

- 真实 LLM Provider 调用。
- `aiwiki reflect`
- `aiwiki ingest`
- `aiwiki lint`
- `aiwiki graph build`
- `aiwiki task start / checkpoint / resume / status / close`
- 完整 index 自动重建。
- 通用 preview/diff 写入工作流。

说明：

- `map` 使用轻量启发式扫描，不做 AST 分析。
- `guard` 只读现有 wiki 记忆，不自动创建或更新 file note。
- `.aiwiki/wiki/project-map.md` 是受控写入目标，但仍遵守默认不覆盖策略。

## 后续建议

下一轮建议进入 Milestone 5：Reflect 与 Ingest。

优先顺序：

1. 实现 `aiwiki reflect --from-git-diff` 的 no-LLM preview。
2. 实现 git diff 读取和相关 wiki pages 检索。
3. 生成结构化更新建议，但默认不写入。
4. 实现 `aiwiki ingest <file>`，先保留 raw source，再生成结构化建议。
5. 在进入自动写入前补齐通用 preview / confirmation 流程。
