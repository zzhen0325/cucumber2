# Cucumber Agent Canvas

Infinite-canvas Agent Run MVP: type a requirement, stream an Agent Run node, call a real `generate_image` tool, render image result nodes, then select a non-Run canvas node to create a contextual follow-up branch.

Agent Run nodes display streamed text, a step timeline, tool state, and an advanced trace entry. Tool errors remain visible in the Run node and do not create placeholder image results.

## Stack

- Vite + React + TypeScript
- Vercel AI SDK v6 via `useChat`, `DefaultChatTransport`, and `streamText`
- DeepSeek and Volcengine Ark as selectable text model providers
- Public Skill system for prompt expansion before image generation
- Volcengine Seedream 4.6 for image generation
- Tavily AI SDK for web research search sources
- Supabase Postgres for users, projects, skills, canvas snapshots, and run event storage
- AI Elements registry components for Canvas, Node, Edge, Tool, Message, and Prompt Input
- React Flow under the AI Elements canvas
- Hono Node server for `/api/agent-run`, backed by Vercel AI SDK streaming tool calling, a service-side Tool Registry, policy gate, and artifact metadata store
- OpenAI Agents SDK v2 runtime behind `/api/agent-run-v2`, using a reusable Runner, a focused Manager Agent, and proposal-first canvas tools
- Graph projection reducer for replaying run events, artifacts, and graph patch proposals back into canvas nodes and edges

## Run Locally

```bash
pnpm install
cp .env.example .env
pnpm dev
```

The app runs at `http://localhost:5173`.

The API server runs at `http://127.0.0.1:8787` and Vite proxies `/api/*`.

## Environment

```bash
DEEPSEEK_API_KEY=...
DEEPSEEK_MODEL=deepseek-v4-flash
DEEPSEEK_BASE_URL=https://api.deepseek.com

ARK_API_KEY=...
ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
ARK_MODEL=doubao-seed-2-0-lite-260428

SEEDREAM_ACCESS_KEY_ID=...
SEEDREAM_SECRET_ACCESS_KEY=...
SEEDREAM_REQ_KEY=jimeng_seedream46_cvtob
SEEDREAM_WIDTH=1024
SEEDREAM_HEIGHT=1024
SEEDREAM_MAX_OUTPUT_IMAGES=4
SEEDREAM_SCALE=50

TAVILY_API_KEY=...

SUPABASE_URL=https://wbjqqywnwmghtcwpoatb.supabase.co
SUPABASE_SECRET_KEY=...

OPENAI_API_KEY=...
VITE_AGENT_V2=0

# Optional: required when a proxy/VPN injects a private root CA.
SEEDREAM_CA_CERT_PEM="-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"
# Or use a local certificate file path:
NODE_EXTRA_CA_CERTS=/absolute/path/to/corp-root-ca.pem
SEEDREAM_CA_CERT=/absolute/path/to/corp-root-ca.pem
```

`DEEPSEEK_API_KEY` and `ARK_API_KEY` configure selectable text model providers. The canvas stores the user's global provider preference in browser localStorage under `cucumber:model-provider` and sends it with each `/api/agent-run` request. Reference-image branches do not require Ark visual analysis; the language model receives only lightweight reference metadata. Keep API keys server-only; rotate any key that has been pasted into chat or logs.

`/api/agent-run-v2` runs on the OpenAI Agents SDK and picks its model provider from the environment: it prefers Doubao (Volcengine Ark) via the OpenAI-compatible Responses API when `ARK_API_KEY` is set (model from `ARK_MODEL`, base URL from `ARK_BASE_URL`), then DeepSeek's Chat Completions endpoint when `DEEPSEEK_API_KEY` is set, and finally the native OpenAI provider (`OPENAI_API_KEY`) when neither is configured. Set `VITE_AGENT_V2=1` at build time, or run `localStorage.setItem("cucumber:agent-v2", "1")` in the browser console and reload, to switch the front end from `/api/agent-run` to `/api/agent-run-v2`.

`SEEDREAM_ACCESS_KEY_ID` and `SEEDREAM_SECRET_ACCESS_KEY` are required by the `generate_image` tool. The Seedream client also accepts `VOLCENGINE_ACCESS_KEY_ID` and `VOLCENGINE_SECRET_ACCESS_KEY` as aliases. Missing credentials are shown directly in the Run node; the app does not create placeholder images.

`TAVILY_API_KEY` is required by the `web.search` tool from `@tavily/ai-sdk`. Web research requests route through Tavily search first, then the main `streamText` model writes source-grounded Markdown as `document.write` input; `document.write` only validates and artifactizes that Markdown onto the canvas. Missing Tavily credentials are shown directly in the Run node.

