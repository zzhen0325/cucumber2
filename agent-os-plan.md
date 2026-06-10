# Agent Runtime Development Plan

本文档定义 Cucumber 从当前图片生成优先的 Agent Run 链路，升级为完整的一等 Agent Runtime 的开发计划。后续开发按本文档的两个部分推进：第一部分先把服务端 Runtime 数据结构、路由、上下文、规划、工具和执行器做成稳定核心；第二部分再把 Runtime event 投影成 ReactFlow 画布体验和可审计 UI。

本文档不是运行说明，运行方式仍看 `README.md`；本文档也不是变更日志，实际完成项继续追加到 `process.md`。实现时仍以代码事实为准，文档和代码冲突时先改代码，再同步文档。

## Current Code Facts

当前仓库已经有一些基础设施，并已完成 Agent Runtime Core 的第一版代码落地：

- `/api/agent-run` 在 `server/api.ts` 中接收请求，然后调用 `server/runtime/executor.ts` 的 `executeAgentRun`。
- `server/run-kernel.ts` 保留旧 kernel contract 和测试兼容，但不再是主入口。
- `server/run-kernel.ts` 提供 `adaptKernelRunToAgentRun`，旧 kernel run 可只读投影成新版 `AgentRun`，并保留 artifact、tool call 和 error text。
- `src/types/runtime.ts` 定义一等 `AgentRun`、`AgentInput`、`IntentResult`、`BuiltContext`、`PlanStep`、`AgentStep`、`ToolDefinition`、`ToolResult`、`CanvasOperation`、`AgentError` 和 runtime events。
- `server/runtime/schemas.ts` 为跨边界 runtime 对象提供 Zod schema。
- `server/runtime/input-normalizer.ts`、`intent-router.ts`、`context-builder.ts`、`planner.ts`、`tool-registry.ts`、`executor.ts`、`evaluator.ts` 分别实现输入标准化、结构化意图、上下文选择、schema-validated plan、工具注册、通用 step 执行和基础质量评估。
- `server/runtime/run-store.ts` 负责 `AgentRun` 快照，`supabase/migrations/20260608005000_agent_runtime_core.sql` 新增 `agent_runs`、`agent_run_steps` 并扩展 event 类型约束。
- Tool Registry 已注册当前图片链路工具：`prompt.expand`、`seedream.generateImage`；参考图不经过语言模型分析，由服务端直接写入 Seedream `image_urls`。文本产物工具为 `document.write`；网页/页面工具为 `web.read`、`asset.analyzeContext`、`page.generate`；另有 `canvas.createNode`、`canvas.updateNode`、`canvas.createEdge`、`canvas.attachArtifact` proposal tools。
- `src/lib/runtime-event-renderer.ts` 提供明确的 Runtime Event -> Canvas 投影入口，复用现有 `src/lib/graph-projection.ts` reducer。
- `src/lib/graph.ts` 已有 `collectUpstreamContextWithTrace`，能按 ReactFlow 图结构收集上游 prompt、image、artifact、doc、code、webpage、memory 等 context item。
- `server/prompts.ts` 仍保留具体 prompt render helper；Context Builder 负责 runtime selection、budget、tool exposure 和 skill injection trace。
- `src/lib/graph-projection.ts` 已有 event/artifact/patch 到 ReactFlow 节点和边的投影层，并兼容新增 runtime event 名称。
- `src/components/CanvasWorkspace.tsx` 已通过 `useChat` 消费 AI SDK UI message stream，并把 tool parts、step timeline 和 evaluator summary 更新到 Run 节点。

因此现在的结论是：一等 Runtime Core 已经成为主入口，Intent Router 和 Planner 已接入 LLM structured output 主路径，并由 schema + deterministic policy gate 校验；当前图片生成体验通过 generic executor 和 Tool Registry 跑通。剩余重点是补齐复杂非图片工具，以及继续把 Run 节点业务状态完全收敛到 `AgentRun` / runtime events，减少 `CanvasWorkspace` 中的兼容手工拼装。

## Implementation Status

2026-06-08 已完成：

- Runtime contracts and schemas：`src/types/runtime.ts`、`server/runtime/schemas.ts`。
- Legacy runtime adapter：`server/run-kernel.ts` 可将旧 `Run` 适配为 schema-valid `AgentRun`，并通过 `success/error` <-> `completed/failed` 状态映射测试。
- Runtime event protocol 第一版：新增 event 类型并扩展 `agent_run_step_events` check constraint，包括 `retry.attempt`。
- Input Layer 第一版：标准化 prompt、run/prompt/selected node、upstream context、conversation summary 和附件 metadata。
- Input Layer 会根据 user-owned project snapshot 校验 selected node、upstream node 和 artifact id；composer 附件只写 metadata/contentRef/preview，不把大文件内容直接塞进 planner prompt。
- Structured Intent Router 第一版：通过 AI SDK structured output 或等效 JSON schema 输出 `IntentResult`，非图片 capability 不再静默走图片 executor。
- Intent Router fixtures 覆盖 image_generation、image_editing、page_generation、document_writing、web_research、file_analysis、code_modification、canvas_operation 和 multi_step。
- Context Builder 第一版：生成 `BuiltContext`，记录 selected/omitted context、tool exposure、skill injection 和 token budget trace。
- Context Builder 现在会把 attachments、conversation history summaries 和 project refs 一并纳入 context selection/ranking，不再只处理 upstream graph。
- Planner prompt、Run reasoning、reference-image analysis 和 prompt expansion step 已消费 `BuiltContext.promptParts`，Context Builder 成为 runtime intent/user/context/tools/skills/omitted-context prompt parts 的来源；`server/prompts.ts` 只保留 section render/helper 和 legacy run-kernel prompt compatibility。
- Tool Registry 第一版：当前三类真实图片工具和 canvas attach proposal tool 已统一 schema、policy、timeout、risk、render hint 和 `ToolResult`。
- Tool implementations 已按领域拆到 `server/runtime/tools/`：`image-tools.ts`、`canvas-tools.ts` 和共享 `ids.ts`。
- Web/page tools 第一版：`web.read`、`asset.analyzeContext`、`page.generate` 已注册为可执行工具，复杂落地页 planner 可输出 web read、asset analysis、page artifact、canvas node 和 evaluation DAG。
- Canvas Operation Policy 第一版：`canvas.createNode`、`canvas.updateNode`、`canvas.createEdge`、`canvas.attachArtifact` 都是 Tool Registry 中的 proposal tool；服务端 policy 校验 project id、node kind、edge endpoint、target permission 和 produced artifact，rejected operation 会写入 event 和 run error。
- Planner 第一版：通过 AI SDK structured output 或等效 JSON schema 输出 `PlanStep[]`，能拒绝未知工具、未暴露工具和循环依赖；deterministic builder 仅作为测试 fixture。
- Generic Executor 第一版：`runStep` 分发 reasoning、tool、approval、evaluation step，并统一写 runtime event、AI SDK UI tool chunk、artifact、canvas operation proposal、retry attempt 和 legacy graph patch event。
- Evaluator 第一版：图片 artifact 和 URL 基础质量检查。
- Runtime Event Renderer 第一版：`projectRuntimeEventsToCanvas` 和 `applyCanvasOperation` 复用现有 projection/reducer。

