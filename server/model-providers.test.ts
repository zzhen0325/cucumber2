import { z } from "zod";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildArkResponsesRequest,
  disableDeepSeekThinkingMode,
  extractArkResponseText,
  generateStructuredObjectWithProvider,
  generateTextWithProvider,
  getDefaultModelProviderId,
  getModelProviderSummaries,
  readArkMaxReferenceImagesFromEnv,
  withJsonModeInstruction,
} from "./model-providers";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

describe("model providers", () => {
  it("builds Ark Responses requests with image and text parts", () => {
    expect(
      buildArkResponsesRequest({
        imageUrls: ["https://cdn.example/1.png"],
        inputText: "你看见了什么？",
        maxOutputTokens: 300,
        model: "doubao-seed-2-0-lite-260428",
      })
    ).toEqual({
      model: "doubao-seed-2-0-lite-260428",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_image",
              image_url: "https://cdn.example/1.png",
            },
            {
              type: "input_text",
              text: "你看见了什么？",
            },
          ],
        },
      ],
      max_output_tokens: 300,
    });
  });

  it("extracts Ark output_text first and nested content as fallback", () => {
    expect(extractArkResponseText({ output_text: "直接文本" })).toBe("直接文本");
    expect(
      extractArkResponseText({
        output: [
          {
            content: [
              {
                type: "output_text",
                text: "嵌套文本",
              },
            ],
          },
        ],
      })
    ).toBe("嵌套文本");
    expect(
      extractArkResponseText({
        choices: [
          {
            message: {
              content: [{ type: "text", text: "兼容文本" }],
            },
          },
        ],
      })
    ).toBe("兼容文本");
    expect(
      extractArkResponseText({
        choices: [
          {
            delta: {
              content: "增量文本",
            },
          },
        ],
      })
    ).toBe("增量文本");
  });

  it("includes Ark response diagnostics when a successful response has no text", async () => {
    process.env.ARK_API_KEY = "ark-secret";
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "completed",
        output: [{ type: "message", content: [] }],
      }),
    } as Response);

    await expect(
      generateTextWithProvider("ark", {
        system: "Expand prompts.",
        prompt: "生成四张小狗插画",
      })
    ).rejects.toThrow(
      "Ark Responses API returned an empty response. status=completed; output_items=1; output_types=message."
    );
  });

  it("reports configured providers without exposing secrets", () => {
    process.env.DEEPSEEK_API_KEY = "deepseek-secret";
    process.env.ARK_API_KEY = "ark-secret";
    process.env.AGENT_MODEL_PROVIDER = "ark";

    expect(getDefaultModelProviderId()).toBe("ark");
    expect(getModelProviderSummaries()).toMatchObject([
      { id: "deepseek", configured: true },
      { id: "ark", configured: true },
    ]);
    expect(JSON.stringify(getModelProviderSummaries())).not.toContain("secret");
  });

  it("reads Ark reference image limits with a safe default", () => {
    delete process.env.ARK_MAX_REFERENCE_IMAGES;
    expect(readArkMaxReferenceImagesFromEnv()).toBe(4);

    process.env.ARK_MAX_REFERENCE_IMAGES = "2";
    expect(readArkMaxReferenceImagesFromEnv()).toBe(2);
  });

  it("generates structured objects through the Ark JSON parse path", async () => {
    process.env.ARK_API_KEY = "ark-secret";
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        output_text: '```json\n{"kind":"image_generation","confidence":0.91}\n```',
      }),
    } as Response);

    const output = await generateStructuredObjectWithProvider("ark", {
      system: "Return JSON.",
      prompt: "Route this request.",
      schema: z.object({
        kind: z.literal("image_generation"),
        confidence: z.number(),
      }),
    });

    expect(output).toEqual({
      kind: "image_generation",
      confidence: 0.91,
    });
  });

  it("adds explicit JSON wording for DeepSeek structured output prompts", () => {
    const input = withJsonModeInstruction({
      system: "Return only structured intent data.",
      prompt: "Route this request.",
      schema: z.object({ kind: z.string() }),
    });

    expect(input.system).toMatch(/\bJSON\b/i);
    expect(input.prompt).toMatch(/\bJSON\b/i);
  });

  it("disables DeepSeek thinking mode in OpenAI-compatible request bodies", () => {
    expect(
      disableDeepSeekThinkingMode({
        model: "deepseek-v4-flash",
        messages: [],
        tools: [{ type: "function" }],
      })
    ).toMatchObject({
      model: "deepseek-v4-flash",
      thinking: { type: "disabled" },
      tools: [{ type: "function" }],
    });
  });
});
