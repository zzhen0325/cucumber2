# Agent OS Canvas Roadmap

本文规划 Cucumber 从当前 Infinite Canvas Agent Run MVP 继续演进为通用 Agent OS 画布产品的阶段路线。规划以当前代码为准，尤其遵守以下边界：唯一 runtime 是 `server/agent/`，唯一运行入口是 `POST /api/agent-run`，唯一 Trace 表是 `agent_run_events`，客户端不提供可信 upstream context，Agent 只能 proposal-first 地提出画布变更，最终由 runtime policy 决定是否落到画布。

## 1. Product North Star

Cucumber 的目标不是聊天框套画布，也不是单一图片生成器，而是一个可见、可追溯、可组合的 Agent OS：

- 画布是用户的工作空间，也是 Agent 的执行状态图。
- 每次运行都从 prompt node 到 run node，再到结果 artifact node，形成可复用的上下文分支。
- Agent 的计划、handoff、工具调用、产物、错误和最终输出都必须在画布或 Trace 中可见。
- 用户可以把任意节点作为上下文继续运行，让结果自然形成分支，而不是被聊天历史淹没。
- 技能、工具和 specialist agents 是 OS 的能力包；Manager 负责任务理解和协调，不绕过 runtime 写状态。

一句话定义：

> 一个以画布图结构为长期上下文、以 Agent Run 为可审计执行单元、以 typed artifacts 为输出资产的通用智能工作台。

## 2. Current Baseline

当前仓库已经具备这些基础：

- 前端：Vite、React、TypeScript、React Flow、AI Elements。
- 服务端：Hono，入口 `server/api.ts`。
- Runtime：`server/agent/`，使用 OpenAI Agents SDK Runner。
- 运行入口：`POST /api/agent-run`，停止入口：`DELETE /api/agent-run?projectId=...&runNodeId=...`。
- 事件表：`agent_run_events`。
- 画布类型：`src/types/canvas.ts`，运行事件和 operation 契约：`src/types/runtime.ts`。
- 当前 specialist：Manager + Image Agent。
- 当前工具：`generate_image`、`upscale_image`、`expand_image_prompt`、`activate_skill`、`run_skill_script`、`propose_canvas_operations`。
- 当前持久化：项目快照、Trace、artifact metadata、私有对象存储、技能定义和本地账号会话。
- 当前 UI：项目列表、登录、无限画布、Prompt/Run/Image 节点、Trace 面板、技能管理页、图片 toolbar。

当前短板：

- 通用 artifact 类型已经在类型里出现，但 UI 渲染、服务端创建、上下文压缩和结果物化还没有全部打通。
- Run 只有执行 Trace，没有 first-class plan、任务分解、checkpoint、resume 语义。
- Specialist agents 只有图片域，文档、网页、代码、数据、研究等能力仍未接入。
- Skill 是很好的 Agent OS 原型，但还缺版本、权限、依赖、测试、分发和运行观测。
- 外部工具和 connector 尚未形成稳定 registry、授权、secret、scope 和 policy 边界。
- Memory node 类型已经存在，但还没有形成明确的记忆写入、检索、过期、引用和审计机制。
- 项目仍是单用户工作流，没有 workspace、共享、评论、模板和团队协作能力。

## 3. Product Principles

后续每个阶段都应该遵守这些原则。

### 3.1 Canvas Is The Source Of Work

所有重要执行状态必须能从持久化项目快照和 `agent_run_events` 重建。不要新增绕开 `AgentCanvasNode`、`AgentCanvasEdge` 和 `RunDraft` 的平行状态。

### 3.2 Events Before UI

新增能力先定义事件语义，再做投影和 UI。Run 节点展示摘要，Trace 面板展示完整链路，默认 UI 不污染内部诊断字段。

### 3.3 Proposal First

SDK 决定做什么，runtime policy 决定是否允许落到画布。工具可以产出 typed artifact 和 proposal，但不能静默篡改画布状态。

### 3.4 Typed Artifacts First