仍未完成或需要继续增强：

- 非图片能力中 code modification 还缺工具 executor；document writing 已有 Markdown artifact 工具，page generation 已有第一版 HTML artifact 工具，web research 已有 URL read/summarize 工具。
- Trace Panel 已按 runtime event 分区展示 run snapshot、intent、context selection reason、skill injection detail、raw/normalized plan、plan validation、step timeline、tool IO、tool schema digest、tool duration/logs、retry、artifact、canvas operations、evaluation 和 errors。
- Run 节点已显示 intent、context、plan、artifact、step timeline、tool state 和 evaluator 用户级摘要。
- Composer attachments 已能展示/删除待提交附件，并把文件/网页链接标准化进入 Input Layer。
- 实时 AI SDK stream 已写入 `data-runtime-event` 并通过 `projectRuntimeEventsToCanvas` 投影；旧 tool part 兼容路径会先转换成 runtime events，再进入同一个 projection。

## External UI Reference

已核对 `https://elements.ai-sdk.dev/`。AI Elements 是基于 shadcn/ui 的组件 registry，强调可组合组件、AI SDK 集成、streaming/status state/type safety。对本项目相关的组件和用途如下：

- `Canvas`：React Flow based canvas，适合继续作为 Cucumber 的画布基础。参考：https://elements.ai-sdk.dev/components/canvas
- `Node` / `Edge`：React Flow canvas 的节点和边组件，适合规范 Run、Artifact、Decision、Tool Result 节点视觉结构。参考：https://elements.ai-sdk.dev/components/node 和 https://elements.ai-sdk.dev/components/edge
- `Plan`：展示 AI-generated execution plans，支持 streaming 和 collapsible 内容，适合 Run 节点内展示 LLM planner 输出摘要。参考：https://elements.ai-sdk.dev/components/plan
- `Task`：展示 workflow progress、状态和任务列表，适合 Run timeline 和 step progress。参考：https://elements.ai-sdk.dev/components/task
- `Tool`：消费 AI SDK `ToolUIPart`，展示 tool input/output/error/approval states，适合 Run 节点和 trace panel。参考：https://elements.ai-sdk.dev/components/tool
- `Confirmation`：支持 tool approval request/accepted/rejected 状态，适合高风险工具审批。参考：https://elements.ai-sdk.dev/components/confirmation
- `Context`：展示 context window、token breakdown、cost estimate，适合 Context Builder trace 的高级入口。参考：https://elements.ai-sdk.dev/components/context
- `Attachments`：展示 file/image/source document，适合 Input Layer 和 composer 附件预览。参考：https://elements.ai-sdk.dev/components/attachments
- `Agent`：展示 agent model、instructions、tools、output schema，适合 Tool Registry 或当前 Run 的 agent profile 高级面板。参考：https://elements.ai-sdk.dev/components/agent
- `Artifact`：展示代码、文档等生成内容和操作按钮，适合 artifact detail 面板，画布节点只放摘要。参考：https://elements.ai-sdk.dev/components/artifact
- `Schema Display`：展示 request/response schema，适合 Tool Registry 的 tool schema inspector。参考：https://elements.ai-sdk.dev/components/schema-display

产品约束：AI Elements 是组件参考，不是新的状态源。Runtime truth 仍应来自 `AgentRun`、event log、artifact store 和 ReactFlow projection reducer。

## Target Runtime

目标架构：

```txt
Input Layer
  -> Intent Router
  -> Context Builder
  -> LLM Planner
  -> Generic Executor
  -> Tool Registry / Tool Runtime
  -> Artifact Store / Event Log / Evaluator
  -> ReactFlow Event Renderer
```

关键原则：

