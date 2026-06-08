# Cucumber Agent Canvas

Infinite-canvas Agent Run MVP: type a requirement, stream an Agent Run node, call a real `generate_image` tool, render image result nodes, then select a non-Run canvas node to create a contextual follow-up branch.

Agent Run nodes display streamed text, a step timeline, tool state, and an advanced trace entry. Tool errors remain visible in the Run node and do not create placeholder image results.

## Stack

- Vite + React + TypeScript
- Vercel AI SDK v6 via `useChat`, `DefaultChatTransport`, and `streamText`
- DeepSeek and Volcengine Ark as selectable text model providers
- Volcengine Ark Responses API for reference image analysis
- Public Skill system for prompt expansion before image generation
- Volcengine Seedream 4.6 for image generation
- Supabase Postgres for users, projects, skills, canvas snapshots, and run event storage
- AI Elements registry components for Canvas, Node, Edge, Tool, Message, and Prompt Input
- React Flow under the AI Elements canvas
- Hono Node server for `/api/agent-run`, backed by a service-side Run Kernel, capability router, policy gate, and artifact metadata store
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
ARK_MAX_REFERENCE_IMAGES=4

SEEDREAM_ACCESS_KEY_ID=...
SEEDREAM_SECRET_ACCESS_KEY=...
SEEDREAM_REQ_KEY=jimeng_seedream46_cvtob
SEEDREAM_WIDTH=1024
SEEDREAM_HEIGHT=1024
SEEDREAM_MAX_OUTPUT_IMAGES=4

SUPABASE_URL=https://wbjqqywnwmghtcwpoatb.supabase.co
SUPABASE_SECRET_KEY=...