通用 Agent OS 的输出不是一段聊天文本，而是可引用、可预览、可继续加工的 typed artifact，例如 image、markdown、doc、code、webpage、dataset、decision、tool_result、memory。

### 3.5 Server Rebuilds Trusted Context

客户端只提交用户意图和选择信息。服务端从持久化 nodes/edges 重建 upstream context、引用路径、content refs 和 provider 可读 URL。

### 3.6 Skills Are Capability Packages

Skill 不只是 prompt 片段，而是带 metadata、触发条件、工具绑定、脚本、权限和运行审计的能力包。Agent 只能先看到 skill card，必须 `activate_skill` 后才读取完整 `SKILL.md`。

## 4. Roadmap Overview

阶段顺序建议如下。时间是相对节奏，不是日历承诺。

| Phase | Focus | Outcome |
| --- | --- | --- |
| P0 | MVP hardening | 当前图片/文本/技能流稳定可靠，Trace 和错误闭环清晰 |
| P1 | Canvas object model | 通用 artifact 节点、预览、上下文和物化能力成型 |
| P2 | Skill and tool OS | 技能、脚本、MCP tool、权限、secret 和观测形成统一层 |
| P3 | Specialist agents | 接入文档、网页、代码、数据、研究等垂直 Agent |
| P4 | Workflow canvas | Run plan、任务节点、checkpoint、resume 和长任务队列 |
| P5 | Memory and knowledge | 项目记忆、知识导入、检索、引用和 provenance |
| P6 | Collaboration and platform | Workspace、共享、模板、配额、评测、插件和发布能力 |

## 5. Phase P0: Harden The Current Runtime

目标：把当前 MVP 先变成可靠的 OS kernel，避免后续能力扩展时把基础打散。

### User Capabilities

- 用户能稳定发起图片生成、图片放大、轻量问答、基于选中节点继续修改。
- 用户能停止正在运行的 Run，画布不会留下假成功或幽灵图片节点。
- 用户能在 Trace 面板理解失败来自模型、工具、Seedream、技能脚本、上下文校验还是画布 policy。
- 用户能看到本轮使用了哪些 upstream context，哪些被省略以及原因。

### Engineering Work

- 保持 `agent_run_events` 为唯一 Trace 表，补齐所有终态事件的物化路径。
- 强化 `materializeAgentRunSnapshot` 幂等性：同一 artifact id 不重复生成结果节点。
- 在 Trace UI 展示 `input.normalized`、`skill.retrieved`、`skill.activated`、`tool.error`、`canvas.operation.rejected` 的用户可读摘要。
- 给 Run 节点保留短错误，详细诊断放到 Trace 面板。
- 给上下文重建增加可视化摘要：selected nodes、reference nodes、upstream path、omitted nodes。
- 健康检查继续覆盖 Agent provider、Seedream、Supabase，涉及环境变量时 Run 节点必须显示可操作错误。

### Files Likely Touched

- `server/agent/runtime.ts`
- `server/agent/materialize-run.ts`
- `server/agent/context.ts`
- `src/lib/graph-projection.ts`
- `src/lib/runtime-event-renderer.ts`
- `src/components/RunTracePanel.tsx`
- `src/components/RunNodeView.tsx`

### Acceptance

- 工具失败时先写 `tool.error`，随后写 `run.failed`，不生成假成功结果。
- `run.completed` 一定包含真实 `finalOutput` 和真实 artifact ids。
- 停止运行后，Run 节点进入明确失败或停止状态，未完成图片投影被清理。
- 多选引用只使用服务端验证后的可引用节点，Run 节点不会成为可信 upstream content。

### Validation

```bash
pnpm exec vitest run server/agent/context.test.ts server/agent/materialize-run.test.ts
pnpm exec vitest run server/agent/events/openai-stream-to-cucumber-events.test.ts
pnpm exec vitest run src/lib/graph-projection.test.ts src/lib/runtime-event-renderer.test.ts
pnpm exec tsc -b --pretty false
pnpm build
```

