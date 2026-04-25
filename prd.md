# PRD：AI Coding Memory / AIWiki

## 0. 文档目的

本文档用于指导 Codex 开发一个本地优先的 AI 编程辅助工具。该工具面向使用 Codex、Claude Code、Cursor 等 AI 编程代理的开发者，提供项目长期记忆、开发前上下文简报、开发中护栏、开发后复盘与知识库维护能力。

该工具不是单纯的“踩坑 Markdown 管理器”，而是一个面向 AI 编程代理的项目记忆与上下文工程层。

---

## 1. 产品名称

暂定名称：`AIWiki`

可选命名：

* `DevMemory`
* `AgentWiki`
* `CodeMemory`
* `ContextForge`
* `Project Memory for AI Agents`

本文档统一使用 `AIWiki`。

---

## 2. 一句话定位

AIWiki 是一个本地 Markdown 驱动的项目长期记忆与上下文工程工具，帮助 Codex / Claude Code / Cursor 在开发前理解项目历史、开发中避免重复踩坑、开发后沉淀经验并更新项目规则。

---

## 3. 背景与问题

开发者在使用 AI 编程代理时，经常会在每次需求完成后，让 AI 总结本次开发中遇到的坑，并保存为 Markdown 文档。随着项目迭代增多，这些踩坑文档会越来越多，逐渐出现以下问题：

1. 文档按时间堆积，难以按模块、文件、技术栈、风险点检索。
2. 每次新会话都需要人工挑选相关文档发给 AI。
3. AI 可能重复犯历史错误，例如支付 webhook、鉴权、数据库 migration 等高风险模块中的老问题。
4. 历史开发经验停留在聊天记录或零散 Markdown 中，无法稳定转化为项目规则。
5. 开发前缺少项目记忆驱动的上下文简报，Codex 只能临时阅读代码库来猜测项目约定。
6. 开发后缺少标准化复盘流程，经验无法持续积累。
7. 知识库增长后可能出现重复、过期、矛盾、孤立文档。

AIWiki 的目标是把“每次开发后的经验”编译成一个持续维护的项目记忆系统，并在下一次开发前自动生成给 AI 编程代理使用的高质量上下文。

---

## 4. 核心理念

### 4.1 Session 不等于 Context Window

AI 编程代理的一次会话不应该被看作模型的全部记忆。模型的上下文窗口是临时的、有限的、容易被压缩或截断的。项目历史、踩坑经验、架构决策、业务约束应该存放在外部、可检索、可审计、可持续更新的长期记忆层中。

AIWiki 应该把长期记忆保存在仓库内的 `.aiwiki/` 目录中，并在每次任务开始前根据当前任务生成精简的 context pack，而不是把全部历史文档塞进模型上下文。

### 4.2 Raw Sources 与 Compiled Wiki 分离

AIWiki 应该区分：

* 原始开发记录：不可变或尽量少修改，用于追溯事实。
* 编译后的 Wiki：由 AI 维护的结构化知识层，用于开发前检索和上下文生成。
* Context Pack：面向一次具体任务的临时上下文切片。
* Agent Rules：被用户批准、会长期影响 AI 行为的项目规则。

### 4.3 用户不是知识库编辑员

用户不应该手动维护 index、log、双链、标签、模块页。工具和 AI 负责整理、检索、更新、生成建议。用户只在关键节点做决策：确认需求方向、产品细节、架构选择、规则升级和过期清理。

### 4.4 AIWiki 是 Codex Plan Mode 的上游

Codex 可能已经有计划模式。AIWiki 不替代 Codex 的实现计划。AIWiki 负责生成 Development Brief，也就是项目记忆驱动的任务简报；Codex 基于这个 brief 再生成代码执行层面的实现计划。

---

## 5. 目标用户

### 5.1 主要用户

个人开发者、独立开发者、创业项目开发者，经常使用 Codex / Claude Code / Cursor 等 AI 编程工具开发项目。

### 5.2 次要用户

小团队开发者，希望 AI 代理能够理解项目历史和团队约定，减少重复犯错。

### 5.3 非目标用户

* 需要完整企业知识库系统的大型组织。
* 希望用 Web UI 管理所有文档的知识管理用户。
* 不使用 AI 编程代理的传统开发者。

---

## 6. 产品目标

### 6.1 MVP 目标

MVP 要解决 4 个核心问题：

1. 生成项目地图：帮助 AI 了解项目结构、模块、高风险文件和约定。
2. 生成开发简报：根据任务自动生成给 Codex 的上下文、风险、历史坑和验收标准。
3. 查询文件护栏：当 AI 要修改某个文件时，告诉它相关历史坑和规则。
4. 开发后复盘：根据用户备注和 git diff，更新结构化项目记忆。

### 6.2 中期目标

1. 建立轻量图谱：用 Markdown 双链和 `graph.json` 表达模块、文件、坑、规则、决策之间的关系。
2. 支持规则升级：把反复出现的坑升级为 `AGENTS.md`、`CLAUDE.md` 或 `.cursor/rules`。
3. 支持知识库健康检查：发现重复、过期、矛盾和孤立知识。
4. 支持 session event log：记录开发过程中的关键事件。

### 6.3 长期目标

1. 支持 MCP Server，让 Codex / Claude Code / Cursor 可以直接调用 AIWiki。
2. 支持 deep-context 模式，用递归探索或大上下文切片方式分析超大知识库。
3. 支持 GEPA / eval 驱动的 prompt 优化，自动优化 ingest、context、reflect、rule promotion 等流程。
4. 支持跨项目经验迁移。

---

## 7. 非目标

MVP 阶段不做以下内容：

1. 不做复杂 Web UI。
2. 不接入 Neo4j 等重型图数据库。
3. 不做多人权限和团队协作。
4. 不做云同步。
5. 不要求用户使用特定 AI 编程工具。
6. 不自动修改业务代码。
7. 不在未获用户确认的情况下自动修改全局 agent 规则。
8. 不把所有历史内容一次性塞进模型上下文。

---

## 8. 核心使用场景

### 8.1 开发前：生成 Development Brief

用户输入：

```bash
aiwiki brief "给团队邀请功能增加 resend invite"
```

工具输出一个给 Codex 的开发简报，包含：

* 任务目标
* 需要用户确认的产品问题
* 项目历史相关经验
* 相关模块
* 高风险文件
* 必须遵守的规则
* 推荐方向
* 验收标准
* 建议 Codex 先阅读的文件或文档

用户确认或编辑简报后，将其交给 Codex。Codex 再基于简报生成自己的实现计划并执行。

### 8.2 开发中：查询文件护栏

用户或 Codex 输入：

```bash
aiwiki guard src/app/api/stripe/webhook/route.ts
```

工具输出：

* 该文件相关模块
* 历史踩坑
* 必须遵守的规则
* 相关决策
* 修改前后需要检查的事项

### 8.3 开发中：搜索项目记忆

```bash
aiwiki search "Supabase service role client"
```

工具从 `.aiwiki/` 中检索相关模块页、pitfall、decision、pattern、rules，并按相关性输出。

### 8.4 开发后：复盘并更新知识库

用户输入：

```bash
aiwiki reflect --from-git-diff
```

工具读取 git diff、最近 session log、用户备注，生成：

* 本次任务总结
* 新增或更新的 pitfall
* 需要更新的 module summary
* 可能新增的 decision
* 可复用 pattern
* 是否建议升级规则
* index 和 log 更新

用户确认后，工具写入 `.aiwiki/`。

### 8.5 定期：知识库健康检查

```bash
aiwiki lint
```

工具检查：

* 重复 pitfall
* 过期 decision
* 冲突规则
* 孤立页面
* 缺少模块归属的文档
* 反复出现但未升级的坑
* index / graph 不一致

