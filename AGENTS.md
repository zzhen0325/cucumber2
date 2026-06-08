# Agent Guide

本文件用于约束后续 Agent 或开发者在本仓库中的实现方式。任何改动都应先看实际代码，再更新文档；文档可以辅助理解，但不能替代代码事实。

## Project Snapshot

- 项目是一个 Infinite Canvas Agent Run MVP。
- 前端使用 Vite、React、TypeScript、React Flow 和 AI Elements 组件。
- 服务端使用 Hono Node server，主要入口是 `server/api.ts`。
- Agent Run 入口是 `/api/agent-run`，通过 AI SDK UI message stream 返回 `generate_image` 工具状态。
- 画布节点和边的核心类型在 `src/types/canvas.ts`；图结构和上下文收集逻辑在 `src/lib/graph.ts`。

## Working Rules

- 先读代码，再做判断；遇到文档和代码不一致时，以代码为准，并在完成后更新相关文档。
- 每个功能域必须有清晰、独立、唯一的职责边界
- 保持改动小而完整：一个需求优先落在最少文件内，除非现有结构已经要求拆分。
- 不引入新的状态模型来绕开现有画布数据；优先沿用 `AgentCanvasNode`、`AgentCanvasEdge`、`RunDraft` 和 `UpstreamContextItem`。
- Agent 执行过程应在画布中可见：prompt、run、tool state、image result 和 follow-up branch 都应对应清晰的可视节点或状态。
- 工具错误要直接呈现在 Run 节点中，不生成假图或占位成功结果。
- 后续 Agent 新增功能或调整 AI SDK UI 相关链路时，优先查看官方文档是否已有案例或推荐写法：https://ai-sdk.dev/docs/reference 和 https://ai-sdk.dev/docs/reference/ai-sdk-ui。
- 新增能力后，同步更新 `README.md` 或 `process.md` 中对应的运行方式、环境变量、变更记录。
- 新增或调整 UI 前必须先阅读 `design.md`，新增 UI 元素的设计风格必须与当前界面统一。
- 当提出加入新功能时，要从用户真实体验交互的视角完善考虑，不要只是代码没问题，但是视觉上或者操作交互上缺出现点不到或者别的低级问题。
- 当文件超出1500行时，应该尽量控制代码体积，合理的进行拆分
- 不做降级或兜底方案，将错误抛出
- 测试时只运行相关的最小测试集。
- 不做 legacy adapter，旧实现可以直接删除，不要增加复杂性。

## Agent Canvas Behavior

- 根 prompt 从空画布开始，创建 prompt node -> run node -> image result node。
- 选中 image result 后提交新 prompt，应创建 follow-up branch，并将上游 prompt/image context 传给服务端。
- 上下文收集使用 `collectUpstreamContext`，按图结构从上游到当前节点排序。
- `generate_image` 的输入应包含当前 prompt、可选 selectedNodeId 和 upstreamContext。
- 服务端返回的 image URL 会被 `extractImagesFromToolOutput` 转成 image result nodes。
- 对同一 image id 已渲染过的结果不要重复生成节点。

## Commands

```bash
pnpm install
pnpm dev
pnpm test
pnpm lint
pnpm build
```

本地默认地址：

- Web: `http://localhost:5173`
- API: `http://127.0.0.1:8787`
- Health check: `http://127.0.0.1:8787/api/health`

## Validation

- 图结构、上下文、布局偏移、工具输出解析优先补充或运行 `src/lib/graph.test.ts`。
- UI 改动至少运行 `pnpm build` 或 `pnpm lint` 中与改动相关的检查。
- 涉及 Agent stream、Seedream、环境变量时，需要手动检查 `/api/health` 和 Run 节点错误展示。
- 涉及 `useChat`、transport、UI message stream、tool usage、generative UI 等 AI SDK UI 能力时，先对照官方文档和示例，再落到本仓库代码。

## Do Not

- 不要把画布上下文只留在聊天文本里，关键执行链应回到画布。
- 不要引入与 `design.md` 冲突的视觉语言。
- 不要为了展示内部状态而污染默认 UI；需要诊断时放到明确的高级调试入口。