## 6. Phase P1: General Canvas Object Model

目标：从图片结果画布升级为通用 typed artifact 画布。此阶段不要急着接很多外部工具，先让更多类型的结果能被安全创建、保存、预览、引用和继续加工。

### User Capabilities

- 用户可以在画布中得到并引用 markdown、decision、memory、code、document、webpage、tool result 等结果节点。
- 用户可以拖入或上传常见文件，系统把它们转换为稳定 artifact ref，而不是只依赖本地预览。
- 用户可以打开 artifact 预览，看到内容摘要、来源 Run、创建时间、引用关系和可继续操作入口。
- 用户选择多个节点继续运行时，Agent 能得到按图结构排序后的上下文包。

### Engineering Work

- 完成 `AgentCanvasNodeData` 中非图片节点的渲染策略：
  - `markdown`：可预览、可编辑、可作为上下文。
  - `decision`：展示结论、依据、后续动作。
  - `memory`：展示记忆内容、来源、作用域。
  - `code`：展示语言、文件名、代码摘要和展开预览。
  - `document`：展示文档标题、摘要和下载/预览入口。
  - `webpage`：展示预览 URL、标题、摘要和打开入口。
  - `toolResult`：展示工具名、关键输出、错误或结构化结果。
- 抽象一个轻量 Artifact Shell，统一标题、摘要、来源、状态、操作按钮和错误样式。
- 扩展 artifact content API，但保持私有对象存储和服务端权限校验：
  - 读取继续走 `/api/projects/:projectId/artifacts/:artifactId/content`。
  - 文本类 artifact 需要稳定 content ref、MIME、byte size、digest 和 metadata。
- 上下文收集增加 token/size budget、优先级和 omitted reason，结果写入 `RunDraft.contextTrace`。
- 不让 `propose_canvas_operations` 直接创建内容节点。内容节点应由 typed artifact event 或 runtime-owned materializer 产生，通用 operation 继续只负责便签、形状、合法连边和位置。

### Data And Contract Work

- 明确 `ArtifactRef.metadata` 的最小公共字段：
  - `mimeType`
  - `byteSize`
  - `digest`
  - `sourceRunNodeId`
  - `sourceToolName`
  - `createdBy`
  - `previewKind`
- 为文本类 artifact 定义上下文提取规则：
  - markdown/doc/code/webpage 默认传摘要和 content ref，不直接把全文塞进 Manager prompt。
  - 只有 specialist tool 需要时，服务端再按权限读取完整内容。
- 如果新增 node kind，必须同步更新：
  - `src/types/canvas.ts`
  - `src/lib/graph.ts`
  - `src/lib/graph-projection.ts`
  - `src/lib/runtime-event-renderer.ts`
  - 对应 tests

### Acceptance

- 任意 artifact 节点都能被选中、作为 follow-up 上下文、在 Trace 中追溯来源。
- 上传失败的本地节点不会进入持久化项目，也不会进入 Agent upstream context。
- 文本和代码类结果不会撑破节点布局，长内容通过预览或滚动查看。
- 内容节点创建不能通过通用 canvas operation 绕过 policy。

### Validation

```bash
pnpm exec vitest run src/lib/graph.test.ts src/lib/graph-projection.test.ts
pnpm exec vitest run src/lib/runtime-event-renderer.test.ts src/lib/file-upload.test.ts
pnpm exec tsc -b --pretty false
pnpm build
```

## 7. Phase P2: Skill And Tool OS

目标：把现有 Cloud Skill Management 演进成真正的能力层。每个能力包都应该可发现、可激活、可审计、可限制权限、可测试。

### User Capabilities

- 用户可以安装、启用、禁用、测试技能，并看到技能适用于哪些 Agent、工具和画布节点类型。
- 用户可以看到某次 Run 为什么检索到某个技能、是否激活、是否执行脚本、脚本输入输出是什么。
- 用户可以配置 connector 或工具凭据，但模型永远不能直接看到 secret。
- 用户可以知道某个工具能读什么、能写什么、会产生什么 artifact。

