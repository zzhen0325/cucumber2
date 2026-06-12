import { describe, expect, it, vi } from "vitest";

const createSignedUrl = vi.fn(async () => ({
  data: { signedUrl: "https://signed.example/object.png" },
  error: null,
}));

vi.mock("./supabase.ts", () => ({
  getSupabaseClient: () => ({
    storage: {
      from: () => ({
        createSignedUrl,
      }),
    },
  }),
  registerAgentArtifact: vi.fn(),
}));

const {
  getArtifactContentUrl,
  getStorageContentRef,
  parseStorageContentRef,
  resolveStorageBackedImageContext,
} = await import("./storage.ts");

describe("agent asset storage helpers", () => {
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
    expect(createSignedUrl).toHaveBeenCalledWith(
      "projects/project-1/uploads/upload-1/reference.png",
      600
    );
  });
});
