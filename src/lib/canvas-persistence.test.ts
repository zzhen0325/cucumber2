import { describe, expect, it } from "vitest";

import type { AgentCanvasNode } from "@/types/canvas";
import {
  assertLeanNodeJson,
  toPersistableNode,
  toPersistableNodes,
} from "./canvas-persistence";

describe("canvas persistence", () => {
  it("strips React Flow runtime fields before node_json storage", () => {
    const node = toPersistableNode({
      data: { color: "yellow", createdAt: "now", kind: "stickyNote", text: "hi" },
      dragging: true,
      id: "sticky-1",
      measured: { width: 200, height: 100 },
      position: { x: 1, y: 2 },
      positionAbsolute: { x: 1, y: 2 },
      selected: true,
      type: "stickyNoteNode",
    } as AgentCanvasNode & {
      measured?: unknown;
      positionAbsolute?: unknown;
    });

    expect(node).not.toHaveProperty("selected");
    expect(node).not.toHaveProperty("dragging");
    expect(node).not.toHaveProperty("measured");
    expect(node).not.toHaveProperty("positionAbsolute");
  });

  it("drops local upload nodes", () => {
    const nodes = toPersistableNodes([
      {
        data: {
          artifact: { id: "artifact-1", type: "image" },
          image: { id: "artifact-1", title: "Uploading", url: "" },
          kind: "imageResult",
          prompt: "upload",
          upload: { status: "uploading" },
        },
        id: "local-upload-1",
        position: { x: 0, y: 0 },
        type: "imageResultNode",
      },
    ]);

    expect(nodes).toEqual([]);
  });

  it("keeps markdown node_json lightweight", () => {
    const node = toPersistableNode({
      data: {
        artifact: {
          id: "doc-1",
          metadata: {
            blockNoteBlocks: [{ type: "paragraph" }],
            markdown: "# Hello",
            previewKind: "markdown",
          },
          title: "Doc",
          type: "doc",
        },
        blockNoteBlocks: [{ type: "paragraph" }],
        content: "# Hello",
        kind: "markdown",
        summary: "Hello",
        title: "Doc",
      },
      id: "markdown-1",
      position: { x: 0, y: 0 },
      type: "markdownNode",
    } as AgentCanvasNode);

    expect(node.data).not.toHaveProperty("content");
    expect(node.data).not.toHaveProperty("blockNoteBlocks");
    expect(JSON.stringify(node)).not.toContain("blockNoteBlocks");
    expect(JSON.stringify(node)).not.toContain("# Hello");
  });

  it("rejects oversized node_json", () => {
    const node = {
      data: {
        color: "yellow",
        createdAt: "now",
        kind: "stickyNote",
        text: "x".repeat(70 * 1024),
      },
      id: "sticky-large",
      position: { x: 0, y: 0 },
      type: "stickyNoteNode",
    } as AgentCanvasNode;

    expect(() => assertLeanNodeJson(node)).toThrow(/too large for node_json/);
  });
});
