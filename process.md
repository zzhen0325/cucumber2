# Process

本文记录 2026-06-11 Agent v2 正式切换后的变更。

## 2026-06-18 Image Agent Matting And Inspection

- Image Agent 扩展为图片生成、抠图、拆解、理解和高清处理的统一 specialist；Manager 继续只做编排，工具只创建 artifact 和事件，不直接写画布节点。
- 新增 `image_matting` 本地工具，通过统一 matting provider 接口和可信上游图片解析生成抠图/透明底优先素材；当前 provider 为 rembg 2.x CLI，后续可替换实现；`image-generation` negative capability 仍阻止新图生成，但不阻止抠图和高清这类图片处理。
- 新增 `decompose_image` 和 `analyze_media` 本地工具，把图片风格拆解、prompt 线索、内容理解和信息提取保存为 Markdown/doc artifact；没有像素级可见信息时必须在 artifact 限制里说明，不能伪造看见的细节。
- 输入归一化新增 `image.matting`、`image.decompose` 和 `media.analyze` intent 兼容摘要，实际路由仍以 `operation + artifact + requiredCapabilities + negativeCapabilities` 为准；`image-decompose` / `media-analysis` 的 Markdown 产物也路由到 Image Agent。
- Tool Registry 新增 `tool.image.matting`、`tool.image.decompose` 和 `tool.media.analyze` scope；Run plan、Run 节点工具摘要、错误来源摘要和 artifact 投影路径同步识别 `image_matting`、`decompose_image`、`analyze_media`。

## 2026-06-18 R2 Object Storage

- 对象字节存储从 Supabase Storage 切换到 Cloudflare R2；Supabase 继续负责数据库、Auth/session 和 Trace。
- `server/storage.ts` 保持 artifact 领域边界，底层通过 R2 S3-compatible API 执行 `putObject`、`getObject`、`headObject`、presigned upload/read URL；运行时只生成和接受 `r2://{bucket}/{path}` content ref。
- 浏览器上传不再使用 Supabase browser client；`/uploads/sign` 返回 R2 presigned `PUT` 合同，前端直接 `fetch` 上传后调用 `/complete` 注册 artifact。
- `/api/health` 新增 `objectStorageProvider: "r2"` 和 `objectStorageConfigured`；`supabaseConfigured` 只表示 Supabase 数据库/session/Trace 配置。
- 新增 `pnpm migrate:storage:r2` 一次性迁移脚本：从 Supabase DB 读取 `agent_artifacts` 和 `agent_skill_definitions` 清单，从旧 Storage 下载对象，上传到 R2，同步校验大小和 SHA-256；`--rewrite-db` 使用 `psql` 单事务改写 DB/canvas/Trace 里的旧 content ref。

## 2026-06-17 Canvas Row Storage

- 破坏性 Supabase migration `20260617125844_canvas_rows_storage.sql` 将画布从 `agent_projects.nodes/edges` 切到 `agent_canvas_nodes`、`agent_canvas_edges` 和 `agent_artifact_contents`；旧项目测试数据会被清空，不做 backfill/dual-write。
- 新增 `apply_canvas_patch` RPC，服务端传入 session user id，RPC 内校验 project owner、deleted 状态和 expected version，并原子 upsert/soft-delete nodes/edges、更新 counts 与 project version。
- `GET /api/projects/:id` 返回 `project` meta + lightweight `nodes`/`edges`；`PATCH /api/projects/:id` 只更新 meta，canvas 保存改走 `PATCH /api/projects/:id/canvas` 且响应不返回完整画布。
- `CanvasWorkspace` 改为 dirty node/edge id 集合保存，不再用整图 JSON digest。React Flow change、run draft、手动创建、粘贴、上传完成、Markdown/shape/text 编辑和 auto layout 都进入 `commitCanvasMutation`。
- `toPersistableNode` 会清理 selected/dragging/measured 等运行时字段、跳过本地 upload 节点、移除 markdown/code/document/tool/webpage 正文类字段，并在 node_json 超过 64KB 时拒绝保存。
- 文本类 artifact 内容新增 create/update/read API；Markdown 正文 debounce 保存到 `agent_artifact_contents`，节点只保存 artifact ref、summary/preview/version 等轻量信息。`saveProjectSnapshot` 会先 flush 待保存正文再写 canvas patch，避免用户编辑后立刻启动 Agent 时服务端读到旧正文；图片和二进制内容走私有对象存储。
- Agent Run 启动与 materialize 都从新的 node/edge 表读取/写入；上游 markdown/code/document/tool result/webpage 节点只从 `node_json` 读取 artifactId，再由服务端读取 `agent_artifacts` / `agent_artifact_contents` 注入受限长度正文；materialize 只在 `input.normalized`、artifact/canvas operation/run terminal/tool error 等关键事件后落盘，非终态事件后台排队，终态事件等待队列收敛。
- 打开项目不再自动 hydrate last run trace，也不自动拉取 artifact full content；Trace 面板、artifact 预览和 Markdown 编辑器聚焦时才按需请求详情。
- `input.normalized` 中已经确定会产出 artifact 时会立即投影并后台物化 pending 结果节点；该机制覆盖 image、markdown/document/diagram、code、webpage 和 data，不把“节点创建”绑到最终 artifact 生成完成之后，也不让中间落库阻塞后续 Agent 执行。真实 `artifact.created` 到达后复用同一个 pending 节点更新为 ready。

