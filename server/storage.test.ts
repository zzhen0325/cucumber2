import { beforeEach, describe, expect, it, vi } from "vitest";

const storageMocks = vi.hoisted(() => {
  const createPresignedReadUrl = vi.fn(async () => "https://signed.example/object.png");
  const createPresignedUploadUrl = vi.fn(async () => ({
    expiresIn: 7200,
    headers: { "Content-Type": "image/png" },
    method: "PUT" as const,
    signedUrl: "https://upload.example/object.png",
  }));
  const getObject = vi.fn();
  const headObject = vi.fn();
  const putObject = vi.fn(async () => undefined);
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
    createPresignedReadUrl,
    createPresignedUploadUrl,
    getObject,
    headObject,
    putObject,
    registerAgentArtifact,
    replaceAgentKnowledgeChunksForArtifact,
  };
});

vi.mock("./r2-storage.ts", () => ({
  createPresignedReadUrl: storageMocks.createPresignedReadUrl,
  createPresignedUploadUrl: storageMocks.createPresignedUploadUrl,
  getObject: storageMocks.getObject,
  getR2AssetsBucket: () => "agent-assets",
  getR2SignedReadTtlSeconds: () => 600,
  getR2SignedUploadTtlSeconds: () => 7200,
  getR2SkillPackagesBucket: () => "agent-skill-packages",
  headObject: storageMocks.headObject,
  isR2Configured: () => true,
  putObject: storageMocks.putObject,
}));

vi.mock("./supabase.ts", () => ({
  registerAgentArtifact: storageMocks.registerAgentArtifact,
  replaceAgentKnowledgeChunksForArtifact:
    storageMocks.replaceAgentKnowledgeChunksForArtifact,
}));

const {
  createSignedAssetUpload,
  completeSignedAssetUpload,
  getArtifactContentUrl,
  getArtifactStorageContentRef,
  getStorageContentRef,
  parseStorageContentRef,
  resolveStorageBackedImageContext,
} = await import("./storage.ts");

describe("agent asset storage helpers", () => {
  beforeEach(() => {
    storageMocks.createPresignedReadUrl.mockClear();
    storageMocks.createPresignedUploadUrl.mockClear();
    storageMocks.getObject.mockReset();
    storageMocks.headObject.mockReset();
    storageMocks.putObject.mockClear();
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
      "r2://agent-assets/projects/project-1/uploads/upload-1/reference.png"
    );
    expect(
      parseStorageContentRef(
        "r2://agent-assets/projects/project-1/uploads/upload-1/reference.png"
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
            "r2://agent-assets/projects/project-1/uploads/upload-1/reference.png",
          id: "artifact-1",
          type: "image",
          uri: "/api/projects/project-1/artifacts/artifact-1/content",
        },
        contentRef:
          "r2://agent-assets/projects/project-1/uploads/upload-1/reference.png",
        imageUrl: "/api/projects/project-1/artifacts/artifact-1/content",
        nodeId: "image-1",
        type: "image",
      },
    ]);

    expect(context[0].imageUrl).toBe("https://signed.example/object.png");
    expect(storageMocks.createPresignedReadUrl).toHaveBeenCalledWith({
      bucket: "agent-assets",
      expiresIn: 600,
      path: "projects/project-1/uploads/upload-1/reference.png",
    });
  });

  it("recovers storage refs from artifact metadata for migrated image contexts", async () => {
    const artifact = {
      id: "artifact-1",
      metadata: {
        storageBucket: "agent-assets",
        storagePath: "projects/project-1/uploads/upload-1/reference.png",
      },
      type: "image" as const,
      uri: "/api/projects/project-1/artifacts/artifact-1/content",
    };

    expect(getArtifactStorageContentRef(artifact)).toBe(
      "r2://agent-assets/projects/project-1/uploads/upload-1/reference.png"
    );

    const context = await resolveStorageBackedImageContext([
      {
        artifact,
        imageUrl: "/api/projects/project-1/artifacts/artifact-1/content",
        nodeId: "image-1",
        type: "image",
      },
    ]);

    expect(context[0]).toMatchObject({
      contentRef:
        "r2://agent-assets/projects/project-1/uploads/upload-1/reference.png",
      imageUrl: "https://signed.example/object.png",
    });
    expect(context[0].artifact?.contentRef).toBe(
      "r2://agent-assets/projects/project-1/uploads/upload-1/reference.png"
    );
    expect(storageMocks.createPresignedReadUrl).toHaveBeenCalledWith({
      bucket: "agent-assets",
      expiresIn: 600,
      path: "projects/project-1/uploads/upload-1/reference.png",
    });
  });

  it("creates R2 presigned upload contracts", async () => {
    const upload = await createSignedAssetUpload({
      fileName: "reference.png",
      mimeType: "image/png",
      projectId: "project-1",
      sizeBytes: 2048,
    });

    expect(upload).toMatchObject({
      bucket: "agent-assets",
      contentRef: expect.stringContaining(
        "r2://agent-assets/projects/project-1/uploads/"
      ),
      expiresIn: 7200,
      headers: { "Content-Type": "image/png" },
      method: "PUT",
      signedUrl: "https://upload.example/object.png",
    });
    expect(upload.contentRef).toContain("/reference.png");
    expect(storageMocks.createPresignedUploadUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        bucket: "agent-assets",
        contentType: "image/png",
        expiresIn: 7200,
      })
    );
  });

  it("completes image uploads after verifying the stored object", async () => {
    storageMocks.headObject.mockResolvedValueOnce({
      mimeType: "image/png",
      sizeBytes: 2048,
    });

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

    expect(storageMocks.headObject).toHaveBeenCalledWith(
      "agent-assets",
      "projects/project-1/uploads/upload-1/reference.png"
    );
    expect(storageMocks.getObject).not.toHaveBeenCalled();
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
    storageMocks.headObject.mockResolvedValueOnce({
      mimeType: "text/markdown",
      sizeBytes: 15,
    });
    storageMocks.getObject.mockResolvedValueOnce({
      bytes: new TextEncoder().encode("# Brief\n\nHello"),
      mimeType: "text/markdown",
      sizeBytes: 15,
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

    expect(storageMocks.getObject).toHaveBeenCalledWith(
      "agent-assets",
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
