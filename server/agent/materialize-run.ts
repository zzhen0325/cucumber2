import { projectRunTraceToCanvas } from "../../src/lib/graph-projection.ts";
import { diffCanvasPatch, hasCanvasPatchChanges, mergeCanvasUpserts } from "../../src/lib/canvas-patch.ts";
import type { AgentEvent, AgentEventType } from "../../src/types/runtime.ts";
import {
  applyCanvasPatchForUser,
  loadCanvasSnapshotForUser,
  ProjectVersionConflictError,
  type CanvasProject,
} from "../canvas-store.ts";

const materializedEventTypes = new Set<AgentEventType>([
  "artifact.created",
  "canvas.operation.applied",
  "input.normalized",
  "run.completed",
  "run.failed",
  "skill.script.failed",
  "tool.error",
]);

export function shouldMaterializeRunEvent(type: AgentEventType) {
  return materializedEventTypes.has(type);
}

export function shouldBlockRunForMaterialization(type: AgentEventType) {
  return type === "run.completed" || type === "run.failed";
}

export async function materializeAgentRunSnapshot({
  events,
  projectId,
  runNodeId,
  userId,
}: {
  events: AgentEvent[];
  projectId: string;
  runNodeId: string;
  userId: string;
}) {
  const runEvents = events.filter((event) => event.runNodeId === runNodeId);
  if (!runEvents.length) {
    return null;
  }

  const maxAttempts = 3;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const current = await loadCanvasSnapshotForUser(projectId, userId);
    if (!current) {
      return null;
    }

    const next = materializeSnapshot(current, runEvents, runNodeId);
    const canvasPatch = diffCanvasPatch(
      { nodes: current.nodes, edges: current.edges },
      next
    );
    if (
      current.lastRunId === runNodeId &&
      !hasCanvasPatchChanges(canvasPatch)
    ) {
      return current;
    }

    try {
      return await applyCanvasPatchForUser({
        projectId,
        userId,
        nodeUpserts: canvasPatch.nodeUpserts,
        nodeDeletes: canvasPatch.nodeDeletes,
        edgeUpserts: canvasPatch.edgeUpserts,
        edgeDeletes: canvasPatch.edgeDeletes,
        lastRunId: runNodeId,
        expectedVersion: current.version,
      });
    } catch (error) {
      if (error instanceof ProjectVersionConflictError) {
        continue;
      }
      throw error;
    }
  }

  const current = await requireProject(projectId, userId);
  const next = materializeSnapshot(current, runEvents, runNodeId);
  const canvasPatch = diffCanvasPatch(
    { nodes: current.nodes, edges: current.edges },
    next
  );
  return applyCanvasPatchForUser({
    projectId,
    userId,
    nodeUpserts: canvasPatch.nodeUpserts,
    nodeDeletes: canvasPatch.nodeDeletes,
    edgeUpserts: canvasPatch.edgeUpserts,
    edgeDeletes: canvasPatch.edgeDeletes,
    lastRunId: runNodeId,
  });
}

export function materializeSnapshot(
  project: Pick<CanvasProject, "edges" | "id" | "nodes">,
  events: AgentEvent[],
  runNodeId: string
) {
  const projection = projectRunTraceToCanvas({
    events,
    existingEdges: project.edges,
    existingNodes: project.nodes,
    projectId: project.id,
    runNodeId,
  });

  return removeDuplicateRunArtifactNodes(mergeCanvasUpserts(
    { nodes: project.nodes, edges: project.edges },
    { nodes: projection.nodes, edges: projection.edges }
  ), runNodeId);
}

function removeDuplicateRunArtifactNodes(
  snapshot: Pick<CanvasProject, "edges" | "nodes">,
  runNodeId: string
) {
  const seenArtifactIds = new Set<string>();
  const removedNodeIds = new Set<string>();
  const nodes = snapshot.nodes.filter((node) => {
    const artifactId = getNodeArtifactIdForRun(node, runNodeId);
    if (!artifactId) {
      return true;
    }
    if (seenArtifactIds.has(artifactId)) {
      removedNodeIds.add(node.id);
      return false;
    }
    seenArtifactIds.add(artifactId);
    return true;
  });

  if (!removedNodeIds.size) {
    return snapshot;
  }

  return {
    nodes,
    edges: snapshot.edges.filter(
      (edge) => !removedNodeIds.has(edge.source) && !removedNodeIds.has(edge.target)
    ),
  };
}

function getNodeArtifactIdForRun(
  node: CanvasProject["nodes"][number],
  runNodeId: string
) {
  if (node.data.kind === "imageResult" && node.data.runId === runNodeId) {
    return node.data.artifact?.id ?? node.data.image.artifact?.id ?? node.data.image.id;
  }

  if (
    "artifact" in node.data &&
    node.data.artifact &&
    "runId" in node.data &&
    node.data.runId === runNodeId
  ) {
    return node.data.artifact.id;
  }

  return null;
}

async function requireProject(projectId: string, userId: string) {
  const project = await loadCanvasSnapshotForUser(projectId, userId);
  if (!project) {
    throw new Error("Project not found.");
  }
  return project;
}