## 2026-06-17 Runtime Fast Path

- `/api/agent-run` 入口保持 AI SDK HTTP stream 不变；新增 `Quick Router` 在本地规则层先判定 `smalltalk`、`simple_chat`、`simple_canvas`、`image_task` 和 `complex_agent_task`，并在 `run.created` / `input.normalized` payload 中写入 route、routerSource、skippedSteps 和 cache 状态。
- `smalltalk` 直接写 Trace、流式文本和 `run.completed`；`simple_chat` 使用缓存的轻量 chat Agent/Runner，不加载 skills、MCP、handoff 或动态计划；`simple_canvas` 只处理确定性的安全画布操作，并继续通过 canvas policy 写 `canvas.operation.*`。
- `image_task` 可在 `input.normalized` 后由投影层先创建 loading 图片结果节点；完整图片 artifact 由 `generate_image`、`image_matting` 或 `upscale_image` 产生并按 artifact id 幂等物化，不重复生成结果节点；图片拆解/理解则由 `decompose_image` / `analyze_media` 创建 Markdown artifact 节点。
- `complex_agent_task` 才进入完整 Agent Runner；compact context、skill retrieval 和 MCP/tool prepare 在依赖允许时并行。`plan.build` 只在复杂、图片或非空动态计划时写 Trace，简单任务不再写空计划步骤。
- Agent world 进程级缓存 Manager、Document/Web/Research/Image agents、handoff registry、normalizer Agent、Runner 和 simple chat Runner；per-run instructions/context 仍从 `runContext` 注入，不写入单例。
- 内部 MCP 使用全局 Streamable HTTP 连接池，共享连接 promise，失败后重置；非图片 Fast Path 不连接 MCP。技能 registry 增加 60s 内存缓存，应用内 create/update/import/delete skill 后立即 invalidation。
- 打开项目成功后服务端 fire-and-forget 预热 model provider、Agent world、skill registry 和 MCP pool；预热失败只记录日志，不阻塞画布加载。

## 2026-06-16 Artifact-First Routing

