# Cucumber

Infinite Canvas Agent OS。前端使用 Vite、React、TypeScript、React Flow 和 AI Elements；服务端使用 Hono 与 OpenAI Agents SDK。

## Agent Runtime

项目只有一套 Agent 运行时：

- API：`POST /api/agent-run`；停止运行使用同一路径的 `DELETE` 方法
- 实现：`server/agent/`
- 编排：每次运行创建独立 Manager 和 specialist agents；runtime 先按 artifact-first task protocol 确定路由，单一 specialist 任务直接启动对应 Agent，复合任务由 Manager 通过 Agents SDK handoff 委派给 Document Agent、Web Agent、Research Agent 或 Image Agent
- 失败 Run 节点显示重试按钮；重试会保留原失败节点，并用原 prompt 与原上游锚点创建新的可见 Agent Run 分支
- 图片工具：`render_visual_style_prompt` 使用已激活 visual style-library 技能的 `style.json` 生成结构化图片提示词；`visual-prompt-cookbook` 是内置实例；`expand_image_prompt` 只作为普通扩写后备；`generate_image` 调用配置的图片 provider（Seedream 或 Coze）生成图片，`upscale_image` 调用 Seedream 智能超清
- 文档工具：Document Agent 使用 `create_text_artifact` 创建 Markdown/document typed artifact；`diagram` 是路由协议中的 artifact kind，实际仍保存为包含 Mermaid block 的 Markdown/doc artifact；工具只写 artifact 内容和事件，不直接创建画布节点，结果由 runtime materializer 投影到画布
- 网页工具：Web Agent 使用 `fetch_webpage` 抓取公开 http(s) 页面并创建 webpage artifact；此阶段只做 fetch/read，不做浏览器自动操作、登录态访问或多页面爬取，并拒绝 localhost/private network URL
- Knowledge：用户导入的文档、网页、图片、数据集以及运行时生成的文本/图片 artifact 会自动写入 `agent_knowledge_chunks` keyword index；Agent 可通过 `search_knowledge` 检索项目可见 knowledge chunks 作为参考摘录，不能把未检索到的全文当作已读取内容
- 调研工具：Research Agent 使用 `collect_research_sources` 读取用户提供的公开来源，再用 `create_research_artifact` 创建带 citation metadata 的 research markdown artifact；此阶段不做通用 web search，没有来源时要求用户补充 URL
- Agent OS 技能流：兼容 Agent Skills 目录格式；服务端从持久化画布重建可信上下文，检索启用技能的 metadata，首轮只注入 skill cards；模型必须调用 `activate_skill` 才能读取完整 `SKILL.md`，包内资源通过 `read_skill_resource` 按需读取，脚本只能通过 `run_skill_script` 执行
- 路由协议：`input.normalized` 以 `userGoal`、`operation`、`artifact.kind/subtype/format`、`domain`、`requiredCapabilities` 和 `negativeCapabilities` 为准；`intent` 仅用于旧 UI/Trace 摘要。`视觉`、`H5` 等词默认是 domain/context，不会单独触发 Image Agent。
- 画布变更：Agent 只能提出 `CanvasOperation`，由 runtime policy 校验后投影到画布
- 长任务状态：复杂任务或重试运行会写入 task-specific `run.plan.created`，Run 节点展示对应 todo 和当前步骤；简单短任务不创建固定计划骨架。agent、handoff、skill、tool 和步骤事件会持续物化到项目快照，用户回到项目后可看到最新状态
- 失败步骤重试：失败工具/脚本步骤可从 Run 节点重试；服务端从旧 Run Trace 重建失败步骤上下文，新 Run 分支保留原失败节点并尽量从失败点继续
- Trace：`run.created` / `input.normalized` 记录服务端重建的 selected nodes、reference nodes、upstream path 和 omitted nodes；Trace 面板用用户可读摘要展示 input、skill、tool error 和 canvas policy rejection
- 物化：artifact、canvas operation 和终态事件会幂等写回项目快照；同一 artifact id 只保留一个结果节点
- Typed artifacts：图片、Markdown、code、document、webpage、dataset、decision、memory 和 tool result 都使用稳定 `ArtifactRef`；没有工具 artifact 的最终文本回复会由 runtime 物化为 Markdown artifact 节点
- 错误：Run 节点只保留短错误来源，完整诊断保留在 Trace 事件中；上下文校验失败也会写入 `run.failed`
- 流协议：AI SDK UI `createUIMessageStream` + `data-runtime-event`

