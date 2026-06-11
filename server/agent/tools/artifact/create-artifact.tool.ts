import { tool } from "@openai/agents";
import { z } from "zod";

import type { ArtifactRef } from "../../../../src/types/canvas.ts";
import type { CucumberAgentContext } from "../../context.ts";
import { jsonRecordSchema } from "../canvas/canvas-operation.schema.ts";

const createArtifactInputSchema = z.object({
  id: z.string().min(1).optional(),
  type: z.enum(["image", "file", "doc", "code", "webpage", "dataset", "decision", "tool_result", "memory"]),
  title: z.string().min(1).optional(),
  uri: z.string().optional(),
  contentRef: z.string().optional(),
  metadata: jsonRecordSchema.optional(),
});

const createArtifactJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["type"],
  properties: {
    id: { type: "string", description: "Optional stable artifact id." },
    type: {
      type: "string",
      enum: ["image", "file", "doc", "code", "webpage", "dataset", "decision", "tool_result", "memory"],
    },
    title: { type: "string" },
    uri: { type: "string" },
    contentRef: { type: "string" },
    metadata: { type: "object", additionalProperties: true },
  },
} as const;

export const createArtifactTool = tool({
  name: "create_artifact",
  description:
    "Create an in-memory artifact reference for this run. The runtime may emit it, but this tool does not write storage or database rows directly.",
  parameters: createArtifactJsonSchema as never,
  strict: false,
  async execute(rawArgs, runContext) {
    const context = requireCucumberContext(runContext?.context);
    const parsed = createArtifactInputSchema.safeParse(rawArgs);
    if (!parsed.success) {
      return {
        error: `invalid_artifact_input: ${parsed.error.issues
          .map((issue) => `${issue.path.join(".")} ${issue.message}`)
          .join("; ")}`,
      };
    }
    const args = parsed.data;
    const artifact: ArtifactRef = {
      id: args.id ?? `artifact-${crypto.randomUUID()}`,
      type: args.type,
      uri: args.uri,
      title: args.title,
      metadata: args.metadata,
      contentRef: args.contentRef,
    };

    context.producedArtifacts.push(artifact);
    context.pendingEvents.push({ type: "artifact_created", artifact });

    return { artifact };
  },
});

function requireCucumberContext(context: unknown): CucumberAgentContext {
  if (!context || typeof context !== "object") {
    throw new Error("Cucumber agent context is missing.");
  }
  return context as CucumberAgentContext;
}