---

## 9. 产品形态

MVP 使用本地 CLI。

后续可扩展：

1. MCP Server
2. VS Code / Cursor 插件
3. Obsidian 兼容视图
4. 简单 Web UI

MVP 的本地 CLI 应该可以被 Codex 调用，也可以由用户手动调用。

---

## 10. 推荐技术栈

MVP 推荐使用 TypeScript + Node.js / Bun。

原因：

* 与前端和全栈项目兼容性好。
* 方便发布 npm 包。
* 方便实现 CLI、文件系统操作、Markdown 解析。
* 后续可以自然扩展 MCP Server。

可选技术：

* CLI 框架：`commander` 或 `cac`
* Markdown 解析：`gray-matter`、`remark`
* 搜索：初期使用 `ripgrep` 或 JS 文件扫描；后续可接 SQLite FTS / LanceDB / qdrant
* Git diff：调用 `git diff` 命令
* LLM Provider：OpenAI / Anthropic / OpenRouter，MVP 抽象 provider 接口
* 测试：Vitest
* 配置：`.aiwiki/config.json`

---

## 11. 目录结构

初始化后，在项目根目录生成：

```text
.aiwiki/
  config.json
  AGENTS.md
  index.md
  log.md

  sessions/
    .gitkeep

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

### 11.1 `config.json`

示例：

```json
{
  "version": "0.1.0",
  "projectName": "my-project",
  "defaultModel": "gpt-5.5-thinking",
  "provider": "openai",
  "rulesTargets": {
    "agentsMd": true,
    "claudeMd": false,
    "cursorRules": false
  },
  "tokenBudget": {
    "brief": 8000,
    "guard": 3000,
    "reflect": 10000
  },
  "riskFiles": [],
  "ignore": ["node_modules", ".next", "dist", "build", ".git"]
}
```

### 11.2 `index.md`

内容索引。列出模块、pitfall、decision、pattern、rules。每次写入新页面后自动更新。

### 11.3 `log.md`

时间线日志。每次 ingest、brief、reflect、lint、rule promotion 都追加记录。

日志格式：

```md
## [2026-04-25] reflect | Stripe refund webhook

