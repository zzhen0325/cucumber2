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

  it("accepts P3 document specialist intents", () => {
    const normalized = finalizeNormalizedAgentInput(
      {
        rawPrompt: "写一份项目复盘 Markdown",
        intent: "document.create",
      },
      "写一份项目复盘 Markdown"
    );

    expect(normalized).toEqual({
      rawPrompt: "写一份项目复盘 Markdown",
      intent: "document.create",
    });
  });

  it("keeps visual brief analysis as a text answer even when model proposes image generation", () => {
    const raw =
      "帮我分析这个需求主题是「最佳HOME产品」，整体需要体现出一种“高端感”“荣誉感”和“颁奖典礼感”，字体可以用金色显现出高级感。背景建议以红毯、聚光灯、大量摄影记者、奖杯等元素为主，同时希望能在画面中点缀一些HOME产品。";

    const normalized = finalizeNormalizedAgentInput(
      {
        rawPrompt: raw,
        intent: "image.generate",
        image: {
          contentPrompt: raw,
          resultCount: 4,
          aspectRatio: "16:9",
        },
      },
      raw,
      { maxOutputImages: 4 }
    );

    expect(normalized).toEqual({
      rawPrompt:
        "帮我分析这个需求主题是「最佳 HOME 产品」，整体需要体现出一种“高端感”“荣誉感”和“颁奖典礼感”，字体可以用金色显现出高级感。背景建议以红毯、聚光灯、大量摄影记者、奖杯等元素为主，同时希望能在画面中点缀一些 HOME 产品。",
      intent: "text.answer",
    });
  });

  it("keeps explicit visual brief generation as image generation", () => {
    const raw = "帮我分析这个HOME产品KV需求，然后生成一张16:9图片";

    const normalized = finalizeNormalizedAgentInput(
      {
        rawPrompt: raw,
        intent: "image.generate",
        image: {
          contentPrompt: "最佳HOME产品颁奖典礼KV",
          aspectRatio: "16:9",
        },
      },
      raw
    );

    expect(normalized).toMatchObject({
      rawPrompt: "帮我分析这个 HOME 产品 KV 需求，然后生成一张16:9 图片",
      intent: "image.generate",
      image: {
        contentPrompt: "最佳 HOME 产品颁奖典礼 KV",
        resultCount: 1,
        aspectRatio: "16:9",
      },
    });
  });
});
