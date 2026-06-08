import { describe, expect, it } from "vitest";

import {
  classifyUploadedFile,
  createCanvasNodesFromFiles,
} from "./file-upload";
import type { AgentCanvasNode } from "@/types/canvas";

describe("file upload canvas nodes", () => {
  it("classifies files into supported canvas preview kinds", () => {
    expect(
      classifyUploadedFile(new File([""], "reference.png", { type: "image/png" }))
    ).toBe("image");
    expect(
      classifyUploadedFile(new File([""], "brief.md", { type: "text/markdown" }))
    ).toBe("markdown");
    expect(
      classifyUploadedFile(new File([""], "patch.ts", { type: "" }))
    ).toBe("code");
    expect(
      classifyUploadedFile(new File([""], "data.csv", { type: "text/csv" }))
    ).toBe("dataset");
    expect(
      classifyUploadedFile(new File([""], "notes.txt", { type: "text/plain" }))
    ).toBe("document");
  });

  it("creates image result nodes with a persistent data URL preview", async () => {
    const [node] = await createCanvasNodesFromFiles(
      [new File([Uint8Array.from([1, 2, 3])], "reference.png", { type: "image/png" })],
      { x: 10, y: 20 },
      []
    );

    expect(node).toMatchObject({
      type: "imageResultNode",
      position: { x: 10, y: 20 },
      data: {
        kind: "imageResult",
        prompt: "上传文件: reference.png",
        runId: "local-upload",
      },
    });

    if (node.data.kind !== "imageResult") {
      throw new Error("Expected image result node");
    }

    expect(node.data.image.url).toBe("data:image/png;base64,AQID");
    expect(node.data.artifact?.type).toBe("image");
  });

  it("creates markdown preview nodes with file content", async () => {
    const [node] = await createCanvasNodesFromFiles(
      [new File(["# 方案\n\n上传预览"], "brief.md", { type: "text/markdown" })],
      { x: 30, y: 40 },
      []
    );

    expect(node).toMatchObject({
      id: expect.stringContaining("markdown-upload-markdown"),
      type: "markdownNode",
      data: {
        kind: "markdown",
        title: "brief.md",
      },
    });

    if (node.data.kind !== "markdown") {
      throw new Error("Expected markdown node");
    }

    expect(node.data.content).toContain("上传预览");
    expect(node.data.artifact.metadata?.format).toBe("markdown");
  });

  it("creates code and dataset artifact-backed preview nodes", async () => {
    const nodes = await createCanvasNodesFromFiles(
      [
        new File(["export const ok = true;"], "patch.ts", { type: "" }),
        new File(["name,count\ncucumber,2"], "data.csv", { type: "text/csv" }),
      ],
      { x: 0, y: 0 },
      []
    );

    expect(nodes[0]).toMatchObject({
      type: "codeNode",
      data: {
        kind: "code",
        language: "ts",
        summary: "export const ok = true;",
      },
    });
    expect(nodes[1]).toMatchObject({
      type: "artifactNode",
      data: {
        kind: "artifact",
        artifact: {
          type: "dataset",
        },
      },
    });
  });

  it("moves uploaded nodes away from existing canvas nodes", async () => {
    const [node] = await createCanvasNodesFromFiles(
      [new File(["hello"], "notes.txt", { type: "text/plain" })],
      { x: 0, y: 0 },
      [existingImageNode()]
    );

    expect(node.position.x).toBeGreaterThan(0);
  });
});

function existingImageNode(): AgentCanvasNode {
  return {
    id: "image-existing",
    type: "imageResultNode",
    position: { x: 0, y: 0 },
    data: {
      kind: "imageResult",
      image: {
        id: "existing",
        url: "https://cdn.example/existing.png",
      },
      prompt: "existing",
      runId: "run-1",
    },
  };
}
