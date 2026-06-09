# Process

本文件记录仓库的关键变更、实现决策和后续交接信息。新变更追加在最上方，记录应短而具体，尽量包含涉及文件和验证方式。

## 记录格式

```md
## YYYY-MM-DD

### 变更标题

- 变更：做了什么。
- 文件：涉及哪些关键文件。
- 验证：运行了哪些命令或做了哪些手动检查。
- 备注：风险、后续项或未完成事项。
```

## 2026-06-09

### 允许画布节点文本选取复制

- 变更：对 Prompt、Artifact、HTML、Markdown 标题和 Run 输出文本区域补充 React Flow `nodrag` / `nopan` 交互类，并恢复 `user-select: text`；Markdown 编辑/预览滚动区域补充 `nowheel`，避免滚动时带动画布。
- 文件：`src/components/CanvasWorkspace.tsx`、`src/components/RunNodeView.tsx`、`src/App.css`、`process.md`。
- 验证：已对照 React Flow Utility Classes 官方文档；`pnpm exec eslint src/components/CanvasWorkspace.tsx src/components/RunNodeView.tsx` 通过；VS Code diagnostics 仅保留既有 `line-clamp` CSS warning。

### 修复图片 Intent 漏暴露 prompt.expand

- 现象：Run 节点报错 `Tool step expand_prompt references non-exposed tool prompt.expand.`；触发条件是模型把请求路由为图片生成，但 `requiredTools` 只返回 `seedream.generateImage`，漏掉前置的 `prompt.expand`。
- 变更：`routeIntent` 在模型结构化输出后增加服务端 runtime 契约归一化；图片生成 intent 只要使用 `seedream.generateImage`，就会在进入 Context Builder / Planner 前补齐 `prompt.expand -> seedream.generateImage` 的可暴露工具链，并保留引用图分析工具顺序。
- 文件：`server/runtime/intent-router.ts`、`server/runtime/runtime.test.ts`、`process.md`。
- 验证：`pnpm exec vitest run server/runtime/runtime.test.ts server/runtime/ai-sdk-runner.test.ts --reporter=dot`、`pnpm exec tsc -b --pretty false`、`pnpm exec eslint server/runtime/intent-router.ts server/runtime/runtime.test.ts` 通过；`curl http://127.0.0.1:8787/api/health` 显示 DeepSeek / Ark / Seedream / Supabase 已配置。

### 修复 DeepSeek IntentResult 结构化输出不匹配

- 变更：`routeIntent` 的模型提示补充完整 `IntentResult` 必填形状、枚举值和对象数组约束，并在明确图片生成请求时提供基于当前输入/工具 allowlist 的 preferred intent 示例，避免 DeepSeek 把 `targets`、`deliverables`、`operations` 简化成字符串数组或漏掉 `needsPlanning` / `routingReason`。
- 变更：图片生成计划改为服务端确定性 `buildPlanFromIntentDeterministically`，不再额外调用 LLM planner 生成 `PlanStep[]`；复杂未知路线仍可走 structured planner。
- 变更：补充中文“生成四张小狗的图”这类 `的图` / 多张图表达的显式图片生成识别，并修正 image task 中 `expanded_prompt` 的 `toolHint` 为 `prompt.expand`。
- 文件：`server/runtime/intent-router.ts`、`server/runtime/planner.ts`、`server/runtime/runtime.test.ts`、`process.md`。
- 验证：`pnpm exec vitest run server/runtime/runtime.test.ts server/runtime/ai-sdk-runner.test.ts --reporter=dot`、`pnpm exec tsc -b --pretty false`、`pnpm exec eslint server/runtime/intent-router.ts server/runtime/planner.ts server/runtime/runtime.test.ts server/runtime/ai-sdk-runner.ts` 通过；真实 DeepSeek routeIntent + createPlan 探针确认“生成四张小狗的图”生成 image intent 和 4 图计划。

### 取消模型侧强制 plan_agent_run

- 变更：`server/runtime/ai-sdk-runner.ts` 不再把第 0 步暴露为强制 `plan_agent_run` tool call；Run 开始后先由服务端执行 `routeIntent`、`buildContext`、`createPlan`，把 `intent.routed`、`context.built`、`plan.created` 写入 Run Trace，再启动 AI SDK `streamText` runtime tool loop。
- 变更：执行阶段 `toolChoice` 固定为 `auto`，`activeTools` 只来自服务端已验证计划中的 runtime tools；planning tool 不再进入模型侧可调用工具列表，Run 节点仍通过 trace event 展示运行计划。
- 变更：规划继续使用 AI SDK 官方 structured output 路径：DeepSeek 分支经 `generateText + Output.object()` 生成 schema-validated intent/plan；计划校验失败直接抛出运行错误，不生成假结果。
- 文件：`server/runtime/ai-sdk-runner.ts`、`README.md`、`process.md`。
- 验证：已对照 AI SDK 官方 structured output、tool calling、`activeTools` / `toolChoice` 文档；`pnpm exec tsc -b --pretty false`、`pnpm exec vitest run server/runtime/ai-sdk-runner.test.ts --reporter=dot` 通过。

### Agent Run 意图识别改回结构化模型主路由

- 变更：`/api/agent-run` 主路径不再使用 `server/runtime/tool-router.ts` 的关键词式 deterministic activeTools 预路由；第 0 步仍强制 `plan_agent_run`，但后续工具只从 schema-validated `IntentResult` / `PlanStep[]` 暴露。
- 变更：`routeIntent` 删除本地先行路由和非图片 guard，改为 AI SDK v6 structured output 主路径；旧 deterministic helper 仅保留给兼容测试，同时修正复合页面中的网页来源策略：有 URL/网页节点才用 `web.read`，没有明确 URL 的资料/搜索需求走 `web.search`。
- 文件：`server/runtime/ai-sdk-runner.ts`、`server/runtime/intent-router.ts`、`server/runtime/planner.ts`、`server/runtime/runtime.test.ts`、`server/runtime/ai-sdk-runner.test.ts`、`README.md`、`process.md`；删除 `server/runtime/tool-router.ts`、`server/runtime/tool-router.test.ts`。
- 验证：已对照 AI SDK 官方 structured output 和 `streamText.prepareStep` / `activeTools` 文档；`pnpm exec vitest run server/runtime/ai-sdk-runner.test.ts server/runtime/runtime.test.ts server/runtime/tools/web-page-tools.test.ts`、`pnpm exec tsc -p tsconfig.node.json --noEmit`、`pnpm exec eslint server/runtime/ai-sdk-runner.ts server/runtime/ai-sdk-runner.test.ts server/runtime/intent-router.ts server/runtime/planner.ts server/runtime/runtime.test.ts`、`pnpm build` 通过。

### 多图生成区分单提示词与多提示词批次

- 变更：`prompt.expand` 输出契约改为 `expandedPrompts`、`promptBatchMode`、`requestedResultCount`；普通“生成四张小狗图”只扩写一条 prompt 并用同一 prompt 请求 4 张结果，明确“生成4张不同的小狗图”会扩写 4 条 prompt 并分别生成 1 张。
- 变更：Seedream 请求层新增批次拆分，`single_prompt` 保持一次多结果请求，`distinct_prompts` 拆为每条 prompt 一个单图请求；Run 节点工具摘要改为展示多条扩写提示词数量。
- 文件：`server/runtime/tools/image-tools.ts`、`server/runtime/tools/image-tools.test.ts`、`server/run-kernel.ts`、`seedream.ts`、`server/prompts.ts`、`server/capabilities.ts`、`src/components/RunNodeView.tsx`、`README.md`、`process.md`。
- 验证：已对照 AI SDK tool calling / `prepareStep` / `activeTools` 官方文档；`pnpm exec vitest run seedream.test.ts server/prompts.test.ts server/runtime/tools/image-tools.test.ts src/lib/graph.test.ts src/lib/graph-projection.test.ts`、`pnpm exec tsc -p tsconfig.node.json --noEmit`、`pnpm exec tsc -p tsconfig.app.json --noEmit`、`pnpm exec eslint server/runtime/tools/image-tools.ts server/runtime/tools/image-tools.test.ts server/run-kernel.ts seedream.ts server/prompts.ts server/capabilities.ts src/components/RunNodeView.tsx seedream.test.ts server/prompts.test.ts src/lib/graph.test.ts src/lib/graph-projection.test.ts` 通过。

### Agent Run stream protocol 拆分为 typed data parts

- 变更：`RuntimeEventWriter` 不再把 artifact、canvas operation、run lifecycle 全部写成 `data-runtime-event`；改为写 `data-artifact-created`、`data-canvas-operation`、`data-run-status` 和持久化后的 `data-trace-pointer`，普通运行细节继续使用 `data-runtime-event`。
- 变更：前端 `runtime-event-renderer` 支持从 typed data parts 还原 runtime events；`graph-projection` 直接消费 `canvas.operation.applied`，并按 operation/patch id 跳过兼容 `graph.patch.applied` 的重复应用。
- 文件：`server/runtime/events.ts`、`server/runtime/schemas.ts`、`src/types/runtime.ts`、`src/lib/runtime-event-renderer.ts`、`src/lib/graph-projection.ts`、`server/runtime/runtime.test.ts`、`src/lib/runtime-event-renderer.test.ts`、`src/lib/graph-projection.test.ts`、`README.md`、`process.md`。
- 验证：已对照 AI SDK UI Streaming Custom Data / Stream Protocol 文档；`pnpm test -- src/lib/runtime-event-renderer.test.ts src/lib/graph-projection.test.ts server/runtime/runtime.test.ts --testNamePattern "runtime event|data parts|canvas operation|schema|validates UI runtime"`、`pnpm exec tsc -p tsconfig.node.json --noEmit`、`pnpm exec tsc -p tsconfig.app.json --noEmit` 通过。

### Agent Run 后续工具改为服务端确定性 activeTools

- 变更：新增 `server/runtime/tool-router.ts`，按 prompt 和画布上下文在服务端确定 obvious tool route：图片走 `prompt.expand` / `seedream.generateImage`，参考图补 `vision.analyzeReferenceImages`，网页/HTML 走 `html.generate`，最新/搜索/来源走 `web.search` / `document.write`，普通分析/总结/计划走 `document.write`。
- 变更：`server/runtime/ai-sdk-runner.ts` 仍在第 0 步强制 `plan_agent_run` 记录 intent/context/plan，但第 1 步开始的 AI SDK `activeTools` 改用确定性 route 映射出的 AI SDK tool names，避免错误 plan 直接污染后续工具 allowlist。
- 文件：`server/runtime/tool-router.ts`、`server/runtime/tool-router.test.ts`、`server/runtime/ai-sdk-runner.ts`、`README.md`、`process.md`。
- 验证：已对照 AI SDK 官方 `prepareStep` / `activeTools` 文档；`pnpm test server/runtime/tool-router.test.ts`、`pnpm exec tsc -p tsconfig.node.json --noEmit` 通过。

### document.write 改为 Markdown Artifactizer

- 变更：`document.write` 移除内部 `generateTextWithProvider` 调用，输入改为 `title`、完整 `markdown`、`summary` 和可选 `sourcesUsed`；工具只校验输入、生成 `doc` artifact、返回 canvas runtime event 所需结果。
- 变更：AI SDK runner 主提示词要求主 `streamText` 模型直接把最终 Markdown 作为 `write_document` tool input 生成；web research 仍先调用 `web_search`，再由主模型基于工具结果写 Markdown 和来源列表。
- 文件：`server/runtime/tools/document-tools.ts`、`server/runtime/tool-registry.ts`、`server/runtime/planner.ts`、`server/runtime/ai-sdk-runner.ts`、`server/runtime/tools/document-tools.test.ts`、`README.md`、`process.md`。
- 验证：已对照 AI SDK 官方 tool calling / `streamText` 工具输入文档；`pnpm test -- server/runtime/tools/document-tools.test.ts server/runtime/runtime.test.ts`、`pnpm exec tsc -p tsconfig.node.json --noEmit`、`pnpm build` 通过。

### Agent Run 记录 AI SDK step 与工具生命周期

- 变更：`streamText` 增加 `onStepFinish`，每个 AI SDK step 结束时写入 `step.finished` trace，记录 step number、text、toolCalls、toolResults、finishReason、usage 和模型信息。
- 变更：`streamText` 增加 `experimental_onToolCallStart` / `experimental_onToolCallFinish`，写入 `tool.execution.started` / `tool.execution.finished` trace，观察工具执行前后、耗时和成功/错误摘要；画布默认可见状态仍由 `tool.input`、`tool.output`、`tool.error` 驱动。
- 文件：`server/runtime/ai-sdk-runner.ts`、`src/types/runtime.ts`、`src/components/run-trace-summary.ts`、`README.md`、`process.md`。
- 验证：已对照 AI SDK 官方 `onStepFinish` 和 tool execution lifecycle callbacks 文档；`pnpm build`、`pnpm exec vitest run src/lib/runtime-event-renderer.test.ts src/lib/graph-projection.test.ts src/components/RunTracePanel.test.tsx`、`pnpm exec vitest run server/runtime/runtime.test.ts --testNamePattern "keeps runtime event schema aligned"` 通过。`pnpm test -- server/runtime/runtime.test.ts` 仍被既有 document planner fixture 失败阻断。

