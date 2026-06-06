# Cucumber Agent Canvas

Infinite-canvas Agent Run MVP: type a requirement, stream an Agent Run node, call a real `generate_image` tool, render image result nodes, then select a result to create a contextual follow-up branch.

## Stack

- Vite + React + TypeScript
- Vercel AI SDK v6 via `useChat`, `DefaultChatTransport`, and `streamText`
- DeepSeek API for the agent model
- Volcengine Seedream 4.6 for image generation
- Supabase Postgres for canvas snapshots and run event storage
- AI Elements registry components for Canvas, Node, Edge, Tool, Message, and Prompt Input
- React Flow under the AI Elements canvas
- Hono Node server for `/api/agent-run`

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

SEEDREAM_ACCESS_KEY_ID=...
SEEDREAM_SECRET_ACCESS_KEY=...
SEEDREAM_REQ_KEY=jimeng_seedream46_cvtob
SEEDREAM_WIDTH=1024
SEEDREAM_HEIGHT=1024

SUPABASE_URL=https://wbjqqywnwmghtcwpoatb.supabase.co
SUPABASE_SECRET_KEY=...
SUPABASE_DEFAULT_CANVAS_ID=
```

`DEEPSEEK_API_KEY` is required for the AI SDK model call. `SEEDREAM_ACCESS_KEY_ID` and `SEEDREAM_SECRET_ACCESS_KEY` are required by the `generate_image` tool. The Seedream client also accepts `VOLCENGINE_ACCESS_KEY_ID` and `VOLCENGINE_SECRET_ACCESS_KEY` as aliases. Missing credentials are shown directly in the Run node; the app does not create placeholder images.

`SUPABASE_URL` and `SUPABASE_SECRET_KEY` are required by the Hono API for database storage. Keep `SUPABASE_SECRET_KEY` server-only; do not expose it with a `VITE_` prefix. The current Supabase project is `cucumber2` (`wbjqqywnwmghtcwpoatb`). If `SUPABASE_DEFAULT_CANVAS_ID` is empty, the API loads the most recently updated canvas or creates one.

## Supabase Storage Contract

The database stores the canvas state without introducing a second frontend state model:

- `public.agent_canvases`: current canvas snapshot with `nodes`, `edges`, `selected_node_id`, and `last_run_id`.
- `public.agent_run_events`: append-only run events keyed by `canvas_id` and `run_node_id`, including prompt, upstream context, tool input, output, status, and error text.

Both tables have RLS enabled. Anonymous and browser-authenticated roles are revoked; server writes use the Supabase secret key through `/api/canvas` and `/api/agent-run`.

## Seedream Tool Contract

`generate_image` receives the current prompt plus upstream canvas context:

```json
{
  "prompt": "current user prompt",
  "selectedNodeId": "image-node-id-or-null",
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

The server passes image node URLs from `upstreamContext` to Seedream as reference images, then returns:

```json
{
  "images": [
    {
      "id": "image-id",
      "url": "https://cdn.example/result.png",
      "title": "optional title",
      "metadata": {}
    }
  ]
}
```

## Scripts

```bash
pnpm dev
pnpm test
pnpm lint
pnpm build
```
