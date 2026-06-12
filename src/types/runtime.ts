import type { AgentCanvasEdge, AgentCanvasNode } from "./canvas";

export type CanvasOperation =
  | { id: string; projectId?: string; type: "createNode"; payload: { node: AgentCanvasNode } }
  | {
      id: string;
      projectId?: string;
      type: "updateNode";
      payload: {
        nodeId: string;
        position?: AgentCanvasNode["position"];
        data?: Partial<AgentCanvasNode["data"]>;
      };
    }
  | { id: string; projectId?: string; type: "createEdge"; payload: { edge: AgentCanvasEdge } }
  | {
      id: string;
      projectId?: string;
      type: "setNodeStatus";
      payload: { nodeId: string; status: string; error?: string };
    };

export const agentEventTypes = [
  "run.created",
  "input.normalized",
  "skill.retrieved",
  "skill.activated",
  "skill.script.started",
  "skill.script.completed",
  "skill.script.failed",
  "agent.active",
  "handoff.requested",
  "handoff.completed",
  "tool.input",
  "tool.output",
  "tool.error",
  "artifact.created",
  "canvas.operation.proposed",
  "canvas.operation.applied",
  "canvas.operation.rejected",
  "run.completed",
  "run.failed",
] as const;

export type AgentEventType = (typeof agentEventTypes)[number];

export type AgentEvent = {
  id?: string;
  projectId: string;
  runNodeId: string;
  stepId: string;
  type: AgentEventType;
  payload: Record<string, unknown>;
  errorText?: string | null;
  createdAt: string;
};