# Optional: required when a proxy/VPN injects a private root CA.
SEEDREAM_CA_CERT_PEM="-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"
# Or use a local certificate file path:
NODE_EXTRA_CA_CERTS=/absolute/path/to/corp-root-ca.pem
SEEDREAM_CA_CERT=/absolute/path/to/corp-root-ca.pem
```

`DEEPSEEK_API_KEY` and `ARK_API_KEY` configure selectable text model providers. The canvas stores the user's global provider preference in browser localStorage under `cucumber:model-provider` and sends it with each `/api/agent-run` request. `ARK_API_KEY` is also required when a follow-up branch includes reference image nodes because the server runs an `analyze_reference_images` stage through Ark Responses image input. Keep API keys server-only; rotate any key that has been pasted into chat or logs.

`SEEDREAM_ACCESS_KEY_ID` and `SEEDREAM_SECRET_ACCESS_KEY` are required by the `generate_image` tool. The Seedream client also accepts `VOLCENGINE_ACCESS_KEY_ID` and `VOLCENGINE_SECRET_ACCESS_KEY` as aliases. Missing credentials are shown directly in the Run node; the app does not create placeholder images.

Image generation also requires a public `prompt-expand` skill. Upload `/Users/bytedance/Desktop/prompt-expand-skill.zip` or another zip with a `SKILL.md` frontmatter `name: prompt-expand` from the canvas Skill panel. The server stores the parsed skill in `public.agent_skills`, including `SKILL.md` instructions, parsed `config/*.json`, optional capability manifest metadata, and the source manifest. It does not install, start, or execute code from uploaded zips.

When the prompt explicitly asks for multiple results, such as `一次生成4张图片`, the tool requests that many Seedream output URLs and renders them as sibling image result nodes. `SEEDREAM_MAX_OUTPUT_IMAGES` caps explicit requests; prompts above the cap fail visibly in the Run node instead of silently returning fewer images.

`SUPABASE_URL` and `SUPABASE_SECRET_KEY` are required by the Hono API for database storage. Keep `SUPABASE_SECRET_KEY` server-only; do not expose it with a `VITE_` prefix. The current Supabase project is `cucumber2` (`wbjqqywnwmghtcwpoatb`).

If Seedream or Supabase requests fail with certificate errors such as `SELF_SIGNED_CERT_IN_CHAIN` or `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`, point `NODE_EXTRA_CA_CERTS` to a trusted PEM file. The local `dev:api` script defaults to `/etc/ssl/cert.pem`, which fixes Node certificate validation on macOS setups where `curl` can reach Supabase but Node cannot. Seedream also accepts `SEEDREAM_CA_CERT_PEM` or `SEEDREAM_CA_CERT` for tool-specific HTTPS requests.

## Supabase Storage Contract

The database stores user-owned projects without introducing a second frontend canvas state model:

- `public.app_users`: MVP name/password users; passwords are stored as scrypt hashes.
- `public.app_sessions`: hashed httpOnly cookie session tokens with expiry.
- `public.agent_projects`: user-owned project snapshots with `nodes`, `edges`, `selected_node_id`, `last_run_id`, and soft-delete `deleted_at`.
- `public.agent_skills`: public uploaded skills, owned by the uploader, with parsed instructions, config, source manifest, optional `capabilityManifest`, and soft-delete `deleted_at`.
- `public.agent_run_events`: append-only run events keyed by `project_id` and `run_node_id`, including prompt, upstream context, tool input, output, status, and error text.
- `public.agent_run_step_events`: append-only kernel trace events keyed by `project_id`, `run_node_id`, and `step_id`, including `run.created`, `step.started`, `tool.input`, `tool.output`, `tool.error`, `artifact.created`, `run.completed`, and `run.failed`.
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

Submitting from the bottom composer with no referenced node creates a new root `prompt -> run` chain. Selecting a single non-Run node makes it the reference for the next submission and creates `selected node -> prompt -> run`, including image, Markdown document, document, code, webpage, memory, decision, tool-result, and generic artifact nodes. Dragging on the empty canvas marquee-selects multiple nodes for group movement or deletion; multi-selection does not create a branch anchor. Agent Run nodes are status views only; selecting one does not create a branch anchor.

Files can be dragged directly onto the canvas to create preview nodes when the existing node taxonomy can carry the file. Images become `imageResultNode` previews backed by data URLs, Markdown files become scrollable `markdownNode` previews, and code, document, webpage, dataset, or generic files become artifact-backed preview cards with file metadata and a text snippet when readable. Uploaded nodes are saved with the project snapshot; selecting a single uploaded image or artifact can anchor the next follow-up branch just like generated nodes.

When an Agent/tool output returns a Markdown document, the graph projection layer creates a dedicated `markdownNode` instead of leaving the content inside Run text. Supported output shapes include `{ markdown, title }`, `documents[]` entries with `markdown` or `content`, and `doc` artifacts whose metadata marks `format: "markdown"` or `mimeType: "text/markdown"` and carries `metadata.markdown`, `metadata.content`, or `metadata.text`. The node renders through the shared Streamdown Markdown renderer and can be selected as upstream document context for follow-up branches.

Run nodes include a trace button. The advanced trace panel reads `agent_run_step_events` through `/api/projects/:projectId/runs/:runNodeId/trace` and shows step timeline, prompt parts, capability selection, tool IO, artifact refs, and graph patches. The replay action projects the event log into a read-only canvas view; manually saved node positions from the project snapshot are reused when node ids match, so dragging nodes in the normal canvas is not overwritten by replay.

## Skill And Seedream Tool Contract

Every `/api/agent-run` delegates to `server/run-kernel.ts`. The kernel loads public skill manifests, builds a capability registry, and asks `server/agent-router.ts` for a validated step graph. The current rule planner routes image requests to `prompt.expand + image.generate`, then the kernel uses the selected text model provider for the streamed Run explanation and `prompt-expand` stage. If the upstream context contains image result nodes, the server first runs a visible `analyze_reference_images` stage with Ark Responses API, then passes the visual summary into `expand_prompt`. The latest compatible public skill with `slug === "prompt-expand"` is used when no explicit `prompt.expand` manifest exists. If no such skill exists, model credentials are missing, routing fails, policy denies execution, or any tool stage fails, the Run node shows the error and the kernel does not continue to later steps.

The kernel records both the compatible `agent_run_events` row and finer `agent_run_step_events` trace rows. Trace payloads include `selectedCapabilityIds`, capability summaries, router result, prompt trace, tool IO, artifact refs, and expected image canvas node ids. Prompt construction is assembled from `PromptPart` metadata with a `promptDigest`, selected part ids, omitted part ids, and deterministic low-priority pruning when a token budget is provided.

The frontend graph projection layer lives in `src/lib/graph-projection.ts`. It accepts only validated graph patch proposals (`createNode`, `updateNode`, `createEdge`, `setNodeStatus`, `attachArtifact`) and rejects duplicate nodes, dangling edges, illegal node kinds, and project-id mismatches. `collectUpstreamContext` is artifact-aware and keeps selected context highest priority while recording omitted context in `contextTrace` when a budget is applied.

Capability manifests can be supplied in `SKILL.md` frontmatter or as `manifest.json`, `capability.json`, `config/manifest.json`, or `config/capability.json` inside the uploaded zip. Supported manifest fields are `capabilityId`, `version`, `description`, `triggers`, `inputSchema`, `outputSchema`, `toolIds`, `tokenBudget`, `requiresApproval`, and optional `policy`. Policy records whether a capability can use the network, write files, modify the project, require approval, or create external cost. The built-in `image.generate` capability is marked as networked and potentially external-costing, but does not require approval by default.

`expand_prompt` receives the current prompt plus upstream canvas context:

```json
{
  "prompt": "current user prompt",
  "selectedNodeId": "prompt-or-image-node-id-or-null",
  "skillSlug": "prompt-expand",
  "modelProvider": "deepseek-or-ark",
  "referenceImageAnalysis": "optional Ark visual summary",
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
      "imageUrl": "https://...",
      "summary": "Generated image"
    }
  ]
}
```

It returns an `expandedPrompt`. `generate_image` then receives the expanded prompt plus the original prompt, selected node, upstream context, requested result count, and skill metadata. The server passes image node URLs from `upstreamContext` to Seedream as reference images, disables Seedream `force_single` for multi-result requests, then returns:

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