客户端只提交 `projectId`、`runNodeId`、prompt、`promptNodeId`、主 `selectedNodeId` 和 `selectedNodeIds`。提交前会强制保存项目快照；服务端从持久化 `nodes/edges` 重建 upstream context，不信任客户端上传的节点、artifact 或 URL。多选引用会过滤掉 Run 节点，只让可引用画布节点进入上下文。

Agent 模型按服务端环境固定优先级选择：Ark、DeepSeek、OpenAI。runtime 使用 Agents SDK 官方 `ModelProvider` + `Runner({ model, modelProvider })` 配置，Manager、specialist、输入归一化和图片提示词扩写共用同一 provider 解析路径；前端没有 Agent 模型选择器，也没有 runtime feature flag。底部输入器提供图片 provider 选择，本轮请求会把 `imageProvider` 写入 `canvasContext`，只影响 `generate_image` 的图片生成 provider。

媒体 provider 独立于 Agent 模型 provider。图片生成支持 `IMAGE_PROVIDER=seedream` 或 `IMAGE_PROVIDER=coze`；`upscale_image` 仍只支持 Seedream，不支持其他图片 provider 的静默兜底。视频 provider 通过 `VIDEO_PROVIDER` 暴露到 `/api/health`，但当前还没有 `generate_video` tool、video artifact 或画布投影链路。

## Setup

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

默认地址：

- Web：`http://localhost:5173`
- API：`http://127.0.0.1:8787`
- Health：`http://127.0.0.1:8787/api/health`

至少配置一组 Agent 模型凭据：

- Ark：`ARK_API_KEY`，可选 `ARK_MODEL`、`ARK_BASE_URL`
- DeepSeek：`DEEPSEEK_API_KEY`，可选 `DEEPSEEK_MODEL`、`DEEPSEEK_BASE_URL`
- OpenAI：`OPENAI_API_KEY`，可选 `OPENAI_MODEL`

图片生成默认使用 Seedream，需要 `IMAGE_PROVIDER=seedream`、`SEEDREAM_ACCESS_KEY_ID` 和 `SEEDREAM_SECRET_ACCESS_KEY`。也可以使用 Coze：`IMAGE_PROVIDER=coze`、`COZE_IMAGE_TOKEN`，可选 `COZE_IMAGE_URL`、`COZE_IMAGE_SIZE`、`COZE_IMAGE_WATERMARK`、`COZE_IMAGE_MODEL`。Coze 请求体保持 `prompt`、`reference_images`、`size`、`watermark`、`model` 结构；画布上游图片 URL 会写入 `reference_images` 的 file dict 数组（`{ url }`），`size` 和 `model` 是字符串，`watermark` 是布尔值，空配置不会发送占位字段。项目、Trace 和对象存储 metadata 持久化需要 `SUPABASE_URL` 与 `SUPABASE_SECRET_KEY`。

视频 provider 配置预留：

- 通用：`VIDEO_PROVIDER`、可选 `VIDEO_MODEL`、`VIDEO_API_KEY`
- Seedance：`VIDEO_PROVIDER=seedance`，`SEEDANCE_ACCESS_KEY_ID`、`SEEDANCE_SECRET_ACCESS_KEY`，可选 `SEEDANCE_MODEL`

智能超清默认使用 `SEEDREAM_UPSCALE_REQ_KEY=jimeng_i2i_seed3_tilesr_cvtob`、`SEEDREAM_UPSCALE_RESOLUTION=4k` 和 `SEEDREAM_UPSCALE_SCALE=50`；toolbar 直连放大不创建 Agent Run，但会保存新的图片 artifact、节点和原图连线。

