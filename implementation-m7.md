# AIWiki M7 实现记录

## 概览

本轮已完成 PRD Milestone 7：规则升级 preview。AIWiki 现在可以扫描重复出现且严重程度高的 pitfall，生成 rule promotion candidates。

本轮继续保持安全边界：`promote-rules` 只输出 preview，不自动创建 `wiki/rules/` 页面，不自动修改 `AGENTS.md`、`CLAUDE.md` 或 `.cursor/rules`。

## 已实现能力

### `aiwiki promote-rules`

新增命令：

```bash
aiwiki promote-rules
aiwiki promote-rules --min-count 3
aiwiki promote-rules --format json
```

实现行为：

- 扫描 `.aiwiki/wiki/**/*.md`。
- 只选择 `type: pitfall` 的页面。
- 默认候选条件：
  - `severity: high | critical`
  - `encountered_count >= 2`
  - `status` 不是 `deprecated`
- 支持 `--min-count <n>` 调整重复次数阈值。
- 生成 rule promotion candidates：
  - Rule title
  - Rule body
  - Why
  - Applies To modules / files
  - Source pitfalls
  - Severity
  - Encountered count
  - Suggested targets
  - Requires confirmation
- 根据 `.aiwiki/config.json` 的 `rulesTargets` 输出建议目标：
  - `wiki/rules`
  - `AGENTS.md`
  - `CLAUDE.md`
  - `.cursor/rules`
- 输出 skipped pitfalls，说明哪些 pitfall 没有达到升级条件。

## 主要文件

### 源码

- `src/promote-rules.ts`：规则升级候选生成、Markdown/JSON 输出。
- `src/cli.ts`：注册 `promote-rules` 命令。
- `src/constants.ts`：新增 `DEFAULT_RULE_PROMOTION_MIN_COUNT`。
- `src/index.ts`：导出 M7 新增公共 API 和类型。

### 测试

- `tests/promote-rules.test.ts`

覆盖内容：

- 只升级 repeated high / critical pitfalls。
- deprecated pitfall 不会成为候选。
- `--min-count` 能控制候选范围。
- markdown / json 输出稳定。
- 不会创建结构化 rule 页面。

## 公开 API / 类型

新增导出：

- `generateRulePromotionPreview`
- `formatRulePromotionPreviewMarkdown`
- `PromoteRulesOptions`
- `RulePromotionCandidate`
- `RulePromotionPreview`
- `RulePromotionResult`
- `DEFAULT_RULE_PROMOTION_MIN_COUNT`

## 验收结果

已执行并通过：

```bash
npm run typecheck
npm run test
npm run build
```

测试结果：

```text
Test Files  14 passed (14)
Tests       40 passed (40)
```

额外 smoke test：

```bash
node dist/cli.js init --project-name smoke
node dist/cli.js promote-rules --format json
```

该 smoke test 已在临时目录中通过，验证 `init`、`promote-rules` 可以串起来使用。

## 当前边界

本轮未实现：

- 自动创建 `wiki/rules/` 页面。
- 自动修改 `AGENTS.md`、`CLAUDE.md` 或 `.cursor/rules`。
- 规则候选交互式确认。
- 规则候选合并。
- rule promotion 写入 log / graph。

说明：

- `promote-rules` 是 preview-first 命令。
- 规则升级属于高风险操作，后续写入必须经过用户确认。

## 后续建议

下一轮建议补任务连续性系统，解决长任务跨会话接力：

1. `aiwiki task start "<task>"`
2. `aiwiki task checkpoint --message "..."`
3. `aiwiki task status`
4. `aiwiki task resume`
5. `aiwiki task close --status success|failed|cancelled`

该能力应记录当前任务目标、已完成内容、改过文件、跑过测试、用户决策和下一步建议，但不混入长期 wiki 记忆。
