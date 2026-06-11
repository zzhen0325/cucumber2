import { z } from "zod";

export const jsonRecordSchema = z.record(z.string(), z.unknown());

const positionSchema = z.object({
  x: z.number(),
  y: z.number(),
});

const nodeSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  position: positionSchema,
  data: jsonRecordSchema,
});

const edgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  type: z.string().optional(),
  data: jsonRecordSchema.optional(),
});

export const canvasOperationInputSchema = z.discriminatedUnion("type", [
  z.object({
    id: z.string().min(1),
    projectId: z.string().optional(),
    type: z.literal("createNode"),
    payload: z.object({ node: nodeSchema }),
  }),
  z.object({
    id: z.string().min(1),
    projectId: z.string().optional(),
    type: z.literal("updateNode"),
    payload: z.object({
      nodeId: z.string().min(1),
      position: positionSchema.optional(),
      data: jsonRecordSchema.optional(),
    }),
  }),
  z.object({
    id: z.string().min(1),
    projectId: z.string().optional(),
    type: z.literal("createEdge"),
    payload: z.object({ edge: edgeSchema }),
  }),
  z.object({
    id: z.string().min(1),
    projectId: z.string().optional(),
    type: z.literal("setNodeStatus"),
    payload: z.object({
      nodeId: z.string().min(1),
      status: z.enum(["queued", "running", "success", "error"]),
      error: z.string().optional(),
    }),
  }),
  z.object({
    id: z.string().min(1),
    projectId: z.string().optional(),
    type: z.literal("attachArtifact"),
    payload: z.object({
      nodeId: z.string().min(1),
      artifactId: z.string().min(1),
      artifact: z
        .object({
          id: z.string().min(1),
          type: z.enum([
            "image",
            "file",
            "doc",
            "code",
            "webpage",
            "dataset",
            "decision",
            "tool_result",
            "memory",
          ]),
          uri: z.string().optional(),
          title: z.string().optional(),
          metadata: jsonRecordSchema.optional(),
          contentRef: z.string().optional(),
        })
        .optional(),
    }),
  }),
]);

export const canvasOperationsInputSchema = z.object({
  operations: z.array(canvasOperationInputSchema).min(1),
});

/**
 * Plain JSON Schema handed to the OpenAI Agents SDK (strict mode disabled).
 *
 * The SDK's Zod -> JSON Schema converter cannot represent this discriminated
 * union (open `z.record` payloads + unions), so we describe the shape directly
 * for the model and still validate the parsed arguments with
 * `canvasOperationsInputSchema` inside the tool's execute().
 */
export const canvasOperationsJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    operations: {
      type: "array",
      description: "One or more canvas operations to apply to the infinite canvas.",
      items: {
        type: "object",
        additionalProperties: true,
        required: ["id", "type", "payload"],
        properties: {
          id: {
            type: "string",
            description:
              "Stable, unique, human-readable operation id, e.g. op-<timestamp>-create-note.",
          },
          type: {
            type: "string",
            enum: ["createNode", "updateNode", "createEdge", "setNodeStatus", "attachArtifact"],
          },
          projectId: { type: "string" },
          payload: {
            type: "object",
            additionalProperties: true,
            description:
              "createNode -> { node: { id, type, position: { x, y }, data: { kind, ...fields } } }. " +
              "Use type 'markdownNode' with data.kind 'markdown' (data.text holds the content) for text notes, " +
              "or 'artifactNode' with data.kind 'artifact'. " +
              "updateNode -> { nodeId, position?, data? }. createEdge -> { edge: { id, source, target } }. " +
              "setNodeStatus -> { nodeId, status }. attachArtifact -> { nodeId, artifactId }.",
          },
        },
      },
    },
  },
  required: ["operations"],
} as const;
