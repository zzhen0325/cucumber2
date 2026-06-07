# Agent OS Plan

本文档定义 Cucumber 从 Infinite Canvas Agent Run MVP 演进为通用 Agent OS 的规划。它不是替代 `README.md` 的运行说明，也不是替代 `process.md` 的变更记录；它用于指导后续架构拆分、数据模型、能力注册、画布投影和执行计划。

当前代码事实：

- 前端已经有项目级 Infinite Canvas，核心画布类型在 `src/types/canvas.ts`。
- 图结构和上游上下文收集在 `src/lib/graph.ts`。
- `/api/agent-run` 通过 AI SDK UI message stream 展示 Run 文本、工具状态、错误和图片结果。
- 服务端当前链路是 `agent-run -> optional analyze_reference_images -> prompt-expand -> generate_image`。
- Supabase 已有 `agent_projects`、`agent_skills`、`agent_run_events`，可以作为 OS 化存储的起点。

## North Star

Cucumber 的目标不是只做图片生成画布，而是做一个通用 Agent OS：

```txt
Canvas UI
  -> Graph Projection
  -> Run Kernel
  -> Planner / Router
  -> Skill + Capability Registry
  -> Context / Memory
  -> Tool Runtime
  -> Artifact Store + Event Log
```

核心原则：

- Event log 是事实源，Canvas 是投影层。
- Agent 执行过程必须可见：prompt、run、step、tool、artifact、error、follow-up 都要能回到画布或明确的 trace 入口。
- 模型只能提出计划、工具调用或 patch proposal；系统负责校验、权限判断和应用。
- 不引入绕开现有画布数据的并行状态模型。新增 OS 模型要从 `AgentCanvasNode`、`AgentCanvasEdge`、`RunDraft`、`UpstreamContextItem` 渐进演化。
- 不做静默降级。缺能力、缺权限、缺环境变量、工具失败都应成为可追踪的 Run 错误。
- UI 保持当前 `design.md` 的轻量无限画布风格，内部 raw id 和诊断信息默认隐藏到高级入口。

## Part 1: Run Kernel And Trace Foundation

目标：把当前图片生成 endpoint 抽出为通用运行内核，同时保持现有图片生成体验不回退。

### 1.1 Define Kernel Contracts

- [ ] 新增 `server/run-kernel.ts`，定义通用 Run、Step、ToolCall、ArtifactRef、GraphPatchProposal 类型。
- [ ] 保留 `/api/agent-run` 作为外部入口，但内部委托给 Run Kernel。
- [ ] 将当前 `analyze_reference_images`、`expand_prompt`、`generate_image` 表达成 kernel steps。
- [ ] 保持 AI SDK UI message stream 输出不变，让现有 Run 节点继续消费 tool parts。
- [ ] 为 kernel 类型补最小单元测试，验证 step 状态从 `queued -> running -> success/error`。

验收标准：

- 现有图片生成、参考图分析、prompt-expand、错误展示行为保持一致。
- `/api/agent-run` 中业务编排代码明显变薄，图片生成链路进入 Run Kernel。
- `pnpm test -- server/prompts.test.ts src/lib/graph.test.ts` 通过。

### 1.2 Turn Run Events Into Step Events

- [ ] 扩展 `agent_run_events` 或新增相邻表 `agent_run_step_events`。
- [ ] 定义事件类型：`run.created`、`step.started`、`tool.input`、`tool.output`、`tool.error`、`artifact.created`、`graph.patch.proposed`、`graph.patch.applied`、`run.completed`、`run.failed`。
- [ ] 当前 `recordRunEvent` 保持兼容，同时写入更细的 step event。
- [ ] 每个事件包含 `projectId`、`runNodeId`、`stepId`、`type`、`payload`、`createdAt`。
- [ ] 错误事件必须保存 `errorText` 和失败 step，不生成假成功结果。

验收标准：

- 一次图片生成 run 至少能回放出三个阶段：提示词扩写、图片生成、结果 artifact。
- 数据库中能看到工具输入、输出和错误位置。
- 旧项目画布快照不需要迁移即可继续打开。

### 1.3 Prompt Parts And Prompt Trace

- [ ] 在 `server/prompts.ts` 引入 `PromptPart` / `PromptChunk` 类型。
- [ ] 给每段 prompt 增加 `id`、`category`、`stable`、`priority`、`droppable`、`tokenEstimate`。
- [ ] 将 `buildAgentRunTextPrompt`、`buildSkillPrompt`、`buildReferenceImageAnalysisPrompt` 改为先生成 parts，再 assemble。
- [ ] 记录 `promptDigest`、`selectedPromptPartIds`、`omittedContextReason` 到 run trace。
- [ ] 超预算策略先只做确定性裁剪，不引入模型摘要。