### Agent Run 接入 UIMessage 校验与模型消息转换

- 变更：`executeAiSdkAgentRun` 在调用 `streamText` 前，先用 AI SDK `validateUIMessages` 校验历史 `messages`、runtime data parts、message metadata 和当前工具集合，再用 `convertToModelMessages` 转为模型消息。
- 变更：当前画布 prompt 作为新的 user UI message 追加到已校验历史之后；`streamText` 改为接收 `messages`，不再只依赖拼出的 `prompt` 字段。`data-runtime-event` 继续作为 UI/画布状态，不转换成模型文本。
- 文件：`server/runtime/ai-sdk-runner.ts`、`server/runtime/schemas.ts`、`server/runtime/runtime.test.ts`、`process.md`。
- 验证：已对照 AI SDK 官方 `validateUIMessages`、`convertToModelMessages` 和 Message Persistence 文档；`pnpm test server/runtime/runtime.test.ts`、`pnpm build` 通过。

### 新增 generate_html 页面工具

- 变更：移除旧页面模板生成路径，页面、组件、落地页、网站和 HTML 请求统一暴露 `html.generate` / AI SDK `generate_html` 工具。
- 变更：`generate_html` 输入为 `title`、完整单文件 `html` 和 `summary`；工具校验 `<!doctype html>`、`html/head/body/style`、无外部脚本或样式依赖，然后生成 `webpage` artifact 并投影为可预览节点。
- 文件：`server/runtime/tools/web-page-tools.ts`、`server/runtime/tool-registry.ts`、`server/runtime/planner.ts`、`server/runtime/intent-router.ts`、`server/runtime/ai-sdk-runner.ts`、`src/lib/graph.ts`、`src/lib/graph-projection.ts`、`src/components/RunNodeView.tsx`、`README.md`、`process.md`。
- 验证：`pnpm test -- server/runtime/runtime.test.ts server/runtime/evaluator.test.ts src/lib/graph.test.ts src/lib/graph-projection.test.ts server/runtime/tools/web-page-tools.test.ts`、`pnpm build`、`curl -sS http://127.0.0.1:8787/api/health` 通过。

### 移除 Run 节点工具调用占位

- 变更：新建 Run 节点不再预置 `tool-expand_prompt` / `tool-analyze_reference_images`；Run 节点只有收到真实 `toolPart`、runtime tool event 或已有工具错误时才展示“工具调用”分组。
- 变更：前端 stream 失败时不再补一个假的“提示词扩写”错误工具；如果已有真实工具，则把错误挂到最后一个工具，否则只标记 Run 失败。
- 文件：`src/components/RunNodeView.tsx`、`src/components/CanvasWorkspace.tsx`、`src/lib/graph.ts`、`src/lib/graph.test.ts`、`process.md`。
- 验证：`pnpm test -- src/lib/graph.test.ts src/lib/graph-projection.test.ts src/lib/runtime-event-renderer.test.ts`、`pnpm build`、`pnpm exec eslint src/components/RunNodeView.tsx src/components/CanvasWorkspace.tsx src/lib/graph.ts src/lib/graph.test.ts` 通过。
- 备注：完整 `pnpm lint` 仍因既有 `src/components/BlockNoteMarkdownEditor.tsx` 的 `react-hooks/refs` 问题失败，本次未改该文件。

### 画布节点支持调整大小

- 变更：所有基于 AI Elements `Node` 的画布节点接入 React Flow `NodeResizer`，选中态显示绿色缩放手柄；Prompt、Run、图片结果、Artifact、Markdown 和 HTML 页面节点均可调整宽高。
- 变更：节点内容区域改为跟随外层尺寸伸缩，图片结果使用 `object-fit: cover` 填充新尺寸；图布局和文件上传避让逻辑优先读取节点已保存/测量尺寸。
- 文件：`src/components/ai-elements/node.tsx`、`src/components/CanvasWorkspace.tsx`、`src/components/RunNodeView.tsx`、`src/App.css`、`src/lib/graph.ts`、`src/lib/file-upload.ts`、`design.md`、`process.md`。
- 验证：`pnpm build` 通过；`pnpm dev:web` 打开 `http://localhost:5174/` 项目列表页无 console error。完整 `pnpm dev` 因本机已有 API 占用 `127.0.0.1:8787` 被跳过。

## 2026-06-08

### 修复画布刷新前未落库导致的节点丢失

- 变更：`/api/agent-run` 在通过项目鉴权后立即把当前 `runNodeId` 写入项目 `lastRunId`，让刷新恢复可以用已持久化的 run trace 重建画布链路。
- 变更：前端项目快照保存增加 `pagehide` / `visibilitychange` flush，并在卸载时用 keepalive 请求提交当前节点、边、选中节点、标题和最后 run，避免 debounce 定时器被刷新或切项目取消。
- 文件：`server/api.ts`、`src/components/CanvasWorkspace.tsx`、`src/lib/project-storage.ts`、`process.md`。
- 验证：`pnpm exec tsc -p tsconfig.app.json --noEmit`、`pnpm exec tsc -p tsconfig.node.json --noEmit`、`pnpm exec eslint src/components/CanvasWorkspace.tsx src/lib/project-storage.ts server/api.ts`、`pnpm test src/lib/graph-projection.test.ts` 通过。

### Run 节点改为分组式 Agent 对话流

- 变更：Run 节点展开态改为按“用户请求 / Agent 输出 / 运行计划 / 质量检查 / 工具调用”分组展示，Agent 文本使用 AI Elements `MessageResponse` 渲染，工具调用使用 collapsible 形态展示摘要、参数、结果和错误详情。
- 变更：按 AI Elements 官方 `Shimmer` 组件方向新增本地 `ai-elements/shimmer`，运行中 Run 标题和等待文本使用文字扫光；工具调用块默认展开运行中、错误和图片生成工具，完成项可展开/收起查看完整输入输出。
- 文件：`src/components/RunNodeView.tsx`、`src/components/ai-elements/shimmer.tsx`、`src/App.css`、`process.md`。
- 验证：对照 AI SDK UI `useChat` / `UIMessage.parts` 和 AI Elements `Message` / `Tool` 官方文档；`pnpm build`、`pnpm exec eslint src/components/RunNodeView.tsx` 通过。
- 备注：`pnpm lint` 当前被既有 `src/components/BlockNoteMarkdownEditor.tsx` 的 `react-hooks/refs` 报错阻塞，和本次 Run 节点改动无关。

### Markdown 节点改为 BlockNote 可编辑节点

- 变更：`markdownNode` 从只读 Markdown 预览改为 BlockNote shadcn 编辑器，加载现有 Markdown 内容，编辑后回写 `data.content`、`metadata.markdown` 和 `metadata.blockNoteBlocks`，保持后续分支上下文可用；Trace 回放中的 Markdown 节点为只读。
- 变更：新增 `@blocknote/core`、`@blocknote/react`、`@blocknote/shadcn` 依赖，并按 BlockNote 官方建议用 native blocks JSON 保存富文本状态，同时保留 Markdown 作为 Agent 上游摘要/上下文。
- 文件：`package.json`、`pnpm-lock.yaml`、`src/types/canvas.ts`、`src/components/CanvasWorkspace.tsx`、`src/components/BlockNoteMarkdownEditor.tsx`、`src/index.css`、`src/App.css`、`README.md`、`process.md`。
- 验证：`pnpm exec tsc -p tsconfig.app.json --noEmit`、`pnpm build` 通过；Browser 打开 `http://localhost:5174/` 项目页正常渲染。开发过程中新增懒加载文件时 Vite HMR 曾留下旧错误日志，冷启动 Vite 后页面可正常进入项目。
- 备注：当前测试项目没有 Markdown 节点，未向用户项目写入临时节点做编辑验证。

### 接通前端 Run 节点的 AI SDK Streaming Data

- 变更：`CanvasWorkspace` 的 `useChat` 增加 `onData` 处理，收到 AI SDK `data-runtime-event` part 时立即投影到当前 Run 节点；保留 `messages` effect 作为完整消息重放兜底。
- 变更：`DefaultChatTransport` 明确使用 `/api/agent-run` 并携带同源 cookie；Run 状态投影在 `run.created` 后收到任意后续 runtime event 即进入 running，避免 AI SDK planning 阶段仍显示 queued。
- 文件：`src/components/CanvasWorkspace.tsx`、`src/lib/graph-projection.ts`、`src/lib/graph-projection.test.ts`、`process.md`。
- 验证：已对照 AI SDK UI `useChat`、`DefaultChatTransport`、Streaming Custom Data 文档确认 `messages[].parts` / `onData` 接法；`pnpm test src/lib/runtime-event-renderer.test.ts src/lib/graph-projection.test.ts`、`pnpm build` 通过。

### 关闭 DeepSeek Thinking Mode 以支持 Tool Choice

- 变更：DeepSeek OpenAI-compatible provider 增加 `transformRequestBody`，统一向请求体注入 `thinking: { type: "disabled" }`，避免 thinking mode 下 DeepSeek 拒绝 AI SDK 强制 `tool_choice`。
- 变更：恢复 AI SDK runner 第一轮强制调用 `plan_agent_run`，保证主链路仍先规划再调用 runtime tools。
- 文件：`server/model-providers.ts`、`server/model-providers.test.ts`、`server/runtime/ai-sdk-runner.ts`、`process.md`。
- 验证：`pnpm test server/model-providers.test.ts server/runtime/executor.test.ts src/lib/graph.test.ts src/lib/graph-projection.test.ts`、`pnpm build` 通过。

### 用 Vercel AI SDK Streaming Tool Loop 替换主运行链路

- 变更：`/api/agent-run` 主路径改为 `server/runtime/ai-sdk-runner.ts`：使用 AI SDK `streamText` 原生 streaming，第一步强制调用 `plan_agent_run` 工具生成 `IntentResult` 和 `PlanStep[]`，后续工具调用由 AI SDK tool loop 继续驱动。
- 变更：runtime tools 通过 AI SDK `tool({ inputSchema, execute })` 暴露；provider 不兼容点号的工具名会转为下划线名称，同时 trace payload 保留原 runtime tool id、schema digest、version、duration、logs、artifact 和 canvas operation 事件。
- 变更：`server/runtime/executor.ts` 不再在主入口调用旧的 deterministic router/planner/generic step runner；旧低层 `runStep/executePlanSteps` 仅保留给现有单元测试覆盖工具结果、重试和 canvas policy 行为。
- 文件：`server/runtime/ai-sdk-runner.ts`、`server/runtime/executor.ts`、`server/model-providers.ts`、`src/components/RunNodeView.tsx`、`README.md`、`process.md`。
- 验证：`pnpm test server/runtime/executor.test.ts src/lib/graph.test.ts src/lib/graph-projection.test.ts`、`pnpm lint`、`pnpm build` 通过。
- 备注：未提交真实外部模型/Seedream 请求，避免触发外部调用费用。

### 补强复合页面任务 Router/Planner

- 变更：页面/HTML 请求如果同时包含分析、报告、总结等文本产物目标，会作为通用 multi-step 任务暴露 `document.write -> html.generate` 工具链，而不是落到模型 planner schema 输出。
- 变更：Planner 对包含 `html.generate` 的复合任务按已暴露工具组合生成 DAG；前序 `document.write` 的 Markdown 会作为页面生成素材传给 `html.generate`。只有用户明确要求画布/节点 mutation 时才加入 `canvas.createNode` 和对应 expected canvas operation。
- 变更：对照 AI SDK 官方 multi-step/tool-calling、ToolLoopAgent、loop control 和 structured-output-with-tools 文档，继续用本仓库的 `IntentResult -> PlanStep[] -> generic executor` 映射多步工具循环。
- 文件：`server/runtime/intent-router.ts`、`server/runtime/planner.ts`、`server/runtime/tools/web-page-tools.ts`、`server/runtime/runtime.test.ts`、`README.md`、`process.md`。
- 验证：`pnpm test -- server/runtime/runtime.test.ts`、`pnpm exec tsc -p tsconfig.node.json --noEmit` 通过。

### 页面类需求输出 HTML 预览节点

- 变更：页面/网页/HTML/站点等页面产物意图会路由到 `html.generate`，生成的 `webpage` artifact 会投影为可预览的 `webpageNode`；节点使用 iframe 渲染 `srcDoc`/`data:text/html`，并保留打开预览入口。
- 变更：graph projection、legacy tool part fallback 和 Run 节点工具状态都支持 `web.read`、`asset.analyze_context`、`html.generate`，避免页面生成过程只停留在聊天文本或普通 artifact 卡片里。
- 文件：`server/runtime/intent-router.ts`、`src/types/canvas.ts`、`src/lib/graph.ts`、`src/lib/graph-projection.ts`、`src/lib/runtime-event-renderer.ts`、`src/components/CanvasWorkspace.tsx`、`src/components/RunNodeView.tsx`、`src/App.css`、`src/lib/graph.test.ts`、`src/lib/graph-projection.test.ts`、`process.md`。
- 验证：已对照 AI SDK UI `createUIMessageStream` / streaming data 文档确认沿用 message parts/runtime event 流；`pnpm test src/lib/graph.test.ts src/lib/graph-projection.test.ts server/runtime/runtime.test.ts`、`pnpm build` 通过；Browser 打开 `http://localhost:5174/` 创建空项目，画布、输入器和存储状态正常且无 console error/warn。
- 备注：未提交真实页面生成请求，避免触发模型调用；HTML 节点数据落点由 graph/projection 单元测试覆盖。

