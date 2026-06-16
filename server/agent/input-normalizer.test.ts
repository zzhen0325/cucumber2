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
      operation: "create",
      artifact: { kind: "image", subtype: "banner", format: "png" },
      domain: "visual-design",
      requiredCapabilities: ["image-generation"],
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

    expect(normalized).toMatchObject({
      rawPrompt: "写一份项目复盘 Markdown",
      userGoal: "写一份项目复盘 Markdown",
      operation: "create",
      artifact: { kind: "markdown", format: "markdown" },
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

    expect(normalized).toMatchObject({
      rawPrompt:
        "帮我分析这个需求主题是「最佳 HOME 产品」，整体需要体现出一种“高端感”“荣誉感”和“颁奖典礼感”，字体可以用金色显现出高级感。背景建议以红毯、聚光灯、大量摄影记者、奖杯等元素为主，同时希望能在画面中点缀一些 HOME 产品。",
      operation: "analyze",
      artifact: null,
      domain: "visual-design",
      negativeCapabilities: ["image-generation"],
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
      operation: "create",
      artifact: { kind: "image", subtype: "banner", format: "png" },
      domain: "visual-design",
      intent: "image.generate",
      image: {
        contentPrompt: "最佳 HOME 产品颁奖典礼 KV",
        resultCount: 1,
        aspectRatio: "16:9",
      },
    });
  });

  it("keeps image style analysis out of image generation", () => {
    const raw = "分析这张图的风格";

    const normalized = finalizeNormalizedAgentInput(
      {
        rawPrompt: raw,
        intent: "image.generate",
        image: { contentPrompt: raw },
      },
      raw
    );

    expect(normalized).toMatchObject({
      operation: "analyze",
      artifact: null,
      domain: "visual-design",
      negativeCapabilities: ["image-generation"],
      intent: "text.answer",
    });
    expect(normalized.image).toBeUndefined();
  });

  it("routes sequence diagrams to mermaid document artifacts", () => {
    const raw = "帮我创建一个视觉 H5 需求的流程时序图";

    const normalized = finalizeNormalizedAgentInput(
      {
        rawPrompt: raw,
        operation: "create",
        artifact: { kind: "image", subtype: "poster", format: "png" },
        domain: "visual-design",
      },
      raw
    );

    expect(normalized).toMatchObject({
      rawPrompt: "帮我创建一个视觉 H5 需求的流程时序图",
      operation: "create",
      artifact: {
        kind: "diagram",
        subtype: "sequenceDiagram",
        format: "mermaid",
      },
      domain: "visual-design",
      requiredCapabilities: expect.arrayContaining([
        "sequence-diagram",
        "markdown-artifact",
      ]),
      negativeCapabilities: ["image-generation"],
      intent: "document.create",
    });
    expect(normalized.image).toBeUndefined();
  });

  it("routes visual H5 flowcharts to mermaid diagrams, not images", () => {
    const raw = "做一个 H5 视觉需求流程图";

    const normalized = finalizeNormalizedAgentInput(
      {
        rawPrompt: raw,
        operation: "create",
        artifact: { kind: "diagram", subtype: "flowchart", format: "mermaid" },
      },
      raw
    );

    expect(normalized).toMatchObject({
      operation: "create",
      artifact: { kind: "diagram", subtype: "flowchart", format: "mermaid" },
      domain: "visual-design",
      negativeCapabilities: ["image-generation"],
      intent: "document.create",
    });
  });

  it("keeps flowchart-style posters on the image route", () => {
    const raw = "生成一张流程图风格海报";

    const normalized = finalizeNormalizedAgentInput(
      {
        rawPrompt: raw,
        operation: "create",
        artifact: { kind: "image", subtype: "poster", format: "png" },
        image: { contentPrompt: raw },
      },
      raw
    );

    expect(normalized).toMatchObject({
      operation: "create",
      artifact: { kind: "image", subtype: "poster", format: "png" },
      intent: "image.generate",
    });
  });

  it("keeps webpage-to-document requests as composite document tasks", () => {
    const raw = "把这个页面总结成文档";

    const normalized = finalizeNormalizedAgentInput(
      {
        rawPrompt: raw,
        operation: "transform",
        artifact: { kind: "document", format: "markdown" },
      },
      raw
    );

    expect(normalized).toMatchObject({
      operation: "transform",
      artifact: { kind: "document", format: "markdown" },
      requiredCapabilities: expect.arrayContaining(["web-fetch"]),
      intent: "document.create",
    });
  });
});