Image generation also requires a public `prompt-expand` skill. Upload `/Users/bytedance/Desktop/prompt-expand-skill.zip` or another zip with a `SKILL.md` frontmatter `name: prompt-expand` from the canvas Skill panel. The server stores the parsed skill in `public.agent_skills`, including `SKILL.md` instructions, parsed `config/*.json`, optional capability manifest metadata, and the source manifest. It does not install, start, or execute code from uploaded zips.

When the prompt explicitly asks for multiple results, such as `一次生成4张图片`, the prompt expansion stage first decides the batch mode. A plain multi-result request uses one expanded prompt and asks Seedream for that many outputs from the same prompt. A request that explicitly asks for different results, such as `生成4张不同的小狗图`, returns four expanded prompts and the server submits them to Seedream as four single-image requests. `SEEDREAM_MAX_OUTPUT_IMAGES` caps explicit requests; prompts above the cap fail visibly in the Run node instead of silently returning fewer images.

Seedream reference images are sent directly as `image_urls` from upstream image result or image artifact nodes. The intent router, planner, prompt expansion model, and main Agent model never receive the image URL, data URL, artifact URI, or image bytes; they only receive `referenceImageAvailable: true` plus textual node metadata. The `generate_image` tool also uses AI SDK `toModelOutput` to return only a generated-image count to the model, while the complete URLs remain available to UI projection and artifact storage. Multiple upstream image URLs are supported and deduplicated before Seedream submission. If the user prompt includes explicit dimensions such as `2048x2048`, the request sends `width` and `height`; if it includes a ratio/orientation such as `16:9`, `横版`, `竖版`, or `方图`, the server computes matching `width`/`height`; if it only includes `2K` or `4K`, the request sends Seedream `size`. `SEEDREAM_SCALE` is optional and maps to Seedream `scale`.

`SUPABASE_URL` and `SUPABASE_SECRET_KEY` are required by the Hono API for database storage. Keep `SUPABASE_SECRET_KEY` server-only; do not expose it with a `VITE_` prefix. The current Supabase project is `cucumber2` (`wbjqqywnwmghtcwpoatb`).

If Seedream or Supabase requests fail with certificate errors such as `SELF_SIGNED_CERT_IN_CHAIN` or `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`, point `NODE_EXTRA_CA_CERTS` to a trusted PEM file. The local `dev:api` script defaults to `/etc/ssl/cert.pem`, which fixes Node certificate validation on macOS setups where `curl` can reach Supabase but Node cannot. Seedream also accepts `SEEDREAM_CA_CERT_PEM` or `SEEDREAM_CA_CERT` for tool-specific HTTPS requests.

## Supabase Storage Contract

The database stores user-owned projects without introducing a second frontend canvas state model:

- `public.app_users`: MVP name/password users; passwords are stored as scrypt hashes.
- `public.app_sessions`: hashed httpOnly cookie session tokens with expiry.
- `public.agent_projects`: user-owned project snapshots with `nodes`, `edges`, `selected_node_id`, `last_run_id`, and soft-delete `deleted_at`.
- `public.agent_skills`: public uploaded skills, owned by the uploader, with parsed instructions, config, source manifest, optional `capabilityManifest`, and soft-delete `deleted_at`.
- `public.agent_run_events`: append-only run events keyed by `project_id` and `run_node_id`, including prompt, upstream context, tool input, output, status, and error text.
- `public.agent_run_step_events`: append-only kernel trace events keyed by `project_id`, `run_node_id`, and `step_id`, including `run.created`, `step.started`, `step.finished`, `tool.execution.started`, `tool.execution.finished`, `tool.input`, `tool.output`, `tool.error`, `artifact.created`, `run.completed`, and `run.failed`.
- `public.agent_artifacts`: artifact metadata keyed by artifact id, with `type`, `uri`, `content_ref`, title, metadata, run node, and tool call references. Large or binary content is stored by URL/storage key/content ref, not inline in the row.

All public tables have RLS enabled. Anonymous and browser-authenticated roles are revoked; server reads and writes use the Supabase secret key through `/api/auth/*`, `/api/projects/*`, and `/api/agent-run`.

The migration files live in `supabase/migrations`. Apply them before uploading skills or running agent traces; otherwise `/api/skills` will report that the Skill storage table is missing, `/api/agent-run` will report that `agent_run_step_events` is missing, or image generation will report that `agent_artifacts` is missing. Existing `agent_canvases` data is renamed to `agent_projects` and remains unowned until the first user registers, at which point the API assigns those unowned projects to that user.