- Updated: [[wiki/modules/payment.md]]
- Added: [[wiki/pitfalls/stripe-webhook-raw-body.md]]
- Proposed rule: verify raw webhook body before parsing
```

### 11.4 `sessions/*.jsonl`

开发过程事件日志。每行一个 JSON。

```json
{"type":"task_start","task":"Implement resend invite","time":"2026-04-25T10:00:00Z"}
{"type":"error","message":"Invite token was reused after resend","files":["src/actions/invite.ts"]}
{"type":"fix","message":"Refresh token on resend and invalidate old token"}
{"type":"task_end","status":"success"}
```

### 11.5 `wiki/modules/`

每个项目模块一页。

示例：`wiki/modules/payment.md`

```md
---
type: module
name: payment
status: active
risk: high
related_files:
  - src/app/api/stripe/webhook/route.ts
  - src/lib/stripe.ts
related_pitfalls:
  - ../pitfalls/stripe-webhook-raw-body.md
last_updated: 2026-04-25
---

# Module: Payment

## Purpose

## Current Architecture

## Key Files

## Known Pitfalls

## Required Patterns

## Recent Changes
```

### 11.6 `wiki/pitfalls/`

每个可复用踩坑一页。

```md
---
type: pitfall
status: active
severity: high
modules: [payment]
files:
  - src/app/api/stripe/webhook/route.ts
frameworks: [nextjs, stripe]
encountered_count: 3
last_encountered: 2026-04-25
---

# Pitfall: Stripe webhook raw body must be verified before parsing

## Symptom

## Root Cause

## Correct Fix

## Avoid

## Example

## Related

## Source
```

### 11.7 `wiki/decisions/`

架构和产品决策。

```md
---
type: decision
status: active
modules: [auth]
decision_date: 2026-04-25
supersedes: []
---

# Decision: Use Supabase Auth for authentication

## Context

## Decision

## Alternatives Considered

## Consequences

## Related Pitfalls
```

### 11.8 `wiki/patterns/`

可复用实现模式。

```md
---
type: pattern
modules: [team, auth]
status: active
---

# Pattern: Server Action with permission check

## Use When

## Required Steps

## Example Shape

## Common Mistakes
```

### 11.9 `wiki/rules/`

规则候选页。被用户批准后，可以同步到 `AGENTS.md`、`CLAUDE.md` 或 `.cursor/rules`。

```md
---
type: rule
status: proposed
source_pitfalls:
  - ../pitfalls/supabase-service-role-client.md
severity: critical
---

# Rule: Never expose service role key to client components

## Rule

## Why

## Applies To

## Examples
```

---

## 12. CLI 命令设计

### 12.1 `aiwiki init`

初始化 `.aiwiki/`。

用法：

```bash
aiwiki init
aiwiki init --project-name my-app
```

行为：

1. 检查当前目录是否为 git repo。
2. 创建 `.aiwiki/` 目录结构。
3. 创建默认 `config.json`。
4. 创建 `AGENTS.md`、`index.md`、`log.md`。
5. 创建默认 prompt 模板。
6. 不覆盖已有文件，除非传入 `--force`。

验收：

* 空项目中运行后生成完整目录。
* 重复运行不会破坏已有内容。

---

### 12.2 `aiwiki map`

生成或更新项目地图。

用法：

```bash
aiwiki map
aiwiki map --write
```

行为：

1. 扫描项目文件树。
2. 识别技术栈、主要目录、可能模块、高风险文件。
3. 读取已有 `.aiwiki/wiki/modules/`。
4. 输出 Project Map。
5. `--write` 时写入或更新 `.aiwiki/wiki/project-map.md`。

输出包括：

* Stack
* Modules
* Important directories
* High-risk files
* Generated files / do-not-edit files
* Existing rules
* Missing module pages

---

### 12.3 `aiwiki brief "<task>"`

生成 Development Brief。该命令是 MVP 最重要命令。

用法：

```bash
aiwiki brief "给团队邀请功能增加 resend invite"
aiwiki brief "重构支付模块" --output .aiwiki/context-packs/payment-refactor.md
aiwiki brief "增加修改邮箱功能" --interactive
```

行为：

1. 读取 `index.md`。
2. 检索相关 module、pitfall、decision、pattern、rules。
3. 根据任务识别需要用户确认的产品和架构问题。
4. 生成 Development Brief。
5. 默认只输出到 stdout；传入 `--output` 时保存。
6. 追加 `log.md`。
7. 记录 eval case 到 `.aiwiki/evals/brief-cases.jsonl`。

Development Brief 模板：

```md
# Development Brief

## Task

## Goal

## Product Questions to Confirm

## Recommended Direction

## Relevant Modules

## Relevant Project Memory

## Known Pitfalls

## Project Rules and Constraints

## High-Risk Files

## Suggested Must-Read Files

## Acceptance Criteria

## Notes for Codex
Use this brief as project memory and constraints. Create your own implementation plan before editing code.
```

重要约束：

* brief 不应该替 Codex 写具体代码实现步骤。
* brief 可以给出推荐方向、风险和验收标准。
* brief 应明确说明“Codex 应基于该 brief 自己制定 implementation plan”。

---

### 12.4 `aiwiki guard <file>`

查询文件护栏。

用法：

```bash
aiwiki guard src/app/api/stripe/webhook/route.ts
```

行为：

1. 根据文件路径查找相关 module、pitfall、decision、pattern、rules。
2. 输出修改该文件前必须知道的上下文。
3. 如果该文件没有记录，输出“未找到已有护栏”，并建议是否创建 file note。

输出模板：

```md
# File Guardrails: <file>

## Related Modules

## Critical Rules

## Known Pitfalls

## Required Checks

## Related Decisions

## Suggested Tests
```

---

### 12.5 `aiwiki search "<query>"`

搜索项目记忆。

用法：

```bash
aiwiki search "stripe webhook"
aiwiki search "service role" --type pitfall
```

MVP 搜索策略：

1. Markdown 文件标题匹配。
2. Frontmatter 匹配。
3. 内容关键词匹配。
4. 简单相关性排序。

后续可升级为 BM25 / SQLite FTS / 向量搜索。

---

### 12.6 `aiwiki reflect`

开发后复盘。

用法：

```bash
aiwiki reflect
aiwiki reflect --from-git-diff
aiwiki reflect --notes ./notes/today.md
aiwiki reflect --interactive
```

行为：

1. 收集输入：git diff、用户 notes、最近 session log、已有相关 wiki 页面。
2. 生成复盘建议。
3. 生成将要写入的文件变更 preview。
4. 默认不写入，除非用户确认或传入 `--yes`。
5. 写入后更新 index、log、graph。
6. 记录 eval case。

输出包括：

* Task Summary
* New Lessons
* Pitfalls to Add or Update
* Modules to Update
* Decisions to Add or Deprecate
* Patterns to Add or Update
* Rules to Promote
* Files Changed in `.aiwiki/`

用户确认选项：

* Keep as note
* Add as pitfall
* Update module
* Promote to rule
* Discard

---

### 12.7 `aiwiki ingest <file>`

导入已有踩坑 Markdown。

用法：

```bash
aiwiki ingest ./old-notes/stripe-webhook.md
aiwiki ingest ./old-notes --batch
```

行为：

1. 将原始文件复制到 `.aiwiki/sources/raw-notes/`。
2. 分析内容。
3. 生成 pitfall / module / pattern / decision 更新建议。
4. 用户确认后写入。
5. 更新 index、log、graph。

---

### 12.8 `aiwiki lint`

知识库健康检查。

用法：

```bash
aiwiki lint
aiwiki lint --fix
```

检查项：

1. Frontmatter 缺失或格式错误。
2. index 缺失页面。
3. graph 链接断裂。
4. 孤立 pitfall。
5. 重复 pitfall。
6. active decision 与 deprecated decision 冲突。
7. 反复出现的 pitfall 未升级规则。
8. 高风险模块缺少 module summary。

`--fix` 仅修复低风险问题，例如 index、backlinks、格式。规则升级和废弃 decision 必须用户确认。

---

### 12.9 `aiwiki promote-rules`

发现并升级规则。

用法：

```bash
aiwiki promote-rules
aiwiki promote-rules --target agents
```

行为：

1. 扫描高频 pitfall。
2. 找出重复出现、严重程度高、适合长期约束 AI 的经验。
3. 生成规则候选。
4. 用户确认后写入 `wiki/rules/`。
5. 可选同步到 `AGENTS.md`、`CLAUDE.md`、`.cursor/rules/`。

---

### 12.10 `aiwiki graph build`

构建轻量图谱。

用法：

```bash
aiwiki graph build
aiwiki graph related payment
aiwiki graph hotspots
```

MVP `graph build` 行为：

1. 解析所有 `.aiwiki/wiki/**/*.md` frontmatter。
2. 解析 Markdown 双链和相对链接。
3. 输出 `.aiwiki/graph/graph.json` 和 `backlinks.json`。

节点类型：

* module
* pitfall
* decision
* pattern
* rule
* file
* source
* session

边类型：

* relates_to
* applies_to
* fixed_by
* caused_by
* supersedes
* conflicts_with
* promoted_from
* references_file

---

### 12.11 `aiwiki session`

开发过程事件日志。

用法：

```bash
aiwiki session start "实现 resend invite"
aiwiki session event --type error --message "token reused after resend" --file src/actions/invite.ts
aiwiki session event --type fix --message "regenerate token and expire previous one"
aiwiki session end --status success
```

MVP 可以先支持手动记录。后续通过 hooks 或 MCP 自动记录。

---

## 13. 核心流程

### 13.1 标准开发流程

```text
1. 用户提出任务
2. aiwiki brief 生成 Development Brief
3. 用户确认产品细节和约束
4. 用户把 brief 交给 Codex
5. Codex 用自己的 plan mode 生成 implementation plan
6. Codex 修改代码并运行测试
7. aiwiki reflect 分析 git diff 和开发记录
8. 用户确认新经验和规则升级
9. AIWiki 更新 wiki、index、log、graph
```

### 13.2 高风险文件流程

```text
1. Codex 准备修改高风险文件
2. 调用 aiwiki guard <file>
3. 读取历史坑和规则
4. Codex 生成更谨慎的实现计划
5. 开发后 reflect 更新相关页面
```

### 13.3 旧文档导入流程

```text
1. 用户把历史踩坑 md 放到 old-notes/
2. aiwiki ingest old-notes --batch
3. 工具生成结构化更新建议
4. 用户确认
5. 写入 wiki 并维护 index / graph
```

---

## 14. 用户参与设计

用户只参与关键决策，不参与低价值整理。

### 14.1 用户需要参与

1. 描述任务目标。
2. 确认产品方向和边界。
3. 选择架构方案。
4. 审核开发后沉淀的经验。
5. 批准规则升级和过期清理。

### 14.2 用户不需要参与

1. 手动维护 index。
2. 手动维护 log。
3. 手动添加双链。
4. 手动搜索相关 md。
5. 手动从 git diff 总结经验。
6. 手动判断哪些页面需要更新。

### 14.3 风险分级交互

低风险：自动处理。

* index 更新
* backlinks 更新
* log 追加
* 格式修复

中风险：开发后统一确认。

* 新增 pitfall
* 更新 module summary
* 合并重复文档

高风险：必须即时或显式确认。

* 修改全局规则
* 标记 decision deprecated
* 删除旧经验
* 影响支付、鉴权、数据库、权限、生产数据的建议

---

## 15. 数据模型

### 15.1 WikiPage

```ts
type WikiPageType =
  | 'project_map'
  | 'module'
  | 'pitfall'
  | 'decision'
  | 'pattern'
  | 'rule'
  | 'file'
  | 'source';

interface WikiPageFrontmatter {
  type: WikiPageType;
  status?: 'active' | 'deprecated' | 'proposed' | 'uncertain';
  title?: string;
  modules?: string[];
  files?: string[];
  tags?: string[];
  severity?: 'low' | 'medium' | 'high' | 'critical';
  risk?: 'low' | 'medium' | 'high' | 'critical';
  related_pitfalls?: string[];
  related_decisions?: string[];
  related_patterns?: string[];
  supersedes?: string[];
  conflicts_with?: string[];
  source_sessions?: string[];
  encountered_count?: number;
  created_at?: string;
  last_updated?: string;
}
```

### 15.2 Graph

```ts
interface GraphNode {
  id: string;
  type: WikiPageType | 'file' | 'session';
  label: string;
  path?: string;
  status?: string;
  severity?: string;
}

interface GraphEdge {
  from: string;
  to: string;
  type:
    | 'relates_to'
    | 'applies_to'
    | 'fixed_by'
    | 'caused_by'
    | 'supersedes'
    | 'conflicts_with'
    | 'promoted_from'
    | 'references_file';
  source?: string;
}

interface GraphJson {
  version: string;
  generated_at: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}
```

### 15.3 Session Event

```ts
type SessionEventType =
  | 'task_start'
  | 'task_end'
  | 'file_changed'
  | 'command_run'
  | 'error'
  | 'fix'
  | 'decision'
  | 'lesson'
  | 'user_feedback';

