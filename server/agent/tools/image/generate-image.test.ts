import { RunContext } from "@openai/agents";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CucumberAgentContext } from "../../context.ts";
import type { UpstreamContextItem } from "../../../../src/types/canvas.ts";

const generateSeedreamImage = vi.fn();
const generateCozeImage = vi.fn();
const generateByteArtistImage = vi.fn();
const upscaleSeedreamImage = vi.fn();
const isSeedreamConfigured = vi.fn();
const isCozeImageConfigured = vi.fn();
const isByteArtistConfigured = vi.fn();
const rewritePromptWithReferenceImagesForTextOnlyModel = vi.fn();
const runImageMatting = vi.fn();
const createImageMattingArtifactId = vi.fn();
const resolveStorageBackedImageContext = vi.fn(async (items: UpstreamContextItem[]) =>
  items.map((item) =>
    item.artifact?.contentRef?.startsWith("r2://")
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
    contentRef: `r2://agent-assets/projects/${input.projectId}/runs/${input.runNodeId}/artifacts/${input.artifactId}.png`,
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
const storeGeneratedImageFromBytes = vi.fn(
  async (input: {
    artifactId: string;
    bytes: Uint8Array;
    metadata?: Record<string, unknown>;
    mimeType: string;
    projectId: string;
    runNodeId: string;
    title?: string;
  }) => ({
    contentRef: `r2://agent-assets/projects/${input.projectId}/runs/${input.runNodeId}/artifacts/${input.artifactId}.png`,
    id: input.artifactId,
    metadata: {
      ...input.metadata,
      mimeType: input.mimeType,
      storageBucket: "agent-assets",
      storagePath: `projects/${input.projectId}/runs/${input.runNodeId}/artifacts/${input.artifactId}.png`,
    },
    title: input.title,
    type: "image" as const,
    uri: `/api/projects/${input.projectId}/artifacts/${input.artifactId}/content`,
  })
);
const storeTextArtifactContent = vi.fn(
  async (input: {
    content: string;
    projectId: string;
    runNodeId: string;
    sourceToolName: string;
    title: string;
    type: "doc";
  }) => ({
    contentRef: `r2://agent-assets/projects/${input.projectId}/runs/${input.runNodeId}/artifacts/text-1.md`,
    id: `text-${input.sourceToolName}`,
    metadata: {
      sourceToolName: input.sourceToolName,
    },
    preview: input.content.slice(0, 120),
    previewKind: "markdown" as const,
    title: input.title,
    type: input.type,
    uri: `/api/projects/${input.projectId}/artifacts/text-${input.sourceToolName}/content`,
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
const testCozeConfig = {
  url: "https://coze.example/run",
  token: "test-token",
  maxInputImages: 8,
  maxOutputImages: 4,
  size: undefined,
  watermark: undefined,
  model: undefined,
};
const testByteArtistConfig = {
  aid: "6834",
  appKey: "app-key",
  appSecret: "app-secret",
  baseUrl: "https://byteartist.example",
  expiredDuration: 600,
  imageReturnFormat: "png",
  imageReturnType: "url",
  maxAttempts: 120,
  maxInputImages: 1,
  maxOutputImages: 4,
  modelId: "seed4_0407_lemo",
  pollIntervalMs: 1000,
  seed: -1,
  width: 1024,
  height: 1024,
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

vi.mock("../../../../coze.ts", async () => {
  const actual = await vi.importActual<typeof import("../../../../coze.ts")>(
    "../../../../coze.ts"
  );
  return {
    ...actual,
    generateCozeImage: (...args: unknown[]) => generateCozeImage(...args),
    isCozeImageConfigured: () => isCozeImageConfigured(),
    readCozeImageConfigFromEnv: () => testCozeConfig,
  };
});

vi.mock("../../../../byteartist.ts", async () => {
  const actual = await vi.importActual<typeof import("../../../../byteartist.ts")>(
    "../../../../byteartist.ts"
  );
  return {
    ...actual,
    generateByteArtistImage: (...args: unknown[]) =>
      generateByteArtistImage(...args),
    isByteArtistConfigured: () => isByteArtistConfigured(),
    readByteArtistConfigFromEnv: () => testByteArtistConfig,
  };
});

vi.mock("./reference-image-prompt.ts", async () => {
  const actual = await vi.importActual<typeof import("./reference-image-prompt.ts")>(
    "./reference-image-prompt.ts"
  );
  return {
    ...actual,
    rewritePromptWithReferenceImagesForTextOnlyModel: (...args: unknown[]) =>
      rewritePromptWithReferenceImagesForTextOnlyModel(...args),
  };
});

vi.mock("./image-matting-provider.ts", () => ({
  createImageMattingArtifactId: () => createImageMattingArtifactId(),
  runImageMatting: (...args: unknown[]) => runImageMatting(...args),
}));

vi.mock("../../../storage.ts", () => ({
  getArtifactStorageContentRef: (artifact: {
    contentRef?: string;
    metadata?: Record<string, unknown>;
  }) =>
    artifact.contentRef ??
    (typeof artifact.metadata?.storageBucket === "string" &&
    typeof artifact.metadata?.storagePath === "string"
      ? `r2://${artifact.metadata.storageBucket}/${artifact.metadata.storagePath}`
      : null),
  parseStorageContentRef: (contentRef: string) => {
    const match = contentRef.match(/^r2:\/\/([^/]+)\/(.+)$/);
    return match ? { bucket: match[1], path: match[2] } : null;
  },
  readArtifactContent: () => ({
    bytes: new Uint8Array([9, 8, 7]),
    mimeType: "image/png",
    sizeBytes: 3,
  }),
  resolveStorageBackedImageContext: (items: UpstreamContextItem[]) =>
    resolveStorageBackedImageContext(items),
  storeGeneratedImageFromBytes: (
    input: Parameters<typeof storeGeneratedImageFromBytes>[0]
  ) => storeGeneratedImageFromBytes(input),
  storeGeneratedImageFromUrl: (
    input: Parameters<typeof storeGeneratedImageFromUrl>[0]
  ) => storeGeneratedImageFromUrl(input),
  storeTextArtifactContent: (
    input: Parameters<typeof storeTextArtifactContent>[0]
  ) => storeTextArtifactContent(input),
}));

// Imported after the mock is registered.
const { generateImageTool } = await import("./generate-image.tool.ts");
const { imageMattingTool } = await import("./image-matting.tool.ts");
const { analyzeMediaTool, decomposeImageTool } = await import(
  "./image-inspection.tool.ts"
);
const { upscaleImageTool } = await import("./upscale-image.tool.ts");
const { SEEDREAM_PROMPT_MAX_LENGTH, toSeedreamUpstreamContext } = await import(
  "./generate-image.request.ts"
);

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
    activatedSkills: [],
    producedArtifacts: [],
    pendingEvents: [],
    prompt: "生成一张黄瓜海报",
    selectedNodeId: null,
    skillCandidates: [],
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
  const originalImageProvider = process.env.IMAGE_PROVIDER;

  beforeEach(() => {
    if (originalImageProvider === undefined) {
      delete process.env.IMAGE_PROVIDER;
    } else {
      process.env.IMAGE_PROVIDER = originalImageProvider;
    }
    generateSeedreamImage.mockReset();
    generateCozeImage.mockReset();
    generateByteArtistImage.mockReset();
    upscaleSeedreamImage.mockReset();
    isSeedreamConfigured.mockReset();
    isCozeImageConfigured.mockReset();
    isByteArtistConfigured.mockReset();
    rewritePromptWithReferenceImagesForTextOnlyModel.mockReset();
    rewritePromptWithReferenceImagesForTextOnlyModel.mockResolvedValue(null);
    runImageMatting.mockReset();
    createImageMattingArtifactId.mockReset();
    createImageMattingArtifactId.mockReturnValue("rembg-matting-1");
    resolveStorageBackedImageContext.mockClear();
    storeGeneratedImageFromBytes.mockClear();
    storeGeneratedImageFromUrl.mockClear();
    storeTextArtifactContent.mockClear();
  });

  it("defaults to Seedream 5 and emits artifact_created events without leaking urls", async () => {
    isByteArtistConfigured.mockReturnValue(true);
    generateByteArtistImage.mockImplementation(
      async (input: { onImage?: (image: unknown) => void }) => {
        const images = [
          {
            id: "byteartist-seed5-1",
            metadata: { provider: "byteartist", model: "seed5_duotu_zz" },
            title: "ByteArtist image",
            url: "https://cdn.example/seed5.png",
          },
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
    expect(result.prompt).toBe("黄瓜海报");
    expect(JSON.stringify(result)).not.toContain("cdn.example");

    expect(context.producedArtifacts).toHaveLength(1);
    expect(context.producedArtifacts[0]).toMatchObject({
      contentRef:
        "r2://agent-assets/projects/project-1/runs/run-1/artifacts/byteartist-seed5-1.png",
      id: "byteartist-seed5-1",
      type: "image",
      uri: "/api/projects/project-1/artifacts/byteartist-seed5-1/content",
    });
    expect(storeGeneratedImageFromUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        artifactId: "byteartist-seed5-1",
        metadata: expect.objectContaining({
          model: "seed5_duotu_zz",
          provider: "byteartist",
          prompt: "黄瓜海报",
          sourcePrompt: "生成一张黄瓜海报",
        }),
        projectId: "project-1",
        runNodeId: "run-1",
        sourceUrl: "https://cdn.example/seed5.png",
      })
    );
    expect(context.pendingEvents).toEqual([
      {
        type: "artifact_created",
        artifact: expect.objectContaining({
          id: "byteartist-seed5-1",
          metadata: expect.objectContaining({
            prompt: "黄瓜海报",
            sourcePrompt: "生成一张黄瓜海报",
          }),
          type: "image",
        }),
        toolName: "generate_image",
      },
    ]);

    expect(generateSeedreamImage).not.toHaveBeenCalled();
    const [callArg, config] = generateByteArtistImage.mock.calls[0];
    expect(callArg).toMatchObject({
      totalRequestedImageCount: 1,
      requests: [
        expect.objectContaining({
          prompt: "黄瓜海报",
          width: 2048,
          height: 2048,
          inputImageCount: 0,
          promptIndex: 1,
        }),
      ],
    });
    expect(config).toMatchObject({
      maxInputImages: 6,
      modelId: "seed5_duotu_zz",
    });
  });

  it("falls back to the run prompt when no prompt argument is provided", async () => {
    isByteArtistConfigured.mockReturnValue(true);
    generateByteArtistImage.mockResolvedValue({ images: [] });

    const context = buildContext({ prompt: "默认提示词" });
    await invokeTool(context, {});

    expect(generateByteArtistImage.mock.calls[0][0].requests[0].prompt).toBe(
      "默认提示词"
    );
  });

  it("stores the actual provider-limited prompt for long style prompts", async () => {
    isSeedreamConfigured.mockReturnValue(true);
    generateSeedreamImage.mockImplementation(
      async (input: { onImage?: (image: unknown) => void }) => {
        const image = {
          id: "seedream-1",
          url: "https://cdn.example/1.png",
          title: "Seedream image",
        };
        await input.onImage?.(image);
        return { images: [image] };
      }
    );

    const longPrompt = "手绘日本家居清洁海报，".repeat(120);
    const context = buildContext({ imageProvider: "seedream" });
    const result = await invokeTool(context, { prompt: longPrompt });
    const providerPrompt =
      generateSeedreamImage.mock.calls[0][0].requests[0].body.prompt;

    expect(providerPrompt.length).toBeLessThanOrEqual(SEEDREAM_PROMPT_MAX_LENGTH);
    expect(result.prompt).toBe(providerPrompt);
    expect(storeGeneratedImageFromUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          prompt: providerPrompt,
          sourcePrompt: "生成一张黄瓜海报",
        }),
      })
    );
  });

  it("does not send batch count instructions to each Seedream image request", async () => {
    isSeedreamConfigured.mockReturnValue(true);
    generateSeedreamImage.mockResolvedValue({ images: [] });

    const context = buildContext({ imageProvider: "seedream" });
    await invokeTool(context, { prompt: "生成四张小狗的图", resultCount: 4 });

    const callArg = generateSeedreamImage.mock.calls[0][0];
    expect(callArg.totalRequestedImageCount).toBe(4);
    expect(callArg.requests).toHaveLength(4);
    expect(
      callArg.requests.map(
        (request: { body: { prompt: string } }) => request.body.prompt
      )
    ).toEqual(["小狗的图", "小狗的图", "小狗的图", "小狗的图"]);
  });

  it("forwards normalized aspect ratio and count to Seedream requests", async () => {
    isSeedreamConfigured.mockReturnValue(true);
    generateSeedreamImage.mockResolvedValue({ images: [] });

    const context = buildContext({ imageProvider: "seedream" });
    await invokeTool(context, {
      prompt: "日本家居 banner KV，主体是女生打扫家里的插画",
      resultCount: 4,
      aspectRatio: "16:9",
    });

    const callArg = generateSeedreamImage.mock.calls[0][0];
    expect(callArg.totalRequestedImageCount).toBe(4);
    expect(callArg.requests).toHaveLength(4);
    expect(
      callArg.requests.map(
        (request: { body: { prompt: string } }) => request.body.prompt
      )
    ).toEqual([
      "日本家居 banner KV，主体是女生打扫家里的插画",
      "日本家居 banner KV，主体是女生打扫家里的插画",
      "日本家居 banner KV，主体是女生打扫家里的插画",
      "日本家居 banner KV，主体是女生打扫家里的插画",
    ]);
    expect(
      callArg.requests[0].body.width / callArg.requests[0].body.height
    ).toBeCloseTo(16 / 9, 2);
  });

  it("forwards output size variants to Seedream requests", async () => {
    isSeedreamConfigured.mockReturnValue(true);
    generateSeedreamImage.mockResolvedValue({ images: [] });

    const context = buildContext({ imageProvider: "seedream" });
    await invokeTool(context, {
      prompt: "基于参考图扩展画布",
      resultCount: 2,
      variants: [
        { width: 2048, height: 1024 },
        { width: 1536, height: 1536 },
      ],
    });

    const callArg = generateSeedreamImage.mock.calls[0][0];
    expect(callArg.totalRequestedImageCount).toBe(2);
    expect(callArg.requests.map((request: { body: Record<string, unknown> }) => request.body))
      .toEqual([
        expect.objectContaining({ width: 2048, height: 1024 }),
        expect.objectContaining({ width: 1536, height: 1536 }),
      ]);
  });

  it("throws when seedream is not configured (no silent fallback)", async () => {
    isSeedreamConfigured.mockReturnValue(false);
    const context = buildContext({ imageProvider: "seedream" });

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
      imageProvider: "seedream",
      upstreamContext: [
        {
          artifact: {
            contentRef: "r2://agent-assets/projects/project-1/uploads/ref.png",
            id: "ref",
            type: "image",
            uri: "/api/projects/project-1/artifacts/ref/content",
          },
          contentRef: "r2://agent-assets/projects/project-1/uploads/ref.png",
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

  it("can generate through Coze with server-resolved reference images", async () => {
    isCozeImageConfigured.mockReturnValue(true);
    generateCozeImage.mockImplementation(
      async (input: { onImage?: (image: unknown) => void }) => {
        const image = {
          id: "coze-1",
          metadata: { provider: "coze" },
          title: "Coze image",
          url: "https://cdn.example/coze.png",
        };
        await input.onImage?.(image);
        return { images: [image] };
      }
    );
    const context = buildContext({
      imageProvider: "coze",
      upstreamContext: [
        {
          artifact: {
            contentRef: "r2://agent-assets/projects/project-1/uploads/ref.png",
            id: "ref",
            type: "image",
            uri: "/api/projects/project-1/artifacts/ref/content",
          },
          contentRef: "r2://agent-assets/projects/project-1/uploads/ref.png",
          imageUrl: "/api/projects/project-1/artifacts/ref/content",
          nodeId: "image-1",
          type: "image",
        },
      ],
    });

    const result = await invokeTool(context, {
      prompt: "参考图生成",
      width: 1536,
      height: 1024,
    });

    expect(result.generated).toBe(1);
    expect(JSON.stringify(result)).not.toContain("cdn.example");
    expect(generateCozeImage).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "参考图生成",
        resultCount: 1,
        width: 1536,
        height: 1024,
        imageUrls: ["https://signed.example/ref.png"],
      }),
      testCozeConfig
    );
    expect(storeGeneratedImageFromUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        artifactId: "coze-1",
        metadata: expect.objectContaining({
          provider: "coze",
          prompt: "参考图生成",
        }),
        sourceUrl: "https://cdn.example/coze.png",
      })
    );
  });

  it("converts references to text before generating through seed4 ByteArtist", async () => {
    isByteArtistConfigured.mockReturnValue(true);
    rewritePromptWithReferenceImagesForTextOnlyModel.mockResolvedValue({
      descriptionModel: "vision-model",
      descriptionProvider: "ark",
      descriptions: "参考图是一张黄色角色海报。",
      prompt: "结合参考图描述生成 Lemo 黄色 IP 海报",
    });
    generateByteArtistImage.mockImplementation(
      async (input: { onImage?: (image: unknown) => void }) => {
        const image = {
          id: "byteartist-1",
          metadata: { provider: "byteartist", model: "seed4_0407_lemo" },
          title: "ByteArtist image",
          url: "https://cdn.example/byteartist.png",
        };
        await input.onImage?.(image);
        return { images: [image] };
      }
    );
    const context = buildContext({
      imageProvider: "byteartist",
      upstreamContext: [
        {
          artifact: {
            contentRef: "r2://agent-assets/projects/project-1/uploads/ref.png",
            id: "ref",
            type: "image",
            uri: "/api/projects/project-1/artifacts/ref/content",
          },
          contentRef: "r2://agent-assets/projects/project-1/uploads/ref.png",
          imageUrl: "/api/projects/project-1/artifacts/ref/content",
          nodeId: "image-1",
          type: "image",
        },
      ],
    });

    const result = await invokeTool(context, {
      prompt: "参考图生成",
      width: 1536,
      height: 1024,
    });

    expect(result.generated).toBe(1);
    expect(JSON.stringify(result)).not.toContain("cdn.example");
    expect(rewritePromptWithReferenceImagesForTextOnlyModel).toHaveBeenCalledWith(
      expect.objectContaining({
        images: [
          expect.objectContaining({
            imageUrl: "https://signed.example/ref.png",
            nodeId: "image-1",
          }),
        ],
        modelId: "seed4_0407_lemo",
        prompt: "参考图生成",
      })
    );
    expect(generateByteArtistImage).toHaveBeenCalledWith(
      expect.objectContaining({
        totalRequestedImageCount: 1,
        requests: [
          expect.objectContaining({
            prompt: "结合参考图描述生成 Lemo 黄色 IP 海报",
            width: 1536,
            height: 1024,
            inputImageCount: 0,
          }),
        ],
      }),
      testByteArtistConfig
    );
    expect(generateByteArtistImage.mock.calls[0][0].requests[0].image).toBeUndefined();
    expect(storeGeneratedImageFromUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        artifactId: "byteartist-1",
        metadata: expect.objectContaining({
          provider: "byteartist",
          prompt: "结合参考图描述生成 Lemo 黄色 IP 海报",
          referenceImageDescriptionModel: "vision-model",
          referenceImageDescriptions: "参考图是一张黄色角色海报。",
          referenceImagePromptRewrite: true,
        }),
        sourceUrl: "https://cdn.example/byteartist.png",
      })
    );
  });

  it("routes seed5_duotu_zz selection to ByteArtist with multiple references", async () => {
    isByteArtistConfigured.mockReturnValue(true);
    generateByteArtistImage.mockImplementation(
      async (input: { onImage?: (image: unknown) => void }) => {
        const image = {
          id: "byteartist-seed5-1",
          metadata: { provider: "byteartist", model: "seed5_duotu_zz" },
          title: "ByteArtist image",
          url: "https://cdn.example/seed5.png",
        };
        await input.onImage?.(image);
        return { images: [image] };
      }
    );
    const context = buildContext({
      imageProvider: "seed5_duotu_zz",
      upstreamContext: [
        {
          imageUrl: "https://signed.example/ref-1.png",
          nodeId: "image-1",
          type: "image",
        },
        {
          imageUrl: "https://signed.example/ref-2.png",
          nodeId: "image-2",
          type: "image",
        },
      ],
    });

    const result = await invokeTool(context, {
      prompt: "将图1、图2融合在一张图内",
    });

    expect(result.generated).toBe(1);
    expect(generateByteArtistImage).toHaveBeenCalledWith(
      expect.objectContaining({
        totalRequestedImageCount: 1,
        requests: [
          expect.objectContaining({
            prompt: "将图1、图2融合在一张图内",
            width: 2048,
            height: 2048,
            image: "https://signed.example/ref-1.png",
            images: [
              "https://signed.example/ref-1.png",
              "https://signed.example/ref-2.png",
            ],
            inputImageCount: 2,
          }),
        ],
      }),
      expect.objectContaining({
        maxInputImages: 6,
        modelId: "seed5_duotu_zz",
      })
    );
    expect(generateCozeImage).not.toHaveBeenCalled();
    expect(generateSeedreamImage).not.toHaveBeenCalled();
  });

  it("forces Lemo requests to seed4 ByteArtist even when Seedream 5 is selected", async () => {
    isByteArtistConfigured.mockReturnValue(true);
    generateByteArtistImage.mockResolvedValue({ images: [] });
    const context = buildContext({
      imageProvider: "seed5_duotu_zz",
      prompt: "生成一张 lemo 角色海报",
    });

    await invokeTool(context, { prompt: "生成 lemo 海报" });

    expect(generateCozeImage).not.toHaveBeenCalled();
    expect(generateByteArtistImage).toHaveBeenCalledWith(
      expect.objectContaining({
        requests: [
          expect.objectContaining({
            prompt: "生成 lemo 海报",
          }),
        ],
      }),
      expect.objectContaining({
        modelId: "seed4_0407_lemo",
      })
    );
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
            contentRef: "r2://agent-assets/projects/project-1/uploads/ref.png",
            id: "ref",
            type: "image",
            uri: "/api/projects/project-1/artifacts/ref/content",
          },
          contentRef: "r2://agent-assets/projects/project-1/uploads/ref.png",
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

  it("mats the selected image through the matting provider and emits an image artifact", async () => {
    runImageMatting.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      engine: "rembg",
      metadata: { model: "u2net", provider: "rembg-cli" },
      mimeType: "image/png",
      provider: "rembg-cli",
    });
    const context = buildContext({
      normalizedInput: {
        rawPrompt: "给这张图去背景",
        userGoal: "给这张图去背景",
        operation: "transform",
        artifact: { kind: "image", format: "png" },
        requiredCapabilities: ["image-matting"],
        negativeCapabilities: [],
      },
      selectedNodeId: "image-1",
      upstreamContext: [
        {
          artifact: {
            contentRef: "r2://agent-assets/projects/project-1/uploads/ref.png",
            id: "ref",
            type: "image",
            uri: "/api/projects/project-1/artifacts/ref/content",
          },
          contentRef: "r2://agent-assets/projects/project-1/uploads/ref.png",
          imageUrl: "/api/projects/project-1/artifacts/ref/content",
          nodeId: "image-1",
          summary: "一张商品图",
          type: "image",
        },
      ],
    });

    const result = await invokeMattingTool(context, { subject: "商品" });

    expect(result.matted).toBe(1);
    expect(runImageMatting).toHaveBeenCalledWith(
      expect.objectContaining({
        background: "transparent",
        sourceUrl: "https://signed.example/ref.png",
      })
    );
    expect(storeGeneratedImageFromBytes).toHaveBeenCalledWith(
      expect.objectContaining({
        artifactId: "rembg-matting-1",
        bytes: new Uint8Array([1, 2, 3]),
        metadata: expect.objectContaining({
          model: "u2net",
          operation: "matting",
          provider: "rembg-cli",
          sourceNodeId: "image-1",
        }),
        mimeType: "image/png",
        sourceNodeId: "image-1",
        sourceToolName: "image_matting",
      })
    );
    expect(context.pendingEvents).toEqual([
      {
        type: "artifact_created",
        artifact: expect.objectContaining({
          id: "rembg-matting-1",
          type: "image",
        }),
        toolName: "image_matting",
      },
    ]);
  });

  it("creates a markdown artifact for image decomposition", async () => {
    const context = buildContext({
      normalizedInput: {
        rawPrompt: "分析这张图的风格",
        userGoal: "分析这张图的风格",
        operation: "analyze",
        artifact: { kind: "markdown", format: "markdown" },
        requiredCapabilities: ["image-decompose", "markdown-artifact"],
        negativeCapabilities: ["image-generation"],
      },
      selectedNodeId: "image-1",
      upstreamContext: [
        {
          imageUrl: "https://cdn.example/ref.png",
          nodeId: "image-1",
          summary: "复古海报风格",
          type: "image",
        },
      ],
    });

    const result = await invokeDecomposeTool(context, {
      promptStructure: "Subject + layout + color + texture",
      styleSummary: "复古印刷海报风格",
    });

    expect(result.artifactId).toBe("text-decompose_image");
    expect(storeTextArtifactContent).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("复古印刷海报风格"),
        sourceToolName: "decompose_image",
        title: "图像风格拆解",
        type: "doc",
      })
    );
    expect(context.pendingEvents).toEqual([
      {
        type: "artifact_created",
        artifact: expect.objectContaining({
          id: "text-decompose_image",
          type: "doc",
        }),
        toolName: "decompose_image",
      },
    ]);
  });

  it("creates a markdown artifact for media analysis", async () => {
    const context = buildContext({
      normalizedInput: {
        rawPrompt: "这张图里有什么",
        userGoal: "这张图里有什么",
        operation: "analyze",
        artifact: { kind: "markdown", format: "markdown" },
        requiredCapabilities: ["media-analysis", "markdown-artifact"],
        negativeCapabilities: ["image-generation"],
      },
      selectedNodeId: "image-1",
      upstreamContext: [
        {
          imageUrl: "https://cdn.example/ref.png",
          nodeId: "image-1",
          summary: "一张家居场景图片",
          type: "image",
        },
      ],
    });

    const result = await invokeAnalyzeMediaTool(context, {
      answer: "这是一张家居场景图片。",
      observations: ["上游摘要提供了家居场景信息。"],
    });

    expect(result.artifactId).toBe("text-analyze_media");
    expect(storeTextArtifactContent).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("这是一张家居场景图片。"),
        sourceToolName: "analyze_media",
        title: "图片理解结果",
        type: "doc",
      })
    );
  });
});

async function invokeUpscaleTool(context: CucumberAgentContext, input: unknown) {
  const runContext = new RunContext(context);
  const raw = await upscaleImageTool.invoke(runContext, JSON.stringify(input));
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

async function invokeMattingTool(context: CucumberAgentContext, input: unknown) {
  const runContext = new RunContext(context);
  const raw = await imageMattingTool.invoke(runContext, JSON.stringify(input));
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

async function invokeDecomposeTool(context: CucumberAgentContext, input: unknown) {
  const runContext = new RunContext(context);
  const raw = await decomposeImageTool.invoke(runContext, JSON.stringify(input));
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

async function invokeAnalyzeMediaTool(
  context: CucumberAgentContext,
  input: unknown
) {
  const runContext = new RunContext(context);
  const raw = await analyzeMediaTool.invoke(runContext, JSON.stringify(input));
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}
