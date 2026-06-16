import { describe, expect, it } from "vitest";

import type { SeedreamConfig } from "../../../../seedream.ts";
import { buildCozeImageRequestBody, type CozeImageConfig } from "../../../../coze.ts";
import {
  SEEDREAM_PROMPT_MAX_LENGTH,
  buildSeedreamRequestBodies,
  buildGenerateImageSeedreamInput,
  inferImageResultCount,
  inferImageResultCountFromPrompts,
} from "./generate-image.request.ts";

const testSeedreamConfig: SeedreamConfig = {
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
const testCozeConfig: CozeImageConfig = {
  url: "https://coze.example/run",
  token: "test-token",
  maxInputImages: 8,
  maxOutputImages: 4,
  referenceImagesKey: "urls",
  size: {},
  watermark: {},
  model: {},
};

describe("generate image request normalization", () => {
  it("defaults to one image when no explicit count is requested", () => {
    expect(inferImageResultCount("生成一张黄瓜工作台图片")).toBe(1);
    expect(inferImageResultCount("生成 1024x1024 的正方形图片")).toBe(1);
  });

  it("parses explicit Chinese and English image counts", () => {
    expect(inferImageResultCount("一次生成4张图片")).toBe(4);
    expect(inferImageResultCount("生成四张不同构图")).toBe(4);
    expect(inferImageResultCount("create 3 images of a cucumber canvas")).toBe(3);
  });

  it("falls back to expanded prompts for follow-up regeneration counts", () => {
    expect(
      inferImageResultCountFromPrompts([
        "重新生成",
        "一组四张3D渲染风格的小狗图像",
      ])
    ).toBe(4);
    expect(
      inferImageResultCountFromPrompts(["重新生成", "一组 4 张小狗图像"])
    ).toBe(4);
  });

  it("rejects counts above the configured output limit", () => {
    expect(() => inferImageResultCount("生成 8 张图片", 4)).toThrow(
      "一次最多生成 4 张图片。"
    );
  });

  it("splits multi-image single-prompt requests into independent tasks", () => {
    const requests = buildSeedreamRequestBodies(
      {
        prompts: ["A glossy cucumber campaign poster"],
        resultCount: 4,
        promptBatchMode: "single_prompt",
      },
      testSeedreamConfig
    );

    expect(requests).toHaveLength(4);
    expect(requests.map((request) => request.resultCount)).toEqual([1, 1, 1, 1]);
    expect(requests.map((request) => request.promptIndex)).toEqual([1, 2, 3, 4]);
    for (const request of requests) {
      expect(request.body).toMatchObject({
        width: 1024,
        height: 1024,
        force_single: testSeedreamConfig.forceSingle,
      });
      expect(request.body.prompt).toBe("A glossy cucumber campaign poster");
    }
  });

  it("removes batch count instructions from each single-image Seedream prompt", () => {
    const requests = buildSeedreamRequestBodies(
      {
        prompts: ["一次生成四张图片：小狗的图"],
        resultCount: 4,
        promptBatchMode: "single_prompt",
      },
      testSeedreamConfig
    );

    expect(requests).toHaveLength(4);
    expect(requests.map((request) => request.body.prompt)).toEqual([
      "小狗的图",
      "小狗的图",
      "小狗的图",
      "小狗的图",
    ]);
  });

  it("keeps geometry hints while removing multi-image count text", () => {
    const requests = buildSeedreamRequestBodies(
      {
        prompts: ["create 3 images of a 16:9 2K puppy poster"],
        resultCount: 3,
        promptBatchMode: "single_prompt",
      },
      testSeedreamConfig
    );

    expect(requests.map((request) => request.body.prompt)).toEqual([
      "a 16:9 2K puppy poster",
      "a 16:9 2K puppy poster",
      "a 16:9 2K puppy poster",
    ]);
    expect(
      (requests[0].body.width as number) / (requests[0].body.height as number)
    ).toBeCloseTo(16 / 9, 2);
  });

  it("splits distinct prompt batches into one Seedream request per prompt", () => {
    const requests = buildSeedreamRequestBodies(
      {
        prompts: [
          "A corgi puppy in a sunny kitchen",
          "A husky puppy in fresh snow",
          "A poodle puppy in a fashion studio",
          "A dachshund puppy in a garden",
        ],
        resultCount: 4,
        promptBatchMode: "distinct_prompts",
      },
      testSeedreamConfig
    );

    expect(requests).toHaveLength(4);
    expect(requests.map((request) => request.resultCount)).toEqual([1, 1, 1, 1]);
    expect(requests.map((request) => request.body.prompt)).toEqual([
      "A corgi puppy in a sunny kitchen",
      "A husky puppy in fresh snow",
      "A poodle puppy in a fashion studio",
      "A dachshund puppy in a garden",
    ]);
  });

  it("passes reference images and explicit aspect ratio geometry", () => {
    const request = buildSeedreamRequestBodies(
      {
        prompts: ["生成4张 16:9 横版 2K 海报"],
        resultCount: 4,
        promptBatchMode: "single_prompt",
        upstreamContext: [
          {
            nodeId: "image-1",
            type: "image",
            imageUrl: "https://cdn.example/ref-1.png",
          },
          {
            nodeId: "prompt-1",
            type: "prompt",
            prompt: "original prompt",
          },
          {
            nodeId: "image-2",
            type: "image",
            imageUrl: "https://cdn.example/ref-2.png",
          },
          {
            nodeId: "image-duplicate",
            type: "image",
            imageUrl: "https://cdn.example/ref-1.png",
          },
        ],
      },
      { ...testSeedreamConfig, scale: 60 }
    )[0];

    expect(request.body.image_urls).toEqual([
      "https://cdn.example/ref-1.png",
      "https://cdn.example/ref-2.png",
    ]);
    expect(request.body.force_single).toBe(testSeedreamConfig.forceSingle);
    expect(request.body.scale).toBe(60);
    expect(request.body.width).not.toBe(testSeedreamConfig.width);
    expect(request.body.height).not.toBe(testSeedreamConfig.height);
    expect(
      (request.body.width as number) / (request.body.height as number)
    ).toBeCloseTo(16 / 9, 2);
    expect(request.body.size).toBeUndefined();
  });

  it("uses structured aspect ratio geometry when provided by normalized input", () => {
    const requests = buildSeedreamRequestBodies(
      {
        prompts: ["日本家居 banner KV，主体是女生打扫家里的插画"],
        geometry: { aspectRatio: "16:9" },
        resultCount: 4,
        promptBatchMode: "single_prompt",
      },
      testSeedreamConfig
    );

    expect(requests).toHaveLength(4);
    expect(requests.map((request) => request.body.prompt)).toEqual([
      "日本家居 banner KV，主体是女生打扫家里的插画",
      "日本家居 banner KV，主体是女生打扫家里的插画",
      "日本家居 banner KV，主体是女生打扫家里的插画",
      "日本家居 banner KV，主体是女生打扫家里的插画",
    ]);
    expect(
      (requests[0].body.width as number) / (requests[0].body.height as number)
    ).toBeCloseTo(16 / 9, 2);
  });

  it("keeps Seedream prompt bodies within the provider limit", () => {
    const prompt = `${"手绘家居清洁海报，".repeat(120)}16:9`;
    const request = buildGenerateImageSeedreamInput(
      { prompt },
      testSeedreamConfig
    ).requests[0];

    expect((request.body.prompt as string).length).toBeLessThanOrEqual(
      SEEDREAM_PROMPT_MAX_LENGTH
    );
    expect(request.body.prompt).toContain("手绘家居清洁海报");
    expect(
      (request.body.width as number) / (request.body.height as number)
    ).toBeCloseTo(16 / 9, 2);
  });

  it("uses explicit pixel dimensions or size-only requests when present", () => {
    expect(
      buildSeedreamRequestBodies(
        {
          prompts: ["生成一张 2048x2048 方形图片"],
          resultCount: 1,
          promptBatchMode: "single_prompt",
        },
        testSeedreamConfig
      )[0].body
    ).toMatchObject({ width: 2048, height: 2048 });

    expect(
      buildSeedreamRequestBodies(
        {
          prompts: ["生成一张 4K 超清产品图"],
          resultCount: 1,
          promptBatchMode: "single_prompt",
        },
        testSeedreamConfig
      )[0].body
    ).toMatchObject({ size: 4096 * 4096 });
  });

  it("builds Coze request bodies with prompt, reference images, and size objects", () => {
    expect(
      buildCozeImageRequestBody({
        config: {
          ...testCozeConfig,
          watermark: { enabled: false },
          model: { value: "seedream" },
        },
        prompt: "黄瓜海报",
        imageUrls: ["https://cdn.example/ref.png"],
        width: 1024,
        height: 1536,
      })
    ).toEqual({
      prompt: "黄瓜海报",
      reference_images: { urls: ["https://cdn.example/ref.png"] },
      size: { value: "1024x1536" },
      watermark: { enabled: false },
      model: { value: "seedream" },
    });
  });
});