### 接入 Tavily AI SDK Web Search 工具

- 变更：撤销上一版搜索依赖，改为依赖 `@tavily/ai-sdk`；Tool Registry 新增 `web.search`，通过 Tavily search 返回 sources，缺 `TAVILY_API_KEY` 时直接在 Run 节点显示工具错误。
- 变更：搜索/调研/最新信息类请求会确定性路由到 `web_research`，计划为 `agent_text -> search_web -> write_document -> evaluate_result`；`document.write` 会把 Tavily 搜索结果注入 Markdown 文档 prompt，最终仍生成可继续分支的 `markdownNode`。
- 变更：前端 Run 节点识别并展示 `web_search` 工具状态、查询和来源数量。
- 文件：`package.json`、`pnpm-lock.yaml`、`server/runtime/tools/web-page-tools.ts`、`server/runtime/tools/document-tools.ts`、`server/runtime/tools/ids.ts`、`server/runtime/tool-registry.ts`、`server/runtime/intent-router.ts`、`server/runtime/planner.ts`、`server/runtime/runtime.test.ts`、`src/types/canvas.ts`、`src/lib/graph.ts`、`src/lib/graph-projection.ts`、`src/components/RunNodeView.tsx`、`README.md`、`process.md`。
- 验证：`pnpm exec tsc -p tsconfig.node.json --noEmit`、`pnpm exec tsc -p tsconfig.app.json --noEmit`、`pnpm test -- server/runtime/runtime.test.ts src/lib/graph.test.ts src/lib/graph-projection.test.ts src/lib/runtime-event-renderer.test.ts`、`pnpm build` 通过。

### 修复文档任务 Router/Planner schema 失败

- 变更：`routeIntent` 对非图片且本地规则可确定的可执行任务先走 deterministic policy，`分析下Gemini的视觉风格` 会直接路由到 `document.analysis -> document.write`，不再调用模型结构化 Router。
- 变更：`createPlan` 对 `document.write` 意图直接生成固定计划 `agent_text -> write_document -> evaluate_result`，避免文档任务在 Planner 阶段因模型返回非 schema JSON 而失败。
- 变更：`document.write` 工具改用普通文本生成 Markdown，再本地推导标题和摘要；操作型但当前不可执行的非图片请求会产出诚实的能力说明文档。
- 文件：`server/runtime/intent-router.ts`、`server/runtime/planner.ts`、`server/runtime/tools/document-tools.ts`、`server/runtime/runtime.test.ts`、`process.md`。
- 验证：`pnpm test -- server/runtime/runtime.test.ts server/model-providers.test.ts src/lib/graph-projection.test.ts src/lib/runtime-event-renderer.test.ts src/lib/graph.test.ts`、`pnpm exec tsc -p tsconfig.node.json --noEmit`、`pnpm exec tsc -p tsconfig.app.json --noEmit`、`pnpm build` 通过。

### 修复 DeepSeek Structured Output JSON mode 要求

- 变更：`generateStructuredObjectWithProvider` 的 DeepSeek 路径会统一向 system 与 user prompt 注入显式 `JSON` 指令，满足 DeepSeek/OpenAI-compatible `response_format: json_object` 对 prompt 文本的要求。
- 变更：早期 runtime 失败的 Run 节点 fallback 不再显示为“提示词扩写”，改为“运行错误”，避免把 router/planner/model provider 失败误导成 prompt-expand tool 失败。
- 文件：`server/model-providers.ts`、`server/model-providers.test.ts`、`src/types/canvas.ts`、`src/lib/graph-projection.ts`、`src/components/RunNodeView.tsx`、`process.md`。
- 验证：`pnpm test -- server/model-providers.test.ts server/runtime/runtime.test.ts src/lib/graph-projection.test.ts src/lib/runtime-event-renderer.test.ts src/lib/graph.test.ts`、`pnpm exec tsc -p tsconfig.node.json --noEmit`、`pnpm exec tsc -p tsconfig.app.json --noEmit`、`pnpm build` 通过。

### 非图片文本任务输出 Markdown 文档

- 变更：Tool Registry 新增 `document.write`，通过当前文本模型生成结构化 `{ title, markdown, summary }`，并返回 `doc` artifact；runtime event projection 会将其渲染为 `markdownNode`。
- 变更：Intent Router 增加 post-route policy gate：明确图片仍走生图，页面/画布仍走专用工具；分析、总结、报告、方案、问答等 text-first 任务改走 `document.write`，LLM 误判为 `image_generation` 或 `route_missing` 时也会被纠正为文档产物。
- 变更：未接执行器的非图片操作会生成诚实的能力缺口/下一步 Markdown 文档，不伪造 web/code/file 操作成功，也不再静默走 Seedream。
- 文件：`server/runtime/tools/document-tools.ts`、`server/runtime/tools/ids.ts`、`server/runtime/tool-registry.ts`、`server/runtime/intent-router.ts`、`server/runtime/planner.ts`、`server/runtime/executor.ts`、`server/runtime/runtime.test.ts`、`src/types/canvas.ts`、`src/lib/graph.ts`、`src/lib/runtime-event-renderer.ts`、`src/lib/graph-projection.ts`、`src/components/RunNodeView.tsx`、`README.md`、`process.md`。
- 验证：`pnpm test -- server/runtime/runtime.test.ts src/lib/graph.test.ts src/lib/runtime-event-renderer.test.ts src/lib/graph-projection.test.ts`、`pnpm exec tsc -p tsconfig.node.json --noEmit`、`pnpm exec tsc -p tsconfig.app.json --noEmit`、`pnpm build` 通过。
- 备注：官方 AI SDK 未提供单一“万能 Intent Router”API；本实现对齐其 structured output routing、schema tools、multi-step/tool-state streaming 等推荐模式。

### Router 后预占位图片结果节点

- 变更：`intent.routed` 判定为 image generation / image editing 后，runtime event projection 会按 intent/plan/tool input 中的图片数量和 prompt 尺寸/比例提示，提前创建对应数量的 loading image result nodes。
- 变更：真实 `artifact.created` 到达后复用第 N 个 loading 节点的 id 和位置原位填充图片 URL；server 后续 `attachArtifact` patch 即使指向 `image-${artifact.id}`，投影层也会按 artifact id 找到已填充节点并接受更新。
- 变更：loading/error 图片占位节点显示轻量骨架态，不作为 follow-up 引用锚点；ready 后恢复可选中继续分支。
- 文件：`src/types/canvas.ts`、`src/lib/graph.ts`、`src/lib/graph-projection.ts`、`src/lib/graph-projection.test.ts`、`src/components/CanvasWorkspace.tsx`、`src/App.css`、`README.md`、`process.md`。
- 验证：`pnpm test -- src/lib/graph-projection.test.ts src/lib/graph.test.ts`、`pnpm build`、Browser 打开 `http://localhost:5173/` 项目页正常渲染且无 console error。
- 备注：未提交真实生图请求，避免触发 Seedream/Ark 外部调用费用。

### 修复 Seedream 多图数量与请求参数丢失

- 变更：`seedream.generateImage` 在多图请求时会把 `resultCount` 写回最终 Seedream prompt，避免 prompt-expand 吞掉“四张”等数量后 Visual API 只返回 1 个 URL。
- 变更：Seedream request body 现在会从上游上下文收集多张参考图 URL，并从 prompt 解析显式尺寸、`2K/4K`、`16:9` / 横版 / 竖版 / 方图等比例信息，透传可选 `SEEDREAM_SCALE`；Planner 会把 intent 中的图片数量归一化到 `expectedArtifacts.count`。
- 文件：`seedream.ts`、`seedream.test.ts`、`server/runtime/intent-router.ts`、`server/runtime/planner.ts`、`server/runtime/executor.ts`、`server/runtime/runtime.test.ts`、`README.md`、`process.md`。
- 验证：`pnpm test -- seedream.test.ts server/runtime/runtime.test.ts`、`pnpm build`、`curl http://127.0.0.1:8787/api/health`。
- 备注：未重新提交真实图片生成请求，避免触发 Seedream/Ark 外部调用费用。

### 修复 Run 节点输出被裁剪与 Ark 空响应诊断

- 变更：Run 节点展开区移除固定 `max-height` 和输出行数截断，长工具输出会自然撑高节点；错误工具行优先显示自身 `errorText`，避免被全局 run error 错配到其他工具行。
- 变更：Ark Responses 2xx 但无可提取文本时，错误信息追加响应状态、output/choices 形状等诊断摘要；Ark 文本提取补充兼容 `message.content`、`delta.content` 和 `parts` 结构。
- 文件：`src/App.css`、`src/components/RunNodeView.tsx`、`server/model-providers.ts`、`server/model-providers.test.ts`、`process.md`。
- 验证：`pnpm test -- server/model-providers.test.ts`、`pnpm build`、`curl http://127.0.0.1:8787/api/health`、Browser 打开 `http://localhost:5173/` 检查页面非空/无控制台错误，并确认运行中 CSS 已无 `.run-stream` 最大高度和输出 line clamp。
- 备注：未重新提交真实图片生成请求，避免触发 Seedream/Ark 外部调用费用。

### 修复非图片任务误进提示词扩写链路

- 变更：Intent Router 增加图片产物硬判断，`分析Gemini的视觉风格` 这类分析任务即使被模型误判为 `image_generation`，也会被纠正为 `capability.route_missing` / `asset.analyze`，不再执行 `prompt.expand` 或 `seedream.generateImage`。
- 变更：Tool Registry 不再在所有 Run 启动时强制要求 `prompt-expand` skill；Context Builder 也只在当前 intent 需要 `prompt.expand` 时注入该 skill，避免非图片任务 trace 被旧图片链路污染。
- 文件：`server/runtime/intent-router.ts`、`server/runtime/tool-registry.ts`、`server/runtime/context-builder.ts`、`server/capabilities.ts`、`server/runtime/runtime.test.ts`、`process.md`。
- 验证：`pnpm test server/runtime/runtime.test.ts`。

### 修复 Agent Run 早期失败卡在 Thinking

- 变更：Runtime event writer 现在先把 `data-runtime-event` 写入 AI SDK UI stream，再尝试持久化 event；`executeAgentRun` 将 skill/load、input normalize、run snapshot 创建都纳入同一错误路径，早期失败会流出带 prompt、promptNodeId 和错误详情的 `run.failed`。
- 变更：Runtime event -> ReactFlow 投影在只有早期 `run.failed`、没有 `run.created` 时，会从失败 payload 或现有 prompt/run 节点保留 prompt，并补出可见 error tool row，避免提交后节点内容被空 payload 刷白。
- 变更：通过 Supabase 对 `cucumber2` 项目应用幂等 `repair_agent_runtime_core_schema` migration，重新确认 `agent_runs`、`agent_run_steps`、`agent_run_step_events` 均可被 PostgREST schema cache 查询。
- 文件：`server/runtime/events.ts`、`server/runtime/executor.ts`、`src/lib/graph-projection.ts`、`src/lib/graph-projection.test.ts`、`process.md`。
- 验证：`pnpm test -- src/lib/graph-projection.test.ts src/lib/runtime-event-renderer.test.ts server/runtime/executor.test.ts`、`pnpm build`、`curl http://127.0.0.1:8787/api/health`、Supabase client head query 三张 runtime 表通过。

### 完成 1.8 非图片 Evaluator 专项检查

- 变更：Evaluator 增加 webpage/doc/code artifact completeness 检查，要求有 `uri`、`contentRef` 或 inline content/html metadata；code artifact 如果标记 `testStatus: failed` 或 `typecheckStatus: failed` 会生成专项质量问题。
- 变更：Evaluator 对带 `expectedCanvasOperations: createNode` 的任务检查 canvas visibility signal，来源包括已接受的 `createNode` canvas operation 和 `artifact.created` event 上的 `canvasNodeId`。
- 变更：质量失败的 `needsRegeneration` 覆盖网页/文档/代码内容缺失和画布可见性缺失，不自动重试，仍交给用户确认 revise/regenerate。
- 文件：`server/runtime/evaluator.ts`、`server/runtime/evaluator.test.ts`、`agent-os-plan.md`、`process.md`。
- 验证：`pnpm test server/runtime/evaluator.test.ts server/runtime/runtime.test.ts`、`pnpm exec tsc -p tsconfig.node.json --noEmit` 通过。
- 备注：document writing 和 code modification 的 executor 还未接入，属于后续非图片工具扩展。

