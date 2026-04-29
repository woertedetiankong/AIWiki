# Implementation M14: Module Porting Packs

本轮继续在 `codex/architecture-audit` 分支上推进模块迁移能力。AIWiki 现在可以把一个模块相关的长期记忆导出为 portable module pack，也可以在另一个项目中导入该 pack 并生成迁移 preview 和 update plan draft。

## 已实现

### `aiwiki module export <module>`

新增命令：

```bash
aiwiki module export payment
aiwiki module export payment --output .aiwiki/module-packs/payment.aiwiki-pack.json
aiwiki module export payment --format json
```

行为：

* 扫描 `.aiwiki/wiki/**/*.md`。
* 选出与指定 module 相关的 `module`、`decision`、`pattern`、`pitfall`、`rule` 页面。
* 生成 portable JSON pack，默认写入 `.aiwiki/module-packs/<module>.aiwiki-pack.json`。
* pack 包含源项目名、模块名、导出时间、相关 wiki 页面、相关文件路径和架构迁移提醒。
* 默认不覆盖已有 pack，`--force` 才覆盖。

### `aiwiki module import <pack>`

新增命令：

```bash
aiwiki module import .aiwiki/module-packs/payment.aiwiki-pack.json
aiwiki module import ../source/.aiwiki/module-packs/payment.aiwiki-pack.json --target-stack "FastAPI + PostgreSQL"
aiwiki module import payment.aiwiki-pack.json --output-plan .aiwiki/context-packs/payment-import-plan.json
```

行为：

* 读取 module pack。
* 输出迁移 preview，而不是写入 wiki 页面。
* 明确提示跨栈迁移时不要直接复制源码，应迁移模块契约、规则、坑、配置和测试要求。
* 生成 `updatePlanDraft`，可选写入 project-local JSON 文件。
* 后续仍需用户审查，再通过 `aiwiki apply --confirm` 写入目标项目 `.aiwiki/wiki/`。

### 安全边界

本轮继续保持 local-first 和 preview-first：

* 不复制业务代码。
* 不自动修改目标项目代码。
* 不自动写入目标项目 wiki 页面。
* 不覆盖已有 pack 或 output plan，除非显式 `--force`。
* 写入路径仍限制在目标项目根目录内。
* import 可以读取用户显式提供的 pack 文件路径，以支持跨项目迁移。

### 公共 API

新增 `src/module-pack.ts`，并在 `src/index.ts` 导出：

* `exportModulePack`
* `generateModuleImportPreview`
* `readModulePackFile`
* `formatModulePackExportMarkdown`
* `formatModuleImportPreviewMarkdown`
* `modulePackSchema`
* `ModulePack`
* `ModulePackPage`
* `ModuleImportPreview`
* `ModulePackExportOptions`
* `ModulePackImportOptions`
* `ModulePackExportResult`
* `ModulePackImportResult`

## 测试覆盖

新增 `tests/module-pack.test.ts`，覆盖：

* 导出 payment 模块相关 module / decision / pattern / pitfall / rule 页面。
* 导入 pack 时生成 preview 和 `updatePlanDraft`，不直接写 wiki 页面。
* CLI `module export` 和 `module import` 冒烟测试。

本轮验证：

```bash
npm run typecheck
npm run test
```

已通过：18 个测试文件，63 个测试。

## 后续开发建议

模块迁移 MVP 已形成闭环，但还可以继续增强：

1. 在 `module import` preview 中检测目标项目已有同名 wiki 页面，优先生成 append / skip 建议，减少重复页面。
2. 增加 `--same-stack` 或 `--source-stack`，让同栈迁移和跨栈迁移的提示更明确。
3. 在 pack 中记录 source project stack、dependencies、env keys、数据库表/迁移线索。
4. 将 architecture audit 的结果接入 pack export，标记导出模块当前的可迁移性风险。
5. 增强 hardcoding 检测，减少误报，并支持可配置审计阈值。
6. 在 README 或 PRD 中补正式用户工作流：先 `brief`，开发后 `reflect/apply`，再 `module export/import`。

## 接力提示

新会话继续开发前，建议先阅读：

* `implementation-m13.md`
* `implementation-m14.md`
* `src/architecture.ts`
* `src/module-pack.ts`
* `tests/architecture.test.ts`
* `tests/module-pack.test.ts`

如果继续做下一步，优先建议是：让 `module import` 检测目标项目已有页面并生成 append/skip 草案，而不是总是 create proposed pages。
