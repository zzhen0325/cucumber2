# Cucumber Agent Canvas

Infinite-canvas Agent Run MVP: type a requirement, stream an Agent Run node, call a real `generate_image` tool, render image result nodes, then select a non-Run canvas node to create a contextual follow-up branch.

## Stack

- Vite + React + TypeScript
- Vercel AI SDK v6 via `useChat`, `DefaultChatTransport`, and `streamText`
- DeepSeek API for the agent model
- Volcengine Seedream 4.6 for image generation
- Supabase Postgres for users, projects, canvas snapshots, and run event storage
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

# Optional: required when a proxy/VPN injects a private root CA.
SEEDREAM_CA_CERT_PEM="-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"
# Or use a local certificate file path:
NODE_EXTRA_CA_CERTS=/absolute/path/to/corp-root-ca.pem
SEEDREAM_CA_CERT=/absolute/path/to/corp-root-ca.pem
```

`DEEPSEEK_API_KEY` is required for the AI SDK model call. `SEEDREAM_ACCESS_KEY_ID` and `SEEDREAM_SECRET_ACCESS_KEY` are required by the `generate_image` tool. The Seedream client also accepts `VOLCENGINE_ACCESS_KEY_ID` and `VOLCENGINE_SECRET_ACCESS_KEY` as aliases. Missing credentials are shown directly in the Run node; the app does not create placeholder images.

`SUPABASE_URL` and `SUPABASE_SECRET_KEY` are required by the Hono API for database storage. Keep `SUPABASE_SECRET_KEY` server-only; do not expose it with a `VITE_` prefix. The current Supabase project is `cucumber2` (`wbjqqywnwmghtcwpoatb`).

If Seedream or Supabase requests fail with certificate errors such as `SELF_SIGNED_CERT_IN_CHAIN` or `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`, point `NODE_EXTRA_CA_CERTS` to a trusted PEM file. The local `dev:api` script defaults to `/etc/ssl/cert.pem`, which fixes Node certificate validation on macOS setups where `curl` can reach Supabase but Node cannot. Seedream also accepts `SEEDREAM_CA_CERT_PEM` or `SEEDREAM_CA_CERT` for tool-specific HTTPS requests.

## Supabase Storage Contract

The database stores user-owned projects without introducing a second frontend canvas state model:

- `public.app_users`: MVP name/password users; passwords are stored as scrypt hashes.
- `public.app_sessions`: hashed httpOnly cookie session tokens with expiry.
- `public.agent_projects`: user-owned project snapshots with `nodes`, `edges`, `selected_node_id`, `last_run_id`, and soft-delete `deleted_at`.
- `public.agent_run_events`: append-only run events keyed by `project_id` and `run_node_id`, including prompt, upstream context, tool input, output, status, and error text.

All public tables have RLS enabled. Anonymous and browser-authenticated roles are revoked; server reads and writes use the Supabase secret key through `/api/auth/*`, `/api/projects/*`, and `/api/agent-run`.

The migration files live in `supabase/migrations`. Existing `agent_canvases` data is renamed to `agent_projects` and remains unowned until the first user registers, at which point the API assigns those unowned projects to that user.

## Project API

- `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- `GET /api/projects`, `POST /api/projects`
- `GET /api/projects/:projectId`, `PATCH /api/projects/:projectId`, `DELETE /api/projects/:projectId`

`DELETE /api/projects/:projectId` soft-deletes the project. `/api/agent-run` requires a logged-in session and receives `projectId` in the request body.

## Canvas Branching

Submitting from the bottom composer with no referenced node creates a new root `prompt -> run` chain. Selecting a Prompt or Image Result node makes it the reference for the next submission and creates `selected node -> prompt -> run`. Agent Run nodes are status views only; selecting one does not create a branch anchor.

## Seedream Tool Contract

`generate_image` receives the current prompt plus upstream canvas context:

```json
{
  "prompt": "current user prompt",
  "selectedNodeId": "prompt-or-image-node-id-or-null",
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