### 完成 1.6 复杂落地页 Planner

- 变更：Tool Registry 新增 `web.read`、`asset.analyzeContext`、`html.generate` 三个真实工具；`web.read` 会读取用户提供的 URL 并生成网页 source artifact，`asset.analyzeContext` 汇总已选图片/产物上下文，`html.generate` 生成 HTML webpage artifact。
- 变更：Intent Router 对“根据网页和图片生成落地页并放到画布里”改为可执行 `multi_step.landing_page`，required tools 为 `web.read`、`asset.analyzeContext`、`html.generate`、`canvas.createNode`，不再 route_missing。
- 变更：Planner deterministic fixture 支持复杂落地页 DAG：reasoning -> web read / asset analysis -> page artifact generation -> canvas node creation -> evaluation；planner validation 会通过真实 registry 校验。
- 变更：`canvas.createNode` 增加 `prepareInput`，可从前序非图片 artifact 生成节点 proposal；artifact event 的 `canvasNodeId` 改为按 artifact type 生成，避免 webpage/doc/code 被写成 `image-*`。
- 文件：`server/runtime/tools/web-page-tools.ts`、`server/runtime/tools/ids.ts`、`server/runtime/tool-registry.ts`、`server/runtime/intent-router.ts`、`server/runtime/planner.ts`、`server/runtime/executor.ts`、`server/runtime/runtime.test.ts`、`agent-os-plan.md`、`process.md`。
- 验证：`pnpm test server/runtime/runtime.test.ts` 通过。
- 备注：document writing、code modification executor 和 UI/page evaluator 专项检查仍是后续项。

### 打通实时 Runtime Event Projection

- 变更：`RuntimeEventWriter.writeEvent` 现在在写入数据库事件后，同步向 AI SDK UI stream 写出 `data-runtime-event` data part，实时流不再只能依赖 tool input/output chunk。
- 变更：`runtime-event-renderer` 新增 `runtimeEventsFromMessageParts` / `runtimeEventsFromMessages`，前端会从 AI SDK message parts 中提取 runtime events、按 run 过滤和时间排序，再调用 `projectRuntimeEventsToCanvas`。
- 变更：`CanvasWorkspace` 的实时 message effect 现在只使用 runtime event projection 合并节点/边；旧 AI SDK tool part 兼容路径会先在 `runtime-event-renderer` 中转换为 runtime events，再进入同一个 projection。历史 trace replay 和项目刷新恢复继续使用同一个 projection 入口。
- 变更：移除 `CanvasWorkspace` 对 Run 节点 `status/toolParts/artifacts/agentText` 的手工业务拼装，Run 节点实时状态改由 `run.created`、`tool.*`、`artifact.created`、`evaluation.completed`、`run.completed/run.failed` 等事件投影得到。
- 文件：`server/runtime/events.ts`、`src/lib/runtime-event-renderer.ts`、`src/lib/runtime-event-renderer.test.ts`、`src/components/CanvasWorkspace.tsx`、`agent-os-plan.md`、`process.md`。
- 验证：`pnpm test src/lib/runtime-event-renderer.test.ts src/lib/graph-projection.test.ts server/runtime/runtime.test.ts`、`pnpm exec tsc -p tsconfig.node.json --noEmit`、`pnpm exec tsc -p tsconfig.app.json --noEmit` 通过。
- 备注：网络级 `useChat.onError` 仍会本地标记当前 Run 错误，避免请求未进入 runtime 时画布无反馈。

### 推进 2.1/2.2 刷新后 Runtime Event 重建

- 变更：`CanvasWorkspace` 加载项目时，如果项目存在 `lastRunId`，会调用 `/api/projects/:projectId/runs/:runNodeId/trace` 拉取数据库 runtime events，并通过 `projectRuntimeEventsToCanvas` 合并现有项目快照，恢复最新 Run 链；trace 拉取失败时保留项目快照，不阻塞项目打开。
- 变更：Trace replay 也改为调用 `projectRuntimeEventsToCanvas`，而不是直接使用底层 `projectRunTraceToCanvas`，让刷新恢复和 replay 共用同一个 runtime-event renderer wrapper。
- 文件：`src/components/CanvasWorkspace.tsx`、`agent-os-plan.md`、`process.md`。
- 验证：`pnpm exec tsc -p tsconfig.app.json --noEmit`、`pnpm lint` 通过。
- 备注：实时流仍有 AI SDK tool part 兼容投影路径，尚未完全迁移为 runtime events 驱动，因此 2.1/2.2 总项仍未标记完成。

### 补齐 1.7 Approval Denial 执行语义

- 变更：`AgentInput` 新增 `approvalResponses`，`normalizeAgentInput` 从 AI SDK UI message tool part 的 `approval` 对象中提取 approved/reason，作为 runtime 输入的一等字段。
- 变更：generic executor 的 approval step 现在会按 `approval-${runNodeId}-${stepId}` 匹配响应；未响应时写 `approval.requested` 并暂停，批准时写 `approval.responded` 并继续执行后续 step，拒绝时写 `approval.responded`、记录 `PERMISSION_DENIED`，并将后续 plan step 标记为 `skipped`。
- 变更：补充 input normalizer 与 executor 测试，覆盖 approval response 提取、approval accepted 继续、approval denied 不继续。
- 文件：`src/types/runtime.ts`、`server/runtime/schemas.ts`、`server/runtime/input-normalizer.ts`、`server/runtime/executor.ts`、`server/runtime/input-normalizer.test.ts`、`server/runtime/executor.test.ts`、`server/runtime/evaluator.test.ts`、`agent-os-plan.md`、`process.md`。
- 验证：`pnpm test server/runtime/executor.test.ts server/runtime/input-normalizer.test.ts server/runtime/evaluator.test.ts server/runtime/runtime.test.ts`、`pnpm exec tsc -p tsconfig.node.json --noEmit`、`pnpm exec tsc -p tsconfig.app.json --noEmit` 通过。

### 完成 2.4 Composer 附件与引用提示

- 变更：Composer 内新增本地附件条，使用 `usePromptInputAttachments` 展示待提交附件 chip，并提供移除按钮；footer 增加附件图标按钮触发文件选择，paste/drop 附件仍会进入同一 PromptInput attachment controller。
- 变更：Composer 单选可引用节点时显示引用摘要和当前 upstream context count；多选时明确提示“仅单个节点会作为引用 / 多选不会进入上下文”，避免用户误以为多选都会提交。
- 变更：Composer 提交仍先用 `createRunDraft` 创建 Prompt Node 和 queued Run Node，再把 `projectId`、`promptNodeId`、`runNodeId`、`selectedNodeId`、`upstreamContext`、`attachments` metadata 发送到 `/api/agent-run`；prompt 中的 `http/https` 链接会用 `URL` 解析后作为 `InputAttachment(kind: "webpage")` 一并提交。
- 文件：`src/components/CanvasWorkspace.tsx`、`src/App.css`、`agent-os-plan.md`、`process.md`。
- 验证：`pnpm exec tsc -p tsconfig.app.json --noEmit`、`pnpm lint` 通过。

### 标记 Part 2 已满足的 Done Criteria

- 变更：基于 Run 节点拆分、Composer 附件/引用提示、Trace/Replay/Policy/Evaluation 已有实现，以及本轮桌面和移动首屏 smoke，标记 Part 2 中 AI Elements/本地等价组件、当前图片/follow-up 不回退、视觉检查三项完成。
- 文件：`agent-os-plan.md`、`process.md`。
- 验证：桌面 `1440x900` 与移动 `390x844` Playwright smoke 打开 `http://localhost:5173/`，登录首屏非空，无 pageerror；受当前未登录状态限制，未在浏览器中直接验证 Run 节点展开态。
- 备注：`ReactFlow 画布由 Runtime events 驱动，实时和 replay 共用 projection` 仍未标记完成，当前实时流仍保留兼容投影路径。

### 完成 2.3 Run Node UI 拆分

- 变更：从 `CanvasWorkspace.tsx` 拆出 `src/components/RunNodeView.tsx`，包含 `RunNodeView`、`PlanSummaryView`、`StepTimelineView`、`ToolPartView` 和 Run 节点相关纯 helper；`CanvasWorkspace` 只保留 nodeTypes wiring。
- 变更：对照 `design.md` 保持现有浅暖灰/淡黄绿色 Run 节点视觉，不新增视觉语言；Run Trace、展开、审批、质量修正按钮继续用图标/短文案和原 className。
- 变更：`App.css` 为 Run 节点展开内容增加最大高度和滚动，agent 文本、evaluation 建议、tool detail 行做 2-3 行截断，避免长 prompt/tool output/error 撑破节点。
- 文件：`src/components/CanvasWorkspace.tsx`、`src/components/RunNodeView.tsx`、`src/App.css`、`agent-os-plan.md`、`process.md`。
- 验证：`pnpm exec tsc -p tsconfig.app.json --noEmit`、`pnpm lint` 通过。

### 推进 Runtime Event Protocol 共享类型

- 变更：`src/types/runtime.ts` 新增 `runtimeEventTypes` 作为 runtime event type 的单一来源，`server/runtime/schemas.ts` 的 Zod enum 改为复用该列表，`src/lib/graph-projection.ts` 的 `RunStepTraceEvent` 改为直接别名 `RuntimeEvent`。
- 变更：补充 runtime core 测试，遍历 `runtimeEventTypes` 确认 schema 能 parse 每个事件类型；`runtime-event-renderer.ts` 不再需要把 `RuntimeEvent[]` 强转为本地重复类型。
- 变更：`agent-os-plan.md` 标记 2.1 的共享 event schema 和 2.2 的基础 renderer/reducer 项完成；`CanvasWorkspace` 手工 run-node 拼装和实时/历史完全共用 projection 仍保留为未完成项。
- 文件：`src/types/runtime.ts`、`server/runtime/schemas.ts`、`src/lib/graph-projection.ts`、`src/lib/runtime-event-renderer.ts`、`server/runtime/runtime.test.ts`、`agent-os-plan.md`、`process.md`。
- 验证：`pnpm test server/runtime/runtime.test.ts src/lib/runtime-event-renderer.test.ts src/lib/graph-projection.test.ts`、`pnpm exec tsc -p tsconfig.node.json --noEmit`、`pnpm exec tsc -p tsconfig.app.json --noEmit`、`pnpm lint` 通过。

### 标记 Runtime Part 1 Done Criteria

- 变更：基于当前主入口 `/api/agent-run -> executeAgentRun`、runtime persistence/event trace、结构化 intent/context/plan/step、Tool Registry 和本轮最小验证，标记 `agent-os-plan.md` 的 Part 1 Done Criteria 完成。
- 文件：`agent-os-plan.md`、`process.md`。
- 验证：沿用本轮已通过的 runtime/run-kernel 测试、node/app typecheck 与 lint。
- 备注：复杂网页落地页 planner、approval 拒绝恢复、文档/代码/UI evaluator 专项检查仍作为各自章节的后续能力保留，不在 Part 1 Done Criteria 中伪装完成。

### 收敛 Legacy Image Run Adapter

- 变更：`server/run-kernel.ts` 中旧图片专用 orchestration 不再以 `executeImageAgentRun` 名义导出，改为 `executeLegacyImageAgentRunForTests`，并标记 deprecated；`/api/agent-run` 主路径继续只使用 `server/runtime/executor.ts` 的 generic runtime。
- 变更：`agent-os-plan.md` 标记 Legacy image run adapter cleanup 完成，`README.md` 说明旧 run-kernel 仅保留 compatibility contract / test fixture。
- 文件：`server/run-kernel.ts`、`README.md`、`agent-os-plan.md`、`process.md`。
- 验证：`pnpm test server/run-kernel.test.ts server/runtime/runtime.test.ts server/runtime/executor.test.ts server/runtime/evaluator.test.ts server/runtime/canvas-operation-policy.test.ts server/runtime/retry.test.ts`、`pnpm exec tsc -p tsconfig.node.json --noEmit`、`pnpm exec tsc -p tsconfig.app.json --noEmit`、`pnpm lint` 通过。

### 补强 Runtime 1.8 Evaluator 质量失败语义

- 变更：补充 evaluator/store 测试，确认质量检查失败会写入 `AgentRun.evaluation` 并把 run 状态置为 `failed`，但不会追加系统级 `AgentError`；retry/regenerate 只作为 `recommendedActions` 暴露，仍需要用户确认后重新提交。
- 文件：`server/runtime/evaluator.test.ts`、`agent-os-plan.md`、`process.md`。
- 验证：`pnpm test server/runtime/evaluator.test.ts` 通过。
- 备注：文档/代码/UI task 的专项 evaluator 检查仍未标记完成，需等待对应 executor tools 和 artifact/canvas 类型接入。

### 推进 Runtime 1.7 Generic Executor DAG 控制

