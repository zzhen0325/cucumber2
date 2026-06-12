import { describe, expect, it } from "vitest";

import {
  generateSeedreamImage,
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
});