- `AgentRun` 是一等 Runtime 状态，不再把 input、intent、context、plan、errors 散落在 event payload 里。
- Event log 是可审计事实流，`AgentRun` 是当前快照，ReactFlow canvas 是投影。
- 模型只能输出结构化 intent、plan、tool argument proposal 或 canvas operation proposal；系统负责校验、权限判断和应用。
- Context Builder 决定给模型什么，不允许把完整画布、完整历史、全部工具一股脑塞进 prompt。
- Planner 必须是 LLM planner，但输出必须经过 Zod schema 校验和 deterministic policy gate。
- Executor 必须是通用 `executor.runStep` 分发器，不能继续在 `executeImageAgentRun` 里手写图片专用流程。
- Tool Registry 必须注册完整工具定义，包括 schema、policy、timeout、cost、risk、executor、renderer hint 和 eval fixture。
- ReactFlow Event Renderer 只消费事件和 canvas operation，不直接推断服务端业务。
- 错误必须成为 Run 节点和 trace 中可见的一等对象，不生成假成功。

## First-Class Data Contract

目标类型建议放在 `src/types/runtime.ts`，Zod schema 放在 `server/runtime/schemas.ts`。服务端和前端共享 TypeScript 类型，但服务端所有外部输入仍以 Zod schema 为准。

```ts
export type AgentRunStatus =
  | "queued"
  | "routing"
  | "building_context"
  | "planning"
  | "running"
  | "waiting_approval"
  | "evaluating"
  | "completed"
  | "failed"
  | "cancelled";

export type AgentRun = {
  id: string;
  userId: string;
  projectId: string;
  status: AgentRunStatus;

  input: AgentInput;
  intent?: IntentResult;
  context?: BuiltContext;
  plan?: PlanStep[];

  steps: AgentStep[];
  artifacts: Artifact[];
  canvasOperations: CanvasOperation[];
  errors: AgentError[];

  trace: AgentRunTrace;
  createdAt: string;
  updatedAt: string;
};
```

`AgentInput`：

```ts
export type AgentInput = {
  userMessage: string;
  attachments: InputAttachment[];
  canvasContext: InputCanvasContext;
  conversationHistory: ConversationMessageRef[];
  projectRefs: ProjectContextRef[];
  metadata: {
    userId: string;
    sessionId?: string;
    projectId: string;
    runNodeId: string;
    promptNodeId?: string;
    modelProvider: string;
  };
};
```

`IntentResult` 不只是分类器结果，必须能描述结构化任务：

```ts
export type IntentResult = {
  primaryIntent: string;
  confidence: number;
  task: StructuredTask;
  requiredCapabilities: string[];
  requiredTools: string[];
  needsPlanning: boolean;
  ambiguity: IntentAmbiguity[];
  routingReason: string;
};

export type StructuredTask = {
  kind:
    | "image_generation"
    | "image_editing"
    | "page_generation"
    | "page_editing"
    | "document_writing"
    | "web_research"
    | "file_analysis"
    | "code_modification"
    | "canvas_operation"
    | "multi_step";
  goals: string[];
  targets: TaskTarget[];
  constraints: TaskConstraint[];
  deliverables: TaskDeliverable[];
  operations: TaskOperation[];
};
```

`BuiltContext`：

```ts
export type BuiltContext = {
  runId: string;
  taskContext: string;
  selectedItems: ContextItem[];
  omittedItems: OmittedContextItem[];
  availableTools: ToolSummary[];
  injectedSkills: SkillInstruction[];
  promptParts: PromptPart[];
  tokenEstimate: number;
  budget: ContextBudget;
  trace: ContextBuildTrace;
};
```

`PlanStep`：

```ts
export type PlanStep = {
  id: string;
  title: string;
  goal: string;
  kind: "reasoning" | "tool" | "canvas" | "approval" | "evaluation";
  toolId?: string;
  capabilityId?: string;
  input?: unknown;
  dependsOn: string[];
  expectedArtifacts: ArtifactExpectation[];
  expectedCanvasOperations: CanvasOperationExpectation[];
  risk: ToolRiskLevel;
  approvalRequired: boolean;
  retryPolicy?: RetryPolicy;
};
```

`AgentStep`：

```ts
export type AgentStep = {
  id: string;
  planStepId: string;
  status: "queued" | "running" | "success" | "failed" | "skipped" | "waiting_approval";
  input?: unknown;
  output?: ToolResult;
  error?: AgentError;
  startedAt?: string;
  completedAt?: string;
};
```

`ToolDefinition`：

```ts
export type ToolDefinition<TInput = unknown, TOutput = unknown> = {
  id: string;
  capabilityId: string;
  name: string;
  description: string;
  inputSchema: unknown;
  outputSchema: unknown;
  policy: ToolPolicy;
  timeoutMs: number;
  retryPolicy: RetryPolicy;
  renderHint: ToolRenderHint;
  execute: (input: TInput, context: ToolExecutionContext) => Promise<ToolResult<TOutput>>;
};

export type ToolResult<T = unknown> = {
  ok: boolean;
  data?: T;
  artifacts: Artifact[];
  canvasOperations: CanvasOperation[];
  logs: ToolLog[];
  error?: AgentError;
};
```

`CanvasOperation`：

```ts
export type CanvasOperation =
  | { id: string; type: "createNode"; payload: { node: AgentCanvasNode } }
  | { id: string; type: "updateNode"; payload: { nodeId: string; patch: unknown } }
  | { id: string; type: "createEdge"; payload: { edge: AgentCanvasEdge } }
  | { id: string; type: "setNodeStatus"; payload: { nodeId: string; status: string; error?: string } }
  | { id: string; type: "attachArtifact"; payload: { nodeId: string; artifactId: string } };
```

`AgentError`：

```ts
export type AgentError = {
  id: string;
  code: string;
  message: string;
  retryable: boolean;
  severity: "info" | "warning" | "error" | "fatal";
  stepId?: string;
  toolId?: string;
  details?: Record<string, unknown>;
  createdAt: string;
};
```

## Storage Model

优先复用现有 Supabase 表，逐步补齐一等表：