- 变更：新增 `executePlanSteps`，按 `PlanStep.dependsOn` 排序执行，依赖未成功的 step 会标记 `skipped`，approval step 会暂停 plan 并保持 run 为 `waiting_approval`。
- 变更：`runStep` 的 `canvas` kind 不再被当成 skipped，而是通过 Tool Registry 执行 canvas proposal tool，返回的 `CanvasOperation` 继续走 reducer/policy 校验后写入 trace。
- 变更：fatal step error 会终止当前 plan 执行，并把后续 step 标记为 `skipped`；补充 approval pause、fatal skip、canvas step proposal 的 executor 测试。
- 文件：`server/runtime/executor.ts`、`server/runtime/executor.test.ts`、`agent-os-plan.md`、`process.md`。
- 验证：`pnpm test server/runtime/executor.test.ts`、`pnpm test server/runtime/runtime.test.ts server/runtime/executor.test.ts server/runtime/canvas-operation-policy.test.ts server/runtime/retry.test.ts`、`pnpm exec tsc -p tsconfig.node.json --noEmit`、`pnpm exec tsc -p tsconfig.app.json --noEmit`、`pnpm lint` 通过。
- 备注：`executeImageAgentRun` 的 legacy 收敛/删除仍未完成，继续留在计划清单中。

### 推进 Runtime 1.6 LLM Planner 验证

- 变更：`validatePlanAgainstRegistry` 增加工具输入 schema 校验，显式输入不匹配会拒绝；没有 `prepareInput` 且空对象不能通过 schema 的工具 step 会被判为缺少必需输入。
- 变更：planner validation 增加 canvas operation 授权检查，`createNode`、`createEdge`、`updateNode`、`setNodeStatus`、`attachArtifact` 必须能由当前 context 暴露的 producer tool 产生；canvas step 不能引用没有项目修改权限的工具。
- 变更：补充 planner fixture 测试，覆盖简单图片 plan 的 `attachArtifact` 预期 canvas operation，以及未知工具、循环依赖、缺必需输入、越权 canvas operation 拒绝。
- 文件：`server/runtime/planner.ts`、`server/runtime/runtime.test.ts`、`README.md`、`agent-os-plan.md`、`process.md`。
- 验证：`pnpm test server/runtime/runtime.test.ts`、`pnpm exec tsc -p tsconfig.node.json --noEmit`、`pnpm exec tsc -p tsconfig.app.json --noEmit`、`pnpm lint` 通过。
- 备注：`1.6` 的复杂网页落地页完整 plan 仍未标记完成；当前 registry 尚未提供 web read/analyze、UI generation、artifact/page creation 等真实工具，planner 不应伪造未注册工具链。

### 完成 Runtime 1.3 Intent Router 验收

- 变更：`routeIntentDeterministically` 增加 multi-step unsupported route，`根据网页和图片生成落地页并放到画布里` 会输出 `task.kind: "multi_step"`，包含 web search、image analysis、page generation 和 canvas node operation，而不是单一路由到 image 或 web。
- 变更：新增 canvas operation deterministic route，画布/节点类请求输出 `canvas_operation` 并要求 `canvas.createNode` proposal tool。
- 变更：补齐常见 intent schema fixtures：image_generation、image_editing、page_generation、document_writing、web_research、file_analysis、code_modification、canvas_operation、multi_step。
- 文件：`server/runtime/intent-router.ts`、`server/runtime/runtime.test.ts`、`agent-os-plan.md`、`process.md`。
- 验证：`pnpm test server/runtime/runtime.test.ts server/agent-router.test.ts`、`pnpm exec tsc -p tsconfig.node.json --noEmit`、`pnpm exec tsc -p tsconfig.app.json --noEmit`、`pnpm lint` 通过。

### 完成 Runtime 1.4 Context Builder PromptParts 迁移

- 变更：`image-tools.ts` 的 reference-image analysis 和 prompt expansion 不再调用旧 prompt assembly 重新拼 upstream context；两者都基于 `ToolExecutionContext.context.promptParts` 渲染 prompt，并叠加工具自己的 reference image / skill section。
- 变更：`server/prompts.ts` 新增 `renderRuntimePromptAssembly` 纯渲染 helper；Context Builder 成为新 runtime 的 intent、user message、selected/omitted context、allowed tools、injected skills prompt parts 来源。
- 变更：补充测试覆盖图片工具 promptTrace 包含 `runtime.selected-context`，复杂 route-missing task 不暴露全部工具。
- 文件：`server/runtime/tools/image-tools.ts`、`server/prompts.ts`、`server/runtime/runtime.test.ts`、`README.md`、`agent-os-plan.md`、`process.md`。
- 验证：`pnpm test server/runtime/runtime.test.ts src/components/RunTracePanel.test.tsx server/prompts.test.ts`、`pnpm exec tsc -p tsconfig.node.json --noEmit`、`pnpm exec tsc -p tsconfig.app.json --noEmit`、`pnpm lint` 通过。

### 推进 Runtime 1.4 PromptParts 消费链路

- 变更：Context Builder 抽出 runtime prompt parts 组装，包含 intent、user message、selected context、omitted context、allowed tools 和 injected skills。
- 变更：Planner prompt 现在携带 `context.promptParts`；Run reasoning step 不再重新从 canvasContext 拼 upstream prompt，而是渲染 `BuiltContext.promptParts`。
- 文件：`server/runtime/context-builder.ts`、`server/runtime/planner.ts`、`server/runtime/executor.ts`、`server/prompts.ts`、`server/runtime/runtime.test.ts`、`README.md`、`agent-os-plan.md`、`process.md`。
- 验证：`pnpm test server/runtime/runtime.test.ts src/components/RunTracePanel.test.tsx server/prompts.test.ts`、`pnpm exec tsc -p tsconfig.node.json --noEmit`、`pnpm exec tsc -p tsconfig.app.json --noEmit`、`pnpm lint` 通过。
- 备注：`server/prompts.ts` 仍保留 legacy run-kernel 与 image-tool prompt assembly helper，1.4 对应清单暂不整体标记完成。

### 推进 Runtime 1.4 Context Builder 来源覆盖

- 变更：`buildContext` 不再只处理 upstream graph；新增 attachment、conversation history summary 和 project refs 作为 ContextItem 参与 selection/ranking/budget，并写入 promptParts、selected/omitted trace。
- 变更：补充测试证明选中图片 context 不会被预算裁剪，低优先级大文档会进入 omitted，附件、历史摘要和 project refs 能进入 selected context，工具暴露仍来自 intent allowlist。
- 文件：`server/runtime/context-builder.ts`、`server/runtime/runtime.test.ts`、`agent-os-plan.md`、`process.md`。
- 验证：`pnpm test server/runtime/runtime.test.ts src/components/RunTracePanel.test.tsx`、`pnpm exec tsc -p tsconfig.node.json --noEmit`、`pnpm exec tsc -p tsconfig.app.json --noEmit`、`pnpm lint` 通过。
- 备注：`PromptPart` 彻底从 `server/prompts.ts` 迁到 Context Builder，以及复杂非图片工具的精确暴露仍未完成。

### 补齐 Runtime 1.5 Tool Registry 验收

- 变更：新增 `server/runtime/tools/` 领域目录，图片工具迁到 `image-tools.ts`，canvas proposal tools 迁到 `canvas-tools.ts`，共享 tool ids/version 迁到 `ids.ts`；`tool-registry.ts` 保持注册、摘要、allowlist 和 trace metadata 职责。
- 变更：`ToolRegistry.requireTool` 对未注册工具返回 typed `AgentError` code `TOOL_NOT_REGISTERED`；executor 测试覆盖未注册工具、schema 错误和权限拒绝，retry 测试覆盖 tool timeout。
- 文件：`server/runtime/tool-registry.ts`、`server/runtime/tools/image-tools.ts`、`server/runtime/tools/canvas-tools.ts`、`server/runtime/tools/ids.ts`、`server/runtime/errors.ts`、`server/runtime/executor.test.ts`、`README.md`、`agent-os-plan.md`、`process.md`。
- 验证：`pnpm test server/runtime/runtime.test.ts server/runtime/executor.test.ts server/runtime/canvas-operation-policy.test.ts server/runtime/retry.test.ts`、`pnpm exec tsc -p tsconfig.node.json --noEmit`、`pnpm exec tsc -p tsconfig.app.json --noEmit`、`pnpm lint` 通过。

### 补齐 Runtime 1.2 Input Layer 验收

- 变更：`CanvasWorkspace` 将 PromptInput pasted/dropped files 转成 `AgentInput.attachments` metadata 发送给 `/api/agent-run`；data URL 只记录 `contentRef` 和短 preview summary，不直接进入 prompt。
- 变更：`normalizeAgentInput` 写入 project refs，并基于 user-owned project snapshot 校验 selected node、upstream context node 和 artifact id，伪造上下文会返回 typed `AgentError`，不进入 planner。
- 文件：`src/components/CanvasWorkspace.tsx`、`server/api.ts`、`server/runtime/executor.ts`、`server/runtime/input-normalizer.ts`、`server/runtime/input-normalizer.test.ts`、`README.md`、`agent-os-plan.md`、`process.md`。
- 验证：`pnpm test server/runtime/input-normalizer.test.ts server/runtime/runtime.test.ts src/lib/graph.test.ts`、`pnpm exec tsc -p tsconfig.node.json --noEmit`、`pnpm exec tsc -p tsconfig.app.json --noEmit`、`pnpm lint` 通过。

### 补齐 Runtime 1.1 Legacy Adapter 验收

- 变更：`server/run-kernel.ts` 新增 `adaptKernelRunToAgentRun`，将旧 kernel `Run` 只读适配为一等 `AgentRun`，保留 `promptNodeId`、`runNodeId`、tool call、artifact refs、canvas patch proposal 和 error text。
- 变更：补充 `success/error` 与 `completed/failed` 的双向状态映射测试，以及 legacy adapter 结果通过 `agentRunSchema` parse 的单元测试。
- 文件：`server/run-kernel.ts`、`server/run-kernel.test.ts`、`README.md`、`agent-os-plan.md`、`process.md`。
- 验证：`pnpm test server/run-kernel.test.ts server/runtime/runtime.test.ts`、`pnpm test server/run-kernel.test.ts server/runtime/runtime.test.ts server/runtime/executor.test.ts`、`pnpm test src/lib/graph-projection.test.ts src/lib/runtime-event-renderer.test.ts`、`pnpm exec tsc -p tsconfig.node.json --noEmit`、`pnpm exec tsc -p tsconfig.app.json --noEmit` 通过。

### Unsupported Intent 不再静默走图片链路

- 变更：`routeIntentDeterministically` 对文档写作、网页调研、页面生成、代码修改、文件分析等未注册执行器的请求返回 `primaryIntent: "capability.route_missing"`，并带 `requiredCapabilities` 与 high-severity ambiguity。
- 变更：`validateIntentAgainstRegistry` 允许 route-missing intent 携带尚未注册的 required capability；planner 会生成 `clarify_or_stop` approval step，而不是继续进入图片生成计划。
- 文件：`server/runtime/intent-router.ts`、`server/runtime/runtime.test.ts`、`README.md`、`agent-os-plan.md`、`process.md`。
- 验证：`pnpm exec tsc -p tsconfig.node.json --noEmit`、`pnpm test -- server/runtime/runtime.test.ts` 通过。
- 备注：复杂落地页的完整 multi-step plan 仍未实现；当前只是明确缺少 `html.generate` executor，避免误走图片链路。

### Run 节点补齐用户级 Runtime 摘要

- 变更：`projectRunTraceToCanvas` 从 `intent.routed`、`context.built`、`plan.created`、`artifact.created` 提取短摘要，写入 `RunNodeData.summaryItems`。
- 变更：Run 节点展开区显示意图、上下文、计划和产物摘要；默认画布继续隐藏 raw id、toolCallId、完整 plan/prompt，完整审计仍在 Trace Panel。
- 文件：`src/types/canvas.ts`、`src/lib/graph-projection.ts`、`src/lib/graph-projection.test.ts`、`src/components/CanvasWorkspace.tsx`、`src/App.css`、`README.md`、`agent-os-plan.md`、`process.md`。
- 验证：`pnpm exec tsc -p tsconfig.app.json --noEmit`、`pnpm test -- src/lib/graph-projection.test.ts src/components/RunTracePanel.test.tsx`、`pnpm lint`、`pnpm build` 通过；Playwright 最小夹具验证长 plan 摘要在 240px Run 节点内省略且不溢出，截图 `/tmp/cucumber-run-summary-items.png`。
- 备注：`RunNodeView` / `PlanSummaryView` / `StepTimelineView` / `ToolPartView` 组件拆分尚未做；当前先保持在 `CanvasWorkspace.tsx` 内，避免扩大改动面。

### Run 节点显示 Evaluator 摘要