interface SessionEvent {
  type: SessionEventType;
  time: string;
  task?: string;
  message?: string;
  files?: string[];
  status?: 'success' | 'failed' | 'cancelled';
  metadata?: Record<string, unknown>;
}
```

### 15.4 Eval Case

```ts
interface BriefEvalCase {
  id: string;
  time: string;
  task: string;
  generatedBriefPath?: string;
  selectedDocs: string[];
  userFeedback?: string;
  outcome?: 'helpful' | 'missing_context' | 'too_long' | 'wrong_context' | 'unknown';
}
```

---

## 16. LLM Provider 抽象

MVP 应该把 LLM 调用抽象成 provider，避免绑定单一模型。

```ts
interface LLMProvider {
  generateText(input: {
    system?: string;
    prompt: string;
    temperature?: number;
    maxTokens?: number;
  }): Promise<string>;
}
```

初期支持：

1. OpenAI-compatible API
2. Anthropic API 可选
3. `--no-llm` 模式：只做搜索和模板输出

配置方式：

* 环境变量：`OPENAI_API_KEY`、`ANTHROPIC_API_KEY`
* `.aiwiki/config.json`
* CLI 参数覆盖

---

## 17. 检索策略

### 17.1 MVP 检索

输入任务或查询后：

1. 读取 `index.md`。
2. 扫描 `.aiwiki/wiki/**/*.md`。
3. 基于标题、frontmatter、文件路径、正文关键词打分。
4. 优先 active、高 severity、高 encountered_count、相关 module 的页面。
5. 返回 top N 页面给 LLM 汇总。

### 17.2 排序建议

打分因素：

* 标题匹配：+5
* frontmatter module 匹配：+4
* 文件路径匹配：+4
* 正文关键词匹配：+2
* severity high/critical：+2
* status deprecated：-5
* encountered_count：最高 +3
* 最近更新：最高 +2

### 17.3 后续升级

* SQLite FTS
* BM25
* 向量搜索
* 图谱扩展检索
* RLM deep-context

---

## 18. Prompt 模板要求

所有 prompt 放在 `.aiwiki/prompts/`，允许用户修改。

### 18.1 `brief.md` 要求

输入：

* task
* relevant wiki pages
* project map
* index summary
* token budget

输出：Development Brief。

要求：

* 不生成具体代码。
* 不替 Codex 制定具体编辑步骤。
* 明确用户需要确认的问题。
* 明确历史坑和项目规则。
* 明确 Codex 应自行制定 implementation plan。

### 18.2 `reflect.md` 要求

输入：

* git diff
* user notes
* session events
* relevant wiki pages

输出：结构化更新建议。

要求：

* 区分一次性问题和可复用经验。
* 不把临时 workaround 自动升级成规则。
* 标注置信度。
* 给出文件变更 preview。

### 18.3 `guard.md` 要求

输入：

* file path
* related pages
* graph neighbors

输出：文件护栏。

要求：

* 简洁。
* 优先 critical/high severity。
* 包含修改前和修改后检查项。

---

## 19. 写入策略

为防止 AI 误写，MVP 默认采用 preview-first。

所有会修改 `.aiwiki/` 的命令默认：

1. 生成建议。
2. 显示 diff。
3. 等待用户确认。
4. 写入文件。

可用 `--yes` 跳过确认，但高风险操作即使 `--yes` 也应提示，除非传入 `--force`。

高风险操作包括：

* 删除页面
* 标记 decision deprecated
* 修改 AGENTS.md
* 写入 `.cursor/rules`
* 批量合并文档

---

## 20. 与 Codex 的集成方式

### 20.1 手动集成

用户运行：

```bash
aiwiki brief "..." --output .aiwiki/context-packs/current.md
```

然后把生成内容发给 Codex。

### 20.2 AGENTS.md 集成

`AGENTS.md` 中应包含：

```md
# AIWiki Usage for Coding Agents

Before starting a non-trivial task:
1. Run or ask the user to run `aiwiki brief "<task>"`.
2. Treat the brief as project memory and constraints.
3. Create your own implementation plan before editing code.

Before editing a high-risk file:
1. Run `aiwiki guard <file>`.
2. Follow critical rules and checks.

