import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { serve } from "@hono/node-server";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage,
} from "ai";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";

import { generateSeedreamImage, isSeedreamConfigured } from "../seedream.ts";

loadServerEnv();

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

  const toolInput = {
    prompt: canvasContext.prompt,
    selectedNodeId: canvasContext.selectedNodeId ?? null,
    upstreamContext: canvasContext.upstreamContext,
  };

  const stream = createUIMessageStream({
    originalMessages: messages,
    execute: async ({ writer }) => {
      const toolCallId = `generate_image-${crypto.randomUUID()}`;

      writer.write({
        type: "tool-input-available",
        toolCallId,
        toolName: "generate_image",
        input: toolInput,
      });

      try {
        const output = await generateSeedreamImage(toolInput);

        writer.write({
          type: "tool-output-available",
          toolCallId,
          output,
        });
      } catch (error) {
        const errorText = getErrorMessage(error);
        console.error("[agent-run]", error);

        writer.write({
          type: "tool-output-error",
          toolCallId,
          errorText,
        });
      }
    },
    onError: getErrorMessage,
  });

  return createUIMessageStreamResponse({ stream });
});

const port = Number(process.env.API_PORT ?? 8787);

serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, (info) => {
  console.log(`Cucumber Agent API listening on http://${info.address}:${info.port}`);
});

function loadServerEnv() {
  for (const file of [".env.local", ".env"]) {
    if (existsSync(file)) {
      loadEnvFile(file);
    }
  }
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