### Engineering Work

- 为 `agent_skill_definitions` 增加版本语义：
  - `version`
  - `changelog`
  - `minimumRuntimeVersion`
  - `deprecatedAt`
  - `replacedBySkillId`
- 增加 skill lint/test runner：
  - 校验 frontmatter。
  - 校验 `bindings.tools` 是否存在于 tool registry。
  - 校验脚本输入输出 JSON schema。
  - 运行 dry test，不注入 secret，不写画布。
- 建立 tool registry，统一声明：
  - tool id/name
  - JSON input schema
  - output schema
  - required scopes
  - produced artifact types
  - visible trace labels
  - whether it can call external network
- 保持内部 MCP endpoint 进程内 bearer token，不作为外部 API 暴露。
- 建立 secret boundary：
  - secret 只在服务端 connector/tool adapter 内读取。
  - Trace 只能写 redacted metadata。
  - skill script 默认空 secret 环境；需要 secret 的能力走 server-owned tool，不走脚本环境。
- 为脚本执行补足 portability 策略：
  - 当前 macOS `sandbox-exec` 不可用时继续失败，不做不安全 fallback。
  - 后续可引入隔离 worker 或容器执行器，但仍保持无默认 secret。

### Suggested Scopes

- `read.canvas`
- `read.artifact`
- `write.artifact`
- `propose.canvas`
- `run.script`
- `net.fetch`
- `tool.image.generate`
- `tool.image.upscale`
- `tool.web.fetch`
- `tool.doc.create`
- `tool.code.create`
- `tool.data.analyze`

### Acceptance

- Manager prompt 只注入 skill cards，不注入完整 `SKILL.md`。
- 每轮最多激活 3 个技能的规则继续生效。
- 未激活技能的脚本不能执行。
- skill script 输出的 canvas operations 仍然必须走 runtime policy。
- 工具和脚本的错误都能进入 Trace 和 Run 节点错误摘要。

### Validation

```bash
pnpm exec vitest run server/agent/skills/*.test.ts
pnpm exec vitest run server/agent/mcp/*.test.ts
pnpm exec vitest run server/agent/policy/canvas-operation-policy.test.ts
pnpm exec tsc -b --pretty false
```

## 8. Phase P3: Specialist Agents

目标：把 Cucumber 从 Image Agent 单 specialist 扩展为多 specialist Agent OS。Manager 仍然是唯一主控，specialist model 仍由 runtime 统一注入。

### Priority Agents

建议按下面顺序接入：

1. Document Agent  
   生成和改写 markdown/document，输出 `markdown` 或 `document` artifact。

2. Web Agent  
   抓取网页、总结页面、生成 webpage artifact。此阶段先做 fetch/read，不做浏览器自动操作。

3. Research Agent  
   搜索、读取、归纳、引用来源，输出 research markdown 和 citation metadata。

4. Code Agent  
   生成代码片段、文件草案、diff 方案，输出 `code` artifact。不要默认写本地仓库，除非未来单独建立明确的 workspace file tool policy。

5. Data Agent  
   处理 CSV/表格/JSON，输出 dataset、chart summary 或 analysis markdown。

6. Image Agent  
   保持当前图片生成、参考图生成、高清放大的职责边界。

### Engineering Work

- 扩展 `NormalizedIntent`：
  - `document.create`
  - `document.edit`
  - `web.fetch`
  - `research.answer`
  - `code.create`
  - `data.analyze`
  - `workflow.plan`
  - 保留 `image.generate`、`image.upscale`、`text.answer`、`canvas.operation`、`unsupported`
- 建立 Agent registry：
  - specialist name
  - enabled intents
  - required tools
  - produced artifact types
  - handoff policy
  - instructions builder
