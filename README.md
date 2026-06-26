# Cucumber

Infinite Canvas Agent OS。前端使用 Vite、React、TypeScript、React Flow 和 AI Elements；服务端使用 Hono 与 OpenAI Agents SDK。

## Agent Runtime

项目只有一套 Agent 运行时：

- API：`POST /api/agent-run`；停止运行使用同一路径的 `DELETE` 方法
- 实现：`server/agent/`
- 编排：Manager、specialist agents、handoff registry、输入归一化 Agent 和 Runner 按进程缓存；每轮用户上下文仍只来自 per-run `runContext`。Input Normalizer 只负责生成 artifact-first task protocol，`task-router` 负责把 protocol 映射到 Agent route；单一 specialist 任务直接启动对应 Agent，复合任务由 Manager 通过 Agents SDK handoff 委派给 Document Agent、Web Agent、Research Agent 或 Image Agent
- 启动 Fast Path：路由分两层执行。`Quick Router` 只处理确定性 preflight：寒暄、图片生成元信息直返、简单 canvas 操作和已显式归一化的图像模式输入；其余请求进入唯一 LLM Input Normalizer，由一个 `maxTurns=1` 的结构化 Agents SDK agent 输出 `operation + artifact + domain + requiredCapabilities + negativeCapabilities`，再交给本地规则纠偏和 route 映射。
- 失败 Run 节点显示重试按钮；重试会保留原失败节点，并用原 prompt 与原上游锚点创建新的可见 Agent Run 分支
- 图片工具：`render_visual_style_prompt` 使用已激活 visual style-library 技能的 `style.json` 生成结构化图片提示词；`visual-prompt-cookbook` 是内置实例；`expand_image_prompt` 只作为普通扩写后备；`generate_image` 调用配置的图片 provider（Seedream、Coze 或 ByteArtist）生成图片，`image_matting` 基于选中/上游图片生成抠图素材，`decompose_image` 产出 Markdown 图片拆解 artifact，`upscale_image` 调用 Seedream 智能超清；图片内容理解直接使用 Agent 模型多模态输入回答
- 文本 artifact 工具：Document Agent 使用 `create_text_artifact` 创建 Markdown/document/diagram/code/webpage typed artifact；`diagram` 实际保存为包含 Mermaid block 的 Markdown/doc artifact，HTML 动画、H5 页面和交互 demo 保存为 `webpage` + `html` artifact；HTML artifact 在画布和 Run 输出中支持预览/源码切换；工具只写 artifact 内容和事件，不直接创建画布节点，结果由 runtime materializer 投影到画布
- 网页工具：Web Agent 使用 `fetch_webpage` 抓取公开 http(s) 页面并创建 webpage artifact；此阶段只做 fetch/read，不做浏览器自动操作、登录态访问或多页面爬取，并拒绝 localhost/private network URL。生成 HTML 页面/动画不走 Web Agent，而是由 Document Agent 创建 webpage/html artifact
- Knowledge：用户导入的文档、网页、图片、数据集以及运行时生成的文本/图片 artifact 会自动写入 `agent_knowledge_chunks` keyword index；Agent 可通过 `search_knowledge` 检索项目可见 knowledge chunks 作为参考摘录，不能把未检索到的全文当作已读取内容
- 调研工具：Research Agent 在 OpenAI Agent provider 下使用官方 Agents SDK hosted `web_search` 搜索公开互联网信息，也可用 `collect_research_sources` 读取用户提供的公开来源，再用 `create_research_artifact` 创建带 citation metadata 的 research markdown artifact；非 OpenAI provider 下没有明确 URL 或可信上下文时会提示切换 provider 或补充 URL
- Agent OS 技能流：兼容 Agent Skills 目录格式；服务端从持久化画布重建可信上下文，复杂任务从 60s 内存缓存检索启用技能的 metadata，首轮只注入 skill cards；画布输入器输入 `/` 可为本轮强制选择一个启用技能，服务端按 id 校验后置顶并预激活。模型必须调用 `activate_skill` 才能读取其它完整 `SKILL.md`，包内资源通过 `read_skill_resource` 按需读取，脚本只能通过 `run_skill_script` 执行
- 路由协议：`input.normalized` 以 `userGoal`、`operation`、`artifact.kind/subtype/format`、`domain`、`requiredCapabilities` 和 `negativeCapabilities` 为准；`intent` 仅用于旧 UI/Trace 摘要。`视觉`、`H5` 等词默认是 domain/context，不会单独触发 Image Agent；明确的 HTML 页面、H5 页面、交互 demo 或 HTML 动画请求归一化为 `webpage/html` artifact，并禁止 `image-generation`。
- 通用对话边界：寒暄和简单短答优先走 fast path 或轻量 chat；落到 Manager route 的短问答、概念解释、轻量分析、提示词/文本改写和简短总结直接在 Run 节点回复。用户明确要求详细说明、完整规划、长篇方案、报告、文档、模板、提示词模板、可复制/直接使用方案、设定稿或规范时，归一化为 document/markdown artifact 并交给 Document Agent 产出可沉淀的画布文档；搜索、调研分析和引用来源请求交给 Research Agent 产出 research markdown artifact。
- 画布变更：Agent 只能提出 `CanvasOperation`，由 runtime policy 校验后投影到画布
- 长任务状态：复杂任务、图片任务、重试运行或非空动态计划会写入 task-specific `run.plan.created`，Run 节点展示对应 todo 和当前步骤；简单短任务不创建固定计划骨架。agent、handoff、skill、tool 和步骤事件会持续物化到项目快照，用户回到项目后可看到最新状态
- 失败步骤重试：失败工具/脚本步骤可从 Run 节点重试；服务端从旧 Run Trace 重建失败步骤上下文，新 Run 分支保留原失败节点并尽量从失败点继续
- Trace：`run.created` / `input.normalized` 记录服务端重建的 selected nodes、reference nodes、upstream path、omitted nodes、route、routerSource、skippedSteps 和归一化结果；启动阶段会用 `run.step.*` 记录实际执行的上下文重建、整理用户需求（内部含快速路由和输入归一化）、计划生成、技能检索和 Agent Runner 启动耗时，Fast Path 不再写被跳过的慢步骤；Trace 面板用用户可读摘要展示 input、skill、tool error 和 canvas policy rejection
- 物化：artifact、canvas operation 和终态事件会幂等写回项目快照；同一 artifact id 只保留一个结果节点
- Typed artifacts：图片、Markdown、code、document、webpage、dataset、decision、memory 和 tool result 都使用稳定 `ArtifactRef`；短问答和轻量分析的最终文本只显示在 Run 节点内，不自动物化为 Markdown artifact 节点。简单文本 Run 会保持展开，并可作为下一轮对话引用节点。
- 错误：Run 节点只保留短错误来源，完整诊断保留在 Trace 事件中；上下文校验失败也会写入 `run.failed`
- 流协议：AI SDK UI `createUIMessageStream` + `data-runtime-event`。图片生成是 Image Agent 本地 function tool；API 启动后会 fire-and-forget 预热模型 provider、Agent world 和技能缓存，打开项目后也会补触发预热，失败只记录日志

