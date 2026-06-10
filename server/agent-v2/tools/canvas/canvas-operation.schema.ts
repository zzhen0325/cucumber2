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