- 每个 specialist 只持有本域工具。Manager 不直接执行 specialist 工具。
- 每个新 specialist 都必须有：
  - instructions 文件
  - agent factory
  - tool schemas
  - event projection tests
  - failure tests
  - 至少一个真实数据 QA 场景

### Acceptance

- Manager 能根据 normalized intent handoff 给正确 specialist。
- 如果能力未接入，Manager 必须明确能力边界，不虚假生成。
- 每个 specialist 的输出都形成 typed artifact，能被后续 Run 作为上下文。
- Handoff、tool、artifact、error 都能在 Trace 和 Run 节点摘要中展示。

### Validation

```bash
pnpm exec vitest run server/agent/input-normalizer.test.ts
pnpm exec vitest run server/agent/events/openai-stream-to-cucumber-events.test.ts
pnpm exec vitest run src/lib/graph-projection.test.ts
pnpm exec tsc -b --pretty false
pnpm build
```

## 9. Phase P4: Workflow Canvas

目标：让 Run 从单次执行变成可拆解、可恢复、可分支的 workflow。此阶段是 Agent OS 感最强的部分。

### User Capabilities

- 用户可以让 Agent 先生成任务计划，Run 节点展示简短计划和当前步骤。
- 长任务可以在后台继续运行，用户回到项目后看到最新状态。
- 用户可以从失败步骤重试，而不是只能重跑整个 prompt。
- 用户可以比较多个分支的结果，继续沿某个结果分支推进。
- 用户可以把一组节点保存成 workflow template，在新项目中复用。

### Engineering Work

- 增加计划事件语义：
  - `plan.created`
  - `plan.step.started`
  - `plan.step.completed`
  - `plan.step.failed`
  - `checkpoint.created`
- 计划事件仍写入 `agent_run_events`，不要新增第二套 Trace。
- 如需队列表，限定为运行调度 metadata，不复制 Trace 内容。
- 增加 Run plan 投影：
  - Run 节点显示步骤摘要、当前步骤、失败步骤。
  - Trace 面板展示完整步骤 timeline。
- 增加 resume/retry contract：
  - 从失败 Run 节点创建新的 Run 分支。
  - 保留原失败节点。
  - 使用原 prompt、原 upstream anchor 和失败步骤信息。
- 增加 template contract：
  - 保存选中子图为模板。
  - 模板只保存节点/边结构和可复用参数，不保存用户 private artifact URL。

### Acceptance

- 长任务刷新页面后能从持久化状态恢复展示。
- 失败步骤重试不会覆盖原失败 Trace。
- workflow template 不包含短期 signed URL、provider URL 或 secret。
- plan 只是执行可见性和调度语义，不绕过 existing runtime policy。

## 10. Phase P5: Memory And Knowledge

目标：让项目不仅有一次次运行结果，还有可控、可追溯、可编辑的长期知识。

### User Capabilities

- 用户可以把某个结论保存为项目记忆。
- Agent 可以在明确规则下提出 memory node，但 runtime policy 决定是否落地。
- 用户可以导入文档、网页、图片或数据集，形成可检索 knowledge artifacts。
- Agent 回答能引用具体来源节点、artifact 和上游路径。

### Engineering Work

- 定义 memory 写入规则：
  - 用户明确要求保存时可创建。
  - Agent 可以提出 memory artifact，但必须有来源 Run 和依据。
  - 默认不把每次聊天自动写入长期记忆。
- 定义 memory 作用域：
  - project memory
  - workspace memory
  - user preference memory
- 增加 knowledge index：
  - chunk id
  - source artifact id
  - source node id
  - text excerpt digest
  - embedding 或 keyword index
  - createdAt/updatedAt
- 增加检索事件：
  - `memory.retrieved`
  - `knowledge.retrieved`
  - `context.omitted`
- 上下文注入继续走服务端，不让客户端传可信 memory。

### Acceptance

- 用户能删除或编辑 memory，后续 Run 不再检索已删除内容。
- Agent 输出带 provenance，能追溯到具体节点和 artifact。
- 大文档不会直接塞进 prompt，而是通过摘要、chunk 和引用读取。
- Memory 不成为不可见的隐藏状态；默认必须能在画布或项目设置中查看。

