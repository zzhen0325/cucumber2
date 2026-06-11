import type { AgentCanvasNode } from "../../../src/types/canvas.ts";
import type { CanvasOperation } from "../../../src/types/runtime.ts";

export type CanvasOperationPolicyInput = {
  knownNodeIds?: string[];
  operations: CanvasOperation[];
  projectId: string;
  runNodeId: string;
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

const validProposedNodeTypeByKind = {
  shape: "shapeNode",
  stickyNote: "stickyNoteNode",
} as const;

const validRunStatuses = new Set(["queued", "running", "success", "error"]);
const validShapeVariants = new Set(["rectangle", "ellipse", "diamond", "triangle", "pill", "frame"]);
const validStickyNoteColors = new Set(["yellow", "green", "blue", "pink"]);

export function validateCanvasOperations({
  knownNodeIds = [],
  operations,
  projectId,
  runNodeId,
}: CanvasOperationPolicyInput): CanvasOperationPolicyResult {
  const accepted: AcceptedCanvasOperation[] = [];
  const rejected: RejectedCanvasOperation[] = [];
  const availableNodeIds = new Set(knownNodeIds);
  const seenOperationIds = new Set<string>();

  for (const operation of operations) {
    const normalizedOperation = normalizeOperationProject(operation, projectId);
    const reason = validateCanvasOperation({
      availableNodeIds,
      operation: normalizedOperation,
      projectId,
      runNodeId,
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
  availableNodeIds,
  operation,
  projectId,
  runNodeId,
  seenOperationIds,
}: {
  availableNodeIds: Set<string>;
  operation: CanvasOperation;
  projectId: string;
  runNodeId: string;
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
    if (operation.payload.data && Object.keys(operation.payload.data).length > 0) {
      return "node_data_update_not_allowed";
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
    if (operation.payload.nodeId !== runNodeId) {
      return "target_node_not_allowed";
    }
    if (!validRunStatuses.has(operation.payload.status)) {
      return "invalid_run_status";
    }
    return undefined;
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

function normalizeOperationProject(
  operation: CanvasOperation,
  projectId: string
): CanvasOperation {
  return operation.projectId ? operation : ({ ...operation, projectId } as CanvasOperation);
}

function isValidNode(node: AgentCanvasNode) {
  if (!node.id || !node.position || !isRecord(node.data)) {
    return false;
  }

  if (node.data.kind === "stickyNote") {
    return (
      node.type === validProposedNodeTypeByKind.stickyNote &&
      typeof node.data.text === "string" &&
      typeof node.data.createdAt === "string" &&
      validStickyNoteColors.has(node.data.color)
    );
  }

  if (node.data.kind === "shape") {
    return (
      node.type === validProposedNodeTypeByKind.shape &&
      typeof node.data.label === "string" &&
      typeof node.data.createdAt === "string" &&
      validShapeVariants.has(node.data.shape)
    );
  }

  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
