import { describe, expect, it } from "vitest";

import { validateCanvasOperations } from "./canvas-operation-policy";
import type { CanvasOperation } from "../../../src/types/runtime";

describe("canvas operation policy", () => {
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
      runNodeId: "run-1",
    });

    expect(result.accepted).toEqual([]);
    expect(result.rejected[0].reason).toBe("operation_project_mismatch");
  });

  it("rejects updates that target unknown nodes", () => {
    const result = validateCanvasOperations({
      knownNodeIds: ["run-1"],
      operations: [
        {
          id: "op-1",
          projectId: "project-1",
          type: "updateNode",
          payload: {
            nodeId: "unknown-node",
            data: { kind: "prompt" },
          },
        },
      ],
      projectId: "project-1",
      runNodeId: "run-1",
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
      runNodeId: "run-1",
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
            node: stickyNoteNode("note-2"),
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
              target: "note-2",
            },
          },
        },
      ],
      projectId: "project-1",
      runNodeId: "run-1",
    });

    expect(result.rejected).toEqual([]);
    expect(result.accepted).toHaveLength(2);
  });

  it("rejects artifact-backed and incomplete content nodes", () => {
    const result = validateCanvasOperations({
      knownNodeIds: ["run-1"],
      operations: [
        {
          id: "op-node",
          projectId: "project-1",
          type: "createNode",
          payload: {
            node: {
              id: "markdown-1",
              type: "markdownNode",
              position: { x: 0, y: 0 },
              data: { kind: "markdown", content: "summary" },
            } as never,
          },
        },
      ],
      projectId: "project-1",
      runNodeId: "run-1",
    });

    expect(result.accepted).toEqual([]);
    expect(result.rejected[0].reason).toBe("invalid_node_kind");
  });

  it("rejects data mutation through updateNode", () => {
    const result = validateCanvasOperations({
      knownNodeIds: ["note-1"],
      operations: [
        {
          id: "op-update",
          projectId: "project-1",
          type: "updateNode",
          payload: { nodeId: "note-1", data: { text: "changed" } },
        },
      ],
      projectId: "project-1",
      runNodeId: "run-1",
    });

    expect(result.rejected[0].reason).toBe("node_data_update_not_allowed");
  });

  it("accepts a complete ellipse shape", () => {
    const result = validateCanvasOperations({
      knownNodeIds: ["run-1"],
      operations: [
        {
          id: "op-shape",
          projectId: "project-1",
          type: "createNode",
          payload: {
            node: {
              id: "shape-1",
              type: "shapeNode",
              position: { x: 10, y: 20 },
              data: {
                kind: "shape",
                shape: "ellipse",
                label: "圆形",
                createdAt: "2026-06-11T00:00:00.000Z",
              },
            },
          },
        },
      ],
      projectId: "project-1",
      runNodeId: "run-1",
    });

    expect(result.rejected).toEqual([]);
    expect(result.accepted).toHaveLength(1);
  });
});

function stickyNoteNode(id: string): Extract<CanvasOperation, { type: "createNode" }>["payload"]["node"] {
  return {
    id,
    type: "stickyNoteNode",
    position: { x: 0, y: 0 },
    data: {
      kind: "stickyNote",
      text: "画布摘要",
      color: "yellow",
      createdAt: "2026-06-08T00:00:00.000Z",
    },
  };
}