After completing a task:
1. Run or ask the user to run `aiwiki reflect --from-git-diff`.
2. Do not promote rules without user confirmation.
```

### 20.3 MCP 集成，后续

MCP tools：

* `get_project_map()`
* `get_development_brief(task)`
* `get_file_guardrails(file_path)`
* `search_project_memory(query)`
* `record_session_event(event)`
* `reflect_after_changes(diff, notes)`
* `propose_rule_promotions()`

---

## 21. 图谱设计

### 21.1 MVP 图谱

MVP 不使用图数据库。使用 Markdown 链接、YAML frontmatter、`graph.json`。

### 21.2 图谱用途

1. 提升 brief 相关性。
2. 找出高风险模块。
3. 找出重复坑。
4. 找出规则升级候选。
5. 找出冲突和过期文档。
6. 生成 Obsidian 兼容图谱体验。

### 21.3 图谱命令

```bash
aiwiki graph build
aiwiki graph related <node>
aiwiki graph hotspots
aiwiki graph conflicts
```

### 21.4 Hotspot 计算

模块风险分数：

```text
risk_score = critical_pitfalls * 5 + high_pitfalls * 3 + decisions * 1 + recent_changes * 1
```

---

## 22. GEPA / 自优化路线

MVP 不实现 GEPA，但从第一天收集 eval 数据。

后续可以用 GEPA 优化：

1. `brief` prompt
2. `reflect` prompt
3. `guard` prompt
4. `ingest` prompt
5. `promote-rules` prompt
6. tool descriptions

需要先积累：

* 真实任务
* 生成的 brief
* 用户反馈
* Codex 开发结果
* 是否重复踩坑
* 用户对 reflect 的接受/拒绝记录

后续命令：

```bash
aiwiki optimize brief
aiwiki optimize reflect
```

该命令应生成 prompt 候选和评估报告，不应自动替换生产 prompt，除非用户确认。

---

## 23. RLM / Deep Context 路线

MVP 不实现 RLM。

后续可增加：

```bash
aiwiki deep-context "分析 auth 模块为什么总出问题"
aiwiki investigate "过去三个月支付模块反复出现什么问题"
```

适用场景：

* `.aiwiki/` 很大，普通 brief 不够。
* 跨项目经验查询。
* 长 session / 大 git history 分析。
* 需要递归探索大量文档。

---

## 24. 安全与隐私

MVP 本地优先。

要求：

1. 默认所有数据保存在项目本地。
2. 不上传代码或 wiki，除非用户配置 LLM provider 并明确调用需要 LLM 的命令。
3. 对 git diff 发送给 LLM 前应提示用户。
4. 支持 `--no-llm` 模式。
5. 支持 `.aiwikiignore`，避免读取 secrets、env、build artifacts。
6. 默认 ignore：`.env*`、`node_modules`、`.git`、`dist`、`build`、`.next`。

---

## 25. 配置文件

`.aiwiki/config.json` 字段：

```ts
interface AIWikiConfig {
  version: string;
  projectName: string;
  provider?: 'openai' | 'anthropic' | 'openai-compatible' | 'none';
  defaultModel?: string;
  baseUrl?: string;
  tokenBudget?: {
    brief?: number;
    guard?: number;
    reflect?: number;
  };
  rulesTargets?: {
    agentsMd?: boolean;
    claudeMd?: boolean;
    cursorRules?: boolean;
  };
  ignore?: string[];
  riskFiles?: string[];
  highRiskModules?: string[];
}
```

---

## 26. 输出格式要求

所有 CLI 输出应支持：

```bash
--format markdown
--format json
```

默认 markdown，方便直接复制给 Codex。

JSON 模式用于未来 MCP / 插件集成。

---

## 27. 错误处理

常见错误：

1. 未初始化 `.aiwiki/`：提示运行 `aiwiki init`。
2. 无 git 仓库：允许继续，但 `--from-git-diff` 不可用。
3. 未配置 LLM：降级为搜索和模板输出。
4. API key 缺失：明确提示环境变量。
5. Markdown frontmatter 解析失败：lint 报告具体文件。
6. 写入冲突：先备份或显示 diff。
7. token budget 超限：裁剪低相关性页面，并在输出中说明。

---

## 28. MVP 验收标准

### 28.1 初始化

* `aiwiki init` 可生成完整目录结构。
* 重复执行不会破坏已有文件。

### 28.2 Brief

* `aiwiki brief "任务"` 能读取已有 wiki 页面并生成 Development Brief。
* Brief 包含任务目标、产品问题、历史坑、规则、风险、验收标准。
* Brief 明确提醒 Codex 自己生成 implementation plan。

### 28.3 Guard

* `aiwiki guard <file>` 能根据文件路径找到相关 pitfall 和 rules。
* 对未知文件给出合理空结果。

### 28.4 Reflect

* `aiwiki reflect --from-git-diff` 能读取 git diff。
* 能生成待写入 preview。
* 用户确认后能写入 pitfall / module / log / index。

### 28.5 Ingest

* `aiwiki ingest <file>` 能导入旧 Markdown。
* 能生成结构化 pitfall 建议。

### 28.6 Lint

* `aiwiki lint` 能检查 index 缺失、frontmatter 问题、孤立页面。

### 28.7 Graph

* `aiwiki graph build` 能生成 `graph.json` 和 `backlinks.json`。

---

## 29. 开发里程碑

### Milestone 1：项目骨架和 CLI

* TypeScript 项目初始化
* CLI 框架
* config 读取
* `.aiwiki/` 初始化
* 基础测试

### Milestone 2：Markdown 存储层

* frontmatter 解析
* wiki 页面扫描
* index 更新
* log 追加
* 文件写入 preview

### Milestone 3：搜索与 Brief

* 简单检索
* prompt 模板
* LLM provider 抽象
* `aiwiki brief`
* 输出 markdown/json

### Milestone 4：Guard 与 Map

* `aiwiki map`
* `aiwiki guard`
* risk file 支持

### Milestone 5：Reflect 与 Ingest

* git diff 读取
* reflect 生成更新建议
* ingest 旧文档
* 用户确认写入

### Milestone 6：Lint 与 Graph

* lint 检查
* graph build
* backlinks

### Milestone 7：规则升级

* repeated pitfall 检测
* rule proposal
* AGENTS.md 更新 preview

---

## 29.1 当前实现状态（2026-04-25）

本节用于新 Codex / Claude Code / Cursor 会话接力开发时快速理解当前仓库状态，避免重复从零实现。

### 已完成

当前仓库已经完成 AIWiki 的 M1 + M2 + M3 基础架构与搜索 / Brief 实现：

* Node.js + npm + TypeScript ESM 项目骨架。
* CLI 框架，已实现 `aiwiki init`、`aiwiki search`、`aiwiki brief`。
* 支持：

```bash
aiwiki init
aiwiki init --project-name <name>
aiwiki init --force
aiwiki search "<query>"
aiwiki search "<query>" --type pitfall --limit 5 --format json
aiwiki brief "<task>"
aiwiki brief "<task>" --output .aiwiki/context-packs/current.md
aiwiki brief "<task>" --format json
```

* npm scripts：

```bash
npm run build
npm run test
npm run typecheck
npm run dev -- <args>
```

* `.aiwiki/` 初始化目录结构生成。
* `.aiwiki/config.json` 默认配置生成与读取。
* Zod 配置校验和默认值合并。
* Markdown frontmatter 解析和写入。
* `.aiwiki/wiki/**/*.md` 扫描。
* wiki page frontmatter Zod 校验。
* 按 `type`、`module`、`file` 过滤 wiki pages。
* `index.md` 初始化骨架。
* `log.md` 初始化和 append 基础能力。
* `aiwiki search` 本地 wiki 检索：
  * 扫描 `.aiwiki/wiki/**/*.md`。
  * 基于标题、frontmatter、路径和正文关键词打分。
  * 支持 `--type`、`--limit`、`--format markdown/json`。
  * 对 high / critical severity、`encountered_count` 加权，对 deprecated 页面降权。
* `aiwiki brief` no-LLM Development Brief：
  * 读取 config、index 和相关 wiki pages。
  * 输出 Task、Goal、Product Questions、Recommended Direction、Relevant Modules、Known Pitfalls、Rules、High-Risk Files、Must-Read Files、Acceptance Criteria、Notes for Codex。
  * 明确提醒 Codex 自己制定 implementation plan，不把 brief 当具体代码编辑步骤。
  * 支持 `--output` 写入项目内文件，默认不覆盖，`--force` 才覆盖。
  * 成功生成后追加 `.aiwiki/log.md` 和 `.aiwiki/evals/brief-cases.jsonl`。
* 轻量 LLM Provider 接口已预留，但本阶段不调用远程模型。
* 受控写入策略：默认不覆盖已有文件，`--force` 只刷新 AIWiki 管理的默认模板文件。
* 根目录 `AGENTS.md`，用于约束本项目后续开发规范：可扩展、少硬编码、保护用户数据。
* 测试覆盖 init、config、markdown、wiki-store、log、search、brief。

### 当前代码结构

主要文件：

```text
src/cli.ts
src/search.ts
src/brief.ts
src/output.ts
src/provider.ts
src/init.ts
src/config.ts
src/constants.ts
src/templates.ts
src/managed-write.ts
src/markdown.ts
src/wiki-frontmatter.ts
src/wiki-store.ts
src/log.ts
src/paths.ts
src/types.ts
src/index.ts
tests/init.test.ts
tests/config.test.ts
tests/markdown.test.ts
tests/wiki-store.test.ts
tests/log.test.ts
tests/search.test.ts
tests/brief.test.ts
AGENTS.md
implementation-m1-m2.md
implementation-m3.md
```

架构约定：

* 产品常量集中在 `src/constants.ts`。
* 默认 prompt 和 Markdown 模板集中在 `src/templates.ts`。
* 写入策略集中在 `src/managed-write.ts`。
* 用户可编辑的 wiki frontmatter 通过 `src/wiki-frontmatter.ts` 校验。
* `src/init.ts` 只做初始化流程编排，不再承载大量硬编码模板。
* `src/search.ts` 承载本地检索逻辑，命令层只负责参数解析和输出。
* `src/brief.ts` 承载 Development Brief 生成、输出写入、log/eval 追加。

### 已验证

最近一次验收命令：

```bash
npm run typecheck
npm run test
npm run build
```

M1+M2 历史结果：

```text
Test Files  5 passed (5)
Tests       11 passed (11)
```

M3 最新验收结果：

```text
Test Files  7 passed (7)
Tests       19 passed (19)
```

额外 smoke test 已通过：使用构建后的 `dist/cli.js` 在临时目录运行 `init --project-name smoke`、`search stripe --format json`、`brief "stripe webhook"`，可以完成初始化、检索并生成 no-LLM Development Brief。

### 尚未实现

以下用户命令尚未实现：

```bash
aiwiki guard
aiwiki reflect
aiwiki ingest
aiwiki lint
aiwiki graph build
aiwiki task start
aiwiki checkpoint
aiwiki resume
aiwiki task close
```

以下能力仍待后续补齐：

* 完整 index 自动重建。
* 通用写入 preview/diff 工作流。
* Guardrails 查询。
* Reflect 写入 preview 和确认流程。
* Graph build / backlinks。
* 任务连续性与新会话接力系统。
* LLM provider 抽象的实际调用。

### 下一步开发建议

如果目标是让 AIWiki 尽快被 Codex / Claude Code / Cursor 用起来，下一步建议优先实现：

1. `aiwiki guard <file>`：复用搜索和 wiki filtering，根据文件路径输出护栏。
2. `aiwiki map`：生成项目地图，识别技术栈、主要目录、模块和高风险文件。
3. `aiwiki task start / checkpoint / resume`：结合第 37 节，让新会话可以继续开发，不重复造轮子。
4. `aiwiki reflect --from-git-diff`：开始补开发后复盘和结构化更新建议。

新会话继续开发前，应先阅读：

* `prd.md`
* `implementation-m1-m2.md`
* `AGENTS.md`
* `src/constants.ts`
* `src/wiki-store.ts`
* `src/init.ts`

---

## 30. 推荐首版实现范围

首版可以只实现：

```bash
aiwiki init
aiwiki brief
aiwiki guard
aiwiki reflect
aiwiki ingest
aiwiki search
aiwiki lint
aiwiki graph build
```

暂不实现：

```bash
aiwiki deep-context
aiwiki optimize
aiwiki mcp
```

---

## 31. Codex 开发提示

开发该工具时，请遵守：

1. 优先实现本地 Markdown 工作流。
2. 所有写入操作先 preview，再确认。
3. 不要把 AIWiki 做成 Web App。
4. 不要引入重型数据库。
5. 不要把 brief 做成 Codex 的实现计划。
6. brief 是 Codex 的上游任务简报。
7. 保持 provider 可替换。
8. 保持 prompt 模板可编辑。
9. 对用户数据保持本地优先和透明。
10. 先做可用 MVP，再做 GEPA / RLM / MCP。

---

## 32. 示例：Development Brief 输出

```md
# Development Brief: Resend Team Invite