客户端只提交 `projectId`、`runNodeId`、prompt、`promptNodeId`、主 `selectedNodeId`、`selectedNodeIds`，可选本轮 `forcedSkillId`，图像模式下额外提交白名单 `inputMode=image`、`imageAspectRatio`、`imageResultCount` 和 `imageProvider`，以及可选的本轮 `canvasPatch`。Agent 启动时服务端会先原子写入该 patch，再从持久化 `nodes/edges` 重建 upstream context；不信任客户端上传的节点上下文、artifact 内容、URL 或 `contentRef`。多选引用会过滤掉不可引用的 Run 节点，但保留简单文本输出 Run 作为可继续对话的文本上下文。

Agent 模型按服务端环境固定优先级选择：Ark、DeepSeek、OpenAI。runtime 使用 Agents SDK 官方 `ModelProvider` + `Runner({ model, modelProvider })` 配置，Manager、specialist、输入归一化和图片提示词扩写共用同一 provider 解析路径；前端没有 Agent 模型选择器，也没有 runtime feature flag。底部输入器提供图片 provider 选择，本轮请求会把 `imageProvider` 写入 `canvasContext`，只影响 `generate_image` 的图片生成 provider。

媒体 provider 独立于 Agent 模型 provider。图片生成当前只开放 Lemo 和 Seedream 5 两个入口：默认使用 Seedream 5，用户输入提到 `lemo`/`Lemo` 时服务端强制使用 Lemo；Seedream 4.6 和 Coze Image 暂时不在底部输入器/API 白名单中。`image_matting` 通过独立的 `IMAGE_MATTING_PROVIDER=byteartist` provider 接口调用 ByteArtist `image_matting_lemo`；`decompose_image` 创建 Markdown artifact，不调用图片 provider；图片内容理解由 Agent 模型读取选中/上游图片的多模态 input 后直接回复；`upscale_image` 仍只支持 Seedream，不支持其他图片 provider 的静默兜底。视频 provider 通过 `VIDEO_PROVIDER` 暴露到 `/api/health`，但当前还没有 `generate_video` tool、video artifact 或画布投影链路。

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