- 输入归一化从只依赖 `intent` 升级为 artifact-first task protocol：`userGoal`、`operation`、`artifact.kind/subtype/format`、`domain`、`requiredCapabilities` 和 `negativeCapabilities`；`intent` 仅作为 Trace/UI 兼容摘要派生。
- Specialist registry 不再按 intent 字符串开 handoff；runtime 根据 artifact protocol deterministic route。单一 image/document/web/research 任务直接启动对应 specialist，复合任务留给 Manager 编排并只开放匹配 handoff。
- `视觉`、`H5`、营销或产品语义只作为 `domain`/上下文；流程图和时序图默认归一化为 `diagram` + `mermaid`，由 Document Agent 产出 Markdown artifact，不走图片链路。
- 明确的 HTML 页面、H5 页面、交互 demo 或 HTML 动画请求归一化为 `webpage` + `html`，并加上 `negativeCapabilities=["image-generation"]`；生成 HTML 由 Document Agent 创建 webpage artifact，抓取公开 URL 才走 Web Agent。
- 提示词/文本改写任务（例如选中长图片 prompt 后输入“取消标题”）归一化为 `artifact=null` + `operation=edit` + `negativeCapabilities=["image-generation"]`，由 Manager 直接输出修改后的文本；即使存在上游 prompt 节点也不创建任务 plan、不委派 Image Agent、不调用 `generate_image`。
- Manager 作为通用对话默认处理者：短问答、概念解释、轻量分析和简短总结保持 `artifact=null`，由 Manager 直接回复；明确要求详细说明、完整规划、长篇方案、调研分析、报告或文档时归一化为 document/markdown artifact，交由 Document Agent 创建可沉淀的长文本产物。
- Skill frontmatter 新增可选 `capabilities`、`produces`、`uses` 和 `notFor`；skill retrieval 先按 artifact/capability 打分，再看关键词、canvas kind 和 token overlap，并会按 `negativeCapabilities` 抑制不应出现的 image skill。
- 新增 seed skill `sequence-diagram`，声明 `diagram/sequenceDiagram/mermaid` 能力，Document Agent 可激活后用 `create_text_artifact` 创建包含 Mermaid fenced block 的 Markdown artifact。
- 工具入口新增 task artifact policy：图片 prompt/generation 工具只允许 image artifact task，`image-generation` negative capability 会阻止新图生成；`image_matting` 仍要求 image artifact task 但不视为新图生成；`decompose_image` / `analyze_media` 要求对应 image inspection capability，可产出 markdown/document 分析 artifact；`create_text_artifact` 只允许 markdown/document/diagram/code/webpage 文本类 artifact task，Mermaid diagram 必须包含 mermaid fenced block，webpage artifact 必须是完整 HTML document。

## 2026-06-16 Dynamic Run Plan

- `run.plan.created` 不再是所有运行都会写入的四步固定骨架；runtime 只在复杂任务、带上游/多图/长 prompt/显式计划分析类请求或重试运行时创建 plan。
- plan item 使用任务相关 id/label，并带 `phase` 用于投影状态；Run 节点按真实 item 展示 todo，不再强制截断为四项。
- 简单短文本或单步请求依旧通过 agent、tool、artifact、canvas operation 和终态事件保持可见，不额外污染默认 UI。

## 2026-06-14 Knowledge Artifacts

- 新增 `agent_knowledge_chunks` 作为 artifact 派生 knowledge index，不新增平行 Trace；字段包括 chunk id、project id、source artifact id、source node id、text excerpt、text excerpt digest、keyword index、可选 embedding、metadata、createdAt 和 updatedAt。
- 用户上传文档、网页、图片、数据集，以及 runtime 生成的文本、网页、图片 artifact 后会自动重建对应 knowledge chunks；同一 artifact 重建时先删除旧 chunks，避免重复索引。
- 当前索引实现采用 keyword index，不引入 embedding provider 或 pgvector 依赖；文本型 md/html/txt/csv/json 等会索引正文片段，图片和二进制文件索引标题、summary、prompt 和 metadata 摘要。
- 新增 `search_knowledge` Agent tool，scope 为 `read.artifact` 和 `read.knowledge`；Manager、Document/Web/Research/Image Agent 都可按项目可见 source node/artifact 检索 chunks。
- Agent instructions 更新为：用户要求参考、基于、总结、比较或复用已导入资料时先检索 knowledge；不得声称读取了 `search_knowledge` 未返回的全文。

## 2026-06-14 P3 Specialist Agents

