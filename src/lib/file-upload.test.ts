import { afterEach, describe, expect, it, vi } from "vitest";

import {
  classifyUploadedFile,
  createCanvasNodesFromFiles,
  prepareLocalCanvasUploads,
  type UploadedFileForStorage,
} from "./file-upload";
import { toPersistableNodes } from "./canvas-persistence";
import type { AgentCanvasNode, ArtifactRef } from "@/types/canvas";

describe("file upload canvas nodes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  it("creates image result nodes with storage-backed previews", async () => {
    const [node] = await createCanvasNodesFromFiles(
      [new File([createFakePngBytes(1600, 900)], "reference.png", { type: "image/png" })],
      { x: 10, y: 20 },
      [],
      { resolveUploadedFile: resolveTestUpload }
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

    expect(node.width).toBe(240);
    expect(node.height).toBe(135);
    expect(node.data.image.url).toBe(
      "/api/projects/project-1/artifacts/upload-image-reference-png/content"
    );
    expect(JSON.stringify(node)).not.toContain("data:image/png");
    expect(JSON.stringify(node)).not.toContain("local-upload://");
    expect(node.data.artifact?.type).toBe("image");
    expect(node.data.image.metadata).toMatchObject({ width: 1600, height: 900 });
    expect(node.data.artifact?.metadata).toMatchObject({
      byteSize: 24,
      mimeType: "image/png",
      previewKind: "image",
    });
  });

  it("creates markdown preview nodes with file content", async () => {
    const [node] = await createCanvasNodesFromFiles(
      [new File(["# 方案\n\n上传预览"], "brief.md", { type: "text/markdown" })],
      { x: 30, y: 40 },
      [],
      { resolveUploadedFile: resolveTestUpload }
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

  it("uses full markdown text for canvas content instead of the storage preview", async () => {
    const longMarkdown = [
      "# Agent Skill",
      "",
      ...Array.from({ length: 120 }, (_, index) => `- step ${index}: keep this line`),
      "",
      "final line should remain visible",
    ].join("\n");
    const [node] = await createCanvasNodesFromFiles(
      [new File([longMarkdown], "SKILL.md", { type: "text/markdown" })],
      { x: 0, y: 0 },
      [],
      { resolveUploadedFile: resolveTestUpload }
    );

    if (node.data.kind !== "markdown") {
      throw new Error("Expected markdown node");
    }

    expect(longMarkdown.length).toBeGreaterThan(900);
    expect(node.data.content).toContain("final line should remain visible");
    expect(node.data.content).not.toContain("...内容已截断");
  });

  it("creates code and dataset artifact-backed preview nodes", async () => {
    const nodes = await createCanvasNodesFromFiles(
      [
        new File(["export const ok = true;"], "patch.ts", { type: "" }),
        new File(["name,count\ncucumber,2"], "data.csv", { type: "text/csv" }),
      ],
      { x: 0, y: 0 },
      [],
      { resolveUploadedFile: resolveTestUpload }
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
      [existingImageNode()],
      { resolveUploadedFile: resolveTestUpload }
    );

    expect(node.position.x).toBeGreaterThan(0);
  });

  it("creates optimistic local image nodes before storage upload completes", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:local-reference");

    const [prepared] = await prepareLocalCanvasUploads(
      [new File([createFakePngBytes(1600, 900)], "reference.png", { type: "image/png" })],
      { x: 10, y: 20 },
      [],
      {
        createLocalId: () => "image-1",
        uploadedAt: "2026-06-12T00:00:00.000Z",
      }
    );

    expect(prepared.localNode).toMatchObject({
      position: { x: 10, y: 20 },
      data: {
        kind: "imageResult",
        upload: {
          localPreviewUrl: "blob:local-reference",
          status: "uploading",
        },
      },
    });

    if (prepared.localNode.data.kind !== "imageResult") {
      throw new Error("Expected image result node");
    }
    expect(prepared.localNode.data.image.url).toBe("blob:local-reference");
    expect(prepared.localNode.data.artifact?.contentRef).toBe(
      "local-upload://local-upload-image-1"
    );
  });

  it("excludes local upload nodes from persisted snapshots", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:local-reference");

    const [prepared] = await prepareLocalCanvasUploads(
      [new File([createFakePngBytes(1600, 900)], "reference.png", { type: "image/png" })],
      { x: 0, y: 0 },
      [],
      { createLocalId: () => "image-1" }
    );

    const persistableNodes = toPersistableNodes([prepared.localNode]);

    expect(persistableNodes).toEqual([]);
    expect(JSON.stringify(persistableNodes)).not.toContain("blob:local-reference");
    expect(JSON.stringify(persistableNodes)).not.toContain("local-upload://");
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

async function resolveTestUpload(
  upload: UploadedFileForStorage
): Promise<ArtifactRef> {
  const id = `upload-${upload.kind}-${upload.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")}`;
  const typeByKind = {
    code: "code",
    dataset: "dataset",
    document: "doc",
    file: "file",
    image: "image",
    markdown: "doc",
    webpage: "webpage",
  } satisfies Record<UploadedFileForStorage["kind"], ArtifactRef["type"]>;
  const metadata = {
    ...upload.metadata,
    format: upload.kind === "markdown" ? "markdown" : undefined,
    storageBucket: "agent-assets",
    storagePath: `projects/project-1/uploads/test/${upload.title}`,
    summary: upload.summary,
  };

  return {
    contentRef: `r2://agent-assets/projects/project-1/uploads/test/${upload.title}`,
    id,
    metadata,
    title: upload.title,
    type: typeByKind[upload.kind],
    uri:
      upload.kind === "image"
        ? `/api/projects/project-1/artifacts/${id}/content`
        : undefined,
  };
}

function createFakePngBytes(width: number, height: number) {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  bytes.set([0, 0, 0, 13], 8);
  bytes.set([73, 72, 68, 82], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);

  return bytes;
}
