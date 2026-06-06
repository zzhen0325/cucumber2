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

- 持久化画布节点、边、选中状态和 run 历史，避免刷新丢失。
- 为 Run 节点补充更真实的 tool trace 展示，区分 queued、running、success、error 的可见状态。
- 增加附件或参考图输入时，复用当前底部输入器和画布节点风格，不另做独立上传页。
- 为环境变量缺失、Seedream 失败、网络失败补充更友好的中文错误文案。
- 如果新增面板或弹窗，保持轻量浮层风格，并避免遮挡核心画布操作。
- 重要实现完成后，优先补充 `src/lib/graph.test.ts` 或新增相邻测试。