- 新增 specialist agent registry，集中声明 specialist name、enabled intents、required tools、produced artifact types 和 handoff policy；Manager 通过 registry 生成 Agents SDK handoff，specialist model 仍由 runtime 统一注入。
- `NormalizedIntent` 扩展到 P3 intent：`document.create`、`document.edit`、`web.fetch`、`webpage.create`、`research.answer`、`code.create`、`data.analyze`、`workflow.plan`，并保留 image/text/canvas/unsupported。
- 新增 Cucumber Document Agent：负责 Markdown/document/diagram/code/webpage 文本类 artifact 生成和改写；Manager 遇到 `document.create`/`document.edit`/`webpage.create` 必须 handoff，不直接创建内容 artifact。
- 新增 `create_text_artifact` 工具，写入私有对象存储和 `agent_artifacts`，发出 `artifact_created` 事件，由 runtime materializer 投影为 markdown/document/code/webpage 画布节点；工具不直接写画布节点。
- Tool Registry 新增 `create_text_artifact`，scope 为 `write.artifact` 和 `tool.doc.create`，产出 doc/code/webpage，Trace metadata 继续走统一 redaction/registry 路径。
- 新增 Cucumber Web Agent：负责公开 http(s) 网页 fetch/read；Manager 遇到 `web.fetch` 必须 handoff，不直接抓取网页。
- 新增 `fetch_webpage` 工具，拒绝 localhost/private network URL，只保存最多 2MB 的 html/xhtml/plain text 内容为 webpage artifact，并返回标题、最终 URL 和文本摘录供 Web Agent 简短确认。
- Tool Registry 新增 `fetch_webpage`，scope 为 `write.artifact` 和 `tool.web.fetch`，标记为可访问外部网络并产出 webpage artifact。
- 新增 Cucumber Research Agent：负责 source-based research；Manager 遇到 `research.answer` 必须 handoff，但没有明确公开 URL 或可信来源时要求用户补充来源，不做通用 web search。
- 新增 `collect_research_sources` 工具，复用公开网页 fetch 安全边界，读取最多 5 个用户提供的公开来源并返回 citation records 和文本摘录。
- 新增 `create_research_artifact` 工具，创建带 `citations` metadata 的 research markdown artifact，继续通过 artifact event 和 materializer 投影到画布。
- Tool Registry 新增 `collect_research_sources` 和 `create_research_artifact`，scope 为 `tool.research.answer`，其中来源收集工具同时需要 `tool.web.fetch` 并标记可访问外部网络。
- 代码、数据和 workflow specialist 只完成 intent 分类和 Manager 能力边界提示，尚未接入工具执行。

## 2026-06-14 P0 Runtime Hardening

- Agent Run Trace 继续只写 `agent_run_events`，不新增平行 Trace 表。
- `run.created` 和 `input.normalized` payload 增加服务端重建的 context summary，包含 selected nodes、reference nodes、upstream path 和 omitted nodes/reason；Trace 面板新增 Context/Input 摘要。
- Agent Run 启动阶段新增轻量 `run.step.*` 耗时 Trace，覆盖 `context.build`、`input.normalize`、`plan.build`、`skills.retrieve`、`mcp.connect` 和 `agent.start`，用于定位“准备 Agent”阶段的慢点。
- `input.normalized`、`skill.retrieved`、`skill.activated`、`skill.script.*`、`tool.error`、`canvas.operation.rejected` 和 `run.failed` 在 Trace 面板中显示用户可读摘要，不再只依赖截断 JSON。
- `buildAgentRunInput` 的上下文校验失败会被 runtime 捕获并写入 `run.failed`，错误来源标记为 `context`，Run 节点显示短错误。
- Run 节点错误文案收敛为短来源提示；完整 provider、工具、Seedream、技能脚本和上下文诊断保留在 Trace payload/errorText。
- `projectRunTraceToCanvas` 按 artifact id 跳过重复 `artifact.created`；materializer 会清理同一 run 下重复 artifact 节点和相关边。
- 用户停止 Run 时，`agent_run_aborted` 不再投影 pending 图片占位，避免停止后留下幽灵图片节点。

## 2026-06-14 Visual Prompt Cookbook