验收标准：

- prompt 内容仍和当前行为等价。
- trace 能说明本次用了哪些 prompt part 和 skill。
- prompt assembly 测试覆盖 stable/dynamic 顺序和低优先级裁剪。

## Part 2: Capability, Artifact, And Policy Layer

目标：把 `prompt-expand` 和图片生成从特殊逻辑升级为通用 capability，让 OS 可以承载文档、代码、网页、研究、图像等多种任务。

### 2.1 Capability Registry

- [ ] 在现有 `agent_skills` 基础上增加 manifest 概念，不新建长期并行的 `skills.json`。
- [ ] manifest 字段包括 `capabilityId`、`version`、`description`、`triggers`、`inputSchema`、`outputSchema`、`toolIds`、`tokenBudget`、`requiresApproval`。
- [ ] 升级 `server/skill-parser.ts`，从 `SKILL.md` frontmatter 或 manifest 文件解析 capability metadata。
- [ ] `prompt-expand` 迁移为 capability：`prompt.expand`。
- [ ] 图片生成迁移为 capability：`image.generate`。

验收标准：

- Skill 面板仍可上传和编辑旧 skill。
- 没有 manifest 的旧 `prompt-expand` skill 可以通过兼容路径运行。
- 新 capability 能被 run trace 记录为 `selectedCapabilityIds`。

### 2.2 Router And Planner

- [ ] 新增 `server/agent-router.ts`。
- [ ] 第一版使用规则路由：用户输入、上游 artifact 类型、选中节点类型、可用 capability manifest。
- [ ] 只在多 capability 冲突时引入 LLM router，且必须记录 router prompt 和结果。
- [ ] Planner 输出 step graph，不直接输出 ReactFlow 节点。
- [ ] Planner 结果必须过 Zod schema 校验。

验收标准：

- 图片生成请求稳定路由到 `prompt.expand + image.generate`。
- 未来文档、代码、网页能力可以通过新增 manifest 接入，不需要改主 endpoint。
- 路由失败时 Run 节点显示明确错误：缺少匹配能力或能力不可用。

### 2.3 Artifact Store

- [ ] 新增统一 `Artifact` 类型：`image`、`file`、`doc`、`code`、`webpage`、`dataset`、`decision`、`tool_result`、`memory`。
- [ ] 数据库存储 artifact metadata，二进制或大内容只保存 URL / storage key / content ref。
- [ ] 当前 `ImageResultNodeData.image` 渐进迁移为 artifact ref，同时保留旧字段兼容。
- [ ] `generate_image` 输出先创建 image artifact，再由 graph projection 创建 image result node。
- [ ] 上游上下文从 prompt/image 扩展为 artifact-aware context。

验收标准：

- 图片结果仍正常显示。
- 同一 image id 不重复生成节点的规则保留。
- Run trace 能关联 artifact id、tool output 和画布节点 id。

### 2.4 Policy And Approval

- [ ] 定义 capability policy：是否可联网、是否可写文件、是否可改项目、是否需要用户确认、是否可产生外部费用。
- [ ] Tool runtime 执行前做 permission check。
- [ ] 高风险 tool 进入 `approval-requested` tool state，前端 Run 节点显示确认入口。
- [ ] 未获批准时写入 `output-denied`，不继续执行后续 step。
- [ ] 将环境变量缺失、权限不足、配额不足统一为 typed error。

验收标准：

- 图片生成可标记为可能产生外部费用。
- 需要确认的 tool 不会被模型绕过直接执行。
- 拒绝执行时画布保持一致，Run 节点显示拒绝原因。

## Part 3: Canvas OS, Memory, And Replay

目标：让画布成为通用工作空间，而不是单一图片结果展示；让 run 可回放、可分支、可审计。

### 3.1 Graph Projection Layer

- [ ] 新增 `src/lib/graph-projection.ts` 或相邻模块。
- [ ] 将 event log / artifacts / run steps 投影成 `AgentCanvasNode` 和 `AgentCanvasEdge`。
- [ ] 模型返回的 graph patch 只能作为 proposal，由 reducer 校验后应用。
- [ ] Patch 类型包括 `createNode`、`updateNode`、`createEdge`、`setNodeStatus`、`attachArtifact`。
- [ ] Patch reducer 要防止重复节点、断边、非法 node kind、越权修改其他项目。

