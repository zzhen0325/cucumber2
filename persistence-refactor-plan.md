# 画布数据持久化重构执行清单

> 目标：解决三个问题 —— ①加载慢 ②保存慢 ③丢失节点。
> 原则：小步落地、可独立验证、不破坏现有 Agent 上下文链路、不做兜底降级（错误直接抛出）。

---

## 0. 现状速记（重构前基线）

| 关注点 | 位置 | 现状 |
|---|---|---|
| 存储 | `agent_projects` 表 `nodes jsonb` / `edges jsonb` | 整张画布两个 jsonb 数组存单行 |
| 保存触发 | [CanvasWorkspace.tsx:841-870](src/components/CanvasWorkspace.tsx) | 420ms 防抖，监听 nodes/edges/selectedNodeId/projectTitle |
| 保存实现 | [CanvasWorkspace.tsx:769-814](src/components/CanvasWorkspace.tsx) | 全量 PATCH，读 `nodesRef/edgesRef` |
| 卸载兜底 | [CanvasWorkspace.tsx:816-839](src/components/CanvasWorkspace.tsx) | pagehide/visibilitychange + keepalive |
| 加载 | [CanvasWorkspace.tsx:679-737](src/components/CanvasWorkspace.tsx) | 一次性全量 + lastRun 投影合并 |
| API client | [project-storage.ts:75-95](src/lib/project-storage.ts) | `JSON.stringify` 全量 PATCH |
| 服务端写入 | [supabase.ts:383-421](server/supabase.ts) | 整列覆盖 `.update(payload)` |
| schema | [20260607000000_user_projects.sql:39-54](supabase/migrations/20260607000000_user_projects.sql) | 无 version 列，仅 updated_at 触发器 |

**根因**：
1. 丢节点 = 全量整列覆盖 + 无并发保护（in-flight 请求不取消/不排队，无乐观锁，慢请求乱序到达 → 旧覆盖新）。
2. 保存慢 = 任意小改动都全量序列化所有节点（含 markdown blockNoteBlocks、image 大字段）整列覆盖（写放大）。
3. 加载慢 = 一次性拉取整行大 jsonb + 反序列化 + 一次性 setNodes，无懒加载。

---

## 阶段一：并发保护（解决「丢节点」，最高优先级）

> 数据正确性问题优先。目标：保证写入串行化 + 拒绝过期写，杜绝乱序覆盖。
> ✅ 已完成（2026-06-10）。

### 1.1 数据库：新增 `version` 乐观锁列
- [x] 新增 migration `supabase/migrations/20260610000000_agent_projects_version.sql`
  - `alter table public.agent_projects add column if not exists version bigint not null default 0;`
- [ ] 本地/远程应用迁移（远程历史冲突时按惯例用 `supabase db query --linked` 直接执行）。**← 需手动执行**

### 1.2 服务端：写入做 version 校验 + 自增（CAS）
- [x] `server/supabase.ts` `AgentProject`/`ProjectRow` 增加 `version`；`mapProjectRow` 透出；新增 `ProjectVersionConflictError`。
- [x] `UpdateProjectInput` 增加可选 `expectedVersion?: number`。
- [x] `updateProjectForUser`：传入 `expectedVersion` 时 `.eq("version", expectedVersion)` + `version: expectedVersion + 1`；命中 0 行抛 `ProjectVersionConflictError`（带服务端最新快照）。

### 1.3 API：透传 version，冲突返回 409
- [x] `server/api.ts` `projectPatchSchema` 增加 `expectedVersion`。
- [x] PATCH 路由捕获版本冲突 → 409 `{ error, code: "version_conflict", project }`。

### 1.4 前端：保存串行化 + 单飞 + version 协调
- [x] `project-storage.ts` 类型增加 `version`/`expectedVersion`；`updateProject` 识别 409 抛 `ProjectVersionConflictError`（带最新 project）。
- [x] `CanvasWorkspace.tsx`：`projectVersionRef` 加载时记录；`saveProjectSnapshot` 改为单飞 + 待重跑（`isSavingRef`/`pendingSaveRef`）；捕获冲突对齐 version 并最多重试 3 次。
- [ ] 验证：快速连续拖动 + 慢网络（DevTools throttling）下，节点不回退、不丢失。**← 建议手动回归**

---

## 阶段二：减小写体积（解决「保存慢」）

> 目标：小改动不再全量序列化所有大字段。
> ✅ 2.1 / 2.2 已完成（2026-06-10）。

### 2.1 保存前裁剪易变大字段（低风险，先做）
- [x] 新增 `src/lib/canvas-persistence.ts` `toPersistableNodes(nodes)`：去掉 markdown 节点 `artifact.metadata.blockNoteBlocks` 冗余拷贝（读取端优先 `data.blockNoteBlocks`，无损），在 `saveProjectSnapshot` 中应用。
- [x] image 节点 `url` 现状为远端 URL，未额外裁剪；如出现 base64 再按「不做兜底」抛错处理。
- [x] 测试：`pnpm test` 全绿（含 `src/lib/graph.test.ts`），上下文收集不受影响。

### 2.2 拆分保存频率：高频结构 vs 低频内容
- [x] `hasNodeContentChanged`（`data` 引用比较）区分内容编辑（800ms）与位置/选中（250ms）；二者共用阶段一的单飞保存通道。

### 2.3（可选，体积仍大时）大字段分表
- [ ] 评估将 markdown `blockNoteBlocks`、artifact metadata 拆到独立表，画布行只存引用 id 与轻量摘要。
- [ ] 仅当 2.1/2.2 后单行仍过大才做，避免过度设计。**← 暂缓，按实测决定**

---

## 阶段三：加载优化（解决「加载慢」）

> 3.1 诊断已落地（2026-06-10）；3.2 待实测后按瓶颈实施。

### 3.1 加载阶段计时与诊断
- [x] 加载流程新增 DEV-only `[canvas-load]` 结构化日志：节点/边数、payload 字节、fetch/hydrate/total 毫秒。

### 3.2 首屏轻量化
- [ ] 若瓶颈在 setNodes 渲染：首屏只灌结构 + viewport 内节点，大字段随 React Flow `onlyRenderVisibleElements` / 进入视口再 hydrate。**← 待诊断数据**
- [ ] 配合 2.1：若大字段已分离，`loadProject` 默认只返回轻量快照，大字段按需懒加载。

### 3.3 投影合并成本控制
- [x] 复核 `hydrateProjectSnapshotFromLastRun`：现状已仅在 `lastRunId` 存在且 trace 有事件时才投影，无需进一步收紧（无更可靠的「已落盘」判据，避免引入风险）。

---

## 验证清单（每阶段完成后）

- [ ] `pnpm lint` 与改动相关检查通过。
- [ ] `pnpm test`（至少 `src/lib/graph.test.ts`）通过。
- [ ] 手动：`/api/health` 正常；新建/编辑/拖动/删除节点后刷新页面，数据完整一致。
- [ ] 手动（阶段一重点）：慢网络 + 高频改动场景，反复刷新校验无节点丢失/回退。
- [ ] 完成后同步更新 `README.md` / `process.md` 变更记录与（如有）环境变量、新增接口说明。

---

## 落地顺序建议

1. 阶段一（1.1 → 1.4）：先修数据正确性。
2. 阶段二 2.1 + 2.2：见效快、风险低。
3. 阶段三 3.1 诊断 → 按瓶颈决定 3.2/3.3。
4. 2.3 / 3.2 分表与懒加载仅在确有必要时实施，避免过度设计。