- `agent_runs`：保存 `AgentRun` 当前快照和索引字段。
- `agent_run_steps`：保存每个 step 的状态、输入摘要、输出摘要和错误。
- `agent_run_events` 或现有 `agent_run_step_events`：保存 append-only event stream。
- `agent_artifacts`：继续保存 artifact metadata，大内容只保存 URL、storage key 或 content ref。
- `agent_tools` 可选：如果 tool definition 来自数据库或远端 registry，再加表；第一版可由代码注册和 skill manifest 生成，不急着落库。

迁移规则：

- 当前 `recordRunEvent` 和 `recordRunStepEvent` 先保留兼容。
- 新 Runtime 写 `agent_runs` 快照，同时写 append-only event。
- 旧历史 run 可以通过 adapter 投影成新版 `AgentRun` 的只读兼容结构。
- 不迁移旧画布快照的节点结构，先由 projection adapter 兼容。

## Part 1: Runtime Core

目标：把服务端 Runtime 做成一等结构。完成 Part 1 后，即使没有改 UI，也应该能通过 API 创建一个完整 `AgentRun`，完成输入标准化、结构化 intent、context selection、LLM plan、通用 step execution、tool registry dispatch、artifact/event/error persistence。

### 1.1 Runtime Contracts And Schemas

任务清单：

- [x] 新增 `src/types/runtime.ts`，定义 `AgentRun`、`AgentInput`、`IntentResult`、`BuiltContext`、`PlanStep`、`AgentStep`、`ToolDefinition`、`ToolResult`、`CanvasOperation`、`AgentError`。
- [x] 新增 `server/runtime/schemas.ts`，为所有可跨边界输入输出补 Zod schema。
- [x] 将 `server/run-kernel.ts` 中私有 `Run` 类型迁移或适配到 `AgentRun`。
- [x] 将旧 `RunStatus` 的 `success/error` 映射为新版 `completed/failed`，前端兼容层继续支持旧状态。
- [x] 新增 `server/runtime/events.ts`，集中定义 event type 和 event payload schema。
- [x] 新增 `server/runtime/run-store.ts`，负责创建、更新、读取 `AgentRun` 快照，不把 Supabase 写入散落在 executor 里。
- [x] 补充迁移文件：`agent_runs`、`agent_run_steps`，必要时扩展 `agent_run_step_events`。

验收标准：

- [x] `AgentRun` 能表达当前图片链路的完整状态，不丢失现有 `promptNodeId`、`runNodeId`、tool parts、artifact refs、error text。
- [x] `/api/agent-run` 能创建新版 `AgentRun`，旧画布仍能显示 prompt -> run -> image result。
- [x] 单元测试覆盖 `AgentRun` schema parse、legacy run adapter、status mapping。

建议测试：

```bash
pnpm test server/run-kernel.test.ts server/agent-router.test.ts server/capabilities.test.ts
pnpm exec tsc -p tsconfig.node.json --noEmit
pnpm exec tsc -p tsconfig.app.json --noEmit
```

### 1.2 Input Layer

目标：把用户输入、附件、画布选中节点、会话历史、项目引用标准化成 `AgentInput`。

任务清单：

- [x] 新增 `server/runtime/input-normalizer.ts`。
- [x] 输入来源包括 text、uploaded files、image result nodes、artifact-backed nodes、selected nodes、conversation history、project refs。
- [x] 前端 `CanvasWorkspace` 提交时继续传 `promptNodeId`、`runNodeId`、`selectedNodeId`、`upstreamContext`，同时补充 attachments metadata。
- [x] 服务端不要信任前端 `upstreamContext` 的全部内容，至少校验 project ownership、node id、artifact id。
- [x] 文件内容 extraction 只产生 `contentRef` 或 preview summary，大文件不直接塞进 prompt。
- [x] 标准化结果写入 `AgentRun.input` 和 `run.input.normalized` event。

验收标准：

- [x] 空画布文字输入、选中图片 follow-up、拖拽 markdown/code/doc 后 follow-up 都能生成合法 `AgentInput`。
- [x] 附件类型错误或读取失败时返回 `AgentError`，不进入 planner。
- [x] 输入层测试覆盖文本、图片、文件、网页链接、缺 project 权限。

### 1.3 Intent Router

目标：不再只是规则分类器。Intent Router 必须输出结构化任务，告诉后续 Context Builder 和 Planner 当前任务需要哪些能力、工具、目标、约束和交付物。

设计要求：

- LLM router 为主，规则 router 只做快速安全预检和明显意图 hint。
- Router 输出必须过 `intentResultSchema`。
- Router 不执行工具，不创建画布节点，不决定最终 step args。
- Router 可以输出多个子任务，但必须有一个 `primaryIntent`。
- Router 必须记录可解释的 `routingReason`。
- Router 对低置信度或歧义输入输出 `ambiguity`，由 planner 决定是否需要用户确认或澄清 step。

任务清单：

- [x] 将 `server/agent-router.ts` 拆分为 `intent-router.ts` 和 `planner.ts`，旧 `planAgentRun` 暂时作为 adapter。
- [x] 新增 `routeIntent(input, registry, modelProvider): Promise<IntentResult>`。
- [x] Router prompt 输入只包含 normalized input、可用 capability summaries、当前选中节点摘要和安全策略摘要。
- [x] Router 输出 `StructuredTask`，包括 `goals`、`targets`、`constraints`、`deliverables`、`operations`。
- [x] 对常见意图建立 schema fixture：image_generation、image_editing、page_generation、document_writing、web_research、file_analysis、code_modification、canvas_operation、multi_step。
- [x] 当多个 capability 匹配时，不直接报错，改为让 LLM router 选择或输出 ambiguity。
- [x] 不支持的能力必须返回 `capability.route_missing`，并带 `requiredCapabilities`。

验收标准：