用户输入归一化固定使用 Ark `doubao-seed-2-0-mini-260428`，复用 `ARK_API_KEY` 和 `ARK_BASE_URL`。

图片生成默认使用 Seedream 5，对应 ByteArtist `seed5_duotu_zz`，需要 `BYTEARTIST_BASE_URL`、`BYTEARTIST_AID`、`BYTEARTIST_APP_KEY` 和 `BYTEARTIST_APP_SECRET`，也兼容 `docs/ByteArtist.md` 里的 `GATEWAY_BASE_URL`、`BYTEDANCE_AID`、`BYTEDANCE_APP_KEY`、`BYTEDANCE_APP_SECRET`。底部输入器只显示 `Lemo` 和 `Seedream 5`：`Lemo` 会提交 `imageProvider=byteartist` 并固定模型 `seed4_0407_lemo`；`Seedream 5` 会提交 `imageProvider=seed5_duotu_zz` 并固定模型 `seed5_duotu_zz`。Seedream 4.6 和 Coze Image 暂时禁用，旧的本地选择值会回到 Seedream 5，客户端 API 也不再接受 `seedream` 或 `coze` 作为本轮 `imageProvider`。`seed5_duotu_zz` 默认发送 `extra_inputs.height=2048`、`extra_inputs.width=2048` 和 `user_prompt`，最多上传 6 张上游参考图；`seed4_0407_lemo` 走 `Prompt` 字段且不接收参考图。用户输入提到 `lemo`/`Lemo` 时，服务端会固定使用 ByteArtist `seed4_0407_lemo`；若画布有上游参考图，服务端会先用视觉模型把参考图转成文字描述，再和用户需求整理成最终生图 prompt，之后才调用 ByteArtist。参考图描述默认复用 `ARK_API_KEY`/`ARK_MODEL`，其次 `OPENAI_API_KEY`/`OPENAI_MODEL`，也可通过 `IMAGE_REFERENCE_DESCRIPTION_API_KEY`、`IMAGE_REFERENCE_DESCRIPTION_BASE_URL` 和 `IMAGE_REFERENCE_DESCRIPTION_MODEL` 单独配置。Seedream 4.6、Coze Image 的底层 adapter 和配置读取暂时保留，供后续重新开放或历史测试覆盖。

`image_matting` 使用独立 provider 接口，默认实现为 ByteArtist `image_matting_lemo`：`IMAGE_MATTING_PROVIDER=byteartist`，复用 `BYTEARTIST_BASE_URL`、`BYTEARTIST_AID`、`BYTEARTIST_APP_KEY` 和 `BYTEARTIST_APP_SECRET`，也兼容 `GATEWAY_BASE_URL`、`BYTEDANCE_AID`、`BYTEDANCE_APP_KEY`、`BYTEDANCE_APP_SECRET`。默认请求参数为 `BYTEARTIST_MATTING_BLUE=-1`、`BYTEARTIST_MATTING_GREEN=-1`、`BYTEARTIST_MATTING_ONLY_MASK=0`、`BYTEARTIST_MATTING_RED=-1`、`BYTEARTIST_MATTING_REFINE_MASK=2`，对应透明底抠图；源图由服务端根据已保存 artifact/object storage 签发短期 R2 read URL，并按智创网关图片参数规范通过 ByteArtist 表单字段 `source` 传入；只有没有 provider 可拉取 URL 但已有服务端 bytes 时才使用 `base64file`。显式白底或中性底请求会把 RGB 改为 `255/255/255` 或 `242/242/239`。该 provider 通过同一套 ByteArtist submit/poll API 返回 PNG artifact，不做 rembg 降级。

项目、Auth/session、Trace 和 artifact metadata 仍使用 Supabase，需要 `SUPABASE_URL` 与 `SUPABASE_SECRET_KEY`。对象字节存储使用 Cloudflare R2，需要 `R2_ACCOUNT_ID`、`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`，并默认使用 private bucket `agent-assets` 与 `agent-skill-packages`。浏览器直传依赖 R2 presigned `PUT` URL，`agent-assets` bucket 需要允许前端 origin 的 CORS，至少包含 `PUT`、`GET`、`HEAD`、`Content-Type` 和 `ETag`。

