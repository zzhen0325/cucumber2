import { RunContext } from "@openai/agents";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CucumberAgentContext } from "../../context.ts";
import type { UpstreamContextItem } from "../../../../src/types/canvas.ts";

const generateSeedreamImage = vi.fn();
const isSeedreamConfigured = vi.fn();
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
  };
});

// Imported after the mock is registered.
const { generateImageTool } = await import("./generate-image.tool.ts");
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
    isSeedreamConfigured.mockReset();
  });

  it("generates images and emits artifact_created events without leaking urls", async () => {
    isSeedreamConfigured.mockReturnValue(true);
    generateSeedreamImage.mockImplementation(
      async (input: { onImage?: (image: unknown) => void }) => {
        const images = [
          { id: "seedream-1", url: "https://cdn.example/1.png", title: "Seedream image" },
        ];
        for (const image of images) {
          input.onImage?.(image);
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
      id: "seedream-1",
      type: "image",
      uri: "https://cdn.example/1.png",
    });
    expect(context.pendingEvents).toEqual([
      {
        type: "artifact_created",
        artifact: expect.objectContaining({ id: "seedream-1", type: "image" }),
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
});
