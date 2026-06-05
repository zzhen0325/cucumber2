import { serve } from "@hono/node-server";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { convertToModelMessages, streamText, tool, type UIMessage } from "ai";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";

import { generateSeedreamImage, isSeedreamConfigured } from "../seedream.ts";

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

app.use("*", cors());

app.get("/api/health", (c) =>
  c.json({
    ok: true,
    deepseekConfigured: Boolean(process.env.DEEPSEEK_API_KEY),
    seedreamConfigured: isSeedreamConfigured(),
    model: process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash",
  })
);

app.post("/api/agent-run", async (c) => {
  const body = await c.req.json();
  const messages = (body.messages ?? []) as UIMessage[];
  const canvasContext = canvasContextSchema.parse(body.canvasContext ?? {});

  const result = streamText({
    model: createDeepSeekModel(),
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
          "Generate or modify an image with Seedream using the current canvas context.",
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
          generateSeedreamImage({
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

function createDeepSeekModel() {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error("DEEPSEEK_API_KEY is not configured.");
  }

  const deepseek = createOpenAICompatible({
    name: "deepseek",
    baseURL: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
    apiKey,
    includeUsage: true,
  });

  return deepseek.chatModel(process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash");
}

const port = Number(process.env.API_PORT ?? 8787);

serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, (info) => {
  console.log(`Cucumber Agent API listening on http://${info.address}:${info.port}`);
});
