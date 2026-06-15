# Process

本文记录 2026-06-11 Agent v2 正式切换后的变更。

## 2026-06-14 Knowledge Artifacts

- 新增 `agent_knowledge_chunks` 作为 artifact 派生 knowledge index，不新增平行 Trace；字段包括 chunk id、project id、source artifact id、source node id、text excerpt、text excerpt digest、keyword index、可选 embedding、metadata、createdAt 和 updatedAt。
- 用户上传文档、网页、图片、数据集，以及 runtime 生成的文本、网页、图片 artifact 后会自动重建对应 knowledge chunks；同一 artifact 重建时先删除旧 chunks，避免重复索引。
- 当前索引实现采用 keyword index，不引入 embedding provider 或 pgvector 依赖；文本型 md/html/txt/csv/json 等会索引正文片段，图片和二进制文件索引标题、summary、prompt 和 metadata 摘要。
- 新增 `search_knowledge` Agent tool，scope 为 `read.artifact` 和 `read.knowledge`；Manager、Document/Web/Research/Image Agent 都可按项目可见 source node/artifact 检索 chunks。
- Agent instructions 更新为：用户要求参考、基于、总结、比较或复用已导入资料时先检索 knowledge；不得声称读取了 `search_knowledge` 未返回的全文。

## 2026-06-14 P3 Specialist Agents

- 新增 specialist agent registry，集中声明 specialist name、enabled intents、required tools、produced artifact types 和 handoff policy；Manager 通过 registry 生成 Agents SDK handoff，specialist model 仍由 runtime 统一注入。
- `NormalizedIntent` 扩展到 P3 intent：`document.create`、`document.edit`、`web.fetch`、`research.answer`、`code.create`、`data.analyze`、`workflow.plan`，并保留 image/text/canvas/unsupported。
- 新增 Cucumber Document Agent：负责 Markdown/document 生成和改写；Manager 遇到 `document.create`/`document.edit` 必须 handoff，不直接创建文档 artifact。
- 新增 `create_text_artifact` 工具，写入私有对象存储和 `agent_artifacts`，发出 `artifact_created` 事件，由 runtime materializer 投影为 markdown/document 画布节点；工具不直接写画布节点。
- Tool Registry 新增 `create_text_artifact`，scope 为 `write.artifact` 和 `tool.doc.create`，Trace metadata 继续走统一 redaction/registry 路径。
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
- 删除 `create_artifact`、`attach_artifact`，图片生成 artifact 由 `generate_image` 产生；高清放大 artifact 由 `upscale_image` 或图片 toolbar 直连接口产生。
- Canvas policy 只允许完整便签/形状、位置更新、合法连边和当前 Run 状态；内容节点与 artifact 不可由通用 operation 伪造。
- 删除 Agent v1 runtime、router、kernel、capabilities、旧 prompts/provider、Skill parser/API/UI、审批、Evaluator、附件提交和 legacy event adapter。
- 前端模型选择器删除；模型按 Ark、DeepSeek、OpenAI 的服务端环境优先级选择。
- Trace 和 Run 节点只展示 v2 Agent/handoff、tool、artifact、canvas operation、final text 和 error。
- 新增 `20260611000000_agent_v2_cutover.sql`：删除 v1 数据和旧 runtime 表，保留 v2 Trace 与项目画布，将 `agent_run_step_events` 重命名为唯一 `agent_run_events`。
- Agent v1 文档归档到 `docs/archive/agent-v1/`，旧 process 归档到 `docs/archive/process-through-2026-06-10.md`。

## 2026-06-12 Run Node Streamed Text

- 前端开始消费 AI SDK UI assistant `text` parts，并将当前 Run 的实时文字投影到 `RunNodeData.agentText`。
- Run 节点文字优先级为 `run.completed.finalOutput` 高于当前 streamed text，高于运行状态占位文案；历史 Trace 回放不依赖实时 text Map。
- Run 节点默认收起，仅展示 Agent 流式文字和工具调用摘要；详细 Agent/handoff/timeline 诊断继续通过 Trace 面板查看。
- Run 节点内部滚动区使用 React Flow `nodrag`、`nopan`、`nowheel`，避免滚动文字或工具详情时拖动、平移画布。
- 简单问答、解释、轻量分析或总结任务不调用工具时，`run.completed.finalOutput` 会物化为 Run 节点下游的新 Prompt 结果节点；原始用户输入 Prompt 节点保持不变。

## 2026-06-12 Image Request Boundary

- 新增 `server/agent/tools/image/generate-image.request.ts`，集中负责图片数量、尺寸/比例和 upstream 引用图归一化。
- `generate_image` 工具只做 Agent tool 边界、artifact 事件和图片 provider 调用编排；当前唯一支持的图片 provider 是 `IMAGE_PROVIDER=seedream`。
- `seedream.ts` 收敛为 Seedream provider 执行层，保留配置读取、签名、提交/轮询、并发/重试、取消和 provider metadata。
- 多张图片生成按 `SEEDREAM_MAX_CONCURRENCY` 限制完整 submit+poll 生命周期的并发数，并按 `SEEDREAM_STAGGER_MS` 间隔启动新任务；默认 `SEEDREAM_MAX_CONCURRENCY=1` 会等上一张完整出图或失败后再提交下一张，避免触发 Seedream 账号级并发限制。