- [x] `生成图片` 输出 `image_generation`，包含 `image.generate` 和可能的 `prompt.expand`。
- [x] `根据网页和图片生成落地页并放到画布里` 输出 multi-step structured task：web analysis、image understanding、ui generation、canvas operation。
- [x] `写文档` 不再静默走 image executor。
- [x] Router 的错误在 Run 节点和 trace 中可见。

### 1.4 Context Builder

目标：Context Builder 是独立服务，决定哪些上下文喂给模型，哪些 skill 注入，哪些工具暴露给 Agent，哪些历史要省略。

设计要求：

- 输入：`AgentInput`、`IntentResult`、project canvas snapshot、available tools、skills、conversation history、memory refs。
- 输出：`BuiltContext`。
- Context Builder 不能只是 `formatUpstreamContext`，它必须做 selection、ranking、compression、omission trace 和 tool exposure。
- 当前选中节点和用户当前输入最高优先级。
- 上游图结构顺序仍保留，但排序可在同层按 relevance 和 priority 调整。
- 低优先级历史只保留 summary 或 content ref。
- Skill 注入由 intent 和 tool requirement 驱动，不把所有公开 skill 都塞进 prompt。
- Tool exposure 是白名单：planner 只能看本次任务允许的工具。

任务清单：

- [x] 新增 `server/runtime/context-builder.ts`。
- [x] 把 `collectUpstreamContextWithTrace` 的结果作为输入之一，而不是让服务端重复猜图结构。
- [x] 为 context item 增加 `source`、`relevanceScore`、`tokenEstimate`、`inclusionReason`。
- [x] 实现 context budget：基础版 deterministic rank/drop，高级版可加 summarizer。
- [x] 实现 `selectSkillsForIntent(intent, registry)`。
- [x] 实现 `selectToolsForIntent(intent, toolRegistry)`。
- [x] 将 `PromptPart` 组装从 `server/prompts.ts` 迁移到 Context Builder 输出中，`prompts.ts` 只保留具体 prompt render helper。
- [x] 记录 `context.built` event，包含 selected/omitted/tool exposure/skill injection trace。

验收标准：

- [x] 选中图片 follow-up 必须包含该 image context，不会因预算裁剪掉。
- [x] 复杂任务只暴露必要工具，如 `web.search`、`image.analyze`、`ui.generate`、`canvas.createNode`，不会暴露全部工具。
- [x] 历史对话只带相关摘要，完整历史不直接进入 planner prompt。
- [x] Trace 面板能说明某个节点为什么被选中或省略。

### 1.5 Complete Tool Registry

目标：从 Capability Registry 升级为完整 Tool Registry。Capability 描述能力，Tool 是可执行接口。

职责边界：

- Capability：描述产品能力和匹配条件，例如 `image.generate`、`doc.write`、`canvas.mutate`。
- Tool：描述具体可执行函数，例如 `seedream.generateImage`、`canvas.createNode`、`web.search`、`repo.patch`。
- Skill：提供 instructions、config、capability manifest 或 tool adapter metadata。
- Tool Registry：把内建工具、skill 工具、未来远端工具注册为统一 `ToolDefinition`。

任务清单：

- [x] 新增 `server/runtime/tool-registry.ts`。
- [x] 新增 `server/runtime/tools/` 目录，每个工具一个文件或一个领域一个文件。
- [x] 将当前 `generateSeedreamImage` 包装为 `seedream.generateImage` tool。
- [x] 将 `expandPromptWithSkill` 包装为 `prompt.expand` tool。
- [x] 参考图改为绕过语言模型，直接作为 `seedream.generateImage` 的 provider input。
- [x] 新增 canvas tools 的接口定义：`canvas.createNode`、`canvas.updateNode`、`canvas.createEdge`、`canvas.attachArtifact`。第一版只返回 `CanvasOperation` proposal，不直接写项目快照。
- [x] 新增 tool policy：network、write files、modify project、external cost、approval、timeout、retry。
- [x] 工具输入输出必须使用 Zod parse，失败返回 typed `AgentError`。
- [x] 工具返回统一 `ToolResult`，不再返回裸字符串或散装 object。
- [x] Tool Registry 需要支持 `listToolsForPlanner(context)`，只返回当前 run 允许的 tool summary。
- [x] Trace 中记录 tool definition version 和 schema digest。

验收标准：

- [x] Planner 只能选择 Tool Registry 暴露的工具。
- [x] 未注册工具、schema 错误、权限拒绝、超时都变成标准 `AgentError`。
- [x] 当前图片生成链路能通过 Tool Registry 完成，不再在 kernel 中直接调用 Seedream。

### 1.6 LLM Planner

目标：Planner 必须是 LLM planner，负责把结构化任务拆成可执行 step graph。

设计要求：

- Planner 输入：`AgentInput`、`IntentResult`、`BuiltContext`、allowed tools、policy summary。
- Planner 输出：`PlanStep[]`。
- Planner 输出必须是 JSON/object，必须过 `planSchema`。
- Planner 不创建 ReactFlow 节点，只输出 expected artifacts 和 expected canvas operations。
- Planner 可以选择简单任务直接一到两步，也可以为复杂任务拆 DAG。
- Planner 必须明确每步依赖、工具、风险、是否需要审批、预期输出。
- Planner 不允许使用 context 中未暴露的工具。

任务清单：

