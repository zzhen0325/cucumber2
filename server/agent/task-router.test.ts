import { describe, expect, it } from "vitest";

import {
  selectAgentRoute,
  selectAgentRoutesForTask,
} from "./task-router.ts";

describe("task router", () => {
  it("routes image capabilities through the capability manifest", () => {
    expect(
      selectAgentRoute({
        rawPrompt: "分析这张图",
        operation: "analyze",
        artifact: { kind: "markdown", format: "markdown" },
        requiredCapabilities: ["media-analysis", "markdown-artifact"],
        negativeCapabilities: ["image-generation"],
      })
    ).toBe("image");
  });

  it("routes generated webpage artifacts to document unless web-fetch is required", () => {
    expect(
      selectAgentRoute({
        rawPrompt: "做个 HTML 动画",
        operation: "create",
        artifact: { kind: "webpage", subtype: "animation", format: "html" },
        requiredCapabilities: ["html-artifact", "animation"],
        negativeCapabilities: ["image-generation"],
      })
    ).toBe("document");

    expect(
      selectAgentRoute({
        rawPrompt: "读取 https://example.com",
        operation: "create",
        artifact: { kind: "webpage", format: "html" },
        requiredCapabilities: ["web-fetch"],
        negativeCapabilities: [],
      })
    ).toBe("web");
  });

  it("routes composite source-to-document work to all required specialists", () => {
    expect(
      selectAgentRoutesForTask({
        rawPrompt: "把这个页面总结成带引用的文档",
        operation: "transform",
        artifact: { kind: "document", format: "markdown" },
        requiredCapabilities: ["web-fetch", "citations", "markdown-artifact"],
        negativeCapabilities: [],
      })
    ).toEqual(["web", "research", "document"]);
  });
});
