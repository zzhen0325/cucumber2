import { beforeEach, describe, expect, it, vi } from "vitest";

const storageMocks = vi.hoisted(() => {
  const createSignedUrl = vi.fn(async () => ({
    data: { signedUrl: "https://signed.example/object.png" },
    error: null,
  }));
  const download = vi.fn();
  const info = vi.fn();
  const registerAgentArtifact = vi.fn(async (input: Record<string, unknown>) => ({
    bucketId: input.bucketId ?? null,
    contentRef: input.contentRef ?? null,
    createdAt: "2026-06-18T00:00:00.000Z",
    createdBy: input.createdBy ?? input.userId ?? null,
    id: input.id,
    metadata: input.metadata ?? {},
    mimeType: input.mimeType ?? null,
    origin: input.origin ?? "user_upload",
    previewKind: input.previewKind ?? null,
    previewText: input.previewText ?? null,
    projectId: input.projectId,
    runNodeId: input.runNodeId ?? null,
    sizeBytes: input.sizeBytes ?? null,
    sourceNodeId: input.sourceNodeId ?? null,
    storagePath: input.storagePath ?? null,
    summary: input.summary ?? null,
    title: input.title ?? null,
    toolCallId: input.toolCallId ?? null,
    type: input.type,
    updatedAt: "2026-06-18T00:00:00.000Z",
    uri: input.uri ?? null,
    version: 0,
  }));
  const replaceAgentKnowledgeChunksForArtifact = vi.fn(async () => undefined);

  return {
    createSignedUrl,
    download,
    info,
    registerAgentArtifact,
    replaceAgentKnowledgeChunksForArtifact,
  };
});

vi.mock("./supabase.ts", () => ({
  getSupabaseClient: () => ({
    storage: {
      from: () => ({
        createSignedUrl: storageMocks.createSignedUrl,
        download: storageMocks.download,
        info: storageMocks.info,
      }),
    },
  }),
  registerAgentArtifact: storageMocks.registerAgentArtifact,
  replaceAgentKnowledgeChunksForArtifact:
    storageMocks.replaceAgentKnowledgeChunksForArtifact,
}));

const {
  completeSignedAssetUpload,
  getArtifactContentUrl,
  getStorageContentRef,
  parseStorageContentRef,
  resolveStorageBackedImageContext,
} = await import("./storage.ts");

describe("agent asset storage helpers", () => {
  beforeEach(() => {
    storageMocks.createSignedUrl.mockClear();
    storageMocks.download.mockReset();
    storageMocks.info.mockReset();
    storageMocks.registerAgentArtifact.mockClear();
    storageMocks.replaceAgentKnowledgeChunksForArtifact.mockClear();
  });

  it("uses stable app refs for stored artifacts", () => {
    expect(
      getStorageContentRef(
        "agent-assets",
        "projects/project-1/uploads/upload-1/reference.png"
      )
    ).toBe(
      "supabase://agent-assets/projects/project-1/uploads/upload-1/reference.png"
    );
    expect(
      parseStorageContentRef(
        "supabase://agent-assets/projects/project-1/uploads/upload-1/reference.png"
      )
    ).toEqual({
      bucket: "agent-assets",
      path: "projects/project-1/uploads/upload-1/reference.png",
    });
    expect(getArtifactContentUrl("project-1", "artifact-1")).toBe(
      "/api/projects/project-1/artifacts/artifact-1/content"
    );
  });

  it("signs storage-backed image context only for the provider request", async () => {
    const context = await resolveStorageBackedImageContext([
      {
        artifact: {
          contentRef:
            "supabase://agent-assets/projects/project-1/uploads/upload-1/reference.png",
          id: "artifact-1",
          type: "image",
          uri: "/api/projects/project-1/artifacts/artifact-1/content",
        },
        contentRef:
          "supabase://agent-assets/projects/project-1/uploads/upload-1/reference.png",
        imageUrl: "/api/projects/project-1/artifacts/artifact-1/content",
        nodeId: "image-1",
        type: "image",
      },
    ]);

    expect(context[0].imageUrl).toBe("https://signed.example/object.png");
    expect(storageMocks.createSignedUrl).toHaveBeenCalledWith(
      "projects/project-1/uploads/upload-1/reference.png",
      600
    );
  });

  it("completes image uploads without downloading the stored object", async () => {
    const artifact = await completeSignedAssetUpload({
      bucket: "agent-assets",
      fileName: "reference.png",
      height: 900,
      kind: "image",
      mimeType: "image/png",
      path: "projects/project-1/uploads/upload-1/reference.png",
      projectId: "project-1",
      sizeBytes: 2048,
      summary: "上传图片 reference.png",
      title: "reference.png",
      uploadId: "upload-1",
      userId: "user-1",
      width: 1600,
    });

    expect(storageMocks.info).not.toHaveBeenCalled();
    expect(storageMocks.download).not.toHaveBeenCalled();
    expect(artifact).toMatchObject({
      id: "upload-upload-1",
      mimeType: "image/png",
      sizeBytes: 2048,
      type: "image",
      uri: "/api/projects/project-1/artifacts/upload-upload-1/content",
    });
    expect(artifact.metadata).toMatchObject({
      byteSize: 2048,
      fileName: "reference.png",
      height: 900,
      previewKind: "image",
      width: 1600,
    });
    expect(artifact.metadata?.digest).toBeUndefined();
    expect(storageMocks.replaceAgentKnowledgeChunksForArtifact).toHaveBeenCalled();
  });

  it("still downloads textual uploads for body indexing and digest metadata", async () => {
    storageMocks.info.mockResolvedValueOnce({
      data: {
        metadata: {
          mimetype: "text/markdown",
          size: 15,
        },
      },
      error: null,
    });
    storageMocks.download.mockResolvedValueOnce({
      data: {
        async arrayBuffer() {
          return new TextEncoder().encode("# Brief\n\nHello").buffer;
        },
      },
      error: null,
    });

    const artifact = await completeSignedAssetUpload({
      bucket: "agent-assets",
      fileName: "brief.md",
      kind: "markdown",
      mimeType: "text/markdown",
      path: "projects/project-1/uploads/upload-2/brief.md",
      projectId: "project-1",
      sizeBytes: 15,
      summary: "上传 Markdown brief.md",
      title: "brief.md",
      uploadId: "upload-2",
      userId: "user-1",
    });

    expect(storageMocks.download).toHaveBeenCalledWith(
      "projects/project-1/uploads/upload-2/brief.md"
    );
    expect(artifact.metadata?.digest).toMatch(/^sha256:/);
    const knowledgeCalls =
      storageMocks.replaceAgentKnowledgeChunksForArtifact.mock.calls as unknown as Array<
        [unknown]
      >;
    const knowledgeCall = knowledgeCalls.at(-1)?.[0];
    expect(JSON.stringify(knowledgeCall)).toContain("Brief");
    expect(JSON.stringify(knowledgeCall)).toContain("Hello");
  });
});
