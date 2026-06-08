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

## 2026-06-08

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
