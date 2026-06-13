# Cucumber

Infinite Canvas Agent Run MVP。前端使用 Vite、React、TypeScript、React Flow 和 AI Elements；服务端使用 Hono 与 OpenAI Agents SDK。

## Agent Runtime

项目只有一套 Agent 运行时：

- API：`POST /api/agent-run`；停止运行使用同一路径的 `DELETE` 方法
- 实现：`server/agent/`
- 编排：每次运行创建独立 Manager/Image Agent；Manager 通过 Agents SDK handoff 委派给 Image Agent
- 失败 Run 节点显示重试按钮；重试会保留原失败节点，并用原 prompt 与原上游锚点创建新的可见 Agent Run 分支
- 图片工具：`expand_image_prompt` 只使用已激活的 image prompt-expansion skill，`generate_image` 调用 Seedream 生成图片，`upscale_image` 调用 Seedream 智能超清
- Agent OS 技能流：服务端从持久化画布重建可信上下文，检索启用技能的 metadata，首轮只注入 skill cards；模型必须调用 `activate_skill` 才能读取完整 `SKILL.md`，脚本只能通过 `run_skill_script` 执行
- 画布变更：Agent 只能提出 `CanvasOperation`，由 runtime policy 校验后投影到画布
- 流协议：AI SDK UI `createUIMessageStream` + `data-runtime-event`

客户端只提交 `projectId`、`runNodeId`、prompt、`promptNodeId` 和 `selectedNodeId`。提交前会强制保存项目快照；服务端从持久化 `nodes/edges` 重建 upstream context，不信任客户端上传的节点、artifact 或 URL。

模型按服务端环境固定优先级选择：Ark、DeepSeek、OpenAI。前端没有模型选择器，也没有 runtime feature flag。

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

图片生成还需要 `SEEDREAM_ACCESS_KEY_ID` 和 `SEEDREAM_SECRET_ACCESS_KEY`。项目、Trace 和对象存储 metadata 持久化需要 `SUPABASE_URL` 与 `SUPABASE_SECRET_KEY`。

智能超清默认使用 `SEEDREAM_UPSCALE_REQ_KEY=jimeng_i2i_seed3_tilesr_cvtob`、`SEEDREAM_UPSCALE_RESOLUTION=4k` 和 `SEEDREAM_UPSCALE_SCALE=50`；toolbar 直连放大不创建 Agent Run，但会保存新的图片 artifact、节点和原图连线。

浏览器直传 Supabase Storage 还需要公开环境变量：

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`，或兼容旧命名的 `VITE_SUPABASE_ANON_KEY`

不要把 `SUPABASE_SECRET_KEY` / service role key 暴露到前端。

`GET /api/health` 返回 `agentConfigured`、`agentProvider`、`agentModel`、`seedreamConfigured` 和 `supabaseConfigured`。

## Persistence

持久化表：

- `agent_projects`：项目标题、画布 nodes/edges、选中节点和 `last_run_id`
- `agent_run_events`：唯一 Agent Trace 事件表
- `agent_artifacts`：artifact metadata、对象存储 bucket/path 和稳定 content ref
- `agent_skill_definitions`：全局技能定义、`SKILL.md`、启用状态和默认选择
- `app_users`、`app_sessions`：本地账号和会话

对象存储：

- bucket：`agent-assets`，private，单文件上限 50MB
- bucket：`agent-skill-packages`，private，单包上限 5MB，仅存储导入的技能 zip 包
- 用户上传路径：`projects/{projectId}/uploads/{uploadId}/{fileName}`
- 生成图片路径：`projects/{projectId}/runs/{runNodeId}/artifacts/{artifactId}.{ext}`
- 技能包路径：`skills/{skillName}/{sha256}.zip`
- 画布只保存 `/api/projects/:projectId/artifacts/:artifactId/content` 和 `supabase://agent-assets/...` 稳定引用；实际读取由服务端校验权限后签发短期 URL。
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
- `POST /api/agent-skills`、`POST /api/agent-skills/import`
- `PATCH /api/agent-skills/:skillId`、`DELETE /api/agent-skills/:skillId`
- `POST /api/agent-run`
- `DELETE /api/agent-run?projectId=...&runNodeId=...`

已删除 `/api/agent-run-v2`、`/api/model-providers` 和全部旧 `/api/skills`。新 `/api/agent-skills` 属于当前 OpenAI Agents SDK runtime，不恢复 Agent v1 Skill 栈。

## Agent Skill Contract

`SKILL.md` 必须包含 YAML frontmatter：

- 必填：`name`、`description`
- 可选：`agent_scope`、`purpose`、`tags`、`triggers.keywords`、`triggers.canvas_kinds`、`bindings.tools`、`bindings.agents`
- 可选脚本：`scripts[]`，每项声明 `name`、`path`、`runtime: node|python`、`description`、JSON input/output 期望

zip 导入只接受一个 `SKILL.md` 和声明过的 `scripts/**/*.mjs|*.js|*.py`，拒绝路径穿越、未声明脚本、重复脚本名、超 5MB 包和不支持文件。脚本从 `agent-skill-packages` 下载，校验 SHA-256 后在临时目录中通过 `sandbox-exec` 执行，JSON stdin/stdout，15 秒超时，空 secret 环境；没有 sandbox 支持时直接失败并写入 Trace。

Trace 新增 `skill.retrieved`、`skill.activated`、`skill.script.started`、`skill.script.completed`、`skill.script.failed`。Run Trace 面板显示 Skills 区；Run 节点摘要只显示技能名称，不展示 package path。

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
- `process.md`：2026-06-11 起的 v2 变更记录
- `design.md`：UI 设计语言
- `docs/archive/agent-v1/`：Agent v1 历史文档，不再是实现依据
- `docs/archive/process-through-2026-06-10.md`：旧变更记录
- `persistence-refactor-plan.md`：独立持久化计划，未随 Agent cutover 修改