- 变更：`projectRunTraceToCanvas` 从最新 `evaluation.completed` event 提取用户级 summary，并写入 `RunNodeData.evaluation`。
- 变更：Run 节点展开区显示质量检查通过/失败、issue 数量和第一条 recommended action；完整 evaluator detail 仍保留在 Trace Panel。
- 变更：失败 evaluator 显示“准备重试/准备修正”操作；点击后只会选择旧产物或旧 prompt 作为引用并把建议填入 composer，用户再次提交才创建新的 follow-up branch，不覆盖旧 artifact。
- 变更：质量失败的 Run 标题显示“质量检查未通过”，不再伪装成工具生成失败；工具错误仍由 Tool row 显示。
- 变更：Evaluator 新增 typed quality issue：图片数量不足、artifact 缺失、image URL 缺失、canvas operation rejected；artifact 失败建议保留上下文重试，canvas operation rejected 建议先查 Trace。
- 文件：`server/runtime/evaluator.ts`、`server/runtime/evaluator.test.ts`、`src/types/canvas.ts`、`src/lib/graph.ts`、`src/lib/graph.test.ts`、`src/lib/graph-projection.ts`、`src/lib/graph-projection.test.ts`、`src/components/CanvasWorkspace.tsx`、`src/App.css`、`README.md`、`agent-os-plan.md`、`process.md`。
- 验证：`pnpm exec tsc -p tsconfig.node.json --noEmit`、`pnpm exec tsc -p tsconfig.app.json --noEmit`、`pnpm test -- server/runtime/evaluator.test.ts server/runtime/executor.test.ts server/runtime/runtime.test.ts`、`pnpm test -- src/lib/graph.test.ts src/lib/graph-projection.test.ts`、`pnpm lint`、`pnpm build` 通过；Browser 打开现有 `http://localhost:5173/` 项目页正常渲染；另用真实 `App.css` 的 Playwright 最小夹具验证 evaluator 摘要、标题和准备重试按钮无横向溢出，截图 `/tmp/cucumber-run-evaluation-revision.png`。
- 备注：Run 节点的 intent、context、plan、artifact 用户级摘要仍在 `agent-os-plan.md` 后续项中。

### 补齐 Canvas Operation Policy 闭环

- 变更：新增 `server/runtime/canvas-operation-policy.ts`，服务端在写 `canvas.operation.applied` 前校验 project id、node kind、edge endpoint、target-node permission、同批 createNode、produced artifact ownership 和 duplicate operation。
- 变更：executor 不再把 tool 返回的 canvas operation 全部直接 applied；通过 policy 的 operation 才写 `canvas.operation.applied` / `graph.patch.applied` 并进入 run snapshot，被拒绝的 operation 写 `canvas.operation.rejected` 和 `CANVAS_PATCH_REJECTED` run error。
- 变更：Tool Registry 新增 `canvas.createNode`、`canvas.updateNode`、`canvas.createEdge` proposal tools，并与 `canvas.attachArtifact` 一起具备 tool policy、timeout、risk 和 `canvas_operation` render hint。
- 文件：`server/runtime/canvas-operation-policy.ts`、`server/runtime/canvas-operation-policy.test.ts`、`server/runtime/executor.ts`、`server/runtime/executor.test.ts`、`server/runtime/tool-registry.ts`、`server/runtime/runtime.test.ts`、`src/types/runtime.ts`、`README.md`、`agent-os-plan.md`、`process.md`。
- 验证：`pnpm exec tsc -p tsconfig.node.json --noEmit`、`pnpm test -- server/runtime/canvas-operation-policy.test.ts server/runtime/executor.test.ts server/runtime/runtime.test.ts src/lib/runtime-event-renderer.test.ts src/lib/graph-projection.test.ts` 通过。
- 备注：当前图片默认链路仍只使用 `canvas.attachArtifact`；新增 canvas tools 只有在 router/planner 暴露对应 toolId 时才会进入计划。

### 补充 Tool Trace Schema Digest

- 变更：`ToolDefinition` 和 `ToolSummary` 增加 `version`，Tool Registry 统一生成 `toolDefinitionVersion`、input/output schema digest、risk 和 render kind trace metadata。
- 变更：`tool.input`、`tool.output`、`tool.error` 和 `retry.attempt` event payload 都会写入 tool trace metadata；`tool.output` / `tool.error` 额外记录 duration 和 logs，便于 Trace 面板审计具体工具定义版本、schema 和执行结果。
- 文件：`src/types/runtime.ts`、`server/runtime/tool-registry.ts`、`server/runtime/events.ts`、`server/runtime/executor.ts`、`server/runtime/schemas.ts`、`server/runtime/runtime.test.ts`、`src/components/RunTracePanel.test.tsx`、`README.md`、`agent-os-plan.md`、`process.md`。
- 验证：`pnpm exec tsc -p tsconfig.node.json --noEmit`、`pnpm test -- server/runtime/runtime.test.ts server/runtime/retry.test.ts` 通过。
- 备注：context selected reason 和 skill injection detail 仍未完整展示，继续保留在 Trace UI 后续项中。

### 细化 Run Trace 面板分区

- 变更：`RunTracePanel` 从单纯事件列表扩展为按 runtime 语义分区展示 run snapshot、intent、context、plan、step timeline、prompt parts、capabilities、tool IO、retry、artifacts、canvas operations、evaluation、errors 和 graph patches；Context 区会显示 selected/omitted reason、token estimate、tool exposure reason 和 skill injection reason，Plan 区会显示 raw plan、normalized plan 和 validation detail。
- 变更：新增 `summarizeRunTrace` 纯摘要测试，覆盖 intent/context/plan validation/retry/canvas operation/evaluation 的前端提取逻辑。
- 文件：`src/components/RunTracePanel.tsx`、`src/components/run-trace-summary.ts`、`src/components/RunTracePanel.test.tsx`、`README.md`、`agent-os-plan.md`、`process.md`。
- 验证：`pnpm exec tsc -p tsconfig.node.json --noEmit`、`pnpm exec tsc -p tsconfig.app.json --noEmit`、`pnpm test -- server/runtime/retry.test.ts server/model-providers.test.ts server/runtime/runtime.test.ts server/agent-router.test.ts server/capabilities.test.ts src/components/RunTracePanel.test.tsx src/lib/runtime-event-renderer.test.ts src/lib/graph-projection.test.ts`、`pnpm lint`、`pnpm build` 通过。
- 备注：tool schema digest、tool duration/logs、context selected reason 和 skill injection detail 仍未完整展示，继续保留在 `agent-os-plan.md` 的未完成项。

### 补齐 Tool Retry 与 Timeout 执行层

- 变更：新增 `server/runtime/retry.ts`，工具执行通过 `runWithRetry` 包装，支持 timeout、max retries、backoff、retryable filter，并把重试写成 `retry.attempt` runtime event。
- 变更：`runStep` 在执行 tool 后校验 tool output schema；tool timeout 会转成 `TOOL_TIMEOUT`，retryable error 才会重试。
- 变更：扩展 runtime event 类型、前端 trace event union、RunTracePanel label 和 Supabase event check constraint，确保 Trace 能看到 retry attempt。
- 文件：`server/runtime/retry.ts`、`server/runtime/retry.test.ts`、`server/runtime/executor.ts`、`src/types/runtime.ts`、`server/runtime/schemas.ts`、`server/run-kernel.ts`、`src/lib/graph-projection.ts`、`src/components/RunTracePanel.tsx`、`supabase/migrations/20260608005000_agent_runtime_core.sql`、`agent-os-plan.md`、`process.md`。
- 验证：`pnpm exec tsc -p tsconfig.node.json --noEmit`、`pnpm test -- server/runtime/retry.test.ts server/runtime/runtime.test.ts` 通过。

### 接入 LLM Structured Router 与 Planner

- 变更：新增 `generateStructuredObjectWithProvider`，DeepSeek 路径使用 AI SDK `Output.object({ schema })`，Ark 路径使用 JSON prompt 后继续通过 Zod schema parse；模型输出不符合 schema 时直接抛错。
- 变更：`server/runtime/intent-router.ts` 的 `routeIntent` 改为 LLM structured output 主路径，prompt 只包含 normalized input、capability/tool allowlist、选中节点摘要和安全策略；deterministic router 仅保留为测试 fixture。
- 变更：`server/runtime/planner.ts` 的 `createPlan` 改为 LLM structured output 主路径，prompt 注入 `IntentResult`、`BuiltContext` 和 allowed tool summaries，继续通过 `normalizePlan` 与 `validatePlanAgainstRegistry` 做确定性 gate。
- 文件：`server/model-providers.ts`、`server/model-providers.test.ts`、`server/runtime/intent-router.ts`、`server/runtime/planner.ts`、`server/runtime/executor.ts`、`server/runtime/runtime.test.ts`、`README.md`、`agent-os-plan.md`、`process.md`。
- 验证：`pnpm exec tsc -p tsconfig.node.json --noEmit`、`pnpm test -- server/model-providers.test.ts server/runtime/runtime.test.ts server/agent-router.test.ts server/capabilities.test.ts` 通过。
- 备注：当前仍未完成 tool timeout 执行控制、复杂非图片 executor、完整 canvas operation policy validation 和更细 Trace UI 分区。

### 开发 Agent Runtime Core 第一版

- 变更：将 `/api/agent-run` 主入口切到 `server/runtime/executor.ts`，新增一等 `AgentRun` runtime core：input normalizer、structured intent router、context builder、tool registry、schema-validated planner、generic `runStep` executor、runtime event writer、run store 和 evaluator。
- 变更：当前图片链路通过 Tool Registry 执行 `vision.analyzeReferenceImages`、`prompt.expand`、`seedream.generateImage`、`canvas.attachArtifact`，继续向 AI SDK UI stream 写 `tool-input-available`、`tool-output-available`、`tool-output-error`，并写兼容的 `artifact.created` / `graph.patch.*` trace event。
- 变更：新增 `src/types/runtime.ts`、`server/runtime/schemas.ts` 和 `src/lib/runtime-event-renderer.ts`；新增 Supabase migration `20260608005000_agent_runtime_core.sql`，创建 `agent_runs` / `agent_run_steps` 并扩展 `agent_run_step_events` 事件类型约束。
- 文件：`server/api.ts`、`server/runtime/*`、`src/types/runtime.ts`、`src/lib/runtime-event-renderer.ts`、`src/lib/graph-projection.ts`、`src/components/RunTracePanel.tsx`、`server/supabase.ts`、`server/run-kernel.ts`、`supabase/migrations/20260608005000_agent_runtime_core.sql`、`server/runtime/runtime.test.ts`、`src/lib/runtime-event-renderer.test.ts`、`README.md`、`agent-os-plan.md`、`process.md`。
- 验证：`pnpm exec tsc -p tsconfig.node.json --noEmit`、`pnpm exec tsc -p tsconfig.app.json --noEmit`、`pnpm test -- server/runtime/runtime.test.ts server/agent-router.test.ts server/capabilities.test.ts server/run-kernel.test.ts src/lib/graph-projection.test.ts src/lib/runtime-event-renderer.test.ts` 通过。
- 备注：当前 planner/router 是 schema-validated deterministic adapter，还不是最终 LLM structured-output planner；非图片工具 executor、完整 Run node UI 拆分和更细 Trace 分区仍按 `agent-os-plan.md` 继续推进。

### 重写一等 Agent Runtime 开发文档

- 变更：将 `agent-os-plan.md` 从三阶段 MVP 演进记录重写为两部分完整开发手册：Part 1 聚焦一等 Runtime Core，覆盖 `AgentRun` 数据结构、Input Layer、结构化 Intent Router、Context Builder、完整 Tool Registry、LLM Planner、通用 `executor.runStep`、错误/重试/Evaluator；Part 2 聚焦 ReactFlow Event Renderer 和产品集成，覆盖 Runtime event protocol、画布投影、节点 taxonomy、AI Elements 映射、trace/replay、canvas operation policy 和评估修正流。
- 变更：补充 `https://elements.ai-sdk.dev/` 调研结论，明确 Canvas、Node、Edge、Plan、Task、Tool、Confirmation、Context、Attachments、Agent、Artifact、Schema Display 在本项目中的可用位置，同时约束 AI Elements 只是组件参考，不作为新的状态源。
- 文件：`agent-os-plan.md`、`process.md`。
- 验证：文档基于当前 `server/api.ts`、`server/run-kernel.ts`、`server/agent-router.ts`、`server/capabilities.ts`、`server/prompts.ts`、`src/lib/graph.ts`、`src/lib/graph-projection.ts`、`src/components/CanvasWorkspace.tsx` 的实际代码事实重写；本次只改文档，未运行代码测试。

### 增加画布拖拽上传预览

