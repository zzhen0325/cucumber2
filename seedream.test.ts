import { describe, expect, it } from "vitest";

import { inferSeedreamResultCount } from "./seedream";

describe("seedream result count", () => {
  it("defaults to one image when no explicit count is requested", () => {
    expect(inferSeedreamResultCount("生成一张黄瓜工作台图片")).toBe(1);
    expect(inferSeedreamResultCount("生成 1024x1024 的正方形图片")).toBe(1);
  });

  it("parses explicit Chinese and English image counts", () => {
    expect(inferSeedreamResultCount("一次生成4张图片")).toBe(4);
    expect(inferSeedreamResultCount("生成四张不同构图")).toBe(4);
    expect(inferSeedreamResultCount("create 3 images of a cucumber canvas")).toBe(3);
  });

  it("rejects counts above the configured output limit", () => {
    expect(() => inferSeedreamResultCount("生成 8 张图片", 4)).toThrow(
      "一次最多生成 4 张图片。"
    );
  });
});
