import { RunContext } from "@openai/agents";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CucumberAgentContext } from "../../context.ts";
import type { UpstreamContextItem } from "../../../../src/types/canvas.ts";

const generateSeedreamImage = vi.fn();
const upscaleSeedreamImage = vi.fn();
const isSeedreamConfigured = vi.fn();
const resolveStorageBackedImageContext = vi.fn(async (items: UpstreamContextItem[]) =>
  items.map((item) =>
    item.artifact?.contentRef?.startsWith("supabase://")
      ? { ...item, imageUrl: "https://signed.example/ref.png" }
      : item
  )
);
const storeGeneratedImageFromUrl = vi.fn(
  async (input: {
    artifactId: string;
    metadata?: Record<string, unknown>;
    projectId: string;
    runNodeId: string;
    sourceUrl: string;
    title?: string;
  }) => ({
    contentRef: `supabase://agent-assets/projects/${input.projectId}/runs/${input.runNodeId}/artifacts/${input.artifactId}.png`,
    id: input.artifactId,
    metadata: {
      ...input.metadata,
      storageBucket: "agent-assets",
      storagePath: `projects/${input.projectId}/runs/${input.runNodeId}/artifacts/${input.artifactId}.png`,
    },
    title: input.title,
    type: "image" as const,
    uri: `/api/projects/${input.projectId}/artifacts/${input.artifactId}/content`,
  })
);
const testSeedreamConfig = {
  accessKeyId: "test-ak",
  secretAccessKey: "test-sk",
  reqKey: "jimeng_seedream46_cvtob",
  host: "visual.volcengineapi.com",
  region: "cn-north-1",
  service: "cv",
  version: "2022-08-31",
  width: 1024,
  height: 1024,
  forceSingle: true,
  maxInputImages: 14,
  maxOutputImages: 4,
  maxConcurrency: 2,
  staggerMs: 0,
  maxRetries: 4,
};

vi.mock("../../../../seedream.ts", async () => {
  const actual = await vi.importActual<typeof import("../../../../seedream.ts")>(
    "../../../../seedream.ts"
  );
  return {
    ...actual,
    generateSeedreamImage: (...args: unknown[]) => generateSeedreamImage(...args),
    isSeedreamConfigured: () => isSeedreamConfigured(),
    readSeedreamConfigFromEnv: () => testSeedreamConfig,
    readSeedreamUpscaleConfigFromEnv: () => ({
      ...testSeedreamConfig,
      reqKey: "jimeng_i2i_seed3_tilesr_cvtob",
    }),
    upscaleSeedreamImage: (...args: unknown[]) => upscaleSeedreamImage(...args),
  };
});

vi.mock("../../../storage.ts", () => ({
  resolveStorageBackedImageContext: (items: UpstreamContextItem[]) =>
    resolveStorageBackedImageContext(items),
  storeGeneratedImageFromUrl: (
    input: Parameters<typeof storeGeneratedImageFromUrl>[0]
  ) => storeGeneratedImageFromUrl(input),
}));

// Imported after the mock is registered.
const { generateImageTool } = await import("./generate-image.tool.ts");
const { upscaleImageTool } = await import("./upscale-image.tool.ts");
const { toSeedreamUpstreamContext } = await import("./generate-image.request.ts");

function buildContext(
  overrides: Partial<CucumberAgentContext> = {}
): CucumberAgentContext {
  return {
    userId: "user-1",
    projectId: "project-1",
    canvasId: "project-1",
    runNodeId: "run-1",
    canvasSnapshot: { nodes: [], edges: [] },
    selectedNodeIds: [],
    knownNodeIds: [],
    producedArtifacts: [],
    pendingEvents: [],
    prompt: "生成一张黄瓜海报",
    selectedNodeId: null,
    upstreamContext: [],
    ...overrides,
  };
}