## Task
给团队邀请功能增加 resend invite。

## Goal
允许 team owner/admin 对 pending invite 重新发送邀请邮件。

## Product Questions to Confirm
1. Resend 后旧 token 是否失效？
   - Recommended: yes，避免多个有效邀请链接并存。
2. 是否限制 resend 频率？
   - Recommended: 60 seconds cooldown。
3. 是否需要记录 resend 历史？
   - Recommended: MVP 暂不新增表，只更新 resent_at。

## Recommended Direction
复用现有 invite 表，不新增 invite_events 表。resend 时刷新 token、更新 expires_at、resent_at，并重新发送邮件。

## Relevant Modules
- team
- auth
- email

## Known Pitfalls
- 不要在 client component 中使用 service role key。
- 不要创建重复 pending invite。
- invite token 必须设置过期时间。
- 权限校验必须在 server side 执行。

## Project Rules and Constraints
- 邮件发送必须走 server-side email service。
- Server action 必须校验当前用户和 team role。
- 返回值使用统一 ActionResult 格式。

## High-Risk Files
- src/actions/team-invite.ts
- src/lib/email/sendInvite.ts
- src/app/team/invites/page.tsx

## Acceptance Criteria
- pending invite 显示 resend 操作。
- accepted invite 不显示 resend。
- 非 owner/admin 不能 resend。
- resend 后新邮件链接可用。
- 旧 token 行为符合用户确认的策略。

## Notes for Codex
Use this brief as project memory and constraints. Create your own implementation plan before editing code. Do not treat this brief as exact code instructions.
```

---

## 33. 示例：Reflect 输出

```md
# Reflect Summary

## Task Summary
本次实现了团队邀请 resend 功能，复用了现有 invite 表，并在 resend 时刷新 token 和 expires_at。

## New Pitfalls

### Pitfall: Resending invite must not create duplicate pending invite
- Severity: high
- Module: team
- Files: src/actions/team-invite.ts
- Fix: update existing pending invite instead of inserting a new one

## Module Updates
- Update wiki/modules/team.md with resend invite behavior.
- Update wiki/modules/email.md with invite email resend flow.

## Rule Promotion Candidates

### Rule: Never send invite email from client component
Reason: service role key and token generation must remain server-side.
Suggested target: AGENTS.md
Requires user confirmation: yes

## Files to Write
- wiki/pitfalls/resend-invite-duplicate-pending.md
- wiki/modules/team.md
- log.md
- index.md
```

---

## 34. 成功指标

MVP 成功指标：

1. 用户在新需求开始前，不再需要手动找历史踩坑 md。
2. Codex 能根据 brief 更快理解项目约束。
3. 开发后新经验能结构化沉淀，而不是继续堆成时间线文档。
4. 重复踩同一个坑的次数下降。
5. 高风险文件修改前能看到相关 guardrails。
6. 用户参与集中在确认方向和规则，而不是整理文档。

---

## 35. 未来扩展

### 35.1 MCP Server

让 AI 编程代理直接调用 AIWiki。

### 35.2 Cursor / VS Code 插件

在编辑文件时自动显示 guardrails。

### 35.3 Obsidian 兼容

支持双链、frontmatter、graph view。

### 35.4 GEPA 自优化

使用真实 eval case 优化 prompt。

### 35.5 RLM Deep Context

对大型知识库做递归探索。

### 35.6 跨项目记忆

从其他项目中迁移相似经验。

---

## 36. 最终产品边界

AIWiki 不写业务代码，不替代 Codex，不替代 Cursor，不替代 Claude Code。

AIWiki 的职责是：

1. 保存项目长期记忆。
2. 把长期记忆转化为当前任务需要的上下文。
3. 在高风险修改前提供护栏。
4. 在开发后沉淀新经验。
5. 帮助用户把反复出现的经验升级成项目规则。

Codex 的职责是：

1. 阅读 Development Brief。
2. 制定自己的 implementation plan。
3. 修改代码。
4. 运行测试。
5. 反馈开发过程中的错误和修复。

用户的职责是：

1. 定义任务目标。
2. 确认产品和架构方向。
3. 审核长期记忆和规则升级。

---

## 37. 任务连续性与新会话接力系统

AIWiki 除了支持开发前 brief、开发中 guard、开发后 reflect，还必须支持任务进度记录与新会话接力。

该能力用于解决以下问题：当用户使用 Codex 根据 PRD 或较大需求开发时，任务往往不会在一个会话内完成。用户可能会关闭当前会话，隔天继续，或者从 Codex 切换到 Claude Code / Cursor。此时新的 AI 会话需要快速理解：当前任务原始目标是什么，已经完成到哪一步，哪些文件改过，哪些测试跑过，哪些用户决策已经确定，下一步应该继续哪里。

Codex 自身可能具备 resume session 能力，但 AIWiki 仍然需要提供项目级 resume 能力。原因是 Codex resume 恢复的是 Codex 自己的会话，而 AIWiki resume 恢复的是项目任务状态。项目任务状态应该独立于某一个 AI 工具和某一个聊天窗口存在。

---

### 37.1 核心目标

任务连续性系统的目标是：

1. 记录一个开发任务从开始到结束的进度。
2. 让新开的 Codex / Claude Code / Cursor 会话可以继续上一次未完成的工作。
3. 避免 AI 在新会话里重复实现已完成内容。
4. 避免 AI 忘记用户已经确认过的产品和架构决策。
5. 避免 PRD 开发过程中混淆 MVP 范围和后续范围。
6. 把“当前任务进度”和“长期项目经验”分开管理。

---

### 37.2 与 Reflect / Pitfall 的区别

任务连续性系统和开发后复盘系统不是同一个功能。

`checkpoint / resume` 解决的是：

```text
当前任务开发到哪里了？下一步应该做什么？
```

`reflect / pitfall` 解决的是：

```text
这次开发学到了什么？哪些经验应该沉淀到长期记忆里？
```

示例：

```text
Checkpoint:
已完成 aiwiki init 命令，下一步实现 frontmatter parser。

