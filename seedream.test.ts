import { setTimeout as wait } from "node:timers/promises";

import { describe, expect, it } from "vitest";

import {
  buildSeedreamUpscaleTaskBody,
  generateSeedreamImage,
  mapWithStaggeredStarts,
  SeedreamConcurrencyLimitError,
  type SeedreamConfig,
  type SeedreamGenerateInput,
} from "./seedream";

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

describe("seedream provider", () => {
  it("builds Seedream upscale requests with 4K defaults", () => {
    expect(
      buildSeedreamUpscaleTaskBody({ imageUrl: " https://cdn.example/input.png " })
    ).toEqual({
      image_urls: ["https://cdn.example/input.png"],
      resolution: "4k",
      scale: 50,
    });
  });

  it("builds Seedream upscale requests with 8K and custom scale", () => {
    expect(
      buildSeedreamUpscaleTaskBody({
        imageUrl: "https://cdn.example/input.png",
        resolution: "8k",
        scale: 87,
      })
    ).toEqual({
      image_urls: ["https://cdn.example/input.png"],
      resolution: "8k",
      scale: 87,
    });
  });

  it("clamps Seedream upscale scale to the supported range", () => {
    expect(
      buildSeedreamUpscaleTaskBody({
        imageUrl: "https://cdn.example/input.png",
        scale: 140,
      }).scale
    ).toBe(100);
    expect(
      buildSeedreamUpscaleTaskBody({
        imageUrl: "https://cdn.example/input.png",
        scale: -5,
      }).scale
    ).toBe(0);
  });

  it("starts image requests by stagger without waiting for prior polling", async () => {
    const started: number[] = [];
    const release: Array<() => void> = [];

    const result = mapWithStaggeredStarts(
      [1, 2, 3],
      1,
      20,
      async (item) => {
        started.push(item);
        await new Promise<void>((resolve) => release.push(resolve));
        return item * 10;
      }
    );

    await wait(5);
    expect(started).toEqual([1]);

    await wait(25);
    expect(started).toEqual([1, 2]);

    await wait(25);
    expect(started).toEqual([1, 2, 3]);

    release.forEach((resolve) => resolve());
    await expect(result).resolves.toEqual([10, 20, 30]);
  });

  it("does not start pending staggered requests after a prior request fails", async () => {
    const started: number[] = [];
    const result = mapWithStaggeredStarts([1, 2], 1, 20, async (item) => {
      started.push(item);
      if (item === 1) {
        throw new Error("submit failed");
      }
      return item;
    });

    await expect(result).rejects.toThrow("submit failed");
    await wait(30);
    expect(started).toEqual([1]);
  });

  it("aborts before making a Seedream request", async () => {
    const controller = new AbortController();
    controller.abort();

    const input: SeedreamGenerateInput = {
      requests: [
        {
          body: {
            prompt: "A gray square",
            force_single: true,
            width: 1024,
            height: 1024,
          },
          imageUrls: [],
          resultCount: 1,
          promptIndex: 1,
        },
      ],
      totalRequestedImageCount: 1,
      promptBatchMode: "single_prompt",
      signal: controller.signal,
    };

    await expect(generateSeedreamImage(input, testSeedreamConfig)).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("exposes a concise error for Seedream API concurrency limits", () => {
    const error = new SeedreamConcurrencyLimitError({
      requestId: "20260614141334D697D5C048658435DED5",
      retries: 4,
    });

    expect(error.message).toBe(
      "Seedream 当前达到 API 并发上限，已重试 4 次仍未获得可用额度。请稍后重试。"
    );
    expect(error.code).toBe("seedream_concurrency_limit");
    expect(error.requestId).toBe("20260614141334D697D5C048658435DED5");
  });
});