## Project API

- `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- `GET /api/projects`, `POST /api/projects`
- `GET /api/projects/:projectId`, `PATCH /api/projects/:projectId`, `DELETE /api/projects/:projectId`
- `GET /api/projects/:projectId/runs/:runNodeId/trace`
- `GET /api/skills`, `POST /api/skills`
- `PATCH /api/skills/:skillId`, `DELETE /api/skills/:skillId`
- `GET /api/model-providers`

`DELETE /api/projects/:projectId` soft-deletes the project. `/api/agent-run` requires a logged-in session and receives `projectId` in the request body.

Uploaded skills are public and visible to every logged-in user. Only the uploader can edit or delete a skill. `POST /api/skills` accepts multipart form data with a `.zip` file under the `file` field.

## Canvas Branching

Submitting from the bottom composer with no referenced node creates a new root `prompt -> run` chain. Selecting a single non-Run node makes it the reference for the next submission and creates `selected node -> prompt -> run`, including image, Markdown document, document, code, webpage, memory, decision, tool-result, generic artifact, sticky note, and shape nodes. Dragging a parent node moves all downstream child nodes that are connected through `source -> target` edges, preserving the visible branch layout. Dragging on the empty canvas marquee-selects multiple nodes for group movement or deletion; multi-selection does not create a branch anchor. Agent Run nodes are status views only; selecting one does not create a branch anchor.

The viewport controls include an auto-layout action backed by Dagre. New node or edge additions are automatically reflowed after project load, while manual node dragging is preserved because pure position changes do not retrigger auto-layout.

Files can be dragged directly onto the canvas to create preview nodes when the existing node taxonomy can carry the file. Images become `imageResultNode` previews backed by data URLs, Markdown files become editable `markdownNode` BlockNote document previews, and code, document, webpage, dataset, or generic files become artifact-backed preview cards with file metadata and a text snippet when readable. Uploaded nodes are saved with the project snapshot; selecting a single uploaded image or artifact can anchor the next follow-up branch just like generated nodes.

The left tool rail includes sticky note and shape tools directly. Select a tool, then drag on the empty React Flow pane to draw a persisted `stickyNoteNode` or `shapeNode` at that size; sticky note text and shape labels are editable in-place and saved with the project snapshot.

Composer pasted or dropped files are sent to `/api/agent-run` as lightweight `AgentInput.attachments` metadata. Data URLs are represented with `contentRef` and a short preview summary. Image attachment URIs and image content refs are removed from every model-facing prompt, while the original server-side reference remains available to the image generation tool. Before normalization, the server checks the selected node, upstream context nodes, and upstream artifact ids against the user-owned project snapshot.

When an Agent/tool output returns a Markdown document, the graph projection layer creates a dedicated `markdownNode` instead of leaving the content inside Run text. Supported output shapes include `{ markdown, title }`, `documents[]` entries with `markdown` or `content`, and `doc` artifacts whose metadata marks `format: "markdown"` or `mimeType: "text/markdown"` and carries `metadata.markdown`, `metadata.content`, or `metadata.text`. The node renders as an editable BlockNote document, saves native BlockNote blocks in `metadata.blockNoteBlocks`, keeps the latest Markdown in `content` / `metadata.markdown`, and can be selected as upstream document context for follow-up branches. Trace replay renders Markdown nodes read-only.

Run nodes include user-level summaries for intent, context, plan, artifacts, step timeline, tool state, and evaluator results. The compact summary is projected from runtime events and avoids raw ids, tool call ids, and full prompts; detailed audit data stays in Trace. Once the router emits an image-generation intent, the graph projection pre-allocates loading image result nodes from the requested image count and prompt size/ratio hints, then fills those nodes in place as `artifact.created` events arrive. Loading or failed placeholder image nodes are not valid follow-up branch anchors. When evaluation fails, the Run title says `质量检查未通过`; the `准备重试` / `准备修正` action selects the old result or prompt as the next branch anchor and fills the composer with the evaluator recommendation, but the user must submit again before a new follow-up branch is created. The trace button opens the advanced trace panel, which reads `agent_run_step_events` through `/api/projects/:projectId/runs/:runNodeId/trace` and shows run snapshot, intent, context budget/tool exposure, selected/omitted context reasons, skill injection reason, raw and normalized plan summaries, plan validation, step timeline, prompt parts, capability selection, tool IO, retry attempts, artifact refs, canvas operations, full evaluation detail, errors, and graph patches. The replay action projects the event log into a read-only canvas view; manually saved node positions from the project snapshot are reused when node ids match, so dragging nodes in the normal canvas is not overwritten by replay.

## Skill And Seedream Tool Contract

Every `/api/agent-run` delegates to `server/runtime/executor.ts`, which now hands the main path to `server/runtime/ai-sdk-runner.ts`. The runner normalizes input into `AgentInput`, creates an `AgentRun` snapshot, then performs server-side structured planning before the AI SDK runtime tool loop starts. `routeIntent` uses schema-validated structured output to produce `IntentResult`, with the layered shape `primaryIntent` -> `task.targets` / `task.operations` / `task.constraints` / `task.deliverables` -> `confidence` / `ambiguity` -> `requiredCapabilities` / `requiredTools`; `createPlan` uses schema-validated structured output when a route needs model-authored `PlanStep[]`. The server validates the intent against the registered capability and tool allowlist, builds the budgeted `BuiltContext`, validates the plan, writes `intent.routed`, `context.built`, and `plan.created` trace events, then starts `streamText` with `toolChoice: "auto"` and AI SDK `activeTools` restricted to the verified runtime tools. There is no model-side forced `plan_agent_run` tool call; planning remains visible in Run nodes through server-authored trace events. `streamText.onStepFinish` records each completed model step with step number, text, tool calls, tool results, finish reason, usage, and model metadata; `experimental_onToolCallStart` / `experimental_onToolCallFinish` record tool execution lifecycle timing and success/error summaries. Native AI SDK text and tool chunks are streamed to the client, while custom AI SDK UI data parts keep canvas projection and trace state in sync: `data-run-status` for run lifecycle, `data-artifact-created` for produced artifacts, `data-canvas-operation` for validated canvas mutations, `data-trace-pointer` for persisted trace row pointers, and `data-runtime-event` for remaining detailed runtime events. The old `server/run-kernel.ts` remains as a compatibility contract for legacy tests, but it is no longer the main endpoint path. Its `adaptKernelRunToAgentRun` helper maps legacy `success/error` statuses to `completed/failed` and preserves prompt/run ids, tool call data, artifact refs, canvas patch proposals, and error text in a schema-valid `AgentRun`; the old image-only orchestration is explicitly named `executeLegacyImageAgentRunForTests`.

The current runtime Tool Registry registers `prompt.expand`, `seedream.generateImage`, `document.write`, `web.search`, `web.read`, `asset.analyzeContext`, `html.generate`, and canvas proposal tools for `canvas.createNode`, `canvas.updateNode`, `canvas.createEdge`, and `canvas.attachArtifact`. Tool implementations live by domain under `server/runtime/tools/`: image generation tools in `image-tools.ts`, Markdown document output in `document-tools.ts`, HTML/webpage tools in `web-page-tools.ts`, canvas proposal tools in `canvas-tools.ts`, and shared tool ids/versioning in `ids.ts`. AI SDK tool names are sanitized for provider compatibility, for example `web.read` is exposed as `web_read`; HTML generation is exposed directly as `generate_html`. Image requests plan and call `expand_prompt` before `generate_image`; upstream images bypass language-model analysis and are injected by the server directly into Seedream `image_urls`. Web research/current-source requests should call `web_search` before `write_document`, and text-first requests such as analysis, summaries, reports, plans, answers, and capability gap reports should use `write_document` so the result becomes a Markdown `doc` artifact rendered as a canvas `markdownNode`. `write_document` is an artifactizer: the main `streamText` model must pass `title`, complete `markdown`, `summary`, and optional `sourcesUsed`; the tool does not call another model. Page, component, landing-page, website, or HTML requests should call `generate_html`; compound page requests can call `web_search` or `web_read`, `write_document`, `generate_html`, and `canvas_create_node` when the structured plan requires research, source analysis, page generation, and canvas placement. `generate_html` requires a complete standalone single-file HTML document with CSS in `<style>`, any JS in `<script>`, and no external dependencies; it returns a `webpage` artifact rendered as a previewable canvas node. The latest compatible public skill with `slug === "prompt-expand"` is used when no explicit `prompt.expand` manifest exists. If no such skill exists for an image route, model credentials are missing, planning fails, policy denies execution, schema validation fails, an unregistered tool is referenced, a tool times out, or any tool stage fails, the Run node shows the error and the runtime does not create fake successful artifacts.

Unsupported or not-yet-executable non-image requests should not fall through to image generation. Server-side structured planning is constrained to the registered tool allowlist, and plan validation rejects unknown tools, missing tool ids, missing intent-required tools, and dependency references to unknown steps.

The runtime records compatible `agent_run_events`, finer `agent_run_step_events` trace rows, and current snapshots in `agent_runs` / `agent_run_steps` after applying `supabase/migrations/20260608005000_agent_runtime_core.sql`. Trace payloads include normalized input, AI SDK planning output, context selection, tool IO with tool definition version, schema digests, duration, and logs, artifact refs, canvas operation proposals, graph patch compatibility events, evaluator output, and errors. `server/runtime/context-builder.ts` owns context selection, budget, skill injection, tool exposure, and the model-safe runtime `promptParts` consumed by prompt expansion, document writing, and generated page tools; `server/prompts.ts` remains the renderer/helper layer for section formatting and legacy run-kernel prompt compatibility.

The evaluator marks artifact completeness and canvas policy failures with typed issue codes including `IMAGE_ARTIFACT_COUNT_MISMATCH`, `ARTIFACT_MISSING`, `IMAGE_ARTIFACT_URL_MISSING`, and `CANVAS_OPERATION_REJECTED`. Artifact-related failures recommend regeneration from the failed Run while preserving upstream context; rejected canvas operations recommend checking Run Trace before retrying.

The frontend graph projection layer lives in `src/lib/graph-projection.ts`. It accepts only validated graph patch proposals (`createNode`, `updateNode`, `createEdge`, `setNodeStatus`, `attachArtifact`) and rejects duplicate nodes, dangling edges, illegal node kinds, and project-id mismatches. `collectUpstreamContext` is artifact-aware and keeps selected context highest priority while recording omitted context in `contextTrace` when a budget is applied.

Canvas operation tools only return proposals. The server validates project id, node kind, edge endpoint, target-node permission, and produced-artifact ownership through `server/runtime/canvas-operation-policy.ts` before writing `canvas.operation.applied`; rejected operations become `canvas.operation.rejected` events and `CANVAS_PATCH_REJECTED` run errors, so they remain visible in Trace and cannot silently mutate the project snapshot.

Capability manifests can be supplied in `SKILL.md` frontmatter or as `manifest.json`, `capability.json`, `config/manifest.json`, or `config/capability.json` inside the uploaded zip. Supported manifest fields are `capabilityId`, `version`, `description`, `triggers`, `inputSchema`, `outputSchema`, `toolIds`, `tokenBudget`, `requiresApproval`, and optional `policy`. Policy records whether a capability can use the network, write files, modify the project, require approval, or create external cost. The built-in `image.generate` capability is marked as networked and potentially external-costing, but does not require approval by default.

`expand_prompt` receives the current prompt plus upstream canvas context:

```json
{
  "prompt": "current user prompt",
  "selectedNodeId": "prompt-or-image-node-id-or-null",
  "skillSlug": "prompt-expand",
  "modelProvider": "deepseek-or-ark",
  "upstreamContext": [
    {
      "nodeId": "prompt-1",
      "type": "prompt",
      "prompt": "original requirement",
      "summary": "original requirement"
    },
    {
      "nodeId": "image-1",
      "type": "image",
      "prompt": "prompt that produced the image",
      "summary": "Generated image",
      "referenceImageAvailable": true
    }
  ]
}
```

It returns `expandedPrompts`, `promptBatchMode`, and `requestedResultCount`. For `single_prompt`, `expandedPrompts` must contain exactly one prompt and `generate_image` requests `requestedResultCount` Seedream outputs from that same prompt. For `distinct_prompts`, `expandedPrompts` must contain one prompt per requested image and `generate_image` submits one Seedream request per prompt. The model-facing prompt expansion input contains only the safe metadata above; the server separately passes the original image node URLs to Seedream as reference images, resolves explicit size/aspect-ratio hints into Seedream geometry fields per prompt, disables Seedream `force_single` for same-prompt multi-result requests, then returns:

```json
{
  "images": [
    {
      "id": "image-id",
      "url": "https://cdn.example/result.png",
      "title": "optional title",
      "metadata": {}
    }
  ],
  "artifacts": [
    {
      "id": "image-id",
      "type": "image",
      "uri": "https://cdn.example/result.png",
      "title": "optional title",
      "metadata": {}
    }
  ]
}
```

The `images` array remains for existing canvas projection compatibility. Each image may also include an `artifact` ref, and the same ref is written to `public.agent_artifacts` before the Run node receives the tool output.

## Scripts

```bash
pnpm dev
pnpm test
pnpm lint
pnpm build
```