浏览器直传 Supabase Storage 还需要公开环境变量：

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`，或兼容旧命名的 `VITE_SUPABASE_ANON_KEY`

不要把 `SUPABASE_SECRET_KEY` / service role key 暴露到前端。

`GET /api/health` 返回 `agentConfigured`、`agentProvider`、`agentModel`、`imageConfigured`、`imageProvider`、`imageModel`、`seedreamConfigured`、`cozeImageConfigured`、`videoConfigured`、`videoProvider`、`videoModel` 和 `supabaseConfigured`。

## Persistence

持久化表：

- `agent_projects`：项目标题、画布 nodes/edges、选中节点和 `last_run_id`
- `agent_run_events`：唯一 Agent Trace 事件表
- `agent_artifacts`：artifact metadata、对象存储 bucket/path 和稳定 content ref
- `agent_knowledge_chunks`：artifact 派生的可检索 knowledge index，包含 chunk id、source artifact id、source node id、text excerpt digest、keyword index、createdAt 和 updatedAt；当前使用 keyword index，不要求 embedding provider
- `agent_skill_definitions`：全局技能定义、`SKILL.md` 和启用状态
- `app_users`、`app_sessions`：本地账号和会话

对象存储：

- bucket：`agent-assets`，private，单文件上限 50MB
- bucket：`agent-skill-packages`，private，单包上限 100MB，存储导入的完整技能 zip 包
- 用户上传路径：`projects/{projectId}/uploads/{uploadId}/{fileName}`
- 生成图片路径：`projects/{projectId}/runs/{runNodeId}/artifacts/{artifactId}.{ext}`
- 技能包路径：`skills/{skillName}/{sha256}.zip`
- 画布只保存 `/api/projects/:projectId/artifacts/:artifactId/content` 和 `supabase://agent-assets/...` 稳定引用；实际读取由服务端校验权限后签发短期 URL。
- Artifact metadata 公共字段包括 `mimeType`、`byteSize`、`digest`、`sourceRunNodeId`、`sourceToolName`、`createdBy` 和 `previewKind`；文本类节点默认给 Agent 上下文摘要和 content ref，不把全文塞进 prompt。
- 画布保存使用 `canvasPatch` 增量写入 `nodes/edges` JSON；打开项目仍读取完整快照。

`supabase/migrations/20260611000000_agent_v2_cutover.sql` 会删除 Agent v1 Trace、Skill 和旧 runtime 表，只保留 `run.created.payload.runtime = 'openai-agents-sdk'` 的 Trace，并保留所有项目画布 nodes/edges。该迁移不可逆。

## APIs

- `GET /api/health`
- `POST /api/auth/register`、`POST /api/auth/login`、`POST /api/auth/logout`
- `GET /api/projects`、`POST /api/projects`
- `GET /api/projects/:projectId`、`PATCH /api/projects/:projectId`（支持 `canvasPatch` 增量 upsert/delete）、`DELETE /api/projects/:projectId`
- `GET /api/projects/:projectId/runs/:runNodeId/trace`
- `POST /api/projects/:projectId/uploads/sign`
- `POST /api/projects/:projectId/uploads/:uploadId/complete`
- `GET /api/projects/:projectId/artifacts/:artifactId/content`
- `POST /api/projects/:projectId/images/upscale`
- `GET /api/agent-skills`、`GET /api/agent-skills/:skillId`
- `GET /api/agent-skills/:skillId/resources`、`GET /api/agent-skills/:skillId/resources/content?path=...`
- `GET /api/agent-skills/:skillId/package`
- `POST /api/agent-skills`、`POST /api/agent-skills/import`
- `PATCH /api/agent-skills/:skillId`、`DELETE /api/agent-skills/:skillId`
- `POST /api/agent-run`
- `DELETE /api/agent-run?projectId=...&runNodeId=...`

<br />

## Agent Skill Contract

`SKILL.md` 遵循 Agent Skills 标准，必须包含 YAML frontmatter：

- 必填：`name`、`description`
- 标准可选字段：`license`、`compatibility`、`metadata`、`allowed-tools` 会保留在 frontmatter 中
- Cucumber 可选扩展：`agent_scope`、`purpose`、`tags`、`triggers.keywords`、`triggers.canvas_kinds`、`bindings.tools`、`bindings.agents`、`bindings.scopes`
- Cucumber capability 扩展：`capabilities[]` 可声明 `operation`、`artifact.kind`、`artifact.subtype`、`artifact.format`、`domain`、`requiredCapabilities` 和 `negativeCapabilities`；`produces`、`uses`、`notFor` 用于能力召回和负能力抑制
- `bindings.tools` 必须匹配服务端 Tool Registry；`bindings.scopes` 可显式声明权限范围，未声明时会从绑定工具自动推导，例如 `read.skill`、`run.script`、`propose.canvas`、`tool.image.generate`、`tool.image.upscale`
- Cucumber 可选脚本 manifest：`scripts[]` 可声明 `name`、`path`、`runtime: bash|node|python`、`description`、JSON input/output 期望；标准 skill 即使没有该 manifest，也会从 `scripts/` 自动发现可执行脚本
- 可选资源：zip 包根下除 `SKILL.md` 外的安全相对路径都会作为技能资源保存；文本资源由 Agent 通过 `read_skill_resource` 按需读取，图片等二进制资源只暴露路径和 metadata，不直接塞进模型上下文；技能管理页可浏览 references、scripts、assets 等包内资源，图片资源走受保护内容接口预览

