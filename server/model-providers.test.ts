import { afterEach, describe, expect, it } from "vitest";

import {
  buildArkResponsesRequest,
  extractArkResponseText,
  getDefaultModelProviderId,
  getModelProviderSummaries,
  readArkMaxReferenceImagesFromEnv,
} from "./model-providers";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
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
});