- 新增内置 `visual-prompt-cookbook` seed skill，基于 VigoZhao/AI-Visual-Prompt-Cookbook，资源位于 `server/agent/skills/builtin/visual-prompt-cookbook`，包含 68 个 `style.json` 和 136 张预览图。
- 新增通用 `read_skill_resource` 工具；已激活技能可以列出和读取 zip/seed 包根下除 `SKILL.md` 外的安全资源路径。文本资源按需读入，图片等二进制资源只暴露路径和 metadata。
- `run_skill_script` 继续负责执行技能脚本；zip 导入支持 `scripts[]` 声明脚本，也会按 Agent Skills 标准从 `scripts/` 自动发现 bash/node/python 脚本。资源读取和脚本执行是两个并列通道。
- 新增 `render_visual_style_prompt` 工具；任何已激活且绑定该工具、或标记 `visual-style`/`style-json` 的技能都可用。工具读取 `references/styles/<slug>/style.json` 或 `styles/<slug>/style.json` 并渲染最终图片 prompt，不直接写数据库或画布。
- Image Agent 对新图片生成优先使用 visual style library：`activate_skill` -> `render_visual_style_prompt` -> `generate_image`。旧 `expand_image_prompt` 保留为没有 style-library 候选或用户明确要求普通扩写时的后备。
- 新迁移 `20260614162000_visual_prompt_cookbook_skill.sql` 新增内置 image/prompt_expansion cookbook 技能；运行时按启用状态和上下文相关性检索技能。
- 新迁移 `20260614170000_asset_skill_packages.sql` 将技能 zip 包上限扩到 100MB，并允许完整 Agent Skills 包上传资源文件。
- 技能管理页新增包内容浏览：详情页展示 `SKILL.md`、references、scripts、assets 和 style 资源，支持文本预览、图片预览和技能源文件 zip 下载；zip 技能下载原始包，内置/手动技能动态打包。

## 2026-06-11 Agent Runtime Cutover

- OpenAI Agents SDK 成为唯一 runtime，目录从 `server/agent-v2/` 收口为 `server/agent/`。
- 唯一入口为 `POST /api/agent-run`；删除 `/api/agent-run-v2`、`VITE_AGENT_V2` 和 localStorage feature flag。
- `DELETE /api/agent-run` 显式中止当前 SDK/Seedream 执行，前端同步清理未完成图片投影。
- 客户端提交前强制保存项目；服务端仅接收 prompt、promptNodeId、runNodeId 和 selectedNodeId，并从持久化 nodes/edges 重建上下文。
- `knownNodeIds` 不再信任客户端 upstream IDs 或 edge 端点。
- SDK stream 投影 Agent、handoff、tool、artifact、canvas operation、final output 和 error；等待 `stream.completed`。
- 工具失败先写 `tool.error` 再写 `run.failed`；`run.completed` 写真实 finalOutput 和 artifact IDs。
- 删除 `create_artifact`、`attach_artifact`，图片生成 artifact 由 `generate_image` 产生；抠图 artifact 由 `image_matting` 产生；高清放大 artifact 由 `upscale_image` 或图片 toolbar 直连接口产生。
- Canvas policy 只允许完整便签/形状、位置更新、合法连边和当前 Run 状态；内容节点与 artifact 不可由通用 operation 伪造。
- 删除 Agent v1 runtime、router、kernel、capabilities、旧 prompts/provider、Skill parser/API/UI、审批、Evaluator、附件提交和 legacy event adapter。
- 前端模型选择器删除；模型按 Ark、DeepSeek、OpenAI 的服务端环境优先级选择。
- Trace 和 Run 节点只展示 v2 Agent/handoff、tool、artifact、canvas operation、final text 和 error。
- 新增 `20260611000000_agent_v2_cutover.sql`：删除 v1 数据和旧 runtime 表，保留 v2 Trace 与项目画布，将 `agent_run_step_events` 重命名为唯一 `agent_run_events`。
- Agent v1 文档归档到 `docs/archive/agent-v1/`，旧 process 归档到 `docs/archive/process-through-2026-06-10.md`。

## 2026-06-12 Run Node Streamed Text

- 前端开始消费 AI SDK UI assistant `text` parts，并将当前 Run 的实时文字投影到 `RunNodeData.agentText`。
- Run 节点文字优先级为 `run.completed.finalOutput` 高于当前 streamed text，高于运行状态占位文案；历史 Trace 回放不依赖实时 text Map。
- Run 节点默认收起，仅展示 Agent 流式文字和工具调用摘要；简单文本输出完成后保持展开，详细 Agent/handoff/timeline 诊断继续通过 Trace 面板查看。
- Run 节点内部滚动区使用 React Flow `nodrag`、`nopan`、`nowheel`，避免滚动文字或工具详情时拖动、平移画布。
- 简单问答、解释、轻量分析或简短总结任务不调用工具时，`run.completed.finalOutput` 只显示在 Run 节点内；不再自动创建下游 Prompt/Markdown 结果节点。用户选中该 Run 后可以继续提交下一轮对话，服务端会从持久化画布重建该 Run 的文本上下文。