## 11. Phase P6: Collaboration And Platform

目标：从个人工作台升级为团队可使用、可分发、可运营的平台。

### User Capabilities

- 用户可以创建 workspace，邀请成员，给项目设置访问权限。
- 用户可以评论节点、标记结果、分享只读链接或导出项目。
- 用户可以从模板创建新项目。
- 用户可以安装技能包和 connector，看到版本、权限和运行历史。
- 管理者可以看到用量、失败率、成本和慢工具。

### Engineering Work

- Workspace data model：
  - workspaces
  - workspace_members
  - project_permissions
  - project_comments
  - project_templates
  - audit_logs
- Realtime strategy：
  - 先做保存冲突提示和轻量刷新。
  - 再做多人 presence、selection 和评论。
- Billing/quotas strategy：
  - per user/project/workspace run count
  - token/image/tool cost estimate
  - rate limit and abuse controls
- Observability：
  - run duration
  - tool duration
  - model provider
  - failure code
  - artifact count
  - materialization retry count
- Marketplace：
  - skill package signing
  - compatibility checks
  - install/uninstall history
  - review and rollback path

### Acceptance

- 用户无法读取未授权项目、artifact content 或 Trace。
- 共享项目不暴露 private storage path、provider URL 或 secret metadata。
- 团队成员同时编辑时不会静默覆盖对方的节点变更。
- 每个 Run 的成本、耗时和失败类别可审计。

## 12. Recommended First 30 Days

如果现在开始推进，建议第一个月不要先做大而全的网页/代码/数据 Agent，而是按下面顺序补底座。

### Week 1: Reliability And Context Visibility

- 完成 Run Trace 的上下文摘要展示。
- 强化失败、停止、工具错误、policy rejected 的 UI 文案。
- 补齐 materialization 的重复 artifact 防护测试。
- 验证真实账号 `zz / 123456` 的图片生成、停止、重试、follow-up 和多选引用。

### Week 2: Artifact Shell

- 为 `markdown`、`decision`、`memory`、`code`、`document`、`webpage`、`toolResult` 做统一节点壳。
- 完成长文本、代码、错误、来源、预览按钮的稳定布局。
- 给 `src/lib/graph.ts` 增加非图片 artifact 的上下文摘要规则。

### Week 3: Text Artifact Pipeline

- 增加 runtime-owned text artifact 创建路径。
- 支持 markdown/code/tool_result artifact 写入对象存储或受控内容存储。
- 通过事件投影生成对应画布节点。
- 不恢复 Agent v1 的 `create_artifact`/`attach_artifact`，而是走当前 runtime 的 typed artifact event。

### Week 4: First Non-Image Specialist

- 首选 Document Agent，因为它不需要复杂外部 connector，能最快验证通用 artifact pipeline。
- 新增 `document.create` / `document.edit` normalized intent。
- 输出 markdown/document artifact。
- Trace 展示 handoff、tool、artifact 和 final output。

## 13. Implementation Backlog

下面是可直接拆 issue 的 backlog。

### Epic A: Context Inspector

- 在 Run Trace 面板展示 selected nodes、reference nodes、upstream path、omitted nodes。
- `collectUpstreamContext` 输出 omitted reason 和 size budget。
- Tests：`src/lib/graph.test.ts`、`server/agent/context.test.ts`。

### Epic B: Artifact Node Shell

- 新建统一 artifact node view，覆盖 markdown/document/code/webpage/decision/memory/toolResult。
- 统一节点 title、summary、status、source run、actions。
- Tests：渲染测试、文本溢出测试、Graph projection tests。

### Epic C: Typed Text Artifact Events

- 定义 text/code/document artifact metadata。
- 增加 artifact content 写入和读取路径。
- 新增 projection，artifact.created 能物化非图片节点。
- Tests：storage、projection、runtime renderer。

### Epic D: Tool Registry

