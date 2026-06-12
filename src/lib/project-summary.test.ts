import { describe, expect, it } from "vitest";

import {
  getProjectSnapshotStats,
  getProjectSummaryStats,
} from "./project-summary";

describe("project summary stats", () => {
  it("counts canvas nodes and image result nodes", () => {
    expect(
      getProjectSummaryStats([
        { data: { kind: "prompt" } },
        { data: { kind: "run" } },
        { data: { kind: "imageResult" } },
        { data: { kind: "imageResult" } },
      ])
    ).toEqual({ nodeCount: 4, imageCount: 2 });
  });

  it("ignores malformed nodes when counting images", () => {
    expect(getProjectSummaryStats([null, {}, { data: { kind: "prompt" } }]))
      .toEqual({
        nodeCount: 3,
        imageCount: 0,
      });
  });

  it("counts markdown nodes as nodes without treating them as images", () => {
    expect(
      getProjectSummaryStats([
        { data: { kind: "markdown" } },
        { data: { kind: "imageResult" } },
      ])
    ).toEqual({ nodeCount: 2, imageCount: 1 });
  });

  it("computes snapshot byte size for summary columns", () => {
    const snapshot = {
      nodes: [{ id: "markdown-1", data: { kind: "markdown", content: "hi" } }],
      edges: [{ id: "edge-1", source: "a", target: "b" }],
    };

    expect(getProjectSnapshotStats(snapshot)).toEqual({
      nodeCount: 1,
      imageCount: 0,
      snapshotBytes: new TextEncoder().encode(JSON.stringify(snapshot)).byteLength,
    });
  });
});