## 2026-06-12 Image Request Boundary

- 新增 `server/agent/tools/image/generate-image.request.ts`，集中负责图片数量、尺寸/比例和 upstream 引用图归一化。
- `generate_image` 工具只做 Agent tool 边界、artifact 事件和图片 provider 调用编排；`image_matting` 工具只依赖 `runImageMatting` 统一接口，当前实现用 `IMAGE_MATTING_PROVIDER=rembg` 调用 rembg 2.x CLI；图片生成 provider 支持 `IMAGE_PROVIDER=seedream` 或 `IMAGE_PROVIDER=coze`，其中 Coze 请求体为 `prompt`、`reference_images`、`size`、`watermark`、`model`；`reference_images` 是由上游图片 URL 生成的 `{ url }` file dict 数组，`size/model` 是字符串，`watermark` 是布尔值，空配置不发送占位字段。
- 底部输入器可选择本轮图片 provider；客户端只提交白名单 `imageProvider`，服务端写入 agent context 后由 `generate_image` 选择 provider，`upscale_image` 仍只走 Seedream。
- `seedream.ts` 收敛为 Seedream provider 执行层，保留配置读取、签名、提交/轮询、并发/重试、取消和 provider metadata。
- 多张图片生成按 `SEEDREAM_MAX_CONCURRENCY` 限制完整 submit+poll 生命周期的并发数，并按 `SEEDREAM_STAGGER_MS` 间隔启动新任务；默认 `SEEDREAM_MAX_CONCURRENCY=1` 会等上一张完整出图或失败后再提交下一张，避免触发 Seedream 账号级并发限制。

## 2026-06-13 Input Normalization

- Agent Run 在 Manager 启动前通过 `server/agent/input-normalizer.ts` 生成结构化 `normalizedInput`，并写入 `input.normalized` Trace。
- 图片生成请求会单独抽取 `contentPrompt`、`resultCount`、`aspectRatio`、`dimensions` 或 `variants`；`variants` 表示同一参考图/同一 prompt 输出多组目标尺寸，`generate_image` 会按尺寸拆成 provider request 并由投影层创建对应 pending 图片结果节点。扩图、扩画布、拓展尺寸和 outpaint 归一化为 `image.generate + image-outpaint`，不是 `image.upscale`；只有纯高清、超清、4K/8K 或提升清晰度才进入 `upscale_image`。
- 分析、评估或给建议类视觉 brief（如图片、海报、banner、KV 需求）默认归一化为 `text.answer`；只有用户明确要求生成、创建或渲染图片时才进入 `image.generate`。如果请求明确指向选中/上游实际图片，风格拆解归一化为 `image.decompose`，内容理解/信息提取归一化为 `media.analyze`，抠图/去背景归一化为 `image.matting`。

## 2026-06-13 Multi Node References

- Agent Run 提交支持 `selectedNodeIds`，多选的可引用节点会一起生成到 Prompt 节点的引用边。
- 画布选择工具支持 Shift 点击追加/取消多选；画布任意工具下都可用鼠标中键拖动平移，手型工具仍保留左键拖动平移。
- 服务端继续从持久化项目快照重建 upstream context，并过滤不可引用的 Run 节点；简单文本输出 Run 可作为下一轮文本上下文。客户端提供的节点列表只作为待验证 id，不提供可信上下文。

## 2026-06-13 Internal MCP Tools

- `generate_image` 已迁为内部 MCP tool，由 `/internal/mcp` 通过 Streamable HTTP 暴露给当前 Agents SDK runtime。
- 内部 MCP endpoint 只接受进程内随机 bearer token；暂不作为外部 API 使用。
- MCP tool input 只包含模型可决定的图片参数；`userId`、`projectId`、`runNodeId`、upstream context 和 artifact URL 继续由服务端 run context registry 注入，不进入模型参数。
- 图片 artifact、tool 事件和错误仍通过现有 Cucumber runtime 事件投影到画布。

