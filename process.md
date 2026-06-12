# Process

本文记录 2026-06-11 Agent v2 正式切换后的变更。

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
- `generate_image` 工具只做 Agent tool 边界、artifact 事件和 Seedream provider 调用编排。
- `seedream.ts` 收敛为 Seedream provider 执行层，保留配置读取、签名、提交/轮询、并发/重试、取消和 provider metadata。

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
- 私有预览统一走 `/api/projects/:projectId/artifacts/:artifactId/content`，服务端校验项目权限后 302 到短期 signed read URL。

## 2026-06-12 Cloud Skill Management

- 新增 `agent_skill_definitions` 作为当前 OpenAI Agents SDK runtime 的全局技能表；不恢复 Agent v1 Skill API、审批或执行器。
- 当前版本只支持 Image Agent 的 instruction-only `image/prompt_expansion` 技能；zip 导入只读取一个非隐藏 `SKILL.md`，显式拒绝 `scripts/`。
- 新增 `/api/agent-skills` CRUD 和 `/api/agent-skills/import`，所有接口要求登录；列表不返回完整 `skillMd`，详情返回完整内容用于编辑。
- 管理工作台新增“技能”页，可创建、编辑、启停、设默认、软删除和导入 zip。
- Image Agent 新增 `expand_image_prompt` tool；仅当存在启用的默认 `image/prompt_expansion` 技能时暴露。短、关键词式或视觉细节不足的新图片请求会先扩写，再把 `expandedPrompt` 传给 `generate_image`。
- `generate_image` 的工具输出和 artifact metadata 保留实际 Seedream prompt，同时保留原始 run prompt，供 Trace 和图片结果节点追溯。

## Verification

- Context 越权和服务端重建：`server/agent/context.test.ts`
- Agents SDK stream/handoff/tool failure：`server/agent/events/openai-stream-to-cucumber-events.test.ts`
- Agent Run 快照物化：`server/agent/materialize-run.test.ts`
- Canvas policy、技能解析/导入和图片工具/请求归一化：`server/agent/policy/*.test.ts`、`server/agent/skills/*.test.ts`、`server/agent/tools/image/*.test.ts`
- Event projection：`src/lib/graph-projection.test.ts`、`src/lib/runtime-event-renderer.test.ts`
- 项目摘要统计：`src/lib/project-summary.test.ts`
- 对象存储上传和引用签名：`src/lib/file-upload.test.ts`、`server/storage.test.ts`
- 基础检查：`pnpm exec tsc -b --pretty false`、`pnpm build`、相关 ESLint、浏览器验收