Reflect:
实现 init 时发现不能覆盖已有 .aiwiki 目录，这应该沉淀为写入安全规则。
```

因此，checkpoint 是任务进度记录，reflect 是知识沉淀。两者都需要，但职责不同。

---

### 37.3 目录结构

在 `.aiwiki/` 下新增 `tasks/` 目录：

```text
.aiwiki/
  tasks/
    active-task
    2026-04-25-aiwiki-mvp/
      task.md
      brief.md
      plan.md
      progress.md
      decisions.md
      blockers.md
      changed-files.md
      tests.md
      checkpoints.jsonl
      resume.md
```

说明：

* `active-task`：当前活跃任务指针，可以是一个文本文件，内容为当前任务 id。
* `task.md`：任务原始目标、范围、来源 PRD 或用户需求。
* `brief.md`：AIWiki 生成并经用户确认的 Development Brief。
* `plan.md`：用户确认后的高层计划或 Codex 执行计划摘要。注意：AIWiki 不替代 Codex plan mode，该文件只记录已确认或已执行的计划。
* `progress.md`：当前完成度、已完成项、进行中项、未完成项。
* `decisions.md`：任务过程中用户已确认的产品、架构、实现边界决策。
* `blockers.md`：当前阻塞问题、未解决问题、需要用户确认的问题。
* `changed-files.md`：本任务涉及的文件列表和修改摘要。
* `tests.md`：已运行测试、结果、失败测试、尚未运行测试。
* `checkpoints.jsonl`：append-only 检查点事件日志。
* `resume.md`：给新 AI 会话使用的接力简报。

---

### 37.4 CLI 命令

#### 37.4.1 `aiwiki task start`

开始一个新的开发任务。

用法：

```bash
aiwiki task start "根据 PRD 开发 AIWiki MVP"
aiwiki task start "实现团队邀请 resend invite" --id team-invite-resend
aiwiki task start "根据 PRD 开发 AIWiki MVP" --prd ./docs/aiwiki-prd.md
```

行为：

1. 创建 `.aiwiki/tasks/<task-id>/`。
2. 写入 `task.md`。
3. 将 `<task-id>` 写入 `.aiwiki/tasks/active-task`。
4. 可选：如果传入 `--prd`，记录 PRD 路径和摘要。
5. 追加 `log.md`。
6. 初始化 `progress.md`、`decisions.md`、`blockers.md`、`changed-files.md`、`tests.md`、`checkpoints.jsonl`。

`task.md` 示例：

```md
# Task: 根据 PRD 开发 AIWiki MVP

## Task ID
2026-04-25-aiwiki-mvp

## Original Request
根据 PRD 开发一个本地 Markdown 驱动的 AI 编程项目记忆工具。

## Source Documents
- docs/aiwiki-prd.md

## Scope
MVP only.

## Out of Scope
- MCP Server
- GEPA optimization
- RLM deep-context
- Web UI
- Neo4j / graph database

## Created At
2026-04-25
```

---

#### 37.4.2 `aiwiki task list`

列出所有任务。

用法：

```bash
aiwiki task list
aiwiki task list --status active
aiwiki task list --recent 10
```

输出：

```text
Active:
- 2026-04-25-aiwiki-mvp | 根据 PRD 开发 AIWiki MVP | in_progress

Recent:
- 2026-04-20-payment-webhook | Stripe webhook refund support | done
- 2026-04-18-auth-refactor | Auth module refactor | paused
```

---

#### 37.4.3 `aiwiki task status`

查看当前任务状态。

用法：

```bash
aiwiki task status
aiwiki task status 2026-04-25-aiwiki-mvp
```

输出模板：

```md
# Task Status

## Active Task
根据 PRD 开发 AIWiki MVP

## Status
in_progress

## Completed
- 初始化 TypeScript CLI 项目
- 实现 aiwiki init
- 生成 .aiwiki 目录结构
- 添加 config 读取

## In Progress
- 实现 Markdown frontmatter 读取和写入

## Not Started
- aiwiki brief
- aiwiki guard
- aiwiki reflect
- aiwiki lint
- aiwiki graph build

## Changed Files
- package.json
- src/cli.ts
- src/commands/init.ts
- src/config.ts
- src/fs/layout.ts

## Tests
- pnpm test: passing
- pnpm lint: not run

## Blockers
None

## Next Recommended Steps
1. 完成 frontmatter parser
2. 添加 wiki page scanner
3. 实现 index update
4. 添加 Vitest 测试
```

---

#### 37.4.4 `aiwiki checkpoint`

记录当前开发检查点。

用法：

```bash
aiwiki checkpoint --message "完成 init 命令和目录结构生成"
aiwiki checkpoint --step "Milestone 1" --status done
aiwiki checkpoint --tests "pnpm test passing" --next "实现 frontmatter parser"
aiwiki checkpoint --from-git-diff
```

行为：

1. 找到 active task。
2. 读取当前 git diff 摘要。
3. 记录用户传入的 message / step / status / tests / next。
4. 追加到 `checkpoints.jsonl`。
5. 更新 `progress.md`。
6. 更新 `changed-files.md`。
7. 更新 `tests.md`。
8. 重新生成 `resume.md`。

`checkpoints.jsonl` 示例：

```json
{"time":"2026-04-25T10:00:00Z","type":"checkpoint","message":"完成 CLI 初始化和 aiwiki init","completed":["TypeScript project setup","aiwiki init",".aiwiki layout generation"],"next":["frontmatter parser","wiki page scanner"],"files":["src/cli.ts","src/commands/init.ts"],"tests":[{"command":"pnpm test","status":"passing"}]}
```

---

#### 37.4.5 `aiwiki decision`

记录任务过程中的用户决策。

用法：

```bash
aiwiki decision "MVP 使用 TypeScript + commander，不做 Web UI"
aiwiki decision "resend invite 时刷新 token，并让旧 token 失效" --module team
```

行为：

1. 追加到当前 task 的 `decisions.md`。
2. 追加到 `checkpoints.jsonl`。
3. 如果该决策具有长期价值，在 reflect 阶段建议升级为 `wiki/decisions/` 页面。

`decisions.md` 示例：

```md
# Decisions

## [2026-04-25] MVP 技术栈

Decision: MVP 使用 TypeScript + commander，不做 Web UI。

Reason: 优先实现本地 CLI 和 Markdown 工作流，降低复杂度。

Potential long-term wiki update: yes
```

---

#### 37.4.6 `aiwiki blocker`

记录阻塞问题或待用户确认问题。

用法：

```bash
aiwiki blocker "LLM provider 是否第一版就支持 Anthropic？"
aiwiki blocker "reflect 写入是否默认需要用户确认？" --severity high
```

行为：

1. 更新 `blockers.md`。
2. 追加 checkpoint event。
3. 在 `resume.md` 中突出显示。

---

#### 37.4.7 `aiwiki resume`

生成给新 AI 会话使用的接力简报。

用法：

```bash
aiwiki resume
aiwiki resume 2026-04-25-aiwiki-mvp
aiwiki resume --output .aiwiki/tasks/2026-04-25-aiwiki-mvp/resume.md
```

输出模板：

```md
# Resume Brief for Codex

## Task
根据 PRD 开发 AIWiki MVP。

## Original Goal
实现一个本地 Markdown 驱动的 AI 编程项目记忆工具，MVP 包括 init、brief、guard、reflect、ingest、search、lint、graph build。

## Current Status
in_progress

## Completed
- 初始化 TypeScript CLI 项目
- 实现 aiwiki init
- 生成 .aiwiki 目录结构
- 添加 config 读取

## In Progress
- Markdown frontmatter 读取和写入

