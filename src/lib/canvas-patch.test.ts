import { describe, expect, it } from "vitest";

import {
  applyCanvasPatch,
  diffCanvasPatch,
  hasCanvasPatchChanges,
  mergeCanvasUpserts,
} from "./canvas-patch";
import type { AgentCanvasEdge, AgentCanvasNode } from "@/types/canvas";

describe("canvas patch helpers", () => {
  it("diffs node and edge upserts and deletes", () => {
    const previous = {
      edges: [edge("edge-a", "a", "b"), edge("edge-delete", "b", "c")],
      nodes: [node("a", "A"), node("b", "B"), node("delete", "delete")],
    };
    const next = {
      edges: [edge("edge-a", "a", "b", true), edge("edge-new", "b", "c")],
      nodes: [node("a", "A"), node("b", "B2"), node("c", "C")],
    };

    expect(diffCanvasPatch(previous, next)).toEqual({
      edgeDeletes: ["edge-delete"],
      edgeUpserts: [next.edges[0], next.edges[1]],
      nodeDeletes: ["delete"],
      nodeUpserts: [next.nodes[1], next.nodes[2]],
    });
  });

  it("applies patches while preserving unchanged references", () => {
    const unchanged = node("a", "A");
    const replaced = node("b", "B");
    const unchangedEdge = edge("edge-a", "a", "b");
    const snapshot = {
      edges: [unchangedEdge, edge("edge-delete", "b", "c")],
      nodes: [unchanged, replaced, node("delete", "delete")],
    };
    const nextNode = node("b", "B2");
    const nextEdge = edge("edge-b", "b", "c");

    const applied = applyCanvasPatch(snapshot, {
      edgeDeletes: ["edge-delete"],
      edgeUpserts: [nextEdge],
      nodeDeletes: ["delete"],
      nodeUpserts: [nextNode],
    });

    expect(applied.nodes).toEqual([unchanged, nextNode]);
    expect(applied.nodes[0]).toBe(unchanged);
    expect(applied.edges).toEqual([unchangedEdge, nextEdge]);
    expect(applied.edges[0]).toBe(unchangedEdge);
  });

  it("uses upsert merges for projected nodes and edges", () => {
    const current = {
      edges: [edge("edge-a", "a", "b")],
      nodes: [node("a", "A"), node("b", "B")],
    };
    const projected = {
      edges: [edge("edge-b", "b", "c")],
      nodes: [node("b", "B2"), node("c", "C")],
    };

    expect(mergeCanvasUpserts(current, projected)).toEqual({
      edges: [current.edges[0], projected.edges[0]],
      nodes: [current.nodes[0], projected.nodes[0], projected.nodes[1]],
    });
  });

  it("reports empty patches as unchanged", () => {
    expect(hasCanvasPatchChanges(diffCanvasPatch({ edges: [], nodes: [] }, { edges: [], nodes: [] }))).toBe(false);
  });
});

function node(id: string, label: string): AgentCanvasNode {
  return {
    id,
    position: { x: 0, y: 0 },
    type: "stickyNoteNode",
    data: {
      color: "yellow",
      createdAt: "2026-06-12T00:00:00.000Z",
      kind: "stickyNote",
      text: label,
    },
  };
}

function edge(
  id: string,
  source: string,
  target: string,
  active = false
): AgentCanvasEdge {
  return {
    id,
    source,
    target,
    data: active ? { active } : undefined,
  };
}
