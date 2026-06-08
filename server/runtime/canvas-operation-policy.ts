import type {
  AgentCanvasNode,
  AgentCanvasNodeData,
  ArtifactRef,
} from "../../src/types/canvas.ts";
import type { CanvasOperation } from "../../src/types/runtime.ts";

export type CanvasOperationPolicyInput = {
  artifactIds?: string[];
  knownNodeIds?: string[];
  operations: CanvasOperation[];
  projectId: string;
};

export type AcceptedCanvasOperation = {
  operation: CanvasOperation;
};

export type RejectedCanvasOperation = {
  operation: CanvasOperation;
  reason: string;
};

export type CanvasOperationPolicyResult = {
  accepted: AcceptedCanvasOperation[];
  rejected: RejectedCanvasOperation[];
};

const validNodeTypeByKind: Record<AgentCanvasNodeData["kind"], string> = {
  artifact: "artifactNode",
  code: "codeNode",
  decision: "decisionNode",
  document: "documentNode",
  imageResult: "imageResultNode",
  markdown: "markdownNode",
  memory: "memoryNode",
  prompt: "promptNode",
  run: "runNode",
  toolResult: "toolResultNode",
  webpage: "webpageNode",
};

const validRunStatuses = new Set(["queued", "running", "success", "error"]);

export function validateCanvasOperations({
  artifactIds = [],
  knownNodeIds = [],
  operations,
  projectId,
}: CanvasOperationPolicyInput): CanvasOperationPolicyResult {
  const accepted: AcceptedCanvasOperation[] = [];
  const rejected: RejectedCanvasOperation[] = [];
  const availableNodeIds = new Set(knownNodeIds);
  const seenOperationIds = new Set<string>();
  const allowedArtifactIds = new Set(artifactIds);

  for (const operation of operations) {
    const normalizedOperation = normalizeOperationProject(operation, projectId);
    const reason = validateCanvasOperation({
      allowedArtifactIds,
      availableNodeIds,
      operation: normalizedOperation,
      projectId,
      seenOperationIds,
    });

    if (reason) {
      rejected.push({ operation: normalizedOperation, reason });
      continue;
    }

    accepted.push({ operation: normalizedOperation });
    seenOperationIds.add(normalizedOperation.id);
    if (normalizedOperation.type === "createNode") {
      availableNodeIds.add(normalizedOperation.payload.node.id);
    }
  }

  return { accepted, rejected };
}

function validateCanvasOperation({
  allowedArtifactIds,
  availableNodeIds,
  operation,
  projectId,
  seenOperationIds,
}: {
  allowedArtifactIds: Set<string>;
  availableNodeIds: Set<string>;
  operation: CanvasOperation;
  projectId: string;
  seenOperationIds: Set<string>;
}) {
  if (!operation.id) {
    return "operation_id_missing";
  }
  if (seenOperationIds.has(operation.id)) {
    return "duplicate_operation";
  }
  if (operation.projectId !== projectId) {
    return "operation_project_mismatch";
  }

  if (operation.type === "createNode") {
    return validateCreateNode(operation.payload.node, availableNodeIds);
  }
  if (operation.type === "updateNode") {
    const targetNodeId = operation.payload.nodeId;
    if (!availableNodeIds.has(targetNodeId)) {
      return "target_node_not_allowed";
    }
    if (
      operation.payload.data?.kind &&
      !isValidNodeDataKind(operation.payload.data.kind)
    ) {
      return "invalid_node_kind";
    }
    return undefined;
  }
  if (operation.type === "createEdge") {
    const { edge } = operation.payload;
    if (!edge.id || !edge.source || !edge.target) {
      return "invalid_edge";
    }
    if (!availableNodeIds.has(edge.source) || !availableNodeIds.has(edge.target)) {
      return "dangling_edge";
    }
    return undefined;
  }
  if (operation.type === "setNodeStatus") {
    if (!availableNodeIds.has(operation.payload.nodeId)) {
      return "target_node_not_allowed";
    }
    if (!validRunStatuses.has(operation.payload.status)) {
      return "invalid_run_status";
    }
    return undefined;
  }
  if (operation.type === "attachArtifact") {
    return validateAttachArtifact(operation, availableNodeIds, allowedArtifactIds);
  }

  return "unknown_operation_type";
}

function validateCreateNode(
  node: AgentCanvasNode,
  availableNodeIds: Set<string>
) {
  if (!node?.id || !node.data || !node.type) {
    return "invalid_node";
  }
  if (availableNodeIds.has(node.id)) {
    return "duplicate_node";
  }
  if (!isValidNode(node)) {
    return "invalid_node_kind";
  }
  return undefined;
}

function validateAttachArtifact(
  operation: Extract<CanvasOperation, { type: "attachArtifact" }>,
  availableNodeIds: Set<string>,
  allowedArtifactIds: Set<string>
) {
  const { artifact, artifactId, nodeId } = operation.payload;
  const expectedArtifactNodeId = getArtifactNodeId(artifact ?? {
    id: artifactId,
    type: "image",
  });

  if (!availableNodeIds.has(nodeId) && nodeId !== expectedArtifactNodeId) {
    return "target_node_not_allowed";
  }
  if (!allowedArtifactIds.has(artifactId)) {
    return "artifact_not_produced_by_step";
  }
  if (artifact && artifact.id !== artifactId) {
    return "artifact_id_mismatch";
  }
  return undefined;
}

function normalizeOperationProject(
  operation: CanvasOperation,
  projectId: string
): CanvasOperation {
  return operation.projectId ? operation : ({ ...operation, projectId } as CanvasOperation);
}

function isValidNode(node: AgentCanvasNode) {
  return (
    Boolean(node.id) &&
    Boolean(node.position) &&
    isValidNodeDataKind(node.data.kind) &&
    node.type === validNodeTypeByKind[node.data.kind]
  );
}

function isValidNodeDataKind(
  kind: unknown
): kind is AgentCanvasNodeData["kind"] {
  return typeof kind === "string" && kind in validNodeTypeByKind;
}

function getArtifactNodeId(artifact: Pick<ArtifactRef, "id" | "type">) {
  return artifact.type === "image" ? `image-${artifact.id}` : `artifact-${artifact.id}`;
}