## Not Yet Done
- wiki page scanner
- index update
- log append
- aiwiki brief
- aiwiki guard
- aiwiki reflect
- aiwiki lint
- aiwiki graph build

## Important Decisions
- 使用 TypeScript + commander。
- MVP 不做 Web UI。
- MVP 不接 Neo4j。
- 所有写入操作默认 preview-first。
- AIWiki brief 是 Codex plan mode 的上游，不替代 Codex plan。

## Changed Files
- package.json
- src/cli.ts
- src/commands/init.ts
- src/config.ts
- src/fs/layout.ts
- src/markdown/frontmatter.ts

## Tests
- pnpm test: passing
- pnpm lint: not run

## Known Issues
- frontmatter parser 还没有处理无 frontmatter 文件。
- index update 还没有测试。

## Blockers / Questions
None.

## Next Recommended Steps
1. 完成 frontmatter parser。
2. 添加 wiki page scanner。
3. 实现 index update。
4. 添加 Vitest 测试。
5. 再开始 brief 命令。

## Instructions for Codex
Use this resume brief as the source of truth for the current task state. Do not restart from scratch. First inspect the changed files and current git diff, then continue from the Next Recommended Steps. If you find a mismatch between this resume brief and the actual repository state, report it before editing code.
```

---

#### 37.4.8 `aiwiki task close`

关闭任务。

用法：

```bash
aiwiki task close
aiwiki task close --status done
aiwiki task close --status paused
aiwiki task close --status cancelled
```

行为：

1. 更新 task status。
2. 生成最终 `resume.md` 或 `summary.md`。
3. 建议运行 `aiwiki reflect --from-git-diff`。
4. 清理 active task 指针。
5. 追加 `log.md`。

关闭任务时，如果检测到 git diff 未复盘，应提示：

```text
This task has unreflected changes. Run `aiwiki reflect --from-git-diff` before closing? [Y/n]
```

---

### 37.5 PRD Implementation Tracker

当任务来源是 PRD 时，AIWiki 应该支持维护 PRD 实现进度。

新增文件：

```text
.aiwiki/tasks/<task-id>/prd-progress.md
```

示例：

```md
# PRD Implementation Progress

## Milestone 1: Project Skeleton and CLI
Status: done

- [x] TypeScript project initialized
- [x] CLI framework added
- [x] config loading
- [x] aiwiki init
- [x] basic tests

## Milestone 2: Markdown Storage Layer
Status: in_progress

- [x] frontmatter parser
- [ ] wiki page scanner
- [ ] index update
- [ ] log append
- [ ] write preview

## Milestone 3: Search and Brief
Status: not_started

- [ ] simple retrieval
- [ ] prompt template
- [ ] LLM provider abstraction
- [ ] aiwiki brief
```

`aiwiki checkpoint` 应支持更新 PRD checklist：

```bash
aiwiki checkpoint --complete "Milestone 1: aiwiki init"
aiwiki checkpoint --complete "frontmatter parser" --next "wiki page scanner"
```

如果 AIWiki 能解析 PRD 中的里程碑，则 `task start --prd` 可以自动生成初始 `prd-progress.md`。MVP 中可以先用 LLM 生成；无 LLM 模式下创建空模板。

---

### 37.6 与 Codex Resume 的关系

Codex 自身可能支持恢复同一个会话，但 AIWiki 仍然需要项目级 resume。

区别如下：

| 能力           | Codex Resume      | AIWiki Resume                        |
| ------------ | ----------------- | ------------------------------------ |
| 恢复对象         | Codex 自己的会话       | 项目任务状态                               |
| 是否绑定工具       | 是                 | 否，可给 Codex / Claude Code / Cursor 使用 |
| 是否跨新会话       | 取决于 Codex session | 是，只要仓库中有 `.aiwiki/tasks/`            |
| 是否记录用户决策     | 不一定结构化            | 是，记录到 `decisions.md`                 |
| 是否记录 PRD 完成度 | 不一定               | 是，记录到 `prd-progress.md`              |
| 是否适合长期项目记忆   | 有限                | 是                                    |
| 是否能沉淀到 wiki  | 不一定               | 是，通过 reflect 实现                      |

推荐用法：

```text
短期连续开发：可以使用 Codex resume。
跨窗口 / 隔天继续 / 换 AI 工具：使用 aiwiki resume。
开发完成后的长期经验沉淀：使用 aiwiki reflect。
```

---

### 37.7 Resume Brief 生成规则

`aiwiki resume` 生成接力简报时，应遵守：

1. 优先读取 `progress.md`、`decisions.md`、`blockers.md`、`changed-files.md`、`tests.md`。
2. 如果有 git diff，加入当前未提交变更摘要。
3. 如果有 PRD progress，加入里程碑完成度。
4. 明确区分 completed、in progress、not started。
5. 明确列出 next recommended steps。
6. 明确提醒 Codex 不要从头开始。
7. 明确提醒 Codex 先核对仓库实际状态。
8. 如果 resume brief 与 git 状态可能不一致，应标记 uncertainty。

---

### 37.8 Checkpoint 生成规则

`aiwiki checkpoint` 应尽量低摩擦。用户可以只写一句话，工具自动补充上下文。

最小输入：

```bash
aiwiki checkpoint --message "完成 init 命令"
```

工具自动补充：

* 当前分支
* 当前 git diff 文件列表
* 最近修改文件
* 测试状态，如果用户提供
* active task id
* 时间戳

用户不应该被迫手写复杂进度文档。

---

### 37.9 MVP 实现范围

MVP 阶段至少实现：

```bash
aiwiki task start
aiwiki task list
aiwiki task status
aiwiki checkpoint
aiwiki resume
aiwiki task close
```

可以暂缓实现：

```bash
aiwiki decision
aiwiki blocker
自动 PRD checklist 解析
自动测试结果解析
```

但目录结构和数据模型应提前预留。

---

### 37.10 验收标准

任务连续性系统的验收标准：

1. 用户可以创建一个 task。
2. 用户可以记录多个 checkpoint。
3. 工具可以显示当前 task status。
4. 工具可以生成可直接复制给 Codex 的 resume brief。
5. 新 Codex 会话根据 resume brief 能理解已完成、未完成、下一步。
6. task close 时会提醒用户运行 reflect。
7. task 记录不污染长期 wiki，只有 reflect 后才沉淀为 pitfall / decision / pattern / rule。

---

## 38. 给 Codex 的下一步任务建议

Milestone 1、Milestone 2 和 Milestone 3 已经实现。新的 Codex / Claude Code / Cursor 会话不要从项目脚手架、`aiwiki init`、config 读取、Markdown frontmatter 读写、`aiwiki search`、`aiwiki brief` 重新开始。

继续开发前，请先阅读：

1. `prd.md`
2. `implementation-m1-m2.md`
3. `implementation-m3.md`
4. `AGENTS.md`
5. `src/constants.ts`
6. `src/wiki-store.ts`
7. `src/search.ts`
8. `src/brief.ts`
9. `src/init.ts`

下一步建议优先实现 Milestone 4 和第 37 节的最小接力闭环：

1. 实现 `aiwiki guard <file>`，复用现有 search / wiki filtering 输出文件护栏。
2. 实现 `aiwiki map`，生成项目地图、模块候选和高风险文件列表。
3. 实现 `aiwiki task start`。
4. 实现 `aiwiki checkpoint`。
5. 实现 `aiwiki resume`。
6. 实现 `aiwiki task status` 或 `aiwiki task list`。

实现顺序建议：

```text
guard -> map -> task start -> checkpoint -> resume -> reflect
```

仍然不要一开始实现 GEPA、RLM、MCP、Web UI 或重型数据库。继续保持本地 Markdown 工作流、可扩展架构、少硬编码、保护用户数据。
