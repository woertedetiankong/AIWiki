# Implementation M13: Architecture Audit

本轮在 M12 之后继续推进“可迁移架构记忆”方向：AIWiki 现在不仅能在 `brief` 中提醒模块边界和硬编码风险，也能通过独立命令主动检查当前项目的架构健康状况。

## 已实现

### `aiwiki architecture audit`

新增 CLI 命令：

```bash
aiwiki architecture audit
aiwiki architecture audit --format json
```

该命令只读扫描当前项目，不修改业务代码或 `.aiwiki/` 数据。输出内容包括：

* Large Files：超过架构阈值的大文件。
* Hardcoding Risks：疑似硬编码 secret、token、API key、URL 等字面量。
* High-Risk Files：来自 config `riskFiles` 和风险关键词匹配的文件。
* Missing Module Memory：config `highRiskModules` 中缺少 module page 的模块。

### 架构审计服务

`src/architecture.ts` 扩展为同时支持：

* `generateArchitectureBriefContext`：供 `aiwiki brief` 使用的开发前架构提醒。
* `generateArchitectureAudit`：供独立审计命令使用的项目架构体检。
* `formatArchitectureAuditMarkdown`：稳定 Markdown 输出。

审计逻辑继续遵守 local-first 和 preview-first 边界：

* 尊重 `.aiwiki/config.json` 的 `ignore`。
* 跳过 `.aiwiki/`、`.git`、`node_modules`、构建目录等默认排除路径。
* 不做自动重构。
* 不自动创建 wiki 页面。
* 不阻止用户继续开发。

### 公共导出

`src/index.ts` 新增导出：

* `generateArchitectureAudit`
* `formatArchitectureAuditMarkdown`
* `ArchitectureAudit`
* `ArchitectureAuditIssue`
* `ArchitectureAuditIssueCode`
* `ArchitectureAuditResult`
* `ArchitectureAuditSeverity`

## 测试覆盖

新增 `tests/architecture.test.ts`，覆盖：

* 大文件、硬编码风险、高风险文件和缺失 module memory 的报告。
* 小项目无风险时的稳定 fallback 输出。
* CLI `architecture audit` 命令可运行并输出 Markdown。

本轮验证：

```bash
npm run typecheck
npm run test
```

已通过：17 个测试文件，60 个测试。

## 后续开发建议

下一轮建议继续围绕“架构体检闭环”推进：

1. 将 architecture audit 接入 `reflect --from-git-diff`，让开发后复盘能提示本次改动是否引入大文件、硬编码或模块边界风险。
2. 增强审计规则，识别 provider SDK、API route、DB persistence、UI component、config 混在同一文件的职责混杂信号。
3. 增加 module memory 建议草案，将缺失的高风险模块转换为可审查的 update plan draft，但仍由用户确认后 `apply --confirm`。
4. 再进入 PRD Milestone 13：记忆质量字段和 lifecycle lint，包括 `confidence`、`importance`、`last_seen`、`last_used`、`stale_after`。
5. 在模块记忆质量稳定后，再设计跨项目 `module export/import`。跨语言迁移应迁移模块契约、业务规则、配置清单、测试清单和历史坑，而不是直接复制代码。

## 接力提示

新会话继续开发前，建议先阅读：

* `prd.md`
* `implementation-m12.md`
* `implementation-m13.md`
* `src/architecture.ts`
* `tests/architecture.test.ts`

如果继续实现下一步，优先任务是：让 `reflect` 使用 architecture audit 的结果，并把风险写入 preview / JSON 输出，而不是直接写文件。