## 2026-06-13 Input Normalization

- Agent Run 在 Manager 启动前通过 `server/agent/input-normalizer.ts` 生成结构化 `normalizedInput`，并写入 `input.normalized` Trace。
- 图片生成请求会单独抽取 `contentPrompt`、`resultCount`、`aspectRatio` 或 `dimensions`；`generate_image` 接收这些结构化参数，prompt 文本推断仅作为旧调用兼容。

## 2026-06-13 Multi Node References

- Agent Run 提交支持 `selectedNodeIds`，多选的可引用节点会一起生成到 Prompt 节点的引用边。
- 服务端继续从持久化项目快照重建 upstream context，并过滤 Run 节点；客户端提供的节点列表只作为待验证 id，不提供可信上下文。

## 2026-06-13 Internal MCP Tools

- `generate_image` 已迁为内部 MCP tool，由 `/internal/mcp` 通过 Streamable HTTP 暴露给当前 Agents SDK runtime。
- 内部 MCP endpoint 只接受进程内随机 bearer token；暂不作为外部 API 使用。
- MCP tool input 只包含模型可决定的图片参数；`userId`、`projectId`、`runNodeId`、upstream context 和 artifact URL 继续由服务端 run context registry 注入，不进入模型参数。
- 图片 artifact、tool 事件和错误仍通过现有 Cucumber runtime 事件投影到画布。

## 2026-06-12 Image Node Toolbar

- 图片结果节点选中后显示浮动 toolbar，当前提供放大查看、高清放大、下载和复制四个用户动作。
- 放大查看使用轻量图片预览弹窗，不改变画布节点和 Agent Trace。
- 高清放大 toolbar 动作不创建 Agent Run；它调用 `POST /api/projects/:projectId/images/upscale`，服务端从已保存项目中校验 `sourceNodeId`、签发图片读取 URL、调用 Seedream 智能超清并将新图片节点直接连到原图。
- 复制优先尝试图片二进制；浏览器权限、跨域或读取超时时降级复制稳定图片链接，并在按钮 title 中反馈结果。

## 2026-06-12 Project Persistence

- 项目列表只读取 `agent_projects` 的摘要列，不再拉取完整 `nodes/edges` JSON；`node_count`、`image_count`、`snapshot_bytes` 由服务端保存快照时同步维护。
- 打开画布时先渲染已保存项目快照，`lastRun` Trace 只在后台补齐缺失或状态不完整的 Run 分支。
- Agent runtime 持续写 `agent_run_events`，并在 artifact、canvas operation 和终态事件后由 runtime materializer 将可见 Run 分支物化回 `agent_projects.nodes/edges`。
- 前端保存继续使用 version handshake 和单飞队列；无变化快照通过 digest 跳过 PATCH，变化快照通过 `canvasPatch` 增量提交节点/边 upsert/delete。

## 2026-06-12 Object Storage

- Supabase Storage private bucket `agent-assets` 成为用户上传和 Seedream 生成图片的对象存储边界；画布快照只保存稳定 `ArtifactRef`、`contentRef` 和同源 content API URL。
- 用户拖拽文件会先插入本地预览节点并后台上传；浏览器使用 Supabase signed upload token 直传，再调用 `/complete` 写入 `agent_artifacts`，成功后用真实 artifact 节点替换本地节点。
- 本地上传中/失败的节点不会进入项目持久化或 Agent upstream context；上传失败会留在画布上展示错误状态。
- `generate_image` 和 `upscale_image` 收到 Seedream URL 后由服务端下载并上传到 `agent-assets`，随后才发 `artifact.created`；转存失败会走 `tool.error`/`run.failed`，不会生成假成功结果节点。toolbar 高清放大同样先转存再把真实节点写回项目。
- 上游图片引用对 Manager prompt 仍隐藏真实 URL；调用 Seedream 前，服务端仅根据 `supabase://agent-assets/...` 临时签发 provider 可读 URL。
- Agent 模型 provider 改为 Agents SDK 官方 `ModelProvider` + `Runner({ model, modelProvider })` 写法；Manager、specialist、input normalizer 和 prompt expansion 共用同一 Runner provider 配置。
- 媒体 provider 独立暴露：图片 provider 已接入工具配置检查；视频 provider 仅进入 `/api/health` 配置面，尚未启用 `generate_video`、video artifact 或画布投影。
- 私有预览统一走 `/api/projects/:projectId/artifacts/:artifactId/content`，服务端校验项目权限后 302 到短期 signed read URL。
- P1 typed artifact shell：非图片 artifact 节点统一展示标题、摘要、来源工具/Run、创建时间、大小、预览/打开/下载入口；文本最终回复由 runtime 写入私有对象存储并通过 `artifact.created` 物化为 Markdown 节点。
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