async function invokeTool(context: CucumberAgentContext, input: unknown) {
  const runContext = new RunContext(context);
  // The SDK passes tool arguments as a JSON string.
  const raw = await generateImageTool.invoke(runContext, JSON.stringify(input));
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

describe("generate_image tool", () => {
  beforeEach(() => {
    generateSeedreamImage.mockReset();
    upscaleSeedreamImage.mockReset();
    isSeedreamConfigured.mockReset();
    resolveStorageBackedImageContext.mockClear();
    storeGeneratedImageFromUrl.mockClear();
  });

  it("generates images and emits artifact_created events without leaking urls", async () => {
    isSeedreamConfigured.mockReturnValue(true);
    generateSeedreamImage.mockImplementation(
      async (input: { onImage?: (image: unknown) => void }) => {
        const images = [
          { id: "seedream-1", url: "https://cdn.example/1.png", title: "Seedream image" },
        ];
        for (const image of images) {
          await input.onImage?.(image);
        }
        return { images };
      }
    );

    const context = buildContext();
    const result = await invokeTool(context, { prompt: "黄瓜海报", resultCount: 1 });

    expect(result.generated).toBe(1);
    expect(JSON.stringify(result)).not.toContain("cdn.example");

    expect(context.producedArtifacts).toHaveLength(1);
    expect(context.producedArtifacts[0]).toMatchObject({
      contentRef:
        "supabase://agent-assets/projects/project-1/runs/run-1/artifacts/seedream-1.png",
      id: "seedream-1",
      type: "image",
      uri: "/api/projects/project-1/artifacts/seedream-1/content",
    });
    expect(storeGeneratedImageFromUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        artifactId: "seedream-1",
        projectId: "project-1",
        runNodeId: "run-1",
        sourceUrl: "https://cdn.example/1.png",
      })
    );
    expect(context.pendingEvents).toEqual([
      {
        type: "artifact_created",
        artifact: expect.objectContaining({ id: "seedream-1", type: "image" }),
        toolName: "generate_image",
      },
    ]);

    const callArg = generateSeedreamImage.mock.calls[0][0];
    expect(callArg).toMatchObject({
      totalRequestedImageCount: 1,
      promptBatchMode: "single_prompt",
      requests: [
        {
          body: expect.objectContaining({ prompt: "黄瓜海报" }),
          resultCount: 1,
          promptIndex: 1,
        },
      ],
    });
  });

  it("falls back to the run prompt when no prompt argument is provided", async () => {
    isSeedreamConfigured.mockReturnValue(true);
    generateSeedreamImage.mockResolvedValue({
      images: [{ id: "seedream-1", url: "https://cdn.example/1.png" }],
    });

    const context = buildContext({ prompt: "默认提示词" });
    await invokeTool(context, {});

    expect(generateSeedreamImage.mock.calls[0][0].requests[0].body.prompt).toBe(
      "默认提示词"
    );
  });

  it("throws when seedream is not configured (no silent fallback)", async () => {
    isSeedreamConfigured.mockReturnValue(false);
    const context = buildContext();

    await expect(invokeTool(context, { prompt: "x" })).rejects.toThrow(
      /not configured/i
    );
    expect(generateSeedreamImage).not.toHaveBeenCalled();
  });

  it("forwards only image and prompt upstream items to the image service", () => {
    const items: UpstreamContextItem[] = [
      { nodeId: "p1", type: "prompt", prompt: "风格参考" },
      { nodeId: "i1", type: "image", imageUrl: "https://cdn.example/ref.png" },
      {
        nodeId: "a1",
        type: "artifact",
        artifact: { id: "a1", type: "image", uri: "https://cdn.example/art.png" },
      },
      { nodeId: "d1", type: "doc", summary: "ignored doc" },
    ];

    expect(toSeedreamUpstreamContext(items)).toEqual([
      { nodeId: "p1", type: "prompt", prompt: "风格参考", summary: undefined },
      {
        nodeId: "i1",
        type: "image",
        prompt: undefined,
        imageUrl: "https://cdn.example/ref.png",
        summary: undefined,
      },
      {
        nodeId: "a1",
        type: "image",
        prompt: undefined,
        imageUrl: "https://cdn.example/art.png",
        summary: undefined,
      },
    ]);
  });

  it("signs storage-backed image references only when building Seedream input", async () => {
    isSeedreamConfigured.mockReturnValue(true);
    generateSeedreamImage.mockResolvedValue({ images: [] });
    const context = buildContext({
      upstreamContext: [
        {
          artifact: {
            contentRef: "supabase://agent-assets/projects/project-1/uploads/ref.png",
            id: "ref",
            type: "image",
            uri: "/api/projects/project-1/artifacts/ref/content",
          },
          contentRef: "supabase://agent-assets/projects/project-1/uploads/ref.png",
          imageUrl: "/api/projects/project-1/artifacts/ref/content",
          nodeId: "image-1",
          type: "image",
        },
      ],
    });

    await invokeTool(context, { prompt: "参考图生成" });

    const callArg = generateSeedreamImage.mock.calls[0][0];
    expect(callArg.requests[0].body.image_urls).toEqual([
      "https://signed.example/ref.png",
    ]);
    expect(JSON.stringify(context.pendingEvents)).not.toContain("signed.example");
  });

  it("upscales the selected image and emits artifact_created events without leaking urls", async () => {
    isSeedreamConfigured.mockReturnValue(true);
    upscaleSeedreamImage.mockImplementation(
      async (input: { onImage?: (image: unknown) => void }) => {
        const image = {
          id: "seedream-upscale-1",
          metadata: { operation: "upscale", resolution: "4k", scale: 50 },
          title: "Seedream 4K upscale",
          url: "https://cdn.example/upscaled.png",
        };
        await input.onImage?.(image);
        return { images: [image] };
      }
    );

    const context = buildContext({
      selectedNodeId: "image-1",
      upstreamContext: [
        {
          artifact: {
            contentRef: "supabase://agent-assets/projects/project-1/uploads/ref.png",
            id: "ref",
            type: "image",
            uri: "/api/projects/project-1/artifacts/ref/content",
          },
          contentRef: "supabase://agent-assets/projects/project-1/uploads/ref.png",
          imageUrl: "/api/projects/project-1/artifacts/ref/content",
          nodeId: "image-1",
          type: "image",
        },
      ],
    });
    const result = await invokeUpscaleTool(context, {});

    expect(result.upscaled).toBe(1);
    expect(JSON.stringify(result)).not.toContain("cdn.example");
    expect(upscaleSeedreamImage.mock.calls[0][0]).toMatchObject({
      imageUrl: "https://signed.example/ref.png",
    });
    expect(storeGeneratedImageFromUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        artifactId: "seedream-upscale-1",
        metadata: expect.objectContaining({
          operation: "upscale",
          sourceNodeId: "image-1",
        }),
        sourceNodeId: "image-1",
        sourceUrl: "https://cdn.example/upscaled.png",
      })
    );
    expect(context.pendingEvents).toEqual([
      {
        type: "artifact_created",
        artifact: expect.objectContaining({
          id: "seedream-upscale-1",
          type: "image",
        }),
        toolName: "upscale_image",
      },
    ]);
  });

  it("fails upscale when no selected or single upstream image exists", async () => {
    isSeedreamConfigured.mockReturnValue(true);
    const context = buildContext();

    await expect(invokeUpscaleTool(context, {})).rejects.toThrow(
      /请选择一张图片/
    );
    expect(upscaleSeedreamImage).not.toHaveBeenCalled();
  });
});

async function invokeUpscaleTool(context: CucumberAgentContext, input: unknown) {
  const runContext = new RunContext(context);
  const raw = await upscaleImageTool.invoke(runContext, JSON.stringify(input));
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}
