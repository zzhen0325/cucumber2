import { describe, expect, it } from "vitest";

import type { PromptCanvasContext } from "../prompts";
import { toolIds } from "./tools/ids";
import {
  resolveRoutedAiSdkToolNames,
  routeToolsDeterministically,
} from "./tool-router";

describe("deterministic tool router", () => {
  it("routes image generation to prompt expansion and image generation", () => {
    const route = routeToolsDeterministically(
      canvasContext("生成一张黄瓜主题海报")
    );

    expect(route.toolIds).toEqual([
      toolIds.expandPrompt,
      toolIds.generateImage,
    ]);
  });

  it("includes reference image analysis for image follow-up context", () => {
    const route = routeToolsDeterministically({
      ...canvasContext("参考这张图继续改成绿色海报"),
      selectedNodeId: "image-1",
      upstreamContext: [
        {
          nodeId: "image-1",
          type: "image",
          imageUrl: "https://cdn.example/image.png",
          artifact: {
            id: "artifact-1",
            type: "image",
            uri: "https://cdn.example/image.png",
          },
        },
      ],
    });

    expect(route.toolIds).toEqual([
      toolIds.analyzeReferenceImages,
      toolIds.expandPrompt,
      toolIds.generateImage,
    ]);
  });

  it("routes latest/source requests to web search and document writing", () => {
    const route = routeToolsDeterministically(
      canvasContext("查最新资料来源并总结成一份报告")
    );

    expect(route.toolIds).toEqual([
      toolIds.searchWeb,
      toolIds.writeDocument,
    ]);
  });

  it("routes page and html requests to html generation", () => {
    const route = routeToolsDeterministically(
      canvasContext("生成一个产品 landing page html")
    );

    expect(route.toolIds).toEqual([toolIds.generateHtml]);
  });

  it("keeps compound research page routes in a small deterministic allowlist", () => {
    const route = routeToolsDeterministically(
      canvasContext("查最新资料来源，生成一个 landing page")
    );

    expect(route.toolIds).toEqual([
      toolIds.searchWeb,
      toolIds.writeDocument,
      toolIds.generateHtml,
    ]);
  });

  it("routes ordinary analysis to document writing", () => {
    const route = routeToolsDeterministically(
      canvasContext("分析这个方案的优缺点")
    );

    expect(route.toolIds).toEqual([toolIds.writeDocument]);
  });

  it("maps runtime tool ids to AI SDK tool names", () => {
    const route = {
      toolIds: [toolIds.searchWeb, toolIds.writeDocument],
      reason: "test",
    };

    expect(
      resolveRoutedAiSdkToolNames({
        route,
        toolNamesById: new Map([
          [toolIds.searchWeb, "web_search"],
          [toolIds.writeDocument, "write_document"],
        ]),
      })
    ).toEqual(["web_search", "write_document"]);
  });

  it("fails when a deterministic route points to an unregistered tool", () => {
    expect(() =>
      resolveRoutedAiSdkToolNames({
        route: {
          toolIds: [toolIds.expandPrompt, toolIds.generateImage],
          reason: "test",
        },
        toolNamesById: new Map([[toolIds.generateImage, "generate_image"]]),
      })
    ).toThrow("prompt.expand");
  });
});

function canvasContext(prompt: string): PromptCanvasContext {
  return {
    prompt,
    selectedNodeId: null,
    upstreamContext: [],
  };
}