视频 provider 配置预留：

- 通用：`VIDEO_PROVIDER`、可选 `VIDEO_MODEL`、`VIDEO_API_KEY`
- Seedance：`VIDEO_PROVIDER=seedance`，`SEEDANCE_ACCESS_KEY_ID`、`SEEDANCE_SECRET_ACCESS_KEY`，可选 `SEEDANCE_MODEL`

智能超清默认使用 `SEEDREAM_UPSCALE_REQ_KEY=jimeng_i2i_seed3_tilesr_cvtob`、`SEEDREAM_UPSCALE_RESOLUTION=4k` 和 `SEEDREAM_UPSCALE_SCALE=50`；toolbar 直连放大不创建 Agent Run，但会保存新的图片 artifact、节点和原图连线。

不要把 `SUPABASE_SECRET_KEY`、R2 access key 或 R2 secret 暴露到前端。

`GET /api/health` 返回 `agentConfigured`、`agentProvider`、`agentModel`、`imageConfigured`、`imageProvider`、`imageModel`、`imageMattingConfigured`、`imageMattingProvider`、`imageMattingModel`、`seedreamConfigured`、`cozeImageConfigured`、`byteArtistConfigured`、`videoConfigured`、`videoProvider`、`videoModel`、`objectStorageConfigured`、`objectStorageProvider` 和 `supabaseConfigured`。

## Persistence

持久化表：

- `agent_projects`：项目标题、画布 nodes/edges、选中节点和 `last_run_id`
- `agent_run_events`：唯一 Agent Trace 事件表
- `agent_artifacts`：artifact metadata、对象存储 bucket/path 和稳定 content ref
- `agent_knowledge_chunks`：artifact 派生的可检索 knowledge index，包含 chunk id、source artifact id、source node id、text excerpt digest、keyword index、createdAt 和 updatedAt；当前使用 keyword index，不要求 embedding provider
- `agent_skill_definitions`：全局技能定义、`SKILL.md` 和启用状态
- `app_users`、`app_sessions`：本地账号和会话

对象存储（Cloudflare R2）：

- bucket：`agent-assets`，private，单文件上限 50MB
- bucket：`agent-skill-packages`，private，单包上限 100MB，存储导入的完整技能 zip 包
- 用户上传路径：`projects/{projectId}/uploads/{uploadId}/{fileName}`
- 生成图片路径：`projects/{projectId}/runs/{runNodeId}/artifacts/{artifactId}.{ext}`
- 技能包路径：`skills/{skillName}/{sha256}.zip`
- 画布只保存 `/api/projects/:projectId/artifacts/:artifactId/content` 和 `r2://agent-assets/...` 稳定引用；实际读取由服务端校验权限后从 R2 读取，图片 provider 引用在调用前签发短期 R2 read URL。
- `POST /api/projects/:projectId/uploads/sign` 返回 R2 通用上传合同：`bucket`、`path`、`contentRef`、`signedUrl`、`method: "PUT"`、`headers`、`expiresIn` 和 `uploadId`。前端直接 `fetch` 到 presigned URL，再调用 `/complete` 注册 artifact。
- Artifact metadata 公共字段包括 `mimeType`、`byteSize`、`sourceRunNodeId`、`sourceToolName`、`createdBy` 和 `previewKind`；当写入路径已经持有对象字节时会附带 `digest`。上传完成阶段会先 HEAD 验证对象和大小，文本类对象会继续读取正文用于索引，图片和其他二进制对象不整文件回读。
- 画布保存使用 `canvasPatch` 增量写入 `nodes/edges` JSON；打开项目仍读取完整快照。

Supabase Storage 到 R2 的一次性迁移脚本：

```bash
pnpm migrate:storage:r2 -- --dry-run --report out/r2-migration-report.json
pnpm migrate:storage:r2 -- --resume --report out/r2-migration-report.json
SUPABASE_DB_URL=postgres://... pnpm migrate:storage:r2 -- --resume --rewrite-db --report out/r2-migration-report.json
```