- [x] 新增 `server/runtime/planner.ts`。
- [x] 用 AI SDK structured output 或等效 JSON schema 生成 `PlanStep[]`。
- [x] 给 planner prompt 注入 allowed tools 的 summary，不注入完整 tool implementation。
- [x] 实现 `validatePlanAgainstRegistry(plan, toolRegistry, context)`。
- [x] 实现 `normalizePlan(plan)`，填充 step id、dependsOn、retryPolicy、approvalRequired。
- [x] 对简单图片生成，planner 输出至少：`prompt.expand`、`seedream.generateImage`、`canvas.attachArtifact` 或相应 canvas operation。
- [x] 对复杂网页落地页任务，planner 输出：web read/analyze、asset analysis、UI generation、artifact creation、canvas node creation、evaluation。
- [x] 记录 `plan.created` event，包括原始 plan、normalized plan、validation result。

验收标准：

- [x] Planner 不再使用硬编码 `getImagePlanSteps` 作为主路径。
- [x] 添加新 tool 后，只要 registry 和 planner schema 支持，主 endpoint 不需要增加专用 if/else。
- [x] Plan validation 能拒绝未知工具、循环依赖、缺必需输入、越权 canvas operation。

### 1.7 Generic Executor

目标：Executor 是通用 `executor.runStep` 分发器，按计划执行 step，调用工具，记录状态，处理审批、重试、错误和 artifact/canvas operation。

接口：

```ts
export async function runStep(input: {
  run: AgentRun;
  step: PlanStep;
  context: BuiltContext;
  registry: ToolRegistry;
  writer: RuntimeEventWriter;
}): Promise<AgentStep>;
```

任务清单：

- [x] 新增 `server/runtime/executor.ts`。
- [x] 新增 `executeAgentRun(runId)`，按 plan DAG 执行 queued steps。
- [x] `runStep` 根据 `step.kind` 分发：reasoning、tool、canvas、approval、evaluation。
- [x] tool step 从 Tool Registry 获取定义，parse input，执行，parse output。
- [x] canvas step 只生成 `CanvasOperation`，由 reducer 校验后应用。
- [x] approval step 写 `approval-requested` event，并暂停 run 为 `waiting_approval`。
- [x] retry 只对 retryable error 生效，记录 retry attempt event。
- [x] fatal error 终止 run，后续 step 标记 skipped。
- [x] 执行器不直接拼 UI message chunk，统一通过 Runtime Event Writer 转成 AI SDK UI stream。
- [x] 删除或收敛 `executeImageAgentRun` 中图片专用 orchestration，保留为 legacy adapter 或测试 fixture。

验收标准：

- [x] 任意 tool 失败都能定位到 step、toolId、error code。
- [x] 审批拒绝不会继续执行后续 step。
- [x] 同一 plan 中多个独立 step 可以先顺序执行，未来可扩展并行，但第一版不强制并行。
- [x] 当前图片生成链路通过 generic executor 走完。

### 1.8 Error Handling, Retry, And Evaluator

目标：错误、重试和质量评估是一等 Runtime 层，不散落在 catch block 里。

任务清单：

- [x] 新增 `server/runtime/errors.ts`，统一 error code：`MODEL_OUTPUT_INVALID`、`TOOL_TIMEOUT`、`TOOL_SCHEMA_INVALID`、`PERMISSION_DENIED`、`ENV_MISSING`、`CAPABILITY_UNAVAILABLE`、`PLAN_INVALID`、`CANVAS_PATCH_REJECTED`、`QUALITY_CHECK_FAILED`。
- [x] 新增 `server/runtime/retry.ts`，支持 max retries、backoff、retryable filter。
- [x] 新增 `server/runtime/evaluator.ts`。
- [x] Evaluator 输入原始需求、plan、artifacts、canvas operations、tool results。
- [x] Evaluator 输出 `EvaluationResult`：passed、issues、recommendedActions、needsRegeneration。
- [x] 图片任务先做基础检查：是否有 image artifact、数量是否满足、artifact URL 是否存在、Run 节点是否有错误。
- [x] 文档/代码/UI 任务接入后，Evaluator 要检查测试、类型、canvas node visibility、artifact completeness。
- [x] Evaluator 不自动无限重试，最多触发一次 revise/regenerate plan，之后需要用户确认。

验收标准：

- [x] 缺 key、tool timeout、schema 错误、quality check failed 分别显示不同错误类型。
- [x] 质量失败不是系统失败，Run 状态可以进入 `failed` 或 `waiting_approval` 并说明建议。
- [x] Trace 能看到 retry attempt 和 evaluator result。

### 1.9 Part 1 Done Criteria

Part 1 完成必须满足：

- [x] `AgentRun` 成为服务端运行状态主结构。
- [x] `IntentResult`、`BuiltContext`、`PlanStep[]`、`AgentStep[]` 都能持久化或从 event 重建。
- [x] Intent Router 输出结构化任务。
- [x] Context Builder 独立决定 context、skill、tool exposure。
- [x] Planner 是 LLM planner，并通过 schema + registry validation。
- [x] Executor 通过 `executor.runStep` 执行通用 step。
- [x] Tool Registry 可注册当前图片链路工具：prompt expand、image generate；参考图由 image generate 直接消费。
- [x] 当前图片生成体验不回退。
- [x] 最小测试通过。

建议总验证：

```bash
pnpm test server/agent-router.test.ts server/capabilities.test.ts server/run-kernel.test.ts server/prompts.test.ts src/lib/graph.test.ts
pnpm exec tsc -p tsconfig.node.json --noEmit
pnpm exec tsc -p tsconfig.app.json --noEmit
pnpm lint
pnpm build
```

## Part 2: ReactFlow Event Renderer And Product Integration

目标：把一等 Runtime 事件稳定投影成 ReactFlow 画布体验。完成 Part 2 后，用户应该能从画布上看到输入、意图、上下文、计划、工具执行、产物、错误、评估和 follow-up branch，而不是只能在聊天文本里猜 Agent 做了什么。

### 2.1 Runtime Event Protocol

任务清单：

