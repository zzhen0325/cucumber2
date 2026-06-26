import { describe, expect, it } from "vitest";

import type { AgentRunInput } from "./context.ts";
import {
  routeAgentRunQuick,
  routeNormalizedAgentRun,
  skippedStepsForNormalizedRoute,
} from "./quick-router.ts";

describe("quick agent run router", () => {
  it("routes greetings to the chat agent without slow prep", () => {
    const route = routeAgentRunQuick(input({ message: "哈喽" }));

    expect(route).toMatchObject({
      route: "chat_agent_task",
      routerSource: "quick-router",
      requiresModelNormalization: false,
    });
    expect(route.skippedSteps).toEqual([
      "input.normalize",
      "plan.build",
      "skills.retrieve",
    ]);
  });

  it("defers short ordinary questions to the LLM normalizer", () => {
    const route = routeAgentRunQuick(input({ message: "解释一下 React Flow 是什么" }));

    expect(route).toMatchObject({
      route: "manager_task",
      routerSource: "quick-router",
      requiresModelNormalization: true,
    });
    expect(route.normalizedInput).toBeUndefined();
  });

  it("defers generation-tool questions to the LLM normalizer", () => {
    const route = routeAgentRunQuick(
      input({ message: "有哪些开源免费调用的3D模型生成" })
    );

    expect(route).toMatchObject({
      route: "manager_task",
      routerSource: "quick-router",
      requiresModelNormalization: true,
    });
    expect(route.normalizedInput).toBeUndefined();
  });

  it("routes selected image generation metadata to the chat agent", () => {
    const route = routeAgentRunQuick(
      input({
        message: "这个图片的生成信息是什么",
        selectedNodeId: "image-1",
        selectedNodeIds: ["image-1"],
        upstreamContext: [
          {
            artifact: {
              id: "artifact-1",
              metadata: {
                height: 1024,
                model: "seed5_duotu_zz",
                prompt: "开源免费 3D 模型生成工具科普信息图",
                provider: "byteartist",
                sourcePrompt: "有哪些开源免费调用的3D模型生成",
                sourceToolName: "generate_image",
                width: 1536,
              },
              type: "image",
            },
            imageUrl: "/api/projects/project-1/artifacts/artifact-1/content",
            nodeId: "image-1",
            prompt: "有哪些开源免费调用的3D模型生成",
            summary: "Generated image",
            type: "image",
          },
        ],
      })
    );

    expect(route).toMatchObject({
      route: "chat_agent_task",
      requiresModelNormalization: false,
      normalizedInput: {
        operation: "answer",
        artifact: null,
        negativeCapabilities: ["image-generation"],
      },
    });
    expect(route.skippedSteps).toEqual([
      "input.normalize",
      "plan.build",
      "skills.retrieve",
    ]);
  });

  it("defers explicit image generation to the LLM normalizer", () => {
    const route = routeAgentRunQuick(input({ message: "生成一张 16:9 黄瓜海报" }));

    expect(route).toMatchObject({
      route: "manager_task",
      routerSource: "quick-router",
      requiresModelNormalization: true,
    });
    expect(route.normalizedInput).toBeUndefined();
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
        },
      })
    );

    expect(route).toMatchObject({
      route: "image_task",
      requiresModelNormalization: false,
      normalizedInput: {
        artifact: { kind: "image", format: "png" },
      },
    });
    expect(route.normalizedInput).not.toHaveProperty("image");
  });

  it("defers selected-image character IP figure requests to the LLM normalizer", () => {
    const route = routeAgentRunQuick(
      input({
        message: "根据这个帮我出这个角色的毛绒IP形象",
        selectedNodeId: "image-1",
        selectedNodeIds: ["image-1"],
        upstreamContext: [{ nodeId: "image-1", type: "image", summary: "参考图" }],
      })
    );

    expect(route).toMatchObject({
      route: "manager_task",
      routerSource: "quick-router",
      requiresModelNormalization: true,
    });
    expect(route.normalizedInput).toBeUndefined();
  });

  it("defers HTML animation creation to the LLM normalizer", () => {
    const route = routeAgentRunQuick(
      input({ message: "用huashu skill 帮我做个30秒的HTML动画，讲agent怎么工作" })
    );

    expect(route).toMatchObject({
      route: "manager_task",
      routerSource: "quick-router",
      requiresModelNormalization: true,
    });
    expect(route.normalizedInput).toBeUndefined();
  });

  it("defers diagram requests to the LLM normalizer", () => {
    const route = routeAgentRunQuick(
      input({ message: "帮我创建一个视觉 H5 需求的流程时序图" })
    );

    expect(route).toMatchObject({
      route: "manager_task",
      routerSource: "quick-router",
      requiresModelNormalization: true,
    });
    expect(route.normalizedInput).toBeUndefined();
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
      route: "manager_task",
      routerSource: "quick-router",
      requiresModelNormalization: true,
    });
  });

  it("routes normalized short answers without starting the full agent path", () => {
    const route = routeNormalizedAgentRun(
      input({ message: "解释一下 React Flow 是什么" }),
      {
        rawPrompt: "解释一下 React Flow 是什么",
        userGoal: "解释一下 React Flow 是什么",
        operation: "answer",
        artifact: null,
        requiredCapabilities: [],
        negativeCapabilities: [],
        intent: "text.answer",
      }
    );

    expect(route).toBe("chat_agent_task");
    expect(skippedStepsForNormalizedRoute(route)).toEqual([
      "plan.build",
      "skills.retrieve",
    ]);
  });

  it("keeps normalized short answers on the full path when simple chat is disabled", () => {
    const route = routeNormalizedAgentRun(
      input({ message: "解释一下 React Flow 是什么" }),
      {
        rawPrompt: "解释一下 React Flow 是什么",
        userGoal: "解释一下 React Flow 是什么",
        operation: "answer",
        artifact: null,
        requiredCapabilities: [],
        negativeCapabilities: [],
        intent: "text.answer",
      },
      { allowSimpleChat: false }
    );

    expect(route).toBe("manager_task");
  });

  it("routes normalized image artifacts to image tasks", () => {
    const route = routeNormalizedAgentRun(input({ message: "生成一张黄瓜海报" }), {
      rawPrompt: "生成一张黄瓜海报",
      userGoal: "生成一张黄瓜海报",
      operation: "create",
      artifact: { kind: "image", subtype: "poster", format: "png" },
      domain: "visual-design",
      requiredCapabilities: ["image-generation"],
      negativeCapabilities: [],
      intent: "image.generate",
    });

    expect(route).toBe("image_task");
  });

  it("routes normalized document artifacts to document tasks", () => {
    const route = routeNormalizedAgentRun(input({ message: "写一份 PRD" }), {
      rawPrompt: "写一份 PRD",
      userGoal: "写一份 PRD",
      operation: "create",
      artifact: { kind: "document", subtype: "prd", format: "markdown" },
      domain: "product",
      requiredCapabilities: ["markdown-artifact"],
      negativeCapabilities: [],
      intent: "document.create",
    });

    expect(route).toBe("document_task");
  });

  it("routes normalized research answers to research tasks", () => {
    const route = routeNormalizedAgentRun(input({ message: "调研一下 Agent SDK" }), {
      rawPrompt: "调研一下 Agent SDK",
      userGoal: "调研一下 Agent SDK",
      operation: "answer",
      artifact: null,
      domain: "engineering",
      requiredCapabilities: ["research", "source-based-answer", "citations"],
      negativeCapabilities: [],
      intent: "research.answer",
    });

    expect(route).toBe("research_task");
  });

  it("routes normalized public URL fetches to web tasks", () => {
    const route = routeNormalizedAgentRun(input({ message: "读取 https://example.com" }), {
      rawPrompt: "读取 https://example.com",
      userGoal: "读取 https://example.com",
      operation: "create",
      artifact: { kind: "webpage", format: "html" },
      domain: "general",
      requiredCapabilities: ["web-fetch"],
      negativeCapabilities: [],
      intent: "web.fetch",
    });

    expect(route).toBe("web_task");
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