- 变更：支持将文件直接拖拽到画布，按现有节点类型生成可预览节点；图片生成 `imageResultNode` data URL 预览，Markdown 生成可滚动 `markdownNode`，代码/文档/网页/数据集/通用文件生成 artifact-backed 预览卡片。
- 变更：Markdown 预览新增局部 Error Boundary，渲染器或插件遇到异常内容时降级为纯文本预览，不让单个 `.md` 节点导致整个画布白屏。
- 变更：上传节点会写入当前项目节点列表、自动选中并进入现有保存流；单个上传图片或 artifact 选中后可作为 follow-up branch 引用。
- 文件：`src/lib/file-upload.ts`、`src/lib/file-upload.test.ts`、`src/components/MarkdownPreview.tsx`、`src/components/MarkdownPreview.test.tsx`、`src/components/useCanvasFileDrop.ts`、`src/components/CanvasWorkspace.tsx`、`src/components/FileUploadOverlay.tsx`、`src/App.css`、`README.md`、`design.md`。
- 验证：`pnpm test -- src/components/MarkdownPreview.test.tsx src/lib/file-upload.test.ts src/lib/graph.test.ts`、`pnpm exec tsc -p tsconfig.app.json`、`pnpm lint`、`pnpm build` 通过；`/api/health` 返回 ok；Playwright 直连本地页面拖入含异常 mermaid 的 `test.md`，画布未白屏并生成 1 个 Markdown 节点；拖入 `/Users/bytedance/Downloads/plan.md` 时命中 Vite `Outdated Optimize Dep` / Streamdown 高亮动态 import 失败路径，Error Boundary 接住异常并降级为纯文本预览，页面未白屏。
- 备注：当前上传预览存储在项目快照中，未新增独立对象存储；大文件只保留适合预览的文本片段，非图片二进制显示文件元数据卡片。本轮 Browser 打开 `http://localhost:5174/` 被插件 URL policy 阻断，视觉检查改用 Playwright 直连完成，截图保存到 `/tmp/cucumber-plan-md-upload.png`。

### 增加 Markdown 画布容器

- 变更：新增 `markdownNode`，当 Agent/tool 输出 `{ markdown }`、`documents[]` 或带 `format: "markdown"` / `mimeType: "text/markdown"` 的 `doc` artifact 时，自动投影成独立 Markdown 文档容器；容器复用 Streamdown 渲染，支持标题、列表、代码块和内部滚动。
- 变更：实时 Run 输出不再只处理 `generate_image`，所有 `output-available` tool part 都会进入 graph projection；文档型纯文本 Run 在没有工具输出时可按调研/分析/报告类 prompt 自动升格为 Markdown 容器。
- 文件：`src/types/canvas.ts`、`src/lib/graph.ts`、`src/lib/graph-projection.ts`、`src/components/CanvasWorkspace.tsx`、`src/App.css`、`src/lib/graph.test.ts`、`README.md`。
- 验证：`pnpm test -- src/lib/graph.test.ts`、`pnpm build` 通过；Browser 打开 `http://localhost:5174/`，在测试项目快照中渲染 `markdownNode`，确认标题、列表、代码块、内部滚动、选中态和 follow-up 引用文案可见且无 console error/warn。
- 备注：当前服务端 rule planner 仍只接入图片 executor；真正 research/analyze executor 接入后，只要返回上述 Markdown 输出契约即可落到该容器。

### 修复 Agent OS 三阶段审查遗漏

- 变更：补齐 high-risk capability approval UI，服务端在 `approval-requested` 时暂停，不再立即写 `output-denied`；前端 Run 节点显示确认/拒绝按钮，并通过 AI SDK `addToolApprovalResponse` 带原 run body 继续执行或拒绝。
- 变更：router 不再把已匹配的非图片 terminal capability 静默路由到 `image.generate`，未接入 executor 时返回明确 `capability.route_missing`；run trace 记录真实 `promptNodeId` 并写入 artifact attach graph patch proposed/applied 事件，便于 replay 和 trace 解释。
- 变更：默认画布中未接入的左侧工具按钮、背景/图层/文件/缩放按钮改为 disabled，避免看起来可点但没有行为。
- 文件：`server/run-kernel.ts`、`server/agent-router.ts`、`server/api.ts`、`server/prompts.ts`、`src/types/canvas.ts`、`src/lib/graph.ts`、`src/lib/graph.test.ts`、`src/lib/graph-projection.test.ts`、`src/components/CanvasWorkspace.tsx`、`src/App.css`、`agent-os-plan.md`。
- 验证：`pnpm test -- src/lib/graph.test.ts src/lib/graph-projection.test.ts server/run-kernel.test.ts server/agent-router.test.ts server/capabilities.test.ts`、`pnpm exec tsc -p tsconfig.app.json --noEmit`、`pnpm exec tsc -p tsconfig.node.json --noEmit`、`pnpm lint`、`pnpm build` 通过；Browser 打开 `http://localhost:5173/`，注册态项目列表和空画布非空、无 console error/warn，未接入工具按钮均为 disabled，Skills 面板可打开并加载公开 skill。

### 开发 Agent OS Part 3 Canvas OS、Memory 与 Replay

- 变更：新增 `src/lib/graph-projection.ts`，将 run step events、artifact refs 和 graph patch proposal 投影为 `AgentCanvasNode` / `AgentCanvasEdge`；patch reducer 校验重复节点、断边、非法 node kind、非 Run 状态修改和 project id mismatch。
- 变更：扩展画布节点 taxonomy，支持 Artifact、Decision、Memory、Tool Result、Document、Code、Webpage；Run 节点新增 step timeline 和 trace 按钮，详细 prompt parts、capability、tool IO、artifact refs、graph patches 移入高级 trace 面板。
- 变更：`collectUpstreamContext` 扩展为 artifact-aware context collector，保留图结构顺序，给选中节点、上游 artifact、run decision、memory 等 context item 设置优先级，并在预算裁剪时记录 `contextTrace`。
- 变更：新增 `GET /api/projects/:projectId/runs/:runNodeId/trace` 和 `listRunStepEventsForUser`，trace 面板支持读取历史 run events 并回放到只读画布状态；回放复用项目快照中的手动节点位置，不写回项目。
- 文件：`src/types/canvas.ts`、`src/lib/graph.ts`、`src/lib/graph-projection.ts`、`src/lib/graph-projection.test.ts`、`src/components/CanvasWorkspace.tsx`、`src/components/RunTracePanel.tsx`、`src/components/SkillPanel.tsx`、`src/App.css`、`src/lib/project-storage.ts`、`server/api.ts`、`server/supabase.ts`、`server/prompts.ts`、`server/run-kernel.ts`、`server/capabilities.test.ts`、`README.md`、`agent-os-plan.md`。
- 验证：`pnpm test -- src/lib/graph.test.ts src/lib/graph-projection.test.ts server/run-kernel.test.ts server/prompts.test.ts server/agent-router.test.ts server/capabilities.test.ts`、`pnpm exec tsc -p tsconfig.app.json --noEmit`、`pnpm exec tsc -p tsconfig.node.json --noEmit`、`pnpm lint`、`pnpm build`；Browser 打开 `http://localhost:5173/` 确认登录首屏非空、无 console error/warn，名称输入交互正常。
- 备注：Memory 节点只来自显式 artifact/event 投影，当前没有自动长期记忆写入；只读 replay 不触发真实外部工具。Browser 截图命令 `Page.captureScreenshot` 在本轮验证中超时，未取得截图证据。

### 开发 Agent OS Part 2 Capability、Artifact 与 Policy 基础

- 变更：新增 `server/capabilities.ts` 和 `server/agent-router.ts`，将旧 `prompt-expand` 兼容注册为 `prompt.expand` capability，并以内建 `image.generate` capability 驱动当前图片 run；router 输出 Zod 校验的 step graph，不直接输出 React Flow 节点。
- 变更：`server/skill-parser.ts` 支持从 `SKILL.md` frontmatter 或 `manifest.json` / `capability.json` 解析 capability manifest，manifest 写入 `source_manifest.capabilityManifest`，旧 skill 上传与编辑路径保持兼容。
- 变更：新增 `agent_artifacts` migration 和 `createArtifact`，`generate_image` 成功后先写 image artifact metadata，再返回兼容的 `images` 输出和新的 `artifacts` refs；画布 image result 节点和 upstream context 都保留 artifact ref。
- 变更：新增 capability policy 基础字段和执行前 policy gate；`image.generate` 标记为可联网且可能产生外部费用，`requiresApproval` 能写入官方 AI SDK `tool-approval-request` / `tool-output-denied` 状态并停止后续 step。默认图片能力不要求确认，因此未新增可交互审批按钮。
- 文件：`server/capabilities.ts`、`server/agent-router.ts`、`server/run-kernel.ts`、`server/skill-parser.ts`、`server/supabase.ts`、`src/types/canvas.ts`、`src/lib/graph.ts`、`src/components/CanvasWorkspace.tsx`、`supabase/migrations/20260608004000_agent_artifacts.sql`、`README.md`、`agent-os-plan.md`。
- 验证：`pnpm test -- server/skill-parser.test.ts server/capabilities.test.ts server/agent-router.test.ts server/run-kernel.test.ts src/lib/graph.test.ts`、`pnpm exec tsc -p tsconfig.node.json`、`pnpm exec tsc -p tsconfig.app.json`、`pnpm build`。
- 备注：完整前端审批按钮与自动 continuation 需要等真实高风险 capability 接入时结合 `useChat.addToolApprovalResponse` 补齐；当前基础状态已按 AI SDK 官方 approval chunk 命名实现。

### 开发 Agent OS Part 1 Run Kernel 与 Trace 基础

- 变更：新增 `server/run-kernel.ts`，定义 Run、Step、ToolCall、ArtifactRef、GraphPatchProposal 和 step event contract，并把 `/api/agent-run` 的图片生成链路迁移为 kernel steps：执行说明、参考图分析、prompt 扩写、图片生成。
- 变更：`server/prompts.ts` 引入 `PromptPart` / `PromptChunk` / prompt assembly trace，保持现有 prompt 文本等价，同时记录 `promptDigest`、选中 part、裁剪 part 和确定性低优先级裁剪原因。
- 变更：新增 `agent_run_step_events` migration 和 `recordRunStepEvent`，兼容保留 `agent_run_events`，并记录 `run.created`、`step.started`、`tool.input`、`tool.output`、`tool.error`、`artifact.created`、`run.completed`、`run.failed`。
- 文件：`server/run-kernel.ts`、`server/api.ts`、`server/prompts.ts`、`server/supabase.ts`、`supabase/migrations/20260608003000_agent_run_step_events.sql`、`server/run-kernel.test.ts`、`server/prompts.test.ts`、`README.md`、`agent-os-plan.md`。
- 验证：`pnpm test -- server/prompts.test.ts server/run-kernel.test.ts src/lib/graph.test.ts`、`pnpm exec tsc -p tsconfig.node.json`；安装 Supabase CLI 后通过 `supabase db query --linked --file supabase/migrations/20260608003000_agent_run_step_events.sql` 应用远端，并用 `supabase migration repair --linked --status applied 20260608003000` 对齐该版本历史。
- 备注：远端 migration history 仍保留旧的非本地版本 `20260606165634`、`20260606165716`、`20260607151830`；本次未擅自 repair 这些历史记录。`supabase db advisors --linked --type all --level info --fail-on none` 仅返回 unused index INFO。

### 新增 Agent OS 三阶段规划

- 变更：新增 `agent-os-plan.md`，将通用 Agent OS 目标拆成 Run Kernel 与 trace 基础、Capability/Artifact/Policy 层、Canvas OS/Memory/Replay 三部分。
- 文件：`agent-os-plan.md`、`process.md`。
- 验证：文档内容基于当前 `server/api.ts`、`server/prompts.ts`、`src/types/canvas.ts`、`src/lib/graph.ts`、`README.md` 和 Supabase 存储契约梳理；未运行代码测试。
- 备注：该文档是后续架构路线图，不改变当前图片生成链路；具体实现时仍需按最小相关测试集验证。

## 2026-06-07

### 新增 Ark Provider 与 Prompt 模块化

- 变更：新增 `server/model-providers.ts`，将 DeepSeek 与 Ark 作为可选文本 provider；Ark Responses API 同时负责上游图片的 `analyze_reference_images` 阶段。
- 变更：新增 `server/prompts.ts`，统一 `formatUpstreamContext`、结构化 section、prompt-expand 模式路由和相关 config 选择，避免继续在 `server/api.ts` 中拼大块 prompt。
- 变更：前端顶部新增全局 provider 选择，偏好写入 `localStorage` 的 `cucumber:model-provider`；Run 节点支持展示参考图分析、提示词扩写、生成图片三个工具阶段。
- 文件：`server/api.ts`、`server/model-providers.ts`、`server/prompts.ts`、`server/supabase.ts`、`src/components/CanvasWorkspace.tsx`、`src/lib/model-providers.ts`、`src/lib/graph.ts`、`src/types/canvas.ts`、`src/App.css`、`README.md`。
- 验证：`pnpm test -- server/prompts.test.ts server/model-providers.test.ts src/lib/graph.test.ts server/skill-parser.test.ts`、`pnpm lint`、`pnpm build`；用 Vite dev server + Playwright mock API 验证 provider 选择器可渲染并显示配置状态。
- 备注：`ARK_API_KEY` 只通过环境变量读取；已在 README 记录贴出过的 key 需要轮换。

### 新增公开 Skill 系统与默认 Prompt 扩写

