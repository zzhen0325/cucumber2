import { z } from "zod";

import type { RegisteredCapability } from "../../capabilities.ts";
import type {
  AgentCanvasEdge,
  AgentCanvasNode,
  AgentCanvasNodeData,
  ArtifactRef,
} from "../../../src/types/canvas.ts";
import type { RuntimeToolDefinition } from "../tool-registry.ts";
import { TOOL_DEFINITION_VERSION, toolIds } from "./ids.ts";
import { toolResultSchema } from "../schemas.ts";

const createCanvasNodeInputSchema = z.object({
  node: z.custom<AgentCanvasNode>((value) =>
    Boolean(value && typeof value === "object" && "id" in value && "data" in value)
  ),
});

const createCanvasEdgeInputSchema = z.object({
  edge: z.custom<AgentCanvasEdge>((value) =>
    Boolean(
      value &&
        typeof value === "object" &&
        "id" in value &&
        "source" in value &&
        "target" in value
    )
  ),
});

const updateCanvasNodeInputSchema = z.object({
  data: z.custom<Partial<AgentCanvasNodeData>>((value) =>
    value === undefined || Boolean(value && typeof value === "object")
  ).optional(),
  nodeId: z.string().min(1),
  position: z.object({ x: z.number(), y: z.number() }).optional(),
});

const canvasOperationOutputSchema = z.object({
  operation: z.unknown(),
  operationId: z.string(),
});

export function createAttachArtifactTool({
  imageCapability,
  projectId,
}: {
  imageCapability: RegisteredCapability;
  projectId: string;
}): RuntimeToolDefinition {
  const attachInputSchema = z.object({
    nodeId: z.string().min(1),
    artifactId: z.string().min(1),
  });

  return {
    id: toolIds.attachArtifact,
    version: TOOL_DEFINITION_VERSION,
    toPlannerToolName: "canvas.attach_artifact",
    capabilityId: "canvas.mutate",
    name: "Attach artifact",
    description: "Propose an artifact attachment canvas operation.",
    inputSchema: attachInputSchema,
    outputSchema: z.object({ operationId: z.string() }),
    policy: {
      ...imageCapability.manifest.policy,
      canModifyProject: true,
      mayExternalCost: false,
    },
    timeoutMs: 5_000,
    retryPolicy: { maxRetries: 0, backoffMs: 0, retryableErrorCodes: [] },
    risk: "low",
    renderHint: { kind: "canvas_operation", label: "Attach artifact" },
    async execute(input) {
      const parsed = attachInputSchema.parse(input);
      const operation = {
        id: `canvas-attach-${crypto.randomUUID()}`,
        projectId,
        type: "attachArtifact" as const,
        payload: parsed,
      };

      return toolResultSchema.parse({
        ok: true,
        data: { operationId: operation.id },
        artifacts: [],
        canvasOperations: [operation],
        logs: [toolLog("Canvas attach artifact operation proposed.")],
      });
    },
  };
}

export function createCanvasNodeTool({
  imageCapability,
  projectId,
}: {
  imageCapability: RegisteredCapability;
  projectId: string;
}): RuntimeToolDefinition {
  return {
    id: toolIds.createCanvasNode,
    version: TOOL_DEFINITION_VERSION,
    toPlannerToolName: "canvas.create_node",
    capabilityId: "canvas.mutate",
    name: "Create canvas node",
    description: "Propose a new canvas node for the renderer policy to validate.",
    inputSchema: createCanvasNodeInputSchema,
    outputSchema: canvasOperationOutputSchema,
    policy: {
      ...imageCapability.manifest.policy,
      canModifyProject: true,
      mayExternalCost: false,
    },
    timeoutMs: 5_000,
    retryPolicy: { maxRetries: 0, backoffMs: 0, retryableErrorCodes: [] },
    risk: "medium",
    renderHint: { kind: "canvas_operation", label: "Create canvas node" },
    prepareInput({ previousSteps }) {
      const artifact = previousSteps
        .flatMap((step) => step.output?.artifacts ?? [])
        .find((candidate) => candidate.type !== "image");
      if (!artifact) {
        return undefined;
      }

      return {
        node: createArtifactNodeFromRuntimeArtifact(artifact),
      };
    },
    async execute(input) {
      const parsed = createCanvasNodeInputSchema.parse(input);
      const operation = {
        id: `canvas-create-node-${crypto.randomUUID()}`,
        projectId,
        type: "createNode" as const,
        payload: { node: parsed.node },
      };

      return toolResultSchema.parse({
        ok: true,
        data: { operationId: operation.id, operation },
        artifacts: [],
        canvasOperations: [operation],
        logs: [toolLog("Canvas create node operation proposed.")],
      });
    },
  };
}

