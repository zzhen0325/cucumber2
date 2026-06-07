import { describe, expect, it } from "vitest";

import { getProjectSummaryStats } from "./project-summary";

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
});