- [x] 新增 `src/types/runtime-events.ts` 或并入 `src/types/runtime.ts`。
- [x] 统一 event 类型：`run.created`、`input.normalized`、`intent.routed`、`context.built`、`plan.created`、`step.started`、`tool.input`、`tool.output`、`tool.error`、`retry.attempt`、`approval.requested`、`approval.responded`、`artifact.created`、`canvas.operation.proposed`、`canvas.operation.applied`、`canvas.operation.rejected`、`evaluation.completed`、`run.completed`、`run.failed`。
- [x] 服务端 `RuntimeEventWriter` 同时写数据库 event 和 AI SDK UI stream chunk。
- [x] 前端只依赖 event schema，不依赖服务端内部函数名。
- [x] 保留对当前 AI SDK tool part 的兼容 adapter。

验收标准：

- [x] 实时 run 和历史 replay 使用同一套 event projection。
- [x] 任何 event schema 变化都有测试覆盖。
- [x] UI 中断刷新后，能从数据库 event 重新投影出同一条 Run 链。

### 2.2 ReactFlow Event Renderer

目标：建立明确的 Runtime event -> Canvas model 投影层。

任务清单：

- [x] 将 `src/lib/graph-projection.ts` 升级为 `src/lib/runtime-event-renderer.ts` 或拆分相邻模块。
- [x] 定义 `CanvasProjectionState`：nodes、edges、run summaries、rejected operations。
- [x] 定义 `projectRuntimeEventsToCanvas(events, existingSnapshot)`。
- [x] 定义 `applyCanvasOperation(state, operation)`，继续拒绝 duplicate node、dangling edge、illegal node kind、project mismatch。
- [x] Run 节点数据来自 `AgentRun` 和 event，不在 `CanvasWorkspace` 中手动拼业务状态。
- [x] Result node 不再只从 `extractImagesFromToolOutput` 推断，优先从 `artifact.created` 和 `canvas.operation.applied` 创建。
- [x] Follow-up branch 继续沿用 `AgentCanvasNode`、`AgentCanvasEdge`、`RunDraft`、`UpstreamContextItem`，不要引入第二套画布状态。

验收标准：

- [x] 实时流：prompt node -> run node -> plan/step/tool 状态 -> artifact node。
- [x] 历史 replay：同一事件序列投影结果确定。
- [x] 手动拖拽位置仍由项目快照保存，不被 replay 强行覆盖。

### 2.3 Node Taxonomy And UI Mapping

目标：画布节点表达 Runtime 语义，但默认保持干净，不把 raw trace 全塞进节点。

节点类型：

- Prompt Node：用户输入、附件摘要、引用锚点。
- Run Node：当前 run 状态、intent 摘要、plan 摘要、step timeline、最近 tool 状态、错误。
- Intent Node 可选：复杂任务时显示结构化任务摘要；简单任务可折叠进 Run Node。
- Context Node 可选：复杂任务或用户打开 trace 时显示 context selection 摘要。
- Plan Node 可选：多步骤任务可以独立显示 plan。
- Tool Result Node：工具输出摘要，不直接当最终 artifact。
- Artifact Node：image、doc、code、webpage、dataset、decision、memory。
- Evaluation Node 可选：质量检查结果、是否需要 revise。

AI Elements 映射：

- Run Node 内部用 `Plan` 展示 planner 摘要。
- Step timeline 用 `Task`，展示 pending/running/completed/error。
- Tool 调用详情用 `Tool`，继续消费 AI SDK ToolUIPart 兼容状态。
- 高风险审批用 `Confirmation`。
- Context budget 和 token trace 用 `Context` 放高级入口。
- 输入和 artifact 文件预览用 `Attachments`。
- Tool Registry 或当前 run agent profile 用 `Agent`。
- 文档/代码结果详情用 `Artifact`，画布节点只放摘要。
- Tool schema inspector 用 `Schema Display`。

任务清单：

- [x] 梳理当前 `CanvasWorkspace.tsx` 中 Run 节点渲染逻辑，拆出 `RunNodeView`、`PlanSummaryView`、`StepTimelineView`、`ToolPartView`。
- [x] 对照 `design.md`，保证节点宽高、字体、按钮、hover、tooltip 和当前视觉统一。
- [x] 默认节点只显示用户能扫读的摘要，完整 trace 放 `RunTracePanel`。
- [x] 未接入的操作按钮保持 disabled 或隐藏，不制造假交互。
- [x] 所有节点文本在移动端和桌面不溢出。

验收标准：

- [x] 用户能从画布看出 Agent 做了什么：输入、意图、上下文、计划、执行、产物、错误。
- [x] 默认画布不暴露 raw id、toolCallId、完整 prompt。
- [x] Run 节点不会因长 prompt、长 tool output、长错误信息挤压遮挡其他节点。

### 2.4 Input Composer And Attachments

任务清单：

- [x] Composer 生成 `AgentInput` 所需 metadata，不让服务端猜 session/project/run/prompt ids。
- [x] 使用 `Attachments` 或本地等价组件展示待提交附件。
- [x] 上传文件节点与 Composer 附件统一为 `InputAttachment` 和 artifact ref。
- [x] 选中节点时，Composer 显示引用摘要和 context count。
- [x] 多选节点输入时，明确显示哪些节点会进入 context，哪些只是画布选中。
- [x] 提交后先创建 Prompt Node 和 queued Run Node，再等待 runtime event 更新。

验收标准：

- [x] 文字、图片、文件、网页链接可以被标准化进入 Input Layer。
- [x] 用户能删除待提交附件。
- [x] 选中 artifact follow-up 不会丢失引用关系。

### 2.5 Trace, Replay, And Debug Panel

任务清单：

