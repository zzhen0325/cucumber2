import { describe, expect, it } from "vitest";

import { normalizeLoadedCanvasSnapshot } from "./canvas-load-normalization";
import type { AgentCanvasEdge, AgentCanvasNode } from "@/types/canvas";

describe("normalizeLoadedCanvasSnapshot", () => {
  it("removes stale pending text artifact placeholders when a materialized artifact exists", () => {
    const nodes: AgentCanvasNode[] = [
      {
        id: "run-1",
        type: "runNode",
        position: { x: 0, y: 0 },
        data: {
          kind: "run",
          prompt: "分析 IP",
          status: "success",
        },
      },
      {
        id: "markdown-pending-run-1-1",
        type: "markdownNode",
        position: { x: 0, y: 160 },
        data: {
          kind: "markdown",
          artifact: {
            id: "pending-run-1-markdown-1",
            metadata: { pending: true },
            type: "doc",
          },
          content: "正在生成，结果会自动写入这个节点。",
          runId: "run-1",
          title: "分析 IP",
        },
      },
      {
        id: "document-text-1",
        type: "documentNode",
        position: { x: 260, y: 160 },
        data: {
          kind: "document",
          artifact: {
            id: "text-1",
            title: "上传IP形象特征分析报告",
            type: "doc",
          },
          runId: "run-1",
          title: "上传IP形象特征分析报告",
        },
      },
    ];
    const edges: AgentCanvasEdge[] = [
      {
        id: "edge-run-pending",
        source: "run-1",
        target: "markdown-pending-run-1-1",
      },
      {
        id: "edge-run-document",
        source: "run-1",
        target: "document-text-1",
      },
    ];

    const normalized = normalizeLoadedCanvasSnapshot({
      edges,
      nodes,
      projectId: "project-1",
    });

    expect(normalized.nodes.map((node) => node.id)).toEqual([
      "run-1",
      "document-text-1",
    ]);
    expect(normalized.edges.map((edge) => edge.id)).toEqual([
      "edge-run-document",
    ]);
    expect(
      normalized.nodes.find((node) => node.id === "document-text-1")?.data
    ).toMatchObject({
      artifact: {
        metadata: {
          projectId: "project-1",
        },
      },
    });
  });
});
