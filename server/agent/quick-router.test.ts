import { describe, expect, it } from "vitest";

import type { AgentRunInput } from "./context.ts";
import { routeAgentRunQuick } from "./quick-router.ts";

describe("quick agent run router", () => {
  it("routes smalltalk to a direct response without slow prep", () => {
    const route = routeAgentRunQuick(input({ message: "哈喽" }));

    expect(route).toMatchObject({
      route: "smalltalk",
      routerSource: "quick-router",
      requiresModelNormalization: false,
    });
    expect(route.directResponse).toContain("我在");
    expect(route.skippedSteps).toEqual(
      expect.arrayContaining(["input.normalize", "skills.retrieve", "agent.start"])
    );
  });

  it("routes short ordinary questions to the lightweight chat path", () => {
    const route = routeAgentRunQuick(input({ message: "解释一下 React Flow 是什么" }));

    expect(route).toMatchObject({
      route: "simple_chat",
      requiresModelNormalization: false,
      normalizedInput: {
        operation: "answer",
        artifact: null,
        intent: "text.answer",
      },
    });
    expect(route.skippedSteps).toEqual(
      expect.arrayContaining(["input.normalize", "skills.retrieve"])
    );
  });

  it("routes explicit image generation locally without LLM normalization", () => {
    const route = routeAgentRunQuick(input({ message: "生成一张 16:9 黄瓜海报" }));

    expect(route).toMatchObject({
      route: "image_task",
      requiresModelNormalization: false,
      normalizedInput: {
        artifact: { kind: "image", subtype: "poster", format: "png" },
        intent: "image.generate",
        image: {
          resultCount: 1,
          aspectRatio: "16:9",
        },
      },
    });
    expect(route.skippedSteps).toEqual(
      expect.arrayContaining(["input.normalize", "skills.retrieve"])
    );
  });

  it("lets image composer mode force terse prompts into image generation", () => {
    const route = routeAgentRunQuick(
      input({
        inputMode: "image",
        message: "黄瓜",
        normalizedInput: {
          rawPrompt: "黄瓜",
          userGoal: "黄瓜",
          operation: "create",
          artifact: { kind: "image", format: "png" },
          domain: "visual-design",
          requiredCapabilities: ["image-generation"],
          negativeCapabilities: [],
          intent: "image.generate",
          image: {
            contentPrompt: "黄瓜",
            aspectRatio: "1:1",
            resultCount: 2,
          },
        },
      })
    );

    expect(route).toMatchObject({
      route: "image_task",
      requiresModelNormalization: false,
      normalizedInput: {
        artifact: { kind: "image", format: "png" },
        image: {
          contentPrompt: "黄瓜",
          aspectRatio: "1:1",
          resultCount: 2,
        },
      },
    });
    expect(route.directResponse).toBeUndefined();
  });

  it("routes selected-image character IP figure requests locally", () => {
    const route = routeAgentRunQuick(
      input({
        message: "根据这个帮我出这个角色的毛绒IP形象",
        selectedNodeId: "image-1",
        selectedNodeIds: ["image-1"],
        upstreamContext: [{ nodeId: "image-1", type: "image", summary: "参考图" }],
      })
    );

    expect(route).toMatchObject({
      route: "image_task",
      requiresModelNormalization: false,
      normalizedInput: {
        artifact: { kind: "image", format: "png" },
        intent: "image.generate",
        requiredCapabilities: ["image-generation"],
      },
    });
    expect(route.skippedSteps).toContain("input.normalize");
  });

  it("routes HTML animation creation locally as a webpage artifact", () => {
    const route = routeAgentRunQuick(
      input({ message: "用huashu skill 帮我做个30秒的HTML动画，讲agent怎么工作" })
    );

    expect(route).toMatchObject({
      route: "complex_agent_task",
      requiresModelNormalization: false,
      normalizedInput: {
        artifact: { kind: "webpage", subtype: "animation", format: "html" },
        intent: "webpage.create",
        negativeCapabilities: ["image-generation"],
      },
    });
    expect(route.normalizedInput?.image).toBeUndefined();
    expect(route.skippedSteps).toContain("input.normalize");
  });

  it("keeps diagram requests on the complex agent path but skips LLM normalization", () => {
    const route = routeAgentRunQuick(
      input({ message: "帮我创建一个视觉 H5 需求的流程时序图" })
    );

    expect(route).toMatchObject({
      route: "complex_agent_task",
      requiresModelNormalization: false,
      normalizedInput: {
        artifact: {
          kind: "diagram",
          subtype: "sequenceDiagram",
          format: "mermaid",
        },
        negativeCapabilities: ["image-generation"],
      },
    });
    expect(route.skippedSteps).toContain("input.normalize");
  });

  it("routes safe sticky note creation to simple canvas operations", () => {
    const route = routeAgentRunQuick(input({ message: "新增便签：记得看数据" }));

    expect(route.route).toBe("simple_canvas");
    expect(route.canvasOperations?.[0]).toMatchObject({
      type: "createNode",
      payload: {
        node: {
          type: "stickyNoteNode",
          data: {
            kind: "stickyNote",
            text: "记得看数据",
          },
        },
      },
    });
  });

  it("uses model normalization for ambiguous selected-context edits", () => {
    const route = routeAgentRunQuick(
      input({
        message: "优化这个",
        selectedNodeId: "note-1",
        selectedNodeIds: ["note-1"],
        upstreamContext: [{ nodeId: "note-1", type: "artifact", summary: "old" }],
      })
    );

    expect(route).toMatchObject({
      route: "complex_agent_task",
      routerSource: "llm-normalizer",
      requiresModelNormalization: true,
    });
  });
});

function input(overrides: Partial<AgentRunInput> = {}): AgentRunInput {
  return {
    canvasId: "project-1",
    canvasSnapshot: {
      edges: [],
      nodes: [
        {
          id: "run-1",
          type: "runNode",
          position: { x: 0, y: 240 },
          data: {
            kind: "run",
            prompt: "哈喽",
            status: "queued",
          },
        },
      ],
    },
    message: "哈喽",
    projectId: "project-1",
    promptNodeId: "prompt-1",
    runNodeId: "run-1",
    selectedNodeId: null,
    selectedNodeIds: [],
    upstreamContext: [],
    userId: "user-1",
    ...overrides,
  };
}
