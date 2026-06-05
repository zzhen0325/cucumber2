import { serve } from "@hono/node-server";
import { convertToModelMessages, streamText, tool, type UIMessage } from "ai";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";

const app = new Hono();

const upstreamContextSchema = z.object({
  nodeId: z.string(),
  type: z.enum(["prompt", "image"]),
  prompt: z.string().optional(),
  imageUrl: z.string().optional(),
  summary: z.string().optional(),
});

const canvasContextSchema = z.object({
  prompt: z.string(),
  selectedNodeId: z.string().nullable().optional(),
  upstreamContext: z.array(upstreamContextSchema).default([]),
});

const generatedImageSchema = z.object({
  id: z.string().optional(),
  url: z.string(),
  title: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const imageApiResponseSchema = z
  .object({
    images: z.array(generatedImageSchema).optional(),
    url: z.string().optional(),
  })
  .passthrough();

type CanvasContext = z.infer<typeof canvasContextSchema>;

app.use("*", cors());

app.get("/api/health", (c) =>
  c.json({
    ok: true,
    imageApiConfigured: Boolean(process.env.IMAGE_API_URL),
    model: process.env.AI_MODEL ?? "openai/gpt-5.4",
  })
);

app.post("/api/agent-run", async (c) => {
  const body = await c.req.json();
  const messages = (body.messages ?? []) as UIMessage[];
  const canvasContext = canvasContextSchema.parse(body.canvasContext ?? {});

  const result = streamText({
    model: process.env.AI_MODEL ?? "openai/gpt-5.4",
    messages: await convertToModelMessages(messages),
    system: [
      "You are Cucumber Agent Canvas.",
      "The user works on an infinite canvas where selected image nodes carry upstream context.",
      "For every user request, call the generate_image tool exactly once.",
      "Use the provided prompt, selected node, and upstream context. Do not invent image URLs.",
    ].join("\n"),
    tools: {
      generate_image: tool({
        description:
          "Generate or modify an image by calling the configured custom image API.",
        inputSchema: z.object({
          prompt: z
            .string()
            .describe("The user's current image-generation or edit request."),
          upstreamContext: z
            .array(upstreamContextSchema)
            .default([])
            .describe("Canvas context collected from the selected node upstream."),
          selectedNodeId: z
            .string()
            .nullable()
            .optional()
            .describe("The selected canvas node that anchors this follow-up."),
        }),
        execute: async (input) =>
          callImageApi({
            prompt: input.prompt || canvasContext.prompt,
            selectedNodeId: input.selectedNodeId ?? canvasContext.selectedNodeId,
            upstreamContext: input.upstreamContext.length
              ? input.upstreamContext
              : canvasContext.upstreamContext,
          }),
      }),
    },
    toolChoice: {
      type: "tool",
      toolName: "generate_image",
    },
    onError: ({ error }) => {
      console.error("[agent-run]", error);
    },
  });

  return result.toUIMessageStreamResponse();
});

async function callImageApi(input: CanvasContext) {
  const endpoint = process.env.IMAGE_API_URL;
  if (!endpoint) {
    throw new Error("IMAGE_API_URL is not configured.");
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(process.env.IMAGE_API_KEY
        ? { authorization: `Bearer ${process.env.IMAGE_API_KEY}` }
        : {}),
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Image API failed with ${response.status}: ${detail || response.statusText}`
    );
  }

  const parsed = imageApiResponseSchema.parse(await response.json());
  const images =
    parsed.images?.map((image, index) => ({
      id: image.id ?? `img-${Date.now()}-${index}`,
      url: image.url,
      title: image.title,
      metadata: image.metadata,
    })) ??
    (parsed.url
      ? [
          {
            id: `img-${Date.now()}-0`,
            url: parsed.url,
          },
        ]
      : []);

  if (!images.length) {
    throw new Error("Image API response did not include any images.");
  }

  return { images };
}

const port = Number(process.env.API_PORT ?? 8787);

serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, (info) => {
  console.log(`Cucumber Agent API listening on http://${info.address}:${info.port}`);
});
