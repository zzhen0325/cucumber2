# Cucumber Agent Canvas

Infinite-canvas Agent Run MVP: type a requirement, stream an Agent Run node, call a real `generate_image` tool, render image result nodes, then select a result to create a contextual follow-up branch.

## Stack

- Vite + React + TypeScript
- Vercel AI SDK v6 via `useChat`, `DefaultChatTransport`, and `streamText`
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
AI_MODEL=openai/gpt-5.4
AI_GATEWAY_API_KEY=...
IMAGE_API_URL=https://your-image-service.example/generate
IMAGE_API_KEY=...
```

`AI_GATEWAY_API_KEY` or Vercel OIDC auth is required for the AI SDK model call. `IMAGE_API_URL` is required by the `generate_image` tool. Missing credentials are shown directly in the Run node; the app does not create placeholder images.

## Custom Image API Contract

`generate_image` sends:

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

Expected response:

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

A plain `{ "url": "https://..." }` response is also accepted.

## Scripts

```bash
pnpm dev
pnpm test
pnpm lint
pnpm build
```