zip 导入接受一个可见 `SKILL.md` 和同一包根下的标准 Agent Skills 文件结构，包括 `scripts/`、`references/`、`assets/`、`agents/openai.yaml`、`LICENSE*` 以及其他资源文件；拒绝路径穿越、多个 `SKILL.md`、超 100MB 包和缺失的已声明脚本。脚本从 `agent-skill-packages` 下载，校验 SHA-256 后在临时目录中通过 `sandbox-exec` 执行，支持 bash/node/python、args/stdin、普通 stdout 包装和原 Cucumber JSON 输出，15 秒超时，空 secret 环境；没有 sandbox 支持时直接失败并写入 Trace。

技能源文件下载通过 `/api/agent-skills/:skillId/package`：zip 导入技能返回校验后的原始包；内置或手动技能会动态打包 `SKILL.md` 和可见资源。

Trace 新增 `skill.retrieved`、`skill.activated`、`skill.script.started`、`skill.script.completed`、`skill.script.failed`。Run Trace 面板显示 Skills 区；Run 节点摘要只显示技能名称，不展示 package path。工具和脚本 Trace 写入前会统一 redaction：secret/token/key/cookie/credential 等字段和 URL-bearing 字段会被替换，payload 同时记录 redaction metadata；工具 Trace metadata 来自 Tool Registry，包括 label、required scopes、artifact types 和是否可能访问外部网络。Specialist registry 已接入 Document Agent、Web Agent、Research Agent 和 Image Agent；Document Agent 负责 markdown/document/diagram artifact，输出 doc/markdown artifact；Web Agent 负责 webpage artifact；Research Agent 负责 source-based answer，输出带 citations metadata 的 research markdown artifact；代码、数据和 workflow specialist 尚未接入时必须明确能力边界。

Knowledge index 当前由 artifact 写入路径自动维护：上传完成、`fetch_webpage`、`create_text_artifact`、final output materialization、`generate_image` 和 `upscale_image` 都会根据 artifact 标题、摘要、metadata 和可读取正文生成 chunks。`search_knowledge` 只返回当前项目快照中可见 source node/artifact 的摘录；图片 artifact 索引标题、prompt 和 metadata 摘要，不做 OCR；二进制 dataset/doc 仅索引标题和摘要，文本型 csv/json/md/html/txt 会索引正文片段。

内置 `visual-prompt-cookbook` 基于 `server/agent/skills/builtin/visual-prompt-cookbook` 中的 68 个 `style.json` 和 136 张预览图。Image Agent 在新图片请求中优先激活绑定 `render_visual_style_prompt` 的 style-library 技能，再把返回 prompt 传给 `generate_image`；用户上传的 skill 只要绑定同一工具并提供 `references/styles/<slug>/style.json` 或 `styles/<slug>/style.json`，也可走同一机制。旧 `imagegen-prompt-expander` 保留为普通扩写技能。

## Validation

```bash
pnpm test
pnpm exec tsc -b --pretty false
pnpm build
pnpm lint
```

Agent 相关改动优先运行对应 Vitest 文件和 TypeScript。画布 UI 改动还应在浏览器验证提交、停止、错误、图片结果和 follow-up 分支。

## Documents

- `AGENTS.md`：当前实现约束
- `agent-os-roadmap.md`：通用 Agent OS 画布产品路线图
- `process.md`：2026-06-11 起的 v2 变更记录
- `design.md`：UI 设计语言
- `docs/archive/agent-v1/`：Agent v1 历史文档，不再是实现依据
- `docs/archive/process-through-2026-06-10.md`：旧变更记录
- `persistence-refactor-plan.md`：独立持久化计划，未随 Agent cutover 修改
