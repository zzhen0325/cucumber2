import type { AgentCanvasEdge, AgentCanvasNode, CanvasPatch } from "../types/canvas";

export type CanvasSnapshot = {
  nodes: AgentCanvasNode[];
  edges: AgentCanvasEdge[];
};

export function diffCanvasPatch(
  previous: CanvasSnapshot,
  next: CanvasSnapshot
): CanvasPatch {
  const previousNodesById = new Map(previous.nodes.map((node) => [node.id, node]));
  const nextNodesById = new Map(next.nodes.map((node) => [node.id, node]));
  const previousEdgesById = new Map(previous.edges.map((edge) => [edge.id, edge]));
  const nextEdgesById = new Map(next.edges.map((edge) => [edge.id, edge]));

  const nodeUpserts = next.nodes.filter((node) => {
    const previousNode = previousNodesById.get(node.id);
    return !previousNode || !jsonEqual(previousNode, node);
  });
  const nodeDeletes = previous.nodes.flatMap((node) =>
    nextNodesById.has(node.id) ? [] : [node.id]
  );
  const edgeUpserts = next.edges.filter((edge) => {
    const previousEdge = previousEdgesById.get(edge.id);
    return !previousEdge || !jsonEqual(previousEdge, edge);
  });
  const edgeDeletes = previous.edges.flatMap((edge) =>
    nextEdgesById.has(edge.id) ? [] : [edge.id]
  );

  return compactCanvasPatch({
    edgeDeletes,
    edgeUpserts,
    nodeDeletes,
    nodeUpserts,
  });
}

export function applyCanvasPatch(
  snapshot: CanvasSnapshot,
  patch?: CanvasPatch | null
): CanvasSnapshot {
  if (!patch || !hasCanvasPatchChanges(patch)) {
    return snapshot;
  }

  return {
    edges: applyEdgePatch(snapshot.edges, patch),
    nodes: applyNodePatch(snapshot.nodes, patch),
  };
}

export function mergeCanvasUpserts(
  current: CanvasSnapshot,
  upserts: CanvasSnapshot
): CanvasSnapshot {
  return applyCanvasPatch(current, {
    edgeUpserts: upserts.edges,
    nodeUpserts: upserts.nodes,
  });
}

export function hasCanvasPatchChanges(patch?: CanvasPatch | null) {
  return Boolean(
    patch &&
      ((patch.nodeUpserts?.length ?? 0) > 0 ||
        (patch.nodeDeletes?.length ?? 0) > 0 ||
        (patch.edgeUpserts?.length ?? 0) > 0 ||
        (patch.edgeDeletes?.length ?? 0) > 0)
  );
}

export function compactCanvasPatch(patch: CanvasPatch): CanvasPatch {
  const compacted: CanvasPatch = {};
  if (patch.nodeUpserts?.length) {
    compacted.nodeUpserts = patch.nodeUpserts;
  }
  if (patch.nodeDeletes?.length) {
    compacted.nodeDeletes = [...new Set(patch.nodeDeletes)];
  }
  if (patch.edgeUpserts?.length) {
    compacted.edgeUpserts = patch.edgeUpserts;
  }
  if (patch.edgeDeletes?.length) {
    compacted.edgeDeletes = [...new Set(patch.edgeDeletes)];
  }
  return compacted;
}

function applyNodePatch(nodes: AgentCanvasNode[], patch: CanvasPatch) {
  const deletes = new Set(patch.nodeDeletes ?? []);
  const upserts = patch.nodeUpserts ?? [];
  const upsertsById = new Map(upserts.map((node) => [node.id, node]));
  const consumed = new Set<string>();
  const nextNodes = nodes.flatMap((node) => {
    if (deletes.has(node.id)) {
      return [];
    }

    const upsert = upsertsById.get(node.id);
    if (!upsert) {
      return [node];
    }

    consumed.add(node.id);
    return [jsonEqual(node, upsert) ? node : upsert];
  });

  for (const node of upserts) {
    if (!consumed.has(node.id) && !deletes.has(node.id)) {
      nextNodes.push(node);
    }
  }

  return nextNodes;
}

function applyEdgePatch(edges: AgentCanvasEdge[], patch: CanvasPatch) {
  const deletes = new Set(patch.edgeDeletes ?? []);
  const upserts = patch.edgeUpserts ?? [];
  const upsertsById = new Map(upserts.map((edge) => [edge.id, edge]));
  const consumed = new Set<string>();
  const nextEdges = edges.flatMap((edge) => {
    if (deletes.has(edge.id)) {
      return [];
    }

    const upsert = upsertsById.get(edge.id);
    if (!upsert) {
      return [edge];
    }

    consumed.add(edge.id);
    return [jsonEqual(edge, upsert) ? edge : upsert];
  });

  for (const edge of upserts) {
    if (!consumed.has(edge.id) && !deletes.has(edge.id)) {
      nextEdges.push(edge);
    }
  }

  return nextEdges;
}

function jsonEqual(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}
