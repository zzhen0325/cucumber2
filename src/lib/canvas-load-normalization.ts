import type {
  AgentCanvasEdge,
  AgentCanvasNode,
  AgentCanvasNodeData,
  ArtifactRef,
} from "@/types/canvas";
import { applyDefaultNodeDimensions } from "./canvas-node-dimensions";

export function normalizeLoadedCanvasSnapshot({
  edges,
  nodes,
  projectId,
}: {
  edges: AgentCanvasEdge[];
  nodes: AgentCanvasNode[];
  projectId: string;
}) {
  const materializedKeys = new Set(
    nodes.flatMap((node) => {
      const runId = readArtifactRunId(node.data);
      if (!runId || isPendingArtifactNode(node.data)) {
        return [];
      }
      const family = readArtifactFamily(node.data);
      return family ? [`${runId}:${family}`] : [];
    })
  );
  const nextNodes = nodes
    .filter((node) => {
      const runId = readArtifactRunId(node.data);
      const family = readArtifactFamily(node.data);
      return !(
        runId &&
        family &&
        isPendingArtifactNode(node.data) &&
        materializedKeys.has(`${runId}:${family}`)
      );
    })
    .map((node) => applyDefaultNodeDimensions(attachProjectIdToArtifacts(node, projectId)));
  const nodeIds = new Set(nextNodes.map((node) => node.id));

  return {
    edges: edges.filter(
      (edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target)
    ),
    nodes: nextNodes,
  };
}

function attachProjectIdToArtifacts(
  node: AgentCanvasNode,
  projectId: string
): AgentCanvasNode {
  if (node.data.kind === "imageResult") {
    return {
      ...node,
      data: {
        ...node.data,
        artifact: attachProjectIdToArtifact(node.data.artifact, projectId),
        image: {
          ...node.data.image,
          artifact: attachProjectIdToArtifact(node.data.image.artifact, projectId),
        },
      },
    } as AgentCanvasNode;
  }

  if (!("artifact" in node.data)) {
    return node;
  }

  return {
    ...node,
    data: {
      ...node.data,
      artifact: attachProjectIdToArtifact(node.data.artifact, projectId),
    },
  } as AgentCanvasNode;
}

function attachProjectIdToArtifact(
  artifact: ArtifactRef | undefined,
  projectId: string
) {
  if (!artifact) {
    return artifact;
  }
  if (artifact.metadata?.projectId === projectId) {
    return artifact;
  }

  return {
    ...artifact,
    metadata: {
      ...(artifact.metadata ?? {}),
      projectId,
    },
  };
}

function readArtifactRunId(data: AgentCanvasNodeData) {
  return "runId" in data && typeof data.runId === "string"
    ? data.runId
    : undefined;
}

function readArtifactFamily(data: AgentCanvasNodeData) {
  if (data.kind === "imageResult") {
    return "image";
  }
  if (!("artifact" in data) || !data.artifact) {
    return undefined;
  }
  if (data.kind === "markdown" || data.kind === "document") {
    return "doc";
  }
  if (data.kind === "toolResult") {
    return "tool_result";
  }
  return data.artifact.type;
}

function isPendingArtifactNode(data: AgentCanvasNodeData) {
  return (
    "artifact" in data &&
    data.artifact?.metadata?.pending === true
  );
}