export function createCanvasEdgeTool({
  imageCapability,
  projectId,
}: {
  imageCapability: RegisteredCapability;
  projectId: string;
}): RuntimeToolDefinition {
  return {
    id: toolIds.createCanvasEdge,
    version: TOOL_DEFINITION_VERSION,
    toPlannerToolName: "canvas.create_edge",
    capabilityId: "canvas.mutate",
    name: "Create canvas edge",
    description: "Propose a new canvas edge for the renderer policy to validate.",
    inputSchema: createCanvasEdgeInputSchema,
    outputSchema: canvasOperationOutputSchema,
    policy: {
      ...imageCapability.manifest.policy,
      canModifyProject: true,
      mayExternalCost: false,
    },
    timeoutMs: 5_000,
    retryPolicy: { maxRetries: 0, backoffMs: 0, retryableErrorCodes: [] },
    risk: "medium",
    renderHint: { kind: "canvas_operation", label: "Create canvas edge" },
    async execute(input) {
      const parsed = createCanvasEdgeInputSchema.parse(input);
      const operation = {
        id: `canvas-create-edge-${crypto.randomUUID()}`,
        projectId,
        type: "createEdge" as const,
        payload: { edge: parsed.edge },
      };

      return toolResultSchema.parse({
        ok: true,
        data: { operationId: operation.id, operation },
        artifacts: [],
        canvasOperations: [operation],
        logs: [toolLog("Canvas create edge operation proposed.")],
      });
    },
  };
}

export function createUpdateCanvasNodeTool({
  imageCapability,
  projectId,
}: {
  imageCapability: RegisteredCapability;
  projectId: string;
}): RuntimeToolDefinition {
  return {
    id: toolIds.updateCanvasNode,
    version: TOOL_DEFINITION_VERSION,
    toPlannerToolName: "canvas.update_node",
    capabilityId: "canvas.mutate",
    name: "Update canvas node",
    description: "Propose a canvas node update for the renderer policy to validate.",
    inputSchema: updateCanvasNodeInputSchema,
    outputSchema: canvasOperationOutputSchema,
    policy: {
      ...imageCapability.manifest.policy,
      canModifyProject: true,
      mayExternalCost: false,
    },
    timeoutMs: 5_000,
    retryPolicy: { maxRetries: 0, backoffMs: 0, retryableErrorCodes: [] },
    risk: "medium",
    renderHint: { kind: "canvas_operation", label: "Update canvas node" },
    async execute(input) {
      const parsed = updateCanvasNodeInputSchema.parse(input);
      const operation = {
        id: `canvas-update-node-${crypto.randomUUID()}`,
        projectId,
        type: "updateNode" as const,
        payload: {
          data: parsed.data,
          nodeId: parsed.nodeId,
          position: parsed.position,
        },
      };

      return toolResultSchema.parse({
        ok: true,
        data: { operationId: operation.id, operation },
        artifacts: [],
        canvasOperations: [operation],
        logs: [toolLog("Canvas update node operation proposed.")],
      });
    },
  };
}

function createArtifactNodeFromRuntimeArtifact(
  artifact: ArtifactRef
): AgentCanvasNode {
  const kind = getArtifactNodeKind(artifact);
  const nodeId = `${kind}-${artifact.id}`;
  return {
    id: nodeId,
    type: `${kind}Node`,
    position: { x: 620, y: 420 },
    data: {
      kind,
      artifact,
      title: artifact.title ?? "Generated artifact",
      summary: readString(artifact.metadata?.summary),
      content: kind === "markdown" ? readString(artifact.metadata?.content) ?? "" : undefined,
    } as AgentCanvasNodeData,
  };
}

function getArtifactNodeKind(
  artifact: ArtifactRef
): Extract<AgentCanvasNodeData["kind"], "artifact" | "code" | "document" | "markdown" | "webpage"> {
  if (artifact.type === "webpage") {
    return "webpage";
  }
  if (artifact.type === "code") {
    return "code";
  }
  if (artifact.type === "doc") {
    return readString(artifact.metadata?.format) === "markdown"
      ? "markdown"
      : "document";
  }
  return "artifact";
}

function readString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function toolLog(message: string) {
  return { level: "info" as const, message, createdAt: new Date().toISOString() };
}
