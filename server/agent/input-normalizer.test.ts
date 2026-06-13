import { describe, expect, it } from "vitest";

import {
  finalizeNormalizedAgentInput,
  normalizeImageRequestSlots,
} from "./input-normalizer.ts";

describe("input normalizer", () => {
  it("extracts image content, count, and aspect ratio from a compact Chinese brief", () => {
    const raw = "日本家居banner KV 16:9主体是女生打扫家里的插画,四张";

    const normalized = finalizeNormalizedAgentInput(
      {
        rawPrompt: raw,
        intent: "image.generate",
        image: {
          contentPrompt: raw,
        },
      },
      raw,
      { maxOutputImages: 4 }
    );

    expect(normalized).toMatchObject({
      rawPrompt: "日本家居 banner KV 16:9 主体是女生打扫家里的插画,四张",
      intent: "image.generate",
      image: {
        contentPrompt: "日本家居 banner KV，主体是女生打扫家里的插画",
        resultCount: 4,
        aspectRatio: "16:9",
        usage: "banner KV",
      },
    });
  });

  it("keeps explicit dimensions as structured geometry", () => {
    const normalized = normalizeImageRequestSlots(
      "生成两张 2048x1024 的产品海报",
      undefined,
      { maxOutputImages: 4 }
    );

    expect(normalized).toMatchObject({
      resultCount: 2,
      dimensions: { width: 2048, height: 1024 },
      aspectRatio: "2:1",
      contentPrompt: "产品海报",
    });
  });

  it("rejects requested image counts above the configured limit", () => {
    expect(() =>
      normalizeImageRequestSlots("生成五张小狗图片", undefined, {
        maxOutputImages: 4,
      })
    ).toThrow("一次最多生成 4 张图片。");
  });
});
