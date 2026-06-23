import { describe, expect, it } from "vitest";

import {
  finalizeNormalizedAgentInput,
  normalizeImageRequestSlots,
  selectAgentRoute,
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

  it("does not create an image artifact when the prompt explicitly says not to generate images", () => {
    const raw = "请用一句话解释什么是无限画布，不要生成图片。";

    const normalized = finalizeNormalizedAgentInput(
      {
        rawPrompt: raw,
        artifact: { kind: "image", format: "png" },
        image: {
          contentPrompt: raw,
          resultCount: 1,
        },
      },
      raw
    );

    expect(normalized).toMatchObject({
      rawPrompt: "请用一句话解释什么是无限画布，不要生成图片。",
      artifact: null,
      negativeCapabilities: ["image-generation"],
      operation: "answer",
      intent: "text.answer",
    });
    expect(normalized).not.toHaveProperty("image");
    expect(selectAgentRoute(normalized)).toBe("manager");
  });

  it("routes image dimension expansion as outpaint generation instead of upscale", () => {
    const raw =
      "帮我把这个图拓展4个尺寸：1125-450 / 1125-600 / 900-1200 / 800-800";

    const normalized = finalizeNormalizedAgentInput(
      {
        rawPrompt: raw,
        operation: "transform",
        artifact: { kind: "image", format: "png" },
        requiredCapabilities: ["image-upscale"],
        intent: "image.upscale",
        image: {
          contentPrompt: "把这个图",
          resultCount: 1,
        },
      },
      raw,
      { maxOutputImages: 4 }
    );

    expect(normalized).toMatchObject({
      rawPrompt:
        "帮我把这个图拓展4 个尺寸：1125-450 / 1125-600 / 900-1200 / 800-800",
      operation: "create",
      artifact: { kind: "image", format: "png" },
      domain: "visual-design",
      requiredCapabilities: ["image-generation", "image-outpaint"],
      intent: "image.generate",
      image: {
        resultCount: 4,
        contentPrompt:
          "基于参考图扩展画布，保持原图主体、文字、风格、光影和构图一致，补全新增区域。",
        variants: [
          { width: 1125, height: 450, label: "1125x450" },
          { width: 1125, height: 600, label: "1125x600" },
          { width: 900, height: 1200, label: "900x1200" },
          { width: 800, height: 800, label: "800x800" },
        ],
      },
    });
    expect(selectAgentRoute(normalized)).toBe("image");
  });

  it("uses a clean reference-image prompt for spaced dimension expansion", () => {
    const normalized = normalizeImageRequestSlots(
      "帮我把这个图拓展4个尺寸： 1125-450 / 1125-672  /  1080-1440  /1029-540",
      undefined,
      { maxOutputImages: 4 }
    );

    expect(normalized).toMatchObject({
      resultCount: 4,
      contentPrompt:
        "基于参考图扩展画布，保持原图主体、文字、风格、光影和构图一致，补全新增区域。",
      variants: [
        { width: 1125, height: 450, label: "1125x450" },
        { width: 1125, height: 672, label: "1125x672" },
        { width: 1080, height: 1440, label: "1080x1440" },
        { width: 1029, height: 540, label: "1029x540" },
      ],
    });
  });

  it("classifies character IP figure requests as image generation", () => {
    const raw = "根据这个帮我出这个角色的毛绒IP形象";

    const normalized = finalizeNormalizedAgentInput(
      {
        rawPrompt: raw,
        userGoal: raw,
        operation: "answer",
        artifact: null,
        requiredCapabilities: [],
        negativeCapabilities: [],
      },
      raw,
      { maxOutputImages: 4 }
    );

    expect(normalized).toMatchObject({
      operation: "create",
      artifact: { kind: "image", format: "png" },
      requiredCapabilities: ["image-generation"],
      intent: "image.generate",
      image: {
        resultCount: 1,
        contentPrompt: "根据这个帮我出这个角色的毛绒 IP 形象",
      },
    });
    expect(selectAgentRoute(normalized)).toBe("image");
  });

  it("keeps pure image clarity enhancement as upscale", () => {
    const raw = "把这张图高清放大到 4K";

    const normalized = finalizeNormalizedAgentInput(
      {
        rawPrompt: raw,
        operation: "create",
        artifact: { kind: "image", format: "png" },
        requiredCapabilities: ["image-generation"],
        intent: "image.generate",
        image: { contentPrompt: raw },
      },
      raw
    );

    expect(normalized).toMatchObject({
      operation: "transform",
      artifact: { kind: "image", format: "png" },
      requiredCapabilities: ["image-upscale"],
      intent: "image.upscale",
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

  it("routes HTML animation requests to webpage artifacts instead of image generation", () => {
    const raw = "用huashu skill 帮我做个30秒的HTML动画，讲agent怎么工作";

    const normalized = finalizeNormalizedAgentInput(
      {
        rawPrompt: raw,
        operation: "create",
        artifact: { kind: "image", subtype: "poster", format: "png" },
        requiredCapabilities: ["image-generation"],
        intent: "image.generate",
        image: { contentPrompt: raw },
      },
      raw
    );

    expect(normalized).toMatchObject({
      rawPrompt: "用 huashu skill 帮我做个30 秒的 HTML 动画，讲 agent 怎么工作",
      operation: "create",
      artifact: { kind: "webpage", subtype: "animation", format: "html" },
      domain: "visual-design",
      requiredCapabilities: expect.arrayContaining(["html-artifact", "animation"]),
      negativeCapabilities: ["image-generation"],
      intent: "webpage.create",
    });
    expect(normalized.image).toBeUndefined();
    expect(selectAgentRoute(normalized)).toBe("document");
  });

  it("routes actual image style analysis to Image Agent markdown decomposition", () => {
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
      artifact: { kind: "markdown", format: "markdown" },
      domain: "visual-design",
      requiredCapabilities: ["image-decompose", "markdown-artifact"],
      negativeCapabilities: ["image-generation"],
      intent: "image.decompose",
    });
    expect(normalized.image).toBeUndefined();
    expect(selectAgentRoute(normalized)).toBe("image");
  });

  it("routes media understanding to Image Agent markdown analysis", () => {
    const raw = "这张图里有什么，帮我提取关键信息";

    const normalized = finalizeNormalizedAgentInput(
      {
        rawPrompt: raw,
        operation: "answer",
        artifact: null,
      },
      raw
    );

    expect(normalized).toMatchObject({
      operation: "analyze",
      artifact: { kind: "markdown", format: "markdown" },
      requiredCapabilities: ["media-analysis", "markdown-artifact"],
      negativeCapabilities: ["image-generation"],
      intent: "media.analyze",
    });
    expect(selectAgentRoute(normalized)).toBe("image");
  });

  it("routes image matting to image transform", () => {
    const raw = "给这张图去背景，输出透明底素材";

    const normalized = finalizeNormalizedAgentInput(
      {
        rawPrompt: raw,
        operation: "answer",
        artifact: null,
      },
      raw
    );

    expect(normalized).toMatchObject({
      operation: "transform",
      artifact: { kind: "image", format: "png" },
      requiredCapabilities: ["image-matting"],
      intent: "image.matting",
    });
    expect(selectAgentRoute(normalized)).toBe("image");
  });

  it("keeps short QA on the manager route", () => {
    const raw = "解释一下 React Flow 是什么";

    const normalized = finalizeNormalizedAgentInput(
      {
        rawPrompt: raw,
        operation: "answer",
        artifact: null,
      },
      raw
    );

    expect(normalized).toMatchObject({
      operation: "answer",
      artifact: null,
      intent: "text.answer",
    });
    expect(selectAgentRoute(normalized)).toBe("manager");
  });

  it("routes explicit long-form explanations to the document specialist", () => {
    const raw = "详细解释一下 Agent Runtime 的工作方式";

    const normalized = finalizeNormalizedAgentInput(
      {
        rawPrompt: raw,
        operation: "answer",
        artifact: null,
      },
      raw
    );

    expect(normalized).toMatchObject({
      operation: "create",
      artifact: { kind: "document", format: "markdown" },
      requiredCapabilities: ["markdown-artifact"],
      negativeCapabilities: ["image-generation"],
      intent: "document.create",
    });
    expect(selectAgentRoute(normalized)).toBe("document");
  });

  it("routes planning requests that should become long text to the document specialist", () => {
    const raw = "给我一个三阶段产品规划";

    const normalized = finalizeNormalizedAgentInput(
      {
        rawPrompt: raw,
        operation: "answer",
        artifact: null,
      },
      raw
    );

    expect(normalized).toMatchObject({
      operation: "create",
      artifact: { kind: "document", subtype: "brief", format: "markdown" },
      domain: "product",
      requiredCapabilities: ["markdown-artifact"],
      intent: "document.create",
    });
    expect(selectAgentRoute(normalized)).toBe("document");
  });

  it("routes long-form research analysis to a document artifact when no source citations are requested", () => {
    const raw = "做一份 AI 画布产品机会点的调研分析";

    const normalized = finalizeNormalizedAgentInput(
      {
        rawPrompt: raw,
        operation: "answer",
        artifact: null,
      },
      raw
    );

    expect(normalized).toMatchObject({
      operation: "create",
      artifact: { kind: "document", format: "markdown" },
      requiredCapabilities: ["markdown-artifact"],
      intent: "document.create",
    });
    expect(selectAgentRoute(normalized)).toBe("document");
  });

  it("keeps prompt text edits out of image generation even when the model proposes image generation", () => {
    const raw = "取消标题";

    const normalized = finalizeNormalizedAgentInput(
      {
        rawPrompt: raw,
        operation: "create",
        artifact: { kind: "image", subtype: "poster", format: "png" },
        requiredCapabilities: ["image-generation", "tool.image.generate"],
        intent: "image.generate",
        image: {
          contentPrompt:
            "这是一个3D渲染风格的红毯家居生活用品展示场景，画面前景有大型3D标题文字。",
          resultCount: 4,
        },
      },
      raw,
      { maxOutputImages: 4 }
    );

    expect(normalized).toMatchObject({
      rawPrompt: "取消标题",
      operation: "edit",
      artifact: null,
      negativeCapabilities: ["image-generation"],
      requiredCapabilities: [],
      intent: "text.answer",
    });
    expect(normalized.image).toBeUndefined();
    expect(selectAgentRoute(normalized)).toBe("manager");
  });

  it("keeps explicit generation requests on the image route after prompt edits", () => {
    const raw = "把这个提示词改成不要标题，然后生成一张图";

    const normalized = finalizeNormalizedAgentInput(
      {
        rawPrompt: raw,
        operation: "create",
        artifact: { kind: "image", format: "png" },
        image: { contentPrompt: "无标题红毯家居展示场景" },
      },
      raw
    );

    expect(normalized).toMatchObject({
      operation: "create",
      artifact: { kind: "image", format: "png" },
      intent: "image.generate",
    });
    expect(selectAgentRoute(normalized)).toBe("image");
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