`--dry-run` 只下载并校验 Supabase Storage 源对象，不写 R2 和 DB；`--resume` 会跳过已经通过 R2 HEAD/read-back 校验的对象；`--rewrite-db` 在 copy/verify 全部通过后使用 `psql` 单事务把 `agent_artifacts.content_ref`、artifact metadata、`agent_canvas_nodes.node_json`、`agent_canvas_edges.edge_json` 和 `agent_run_events.payload` 中的 `supabase://...` 改为 `r2://...`。

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
- `POST /api/projects/:projectId/images/matting`
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
- `bindings.tools` 必须匹配服务端 Tool Registry；`bindings.scopes` 可显式声明权限范围，未声明时会从绑定工具自动推导，例如 `read.skill`、`run.script`、`propose.canvas`、`tool.image.generate`、`tool.image.matting`、`tool.image.decompose`、`tool.image.upscale`
- Cucumber 可选脚本 manifest：`scripts[]` 可声明 `name`、`path`、`runtime: bash|node|python`、`description`、JSON input/output 期望；标准 skill 即使没有该 manifest，也会从 `scripts/` 自动发现可执行脚本
- 可选资源：zip 包根下除 `SKILL.md` 外的安全相对路径都会作为技能资源保存；文本资源由 Agent 通过 `read_skill_resource` 按需读取，图片等二进制资源只暴露路径和 metadata，不直接塞进模型上下文；技能管理页可浏览 references、scripts、assets 等包内资源，图片资源走受保护内容接口预览

zip 导入接受一个可见 `SKILL.md` 和同一包根下的标准 Agent Skills 文件结构，包括 `scripts/`、`references/`、`assets/`、`agents/openai.yaml`、`LICENSE*` 以及其他资源文件；拒绝路径穿越、多个 `SKILL.md`、超 100MB 包和缺失的已声明脚本。脚本从 `agent-skill-packages` 下载，校验 SHA-256 后在临时目录中通过 `sandbox-exec` 执行，支持 bash/node/python、args/stdin、普通 stdout 包装和原 Cucumber JSON 输出，15 秒超时，空 secret 环境；没有 sandbox 支持时直接失败并写入 Trace。

技能源文件下载通过 `/api/agent-skills/:skillId/package`：zip 导入技能返回校验后的原始包；内置或手动技能会动态打包 `SKILL.md` 和可见资源。

Trace 新增 `skill.retrieved`、`skill.activated`、`skill.script.started`、`skill.script.completed`、`skill.script.failed`。Run Trace 面板显示 Skills 区；Run 节点摘要只显示技能名称，不展示 package path。工具和脚本 Trace 写入前会统一 redaction：secret/token/key/cookie/credential 等字段和 URL-bearing 字段会被替换，payload 同时记录 redaction metadata；工具 Trace metadata 来自 Tool Registry，包括 label、required scopes、artifact types 和是否可能访问外部网络。Specialist registry 已接入 Document Agent、Web Agent、Research Agent 和 Image Agent；Document Agent 负责 markdown/document/diagram/code/webpage 文本类 artifact，输出 doc/code/webpage artifact；Web Agent 只负责 fetch/read 外部 webpage artifact；Research Agent 负责 hosted web search、source-based answer，输出带 citations metadata 的 research markdown artifact；数据和复杂 workflow specialist 尚未接入时必须明确能力边界。

Knowledge index 当前由 artifact 写入路径自动维护：上传完成、`fetch_webpage`、`create_text_artifact`、`generate_image`、`image_matting`、`decompose_image` 和 `upscale_image` 都会根据 artifact 标题、摘要、metadata 和可读取正文生成 chunks。`search_knowledge` 只返回当前项目快照中可见 source node/artifact 的摘录；图片 artifact 索引标题、prompt 和 metadata 摘要，不做 OCR；二进制 dataset/doc 仅索引标题和摘要，文本型 csv/json/md/html/txt 会索引正文片段。

内置 `visual-prompt-cookbook` 基于 `server/agent/skills/builtin/visual-prompt-cookbook` 中的 68 个 `style.json` 和 136 张预览图。图片任务统一进入 Image Agent：简单生图可直接调用 `generate_image`；需要特定风格系统、prompt 扩写或复杂参考时，Image Agent 再按需激活绑定 `render_visual_style_prompt` 或 `expand_image_prompt` 的技能。用户上传的 skill 只要绑定同一工具并提供 `references/styles/<slug>/style.json` 或 `styles/<slug>/style.json`，也可走同一机制。旧 `imagegen-prompt-expander` 保留为普通扩写技能。

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
