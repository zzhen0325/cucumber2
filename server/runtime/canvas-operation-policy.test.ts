import { describe, expect, it } from "vitest";

import { validateCanvasOperations } from "./canvas-operation-policy";
import type { CanvasOperation } from "../../src/types/runtime";

describe("canvas operation policy", () => {
  it("accepts artifact attachment operations produced by the current step", () => {
    const result = validateCanvasOperations({
      artifactIds: ["artifact-1"],
      knownNodeIds: ["run-1", "image-artifact-1"],
      operations: [
        {
          id: "op-1",
          type: "attachArtifact",
          payload: {
            nodeId: "image-artifact-1",
            artifactId: "artifact-1",
            artifact: {
              id: "artifact-1",
              type: "image",
              uri: "https://cdn.example/1.png",
            },
          },
        },
      ],
      projectId: "project-1",
    });

    expect(result.rejected).toEqual([]);
    expect(result.accepted[0].operation.projectId).toBe("project-1");
  });

  it("rejects operations for the wrong project", () => {
    const result = validateCanvasOperations({
      knownNodeIds: ["run-1"],
      operations: [
        {
          id: "op-1",
          projectId: "project-2",
          type: "setNodeStatus",
          payload: {
            nodeId: "run-1",
            status: "success",
          },
        },
      ],
      projectId: "project-1",
    });

    expect(result.accepted).toEqual([]);
    expect(result.rejected[0].reason).toBe("operation_project_mismatch");
  });

  it("rejects attachment operations that target unknown nodes", () => {
    const result = validateCanvasOperations({
      artifactIds: ["artifact-1"],
      knownNodeIds: ["run-1"],
      operations: [
        {
          id: "op-1",
          projectId: "project-1",
          type: "attachArtifact",
          payload: {
            nodeId: "unknown-node",
            artifactId: "artifact-1",
          },
        },
      ],
      projectId: "project-1",
    });

    expect(result.rejected[0].reason).toBe("target_node_not_allowed");
  });

  it("rejects dangling edge proposals", () => {
    const result = validateCanvasOperations({
      knownNodeIds: ["prompt-1"],
      operations: [
        {
          id: "op-1",
          projectId: "project-1",
          type: "createEdge",
          payload: {
            edge: {
              id: "edge-1",
              source: "prompt-1",
              target: "missing-node",
            },
          },
        },
      ],
      projectId: "project-1",
    });

    expect(result.rejected[0].reason).toBe("dangling_edge");
  });

  it("allows edges to nodes created earlier in the same operation batch", () => {
    const result = validateCanvasOperations({
      knownNodeIds: ["prompt-1"],
      operations: [
        {
          id: "op-node",
          projectId: "project-1",
          type: "createNode",
          payload: {
            node: promptNode("prompt-2"),
          },
        },
        {
          id: "op-edge",
          projectId: "project-1",
          type: "createEdge",
          payload: {
            edge: {
              id: "edge-1",
              source: "prompt-1",
              target: "prompt-2",
            },
          },
        },
      ],
      projectId: "project-1",
    });

    expect(result.rejected).toEqual([]);
    expect(result.accepted).toHaveLength(2);
  });
});

function promptNode(id: string): Extract<CanvasOperation, { type: "createNode" }>["payload"]["node"] {
  return {
    id,
    type: "promptNode",
    position: { x: 0, y: 0 },
    data: {
      kind: "prompt",
      prompt: "生成图片",
      contextLabel: "Root",
      createdAt: "2026-06-08T00:00:00.000Z",
    },
  };
}