验收标准：

- 当前 prompt -> run -> image result 链路可以由 projection 生成。
- 手动拖拽节点位置仍由项目画布快照保存，不被 event replay 强行覆盖。
- Graph patch 测试覆盖非法 patch 被拒绝。

### 3.2 Node Taxonomy

- [ ] 扩展节点类型：Prompt、Run、Artifact、Decision、Memory、Tool Result、Document、Code、Webpage。
- [ ] 每类节点只展示用户需要扫读的信息，详细 trace 放入高级入口。
- [ ] Run 节点显示 step timeline，而不只显示最后一个 tool part。
- [ ] Artifact 节点支持从一个结果继续 follow-up。
- [ ] 节点 UI 变更前先对照 `design.md`，保持当前画布语言。

验收标准：

- 默认画布不暴露 raw id、toolCallId、完整 prompt trace。
- 用户能从任意 artifact 创建 follow-up branch。
- 移动端不遮挡底部输入器和右上工具。

### 3.3 Context And Memory

- [ ] 将 `collectUpstreamContext` 扩展为 artifact-aware context collector。
- [ ] 定义 context item 优先级：用户当前输入、选中节点、上游 artifact、最近 run decision、长期 memory。
- [ ] 引入 context budget，低优先级内容使用 summary 或 content ref。
- [ ] Memory 写入必须来自明确事件或用户确认，不能让模型静默写长期记忆。
- [ ] 记录被裁剪上下文，供 trace 查看。

验收标准：

- Follow-up branch 能同时引用 prompt、image、doc、code 等 artifact。
- 上下文顺序仍按图结构从上游到当前节点。
- 上下文过长时不会静默丢关键选中节点。

### 3.4 Replay, Debug, And Evaluation

- [ ] 新增 Run detail / advanced trace 入口。
- [ ] 支持查看 step timeline、prompt parts、capability selection、tool IO、artifact refs、graph patches。
- [ ] 支持从 event log replay 到只读画布状态。
- [ ] 为关键 capability 建立 eval fixtures：输入、上游上下文、期望 step plan、期望 artifact。
- [ ] 增加失败样例：缺 skill、缺 key、tool error、invalid patch、approval denied。

验收标准：

- 一个历史 run 可以解释“为什么选这个能力、用了哪些上下文、哪里失败”。
- 回放不触发真实外部 tool。
- 新增 capability 必须带最小 eval 或相邻单元测试。

## Cross-Part Checklist

每推进一个功能点，都按以下顺序检查：

- [ ] 是否先读了相关实际代码，而不是只按本规划假设实现。
- [ ] 是否没有绕开现有 `AgentCanvasNode`、`AgentCanvasEdge`、`RunDraft`、`UpstreamContextItem`。
- [ ] 是否保持 AI SDK UI stream 中 Run 节点可见状态。
- [ ] 是否把错误呈现在 Run 节点或高级 trace 中。
- [ ] 是否为新 server 逻辑补 Zod schema 和最小测试。
- [ ] 是否为图结构、上下文、patch、布局变化补 `src/lib/graph.test.ts` 或相邻测试。
- [ ] 是否更新 `README.md` 或 `process.md` 中对应运行方式、环境变量和变更记录。
- [ ] 涉及 AI SDK UI stream、tool usage、transport 前，是否对照官方 AI SDK UI 文档。
- [ ] 涉及 UI 前，是否对照 `design.md` 并做桌面/移动检查。

## Suggested Build Order

第一轮只做基础设施，不扩大产品面：

- [ ] `PromptPart` 与 prompt trace。
- [ ] Run Kernel 类型和当前图片链路迁移。
- [ ] Step event log。
- [ ] Capability manifest 兼容解析。

第二轮做通用能力：

- [ ] Capability router。
- [ ] Artifact store。
- [ ] Image artifact 投影兼容。
- [ ] Policy / approval 基础状态。

第三轮做 OS 体验：

- [ ] Graph projection reducer。
- [ ] 多类型节点。
- [ ] Memory-aware upstream context。
- [ ] Run replay 和 advanced trace。

## Non-Goals For Now

- 不做多 agent 自主协作，先做单 Run Kernel 下的多 step。
- 不做自动长期记忆写入，先做显式 memory artifact。
- 不让模型直接修改数据库或项目快照。
- 不把所有内部 trace 暴露在默认画布 UI。
- 不为了新架构牺牲现有图片生成主链路。