## 2026-06-12 Image Node Toolbar

- 图片结果节点选中后显示浮动 toolbar，当前提供放大查看、高清放大、抠图、下载和复制五个用户动作。
- 放大查看使用轻量图片预览弹窗，不改变画布节点和 Agent Trace。
- 高清放大 toolbar 动作不创建 Agent Run；它调用 `POST /api/projects/:projectId/images/upscale`，服务端从已保存项目中校验 `sourceNodeId`、签发图片读取 URL、调用 Seedream 智能超清并将新图片节点直接连到原图。
- 抠图 toolbar 动作不创建 Agent Run；它调用 `POST /api/projects/:projectId/images/matting`，服务端复用 `runImageMatting` provider 接口、当前 rembg 2.x 实现和同一套可信源图解析，将透明底抠图结果节点直接连到原图。
- 复制优先尝试图片二进制；浏览器权限、跨域或读取超时时降级复制稳定图片链接，并在按钮 title 中反馈结果。

## 2026-06-12 Project Persistence

- 项目列表只读取 `agent_projects` 的摘要列，不再拉取完整 `nodes/edges` JSON；`node_count`、`image_count`、`snapshot_bytes` 由服务端保存快照时同步维护。
- 打开画布时先渲染已保存项目快照；当前版本不再从 `lastRun` Trace 自动 hydrate 项目画布。
- Agent runtime 持续写 `agent_run_events`，并在 artifact、canvas operation 和终态事件后由 runtime materializer 将可见 Run 分支物化回 `agent_canvas_nodes`/`agent_canvas_edges`；中间事件后台 materialize，终态事件等待最终快照收敛。
- 前端保存继续使用 version handshake 和单飞队列；当前版本按 dirty node/edge id 通过 `PATCH /api/projects/:id/canvas` 增量提交节点/边 upsert/delete。

## 2026-06-12 Object Storage

- Cloudflare R2 private bucket `agent-assets` 成为用户上传和图片生成结果的对象存储边界；画布快照只保存稳定 `ArtifactRef`、`contentRef` 和同源 content API URL。
- 用户拖拽或粘贴文件会先插入本地预览节点并后台上传；浏览器通过 `/api/projects/:projectId/uploads/sign` 获取 R2 presigned `PUT` URL 后直传，再调用 `/complete` 写入 `agent_artifacts`，成功后用真实 artifact 节点替换本地节点。
- 本地上传中/失败的节点不会进入项目持久化或 Agent upstream context；上传失败会留在画布上展示错误状态。
- `generate_image` 和 `upscale_image` 收到 Seedream URL 后由服务端下载并上传到 `agent-assets`，随后才发 `artifact.created`；转存失败会走 `tool.error`/`run.failed`，不会生成假成功结果节点。toolbar 高清放大和抠图同样先转存再把真实节点写回项目。
- 上游图片引用对 Manager prompt 仍隐藏真实 URL；调用 Seedream/Coze 前，服务端仅根据 `r2://agent-assets/...` 临时签发 provider 可读 URL。
- Agent 模型 provider 改为 Agents SDK 官方 `ModelProvider` + `Runner({ model, modelProvider })` 写法；Manager、specialist、input normalizer 和 prompt expansion 共用同一 Runner provider 配置。
- 媒体 provider 独立暴露：图片生成 provider 和图片抠图 provider 已接入配置检查；视频 provider 仅进入 `/api/health` 配置面，尚未启用 `generate_video`、video artifact 或画布投影。
- 私有预览统一走 `/api/projects/:projectId/artifacts/:artifactId/content`，服务端校验项目权限后从 R2 读取对象内容。
- P1 typed artifact shell：非图片 artifact 节点统一展示标题、摘要、来源工具/Run、创建时间、大小、预览/打开/下载入口；短文本最终回复保留在 Run 节点，只有 Document/Web/Research 等工具真实创建 artifact 时才物化为 Markdown/document/webpage 节点。
- 上下文收集默认使用 token 估算 budget，按图结构和 priority 保留选中节点，省略项写入 `contextSummary.omittedNodes` 和 Trace。

