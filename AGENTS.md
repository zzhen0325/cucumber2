# Agent Guide

本文件约束本仓库后续实现。任何改动都先看实际代码；文档与代码不一致时，以代码为准并同步修正文档。

## Project Snapshot

- Infinite Canvas Agent Run MVP。
- 前端：Vite、React、TypeScript、React Flow、AI Elements。
- 服务端：Hono，入口 `server/api.ts`。
- 唯一 Agent runtime：`server/agent/`，使用 OpenAI Agents SDK Runner。
- 唯一入口：`POST /api/agent-run`。
- 停止入口：`DELETE /api/agent-run?projectId=...&runNodeId=...`。
- 唯一 Trace 表：`agent_run_events`。
- 画布类型：`src/types/canvas.ts`；事件与 operation 契约：`src/types/runtime.ts`。

## Working Rules

- 每个功能域保持清晰、独立、唯一的职责边界。
- 接收到用户的需求时，要从第一性原理出发思考问题的本质。
- 不要新增一堆自定义 utility，优先用已经存在的 Tailwind theme token；如果某个语义确实反复出现，再补一个小的语义 class，而不是每行都写任意值。
- 目标是通用Agent OS，遇到问题不要单独修某一个类型的特例。
- 保持改动小而完整，不新增平行状态绕开 `AgentCanvasNode`、`AgentCanvasEdge` 和 `RunDraft`。
- 不做 legacy adapter、降级或静默兜底；错误直接进入 Run 节点和 Trace。
- Agent 执行必须在画布可见：prompt、run、Agent/handoff、tool、artifact、canvas operation 和 error 都由事件投影。
- Agent 坚持 proposal-first：SDK 决定做什么，runtime policy 决定是否允许落到画布；tool 不直接写数据库。
- 客户端不得提供可信 upstream context。提交前保存项目，服务端从持久化 nodes/edges 重建上下文。
- `knownNodeIds` 只能来自项目快照和本轮 prompt/run 节点。
- 图片生成 artifact 由 `generate_image` 产生；高清放大 artifact 由 `upscale_image` 或图片 toolbar 直连接口产生。引用图 URL 只转发给 Seedream，不暴露给模型。
- Manager 通过 handoff 委派给 Image Agent；specialist model 由 runtime 统一注入。
- React Flow 改动先查看官方文档：<https://reactflow.dev/learn>。
- Agent 改动先查看 Agents SDK 官方文档：<https://openai.github.io/openai-agents-js/>。
- 流式 UI 改动先查看 AI SDK 官方文档：<https://ai-sdk.dev/docs>。
- 新增简单 Agent tool 默认用 Zod `parameters` + `strict: true`；复杂 union/open payload 才保留手写 JSON Schema + 执行期 Zod 校验。
- 新增能力同步更新 `README.md` 或 `process.md`；UI 改动先阅读 `design.md`。
- 文件超过 1500 行时优先按职责拆分。
- 优先使用codex的Chrome插件进行测试。
- 测试用真实数据进行，本地临时 QA 账号：用户名：zz  密码：123456
- 数据库如果有修改，一定要同步远端数据库

## Canvas Behavior

- 根请求创建 prompt node -> run node -> image result node。
- 选中结果后提交创建 follow-up branch。
- 服务端上下文按图结构从上游到选中节点排序。
- 同一 artifact id 不重复生成结果节点。
- 工具错误写 `tool.error`，随后写 `run.failed`，不生成假成功结果。
- `run.completed` 必须包含真实 `finalOutput` 和 artifact IDs。

## Commands

```bash
pnpm install
pnpm dev
pnpm test
pnpm lint
pnpm build
```

默认地址：Web `http://localhost:5173`，API `http://127.0.0.1:8787`，Health `http://127.0.0.1:8787/api/health`。

## Validation

- 上下文、图结构和布局运行 `src/lib/graph.test.ts`、`server/agent/context.test.ts`。
- SDK stream、handoff 和工具失败运行 `server/agent/events/*.test.ts`。
- 事件投影运行 `src/lib/graph-projection.test.ts`、`src/lib/runtime-event-renderer.test.ts`。
- 涉及 Agent、Seedream 或环境变量时检查 `/api/health` 和 Run 错误展示。
- UI 改动至少运行 TypeScript、build、改动文件 ESLint，并用浏览器验收。

## Do Not

- 不恢复 Agent v1、Skill、审批、Evaluator、客户端模型选择或附件提交。
- 不接受客户端 upstream IDs、artifact 或 URL 作为可信上下文。
- 不把关键执行状态只留在聊天文本。
- 不引入与 `design.md` 冲突的视觉语言。
- 不为了内部诊断污染默认 UI。