- 变更：新增公开 `agent_skills` 数据模型和 `/api/skills` CRUD；上传 zip 时只解析 `SKILL.md` 和 `config/*.json`，不安装或执行 zip 内代码。
- 变更：`/api/agent-run` 默认使用最新公开 `prompt-expand` skill 先执行 `expand_prompt` 工具阶段，再把扩写后的 prompt 传给 `generate_image`；缺少 skill 或扩写失败会直接显示在 Run 节点。
- 变更：画布右上新增 Skill 面板，支持上传、查看、编辑和删除；所有登录用户可用公开 skill，只有上传者可编辑或删除。
- 文件：`server/api.ts`、`server/supabase.ts`、`server/skill-parser.ts`、`server/skill-access.ts`、`src/components/CanvasWorkspace.tsx`、`src/lib/skill-storage.ts`、`src/types/canvas.ts`、`src/lib/graph.ts`、`supabase/migrations/20260607002000_agent_skills.sql`、`README.md`。
- 验证：`pnpm test -- server/skill-parser.test.ts server/skill-access.test.ts src/lib/graph.test.ts`、`pnpm build`。
- 备注：已通过 Supabase MCP 将远端 `agent_skills` migration 应用到项目 `wbjqqywnwmghtcwpoatb`；上传 500 的根因是远端缺少 `public.agent_skills` 表，另补充了 `/api/skills` 的解析错误和 Supabase 存储错误文案。

### 画布支持框选多选

- 变更：空白画布左键拖拽启用 React Flow 框选，多选节点可继续批量拖拽或删除。
- 变更：底部输入器同步显示多选数量；只有单选 Prompt 或 Image Result 时才作为下一次生成的引用锚点。
- 文件：`src/components/CanvasWorkspace.tsx`、`src/App.css`、`README.md`。
- 验证：`pnpm build`。

### Run 节点展开后完整显示输出

- 变更：展开 Run 节点时不再限制 agent 文字为 3 行，不再给输出区域设置内部滚动，工具详情改为完整换行显示。
- 变更：展开态结果图片节点下移，避免完整输出内容与图片结果节点重叠。
- 文件：`src/App.css`、`src/components/CanvasWorkspace.tsx`、`src/lib/graph.ts`、`src/lib/graph.test.ts`。
- 验证：`pnpm test -- src/lib/graph.test.ts`、`pnpm build`。
- 备注：构建仍有既有 Vite 大 chunk 提示，不影响本次验证。

### Run 节点展示流式文字输出

- 变更：`/api/agent-run` 在调用 `generate_image` 前使用 DeepSeek 通过 AI SDK `streamText` 输出简短执行说明，并把 text chunks 合并进 UI message stream。
- 变更：Run 节点从 assistant message parts 中提取 text parts，与 `generate_image` 工具状态一起展示，保留节点内部滚动和错误可见状态。
- 文件：`server/api.ts`、`src/components/CanvasWorkspace.tsx`、`src/lib/graph.ts`、`src/types/canvas.ts`、`src/App.css`、`src/lib/graph.test.ts`、`README.md`。
- 验证：`pnpm test -- src/lib/graph.test.ts`、`pnpm build`；`http://127.0.0.1:8787/api/health` 返回 DeepSeek、Seedream、Supabase 均已配置；浏览器打开 `http://localhost:5173/` 登录页无 console error。
- 备注：DeepSeek 文本输出失败会直接暴露错误，不降级为假执行说明；未创建临时账号做真实生成，避免污染项目数据。

### 支持一次生成多张图片结果

- 变更：`generate_image` 会从 prompt 中解析显式图片数量，例如 `一次生成4张图片`，并在多图请求时关闭 Seedream `force_single`，将返回的多个 image URL 渲染成同一 Run 下的多个图片结果节点。
- 变更：Run 节点工具详情展示目标图片数量；4 张结果按 Figma 参考保持 240px 卡片、17px 间距并以 Run 节点居中展开。
- 文件：`seedream.ts`、`server/api.ts`、`src/components/CanvasWorkspace.tsx`、`src/lib/graph.test.ts`、`seedream.test.ts`、`README.md`。
- 验证：`pnpm test -- seedream.test.ts src/lib/graph.test.ts`、`pnpm build`、`API_PORT=8788 pnpm dev:api` 后检查 `http://127.0.0.1:8788/api/health`。
- 备注：`SEEDREAM_MAX_OUTPUT_IMAGES` 默认 4；超过上限直接报错并显示在 Run 节点，不返回假图或降级结果。

### 调整底部输入器引用分支规则

- 变更：底部输入器未引用节点时创建新的根 `prompt -> run`；选中 Prompt 或 Image Result 节点时创建 `selected node -> prompt -> run` 分支；Agent Run 节点仅展示状态，不作为引用锚点。
- 文件：`src/lib/graph.ts`、`src/components/CanvasWorkspace.tsx`、`src/App.css`、`src/lib/graph.test.ts`、`README.md`。
- 验证：`pnpm test -- src/lib/graph.test.ts`、`pnpm build`。
- 备注：当前选中的非 Run 节点即引用节点，点击画布空白处取消引用。

### 增加用户项目列表与项目归属

- 变更：新增自建名称密码登录，密码使用 scrypt hash，Hono 通过 httpOnly cookie session 识别用户；首个用户注册时会认领迁移后的未归属旧项目。
- 变更：将 `agent_canvases` 迁移为 `agent_projects`，项目保存画布节点、边、选中节点和最后 run；`agent_run_events` 改为通过 `project_id` 归属项目；项目删除为软删除。
- 变更：前端拆为登录页、项目列表页和项目级画布工作区，项目列表支持创建、打开、重命名、软删除和退出登录；画布提交 `/api/agent-run` 时传 `projectId`。
- 文件：`server/api.ts`、`server/auth.ts`、`server/supabase.ts`、`src/App.tsx`、`src/components/AuthPage.tsx`、`src/components/ProjectListPage.tsx`、`src/components/CanvasWorkspace.tsx`、`src/lib/auth-storage.ts`、`src/lib/project-storage.ts`、`supabase/migrations/*`、`README.md`。
- 验证：Supabase MCP 已应用 `user_projects` 和 `drop_legacy_canvas_index` migration；security advisor 无 lint，performance advisor 仅剩新索引未使用的 INFO；`pnpm test -- server/auth.test.ts server/project-access.test.ts src/lib/project-summary.test.ts src/lib/graph.test.ts`、`pnpm lint`、`pnpm build` 通过；临时用户 API 冒烟覆盖注册、`/api/auth/me`、旧项目认领、项目创建/重命名/软删除/退出，并已清理临时用户和恢复旧项目未归属状态；浏览器打开 `http://localhost:5174/` 登录页无 console error。
- 备注：本机没有 Supabase CLI，因此迁移文件由仓库手写并通过 Supabase MCP 应用；后续正式引入 CLI 后可用 `supabase migration list` 对齐历史。

## 2026-06-06

### 接入 Supabase 画布持久化

- 变更：通过 Supabase 插件在 `cucumber2` 项目创建 `agent_canvases` 和 `agent_run_events`，分别存储画布快照与 Agent Run 事件；两张表启用 RLS，仅允许 server-side `service_role` policy 管理。
- 变更：新增 `/api/canvas` 读取/保存接口，前端启动时恢复画布，节点/边/选中状态变化后自动保存；`/api/agent-run` 记录 run 输入、成功输出或错误。
- 文件：`server/api.ts`、`server/supabase.ts`、`src/lib/canvas-storage.ts`、`src/App.tsx`、`src/App.css`、`README.md`、`.env.example`、`package.json`、`pnpm-lock.yaml`。
- 验证：Supabase 插件确认 public schema 中表结构、RLS 与外键已创建；security/performance advisors 均无 lint；测试插入/删除 canvas 记录成功；`pnpm test -- src/lib/graph.test.ts`、`pnpm build`、`pnpm lint` 通过；`API_PORT=8788 pnpm dev` 下 `/api/health` 返回 `supabaseConfigured:false`，`/api/canvas` 返回明确配置错误。
- 备注：前端不使用 Supabase publishable key 直连写库，避免引入与现有画布状态并行的客户端数据模型；数据库错误会阻止提交而不是降级到内存。本机缺少 Supabase CLI 和 `SUPABASE_SECRET_KEY`，因此迁移文件生成与真实本地画布保存需补齐环境后继续验证。

## 2026-06-05

### 修复 Run 节点真实工具流展示

- 变更：Run 节点不再写死 Prompt 优化和 Generateimage 文案，改为渲染 AI SDK assistant message parts 中的 `generate_image` 工具状态、输入摘要、输出图片数量和错误信息。
- 变更：Run 节点右上角箭头恢复为可点击折叠按钮，展开态和收起态分别提供可访问名称。
- 文件：`src/App.tsx`、`src/App.css`、`src/lib/graph.ts`、`src/lib/graph.test.ts`。
- 验证：`pnpm test -- src/lib/graph.test.ts`、`pnpm build`；使用本地 mock AI SDK UI message stream 在桌面和移动 viewport 验证展开/收起交互、真实 tool part 文案和无 console 错误。
- 备注：验证时未调用真实 Seedream，避免产生外部图像生成请求。

### 补充 AI SDK 官方文档优先规则

- 变更：更新 `agent.md`，要求后续 Agent 新增功能或调整 AI SDK UI 相关链路时，优先查看官方文档是否已有案例或推荐写法。
- 文件：`agent.md`、`process.md`。
- 验证：已打开官方 AI SDK UI v6 reference 页面，确认该入口覆盖 `useChat`、UI message stream、transport、tool usage、generative UI 等相关方向。
- 备注：官方入口为 `https://ai-sdk.dev/docs/reference/ai-sdk-ui`，具体实现仍需结合本仓库 `src/App.tsx` 和 `server/api.ts` 的实际流式链路。

### 拆分独立设计规范

- 变更：新增 `design.md`，将 UI 设计规范从 `agent.md` 中单独抽出，作为后续 UI 工作的唯一设计规范入口。
- 变更：更新 `agent.md`，保留协作和 Agent 行为规则，并改为要求新增或调整 UI 前先阅读 `design.md`。
- 文件：`design.md`、`agent.md`、`process.md`。
- 验证：设计规范内容仍基于当前 `src/index.css`、`src/App.css` 和 `src/App.tsx` 的实际界面语言。
- 备注：后续 UI 变更优先更新 `design.md`，过程性信息继续写入 `process.md`。

### 新增协作与过程文档

- 变更：新增 `agent.md`，沉淀 Agent 协作规则、画布行为约束、运行命令和 UI 设计入口。
- 变更：新增 `process.md`，作为轻量变更日志和交接记录。
- 文件：`agent.md`、`process.md`。
- 验证：文档内容基于当前 `README.md`、`src/App.tsx`、`src/App.css`、`src/index.css`、`src/lib/graph.ts`、`server/api.ts` 和 `src/types/canvas.ts` 梳理。
- 备注：后续新增功能时应同步更新本文件，避免只在聊天记录里保留关键信息。

### 当前项目状态快照

- 变更：项目当前是 Infinite Canvas Agent Run MVP，支持输入需求、创建 Run 节点、调用 `generate_image`、渲染图片结果节点，并从选中结果继续生成 follow-up branch。
- 文件：`src/App.tsx`、`src/lib/graph.ts`、`src/types/canvas.ts`。
- 验证：已有 `src/lib/graph.test.ts` 覆盖根 run、上游上下文、分支布局、多结果布局、工具输出和错误解析。
- 备注：画布状态目前主要在前端内存中维护，刷新后不会持久化。

### Agent API 与图像生成链路

- 变更：服务端 `/api/agent-run` 接收 `canvasContext`，通过 AI SDK UI message stream 写入 `generate_image` 工具输入、输出或错误。
- 文件：`server/api.ts`、`seedream.ts`。
- 验证：`/api/health` 会返回 DeepSeek、Seedream 配置状态和当前模型名。
- 备注：缺少 Seedream 凭证时应展示真实错误，不生成占位成功结果。

### 当前 UI 风格基线

- 变更：界面基线是浅暖灰无限画布、绿色主色、圆形左侧工具栏、右上胶囊 viewport controls、底部胶囊输入器和 240px 节点卡片。
- 文件：`src/index.css`、`src/App.css`、`src/App.tsx`。
- 验证：样式 token 和具体 CSS 已写入 `design.md` 的设计规范。
- 备注：新增 UI 元素必须沿用当前颜色、尺寸、圆角、阴影、图标和中文文案风格。

## 后续事项

- 已修复：Seedream HTTPS 请求支持从根目录 `.env.local` 读取 `SEEDREAM_CA_CERT_PEM`、`SEEDREAM_CA_CERT` 或 `NODE_EXTRA_CA_CERTS`，用于公司代理或 VPN 注入私有根证书的场景。
- 已完成：画布节点、边、选中状态和 run 历史已归入用户项目模型。
- 为 Run 节点补充更真实的 tool trace 展示，区分 queued、running、success、error 的可见状态。
- 增加附件或参考图输入时，复用当前底部输入器和画布节点风格，不另做独立上传页。
- 为环境变量缺失、Seedream 失败、网络失败补充更友好的中文错误文案。
- 如果新增面板或弹窗，保持轻量浮层风格，并避免遮挡核心画布操作。
- 重要实现完成后，优先补充 `src/lib/graph.test.ts` 或新增相邻测试。