- [x] `RunTracePanel` 显示 AgentRun 快照、event list、intent、context、plan、tool IO、artifact refs、canvas operations、errors、evaluation。
- [x] Context trace 显示 selected/omitted/reason/token estimate/tool exposure/skill injection。
- [x] Plan trace 显示 LLM planner 原始输出、normalized plan、validation error。
- [x] Tool trace 显示 schema digest、input、output、logs、duration、retry attempt。
- [x] Canvas operation trace 显示 proposed/applied/rejected 和 rejection reason。
- [x] Replay 模式只读，不触发真实工具、不写项目快照。
- [x] 支持从 Run 节点打开 trace，并支持退出 replay 回到当前画布。

验收标准：

- [x] 一个失败 run 能回答：为什么选这些能力、用了哪些上下文、哪一步失败、能不能重试。
- [x] 一个成功 run 能回答：生成了哪些 artifact、哪些 canvas operation 被应用。
- [x] Replay 与实时投影结果一致。

### 2.6 Canvas Operation Policy

任务清单：

- [x] 明确模型只能提出 canvas operation proposal。
- [x] 前端 reducer 校验 node kind、edge endpoint、project id、duplicate id、target node permission。
- [x] 服务端也要校验高风险 canvas operation，不能只靠前端。
- [x] 对 `canvas.createNode`、`canvas.updateNode`、`canvas.createEdge`、`canvas.attachArtifact` 定义 tool policy 和 renderer hint。
- [x] rejected operation 必须成为 event，并在 trace 中可见。

验收标准：

- [x] 错误 patch 不会破坏画布快照。
- [x] 被拒绝的 operation 不会静默丢失。
- [x] 用户能看懂为什么节点没有被创建或连线没有应用。

### 2.7 Evaluation UI And Revise Flow

任务清单：

- [x] Run 节点显示 evaluator summary：通过、失败、需要确认、建议重试。
- [x] Evaluation detail 放 trace panel。
- [x] 对可修复质量问题，显示 `Revise` 或 `Regenerate` 操作，但必须带用户确认。
- [x] Revise flow 创建新的 follow-up branch，不覆盖旧 artifact。
- [x] 质量失败不伪装成工具失败。

验收标准：

- [x] 图片生成数量不够、artifact 缺失、canvas operation rejected 都能被 evaluator 标记。
- [x] 用户可以基于失败结果继续分支，而不是只能重新开始。

### 2.8 Part 2 Done Criteria

Part 2 完成必须满足：

- [x] ReactFlow 画布由 Runtime events 驱动，实时和 replay 共用 projection。
- [x] Run 节点能展示 intent、context、plan、step、tool、artifact、error、evaluation 的用户级摘要。
- [x] Trace panel 能展示完整审计信息。
- [x] AI Elements 相关组件或本地等价实现被用于合适位置，不引入新的状态源。
- [x] Canvas operation proposal/reducer/policy 完成闭环。
- [x] 当前图片生成和 follow-up branch 不回退。
- [x] 桌面和移动端至少做一次视觉检查。

建议总验证：

```bash
pnpm test src/lib/graph.test.ts src/lib/graph-projection.test.ts src/components/MarkdownPreview.test.tsx
pnpm exec tsc -p tsconfig.app.json --noEmit
pnpm lint
pnpm build
```

有 UI 改动时，需要启动本地服务并做浏览器检查：

```bash
pnpm dev
```

默认地址：

- Web: `http://localhost:5173`
- API: `http://127.0.0.1:8787`
- Health check: `http://127.0.0.1:8787/api/health`

## Suggested Build Order

第一部分建议顺序：

- [x] 1.1 Runtime contracts and schemas
- [x] 1.2 Input Layer
- [x] 1.5 Tool Registry
- [x] 1.4 Context Builder
- [x] 1.3 Intent Router
- [x] 1.6 LLM Planner
- [x] 1.7 Generic Executor
- [x] 1.8 Error handling, retry, evaluator
- [x] Legacy image run adapter cleanup

第二部分建议顺序：

- [x] 2.1 Runtime event protocol
- [x] 2.2 ReactFlow event renderer
- [x] 2.3 Node taxonomy and UI mapping
- [x] 2.4 Input composer and attachments
- [x] 2.5 Trace, replay, debug panel
- [x] 2.6 Canvas operation policy
- [x] 2.7 Evaluation UI and revise flow
- [x] Browser visual verification

## Development Guardrails

- [x] 每次实现先读相关代码，不能只按本文档想象。
- [x] 不绕开 `AgentCanvasNode`、`AgentCanvasEdge`、`RunDraft`、`UpstreamContextItem`。
- [x] 不再新增图片专用 if/else 到主 endpoint，除非是 legacy adapter。
- [x] 新工具必须通过 Tool Registry 注册。
- [x] 新 planner 输出必须有 schema 和 fixture。
- [x] 新 context selection 必须记录 selected/omitted trace。
- [x] 新 canvas operation 必须经过 reducer 校验。
- [x] 错误必须进入 `AgentError` 和 Run 节点。
- [x] 涉及 AI SDK UI stream、tool approval、ToolUIPart 状态时，对照 AI SDK 或 AI Elements 官方资料。
- [x] 涉及 UI 时，对照 `design.md`。
- [x] 测试只跑相关最小集，但核心 Runtime contract 改动必须至少跑 server runtime、graph、projection 测试。

## Non-Goals

- 不做多 agent 自主协作。第一版是单 `AgentRun` 下的多 step Runtime。
- 不让模型直接写数据库或项目快照。
- 不把完整 event log 默认暴露在画布节点里。
- 不自动写长期 memory，memory 必须来自明确事件或用户确认。
- 不为了接入 AI Elements 替换现有 ReactFlow 状态源。
- 不为了新架构牺牲当前图片生成、参考图 follow-up、错误可见和项目保存。