## 2026-06-12 Cloud Skill Management

- 新增 `agent_skill_definitions` 作为当前 OpenAI Agents SDK runtime 的全局技能表；不恢复 Agent v1 Skill API、审批或执行器。
- 技能表升级为 Agent OS metadata：`agent_scope`/`purpose` 不再只限 image/prompt_expansion，并新增 tags、triggers、bindings、scripts、package bucket/path/hash/size。
- `agent-skill-packages` 成为技能 zip 包私有 bucket，单包 100MB；zip 导入接受一个 `SKILL.md` 和同一包根下的标准 Agent Skills 文件结构，拒绝路径穿越、多个 `SKILL.md`、重复脚本名和缺失的已声明脚本。
- 新增 `/api/agent-skills` CRUD、`/api/agent-skills/import`、资源浏览和 source package 下载接口，所有接口要求登录；列表不返回完整 `skillMd`，详情返回完整内容用于编辑。
- 管理工作台“技能”页展示 scope、purpose、tags、bindings、scripts、package hash 和启用状态。
- Agent Run 开始后服务端从可信画布快照检索最多 6 个启用技能，只把 skill cards 注入 Manager；完整 `SKILL.md` 只能通过 `activate_skill` 加载，每轮最多激活 3 个技能。
- 新增 `read_skill_resource`，仅已激活技能可用；Agent 可以先 list 资源，再读取安全文本资源。新增 `run_skill_script`，仅已激活且含脚本的技能可用；脚本包下载后校验 SHA-256，通过 `sandbox-exec`、空 secret 环境、args/stdin、bash/node/python、15 秒超时执行。普通 stdout 会包装成结构化工具结果，原 Cucumber JSON 输出继续支持 canvasOperations。没有 sandbox 支持时失败，不做不安全 fallback。
- Image Agent 的 `expand_image_prompt` 改为只使用已激活的 image/prompt_expansion 技能；短、关键词式或视觉细节不足的新图片请求会先激活扩写技能，再把 `expandedPrompt` 传给 `generate_image`。
- `generate_image` 的工具输出和 artifact metadata 保留实际 Seedream prompt，同时保留原始 run prompt，供 Trace 和图片结果节点追溯。
- Trace 新增 `skill.retrieved`、`skill.activated`、`skill.script.started`、`skill.script.completed`、`skill.script.failed`；Run Trace 面板新增 Skills 区，Run 节点摘要显示已激活技能名称但不暴露 package path。

## 2026-06-14 Tool Registry, Scopes, Trace Redaction

- 新增服务端 Tool Registry，统一声明当前 runtime 工具的 tool id/name、JSON input/output schema、required scopes、produced artifact types、Trace label 和外部网络能力。
- `SKILL.md` 的 `bindings.tools` 导入/创建时必须匹配 Tool Registry；`bindings.scopes` 支持显式声明，未声明时从工具绑定自动推导并随 skill card/Trace 暴露。
- 新迁移 `20260614190000_agent_tool_registry_scopes.sql` 为既有技能补写 `bindings.scopes`，不改变现有工具绑定。
- 工具与 skill script Trace 写入统一走 redaction，secret/token/key/cookie/credential 和 URL-bearing 字段不落入默认 Trace payload；Trace metadata 记录 redaction 状态和 registry 派生的工具 scope/label 信息。

## Verification

- Context 越权和服务端重建：`server/agent/context.test.ts`
- Agents SDK stream/handoff/tool failure：`server/agent/events/openai-stream-to-cucumber-events.test.ts`
- Agent Run 快照物化：`server/agent/materialize-run.test.ts`
- Canvas policy、技能解析/导入和图片工具/请求归一化：`server/agent/policy/*.test.ts`、`server/agent/skills/*.test.ts`、`server/agent/tools/image/*.test.ts`
- Event projection：`src/lib/graph-projection.test.ts`、`src/lib/runtime-event-renderer.test.ts`
- 项目摘要统计：`src/lib/project-summary.test.ts`
- 对象存储上传和引用签名：`src/lib/file-upload.test.ts`、`server/storage.test.ts`
- 基础检查：`pnpm exec tsc -b --pretty false`、`pnpm build`、相关 ESLint、浏览器验收