- 定义工具 registry schema。
- 把现有 image tools、skill tools、canvas proposal tool 注册进去。
- Skill import 时校验 bindings.tools。
- Trace 中显示 registry label，而不是散落的 tool name 文案。

### Epic E: Document Agent

- 新增 Document Agent instructions 和 factory。
- 扩展 input normalizer。
- 增加 document markdown artifact tool。
- Manager 对 document intent handoff。
- Tests：normalizer、handoff、artifact projection、失败路径。

### Epic F: Run Plan Events

- 扩展 runtime event types。
- Run 节点展示计划摘要。
- Trace 面板展示 plan timeline。
- Retry 从失败 step 创建新分支。

### Epic G: Memory Policy

- 定义 memory 创建和更新规则。
- Memory node 可见、可删除、可作为 context。
- 新增 memory retrieval event 和上下文预算策略。

## 14. Risk Register

| Risk | Why It Matters | Mitigation |
| --- | --- | --- |
| 能力扩展过快导致 Manager 巨型化 | Manager 会变成万能 prompt，职责边界失控 | 每个新域必须走 specialist agent 和 tool registry |
| 通用 artifact 被 canvas operation 绕过 | 模型可能伪造内容节点或假结果 | 内容节点只由 typed artifact event/materializer 创建 |
| 上下文变成隐藏聊天历史 | Agent OS 的核心是可见图结构 | 所有 context 来自服务端图重建，并在 Trace 中展示摘要 |
| Skill script 成为不安全执行入口 | 脚本可能读 secret、访问网络或写文件 | 默认空 secret、sandbox 强制、无 sandbox 直接失败 |
| 外部 connector 泄漏 URL/secret | 私有 artifact 和 provider URL 不能给模型 | 服务端签发短期 URL，只传给 provider adapter |
| UI 诊断信息过多 | 默认画布会变脏，用户扫读困难 | Run 节点短摘要，Trace 面板承载细节 |
| 多人协作覆盖数据 | 当前 snapshot/patch 需要更强冲突语义 | version handshake、patch 合并、冲突提示、最终再做 realtime |

## 15. Non Goals

近期不要做这些事：

- 不恢复 Agent v1、旧 Skill 栈、旧审批、Evaluator、客户端模型选择或附件提交。
- 不把客户端 upstream IDs、artifact 或 URL 当作可信上下文。
- 不让工具直接静默写画布，必须经事件和 materializer/policy。
- 不把关键执行状态只留在聊天文本。
- 不为了内部诊断污染默认 UI。
- 不先做营销页、模板市场首页或重品牌包装；第一屏仍应是可操作画布。

## 16. Definition Of Done For New Capabilities

每个新能力上线前，至少满足：

- 有明确 node/artifact/event contract。
- 有服务端可信上下文路径，不依赖客户端传内容。
- 有 Trace 展示和 Run 节点摘要。
- 有失败路径，失败不会生成假成功 artifact。
- 有最小测试集，覆盖正常、失败、越权或 policy reject。
- 有 README 或 process/design 文档同步。
- UI 符合 `design.md`，不引入冲突视觉语言。

## 17. Suggested Product Milestones

### Milestone 1: General Artifact Canvas

用户可以在同一画布中生成图片、markdown、decision、code snippet，并把这些节点混合作为下一轮上下文。

### Milestone 2: Skill Powered Workbench

用户可以导入技能包，让 Agent 在 Run 中按需激活技能和脚本，所有行为都能被 Trace 审计。

### Milestone 3: Multi-Agent Workflows

Manager 能把任务交给 Document/Web/Research/Code/Data/Image specialists，用户看到清晰 handoff 和 typed outputs。

### Milestone 4: Resumable Workflow Canvas

长任务有计划、步骤、checkpoint 和失败重试，画布分支成为真正的工作流操作界面。

### Milestone 5: Team Agent OS

Workspace、共享、评论、模板、权限、用量和 marketplace 能支撑小团队长期使用。
