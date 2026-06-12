import { projectRunTraceToCanvas } from "../../src/lib/graph-projection.ts";
import { diffCanvasPatch, hasCanvasPatchChanges, mergeCanvasUpserts } from "../../src/lib/canvas-patch.ts";
import type { AgentEvent, AgentEventType } from "../../src/types/runtime.ts";
import {
  getProjectForUser,
  updateProjectForUser,
  ProjectVersionConflictError,
  type AgentProject,
} from "../supabase.ts";

const materializedEventTypes = new Set<AgentEventType>([
  "artifact.created",
  "canvas.operation.applied",
  "run.completed",
  "run.failed",
]);

export function shouldMaterializeRunEvent(type: AgentEventType) {
  return materializedEventTypes.has(type);
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
    const current = await getProjectForUser(projectId, userId);
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
      return await updateProjectForUser({
        projectId,
        userId,
        canvasPatch,
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
  return updateProjectForUser({
    projectId,
    userId,
    canvasPatch,
    lastRunId: runNodeId,
  });
}

export function materializeSnapshot(
  project: Pick<AgentProject, "edges" | "id" | "nodes">,
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

  return mergeCanvasUpserts(
    { nodes: project.nodes, edges: project.edges },
    { nodes: projection.nodes, edges: projection.edges }
  );
}

async function requireProject(projectId: string, userId: string) {
  const project = await getProjectForUser(projectId, userId);
  if (!project) {
    throw new Error("Project not found.");
  }
  return project;
}
