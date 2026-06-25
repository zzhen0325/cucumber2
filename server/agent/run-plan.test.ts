import { describe, expect, it } from "vitest";

import type { AgentRunInput } from "./context.ts";
import { buildRunPlan } from "./run-plan.ts";

describe("buildRunPlan", () => {
  it("skips simple short text runs", () => {
    const plan = buildRunPlan(
      input({
        message: "你好",
        normalizedInput: { intent: "text.answer", rawPrompt: "你好" },
      })
    );

    expect(plan).toEqual([]);
  });

  it("skips prompt text edit plans even with an upstream prompt node", () => {
    const plan = buildRunPlan(
      input({
        message: "取消标题",
        normalizedInput: {
          artifact: null,
          intent: "text.answer",
          negativeCapabilities: ["image-generation"],
          operation: "edit",
          rawPrompt: "取消标题",
        },
        upstreamContext: [
          {
            nodeId: "prompt-source",
            prompt: "一个包含大型标题文字的红毯家居展示画面提示词",
            type: "prompt",
          },
        ],
      })
    );

    expect(plan).toEqual([]);
  });

  it("creates task-specific document plans", () => {
    const plan = buildRunPlan(
      input({
        message: "写一份产品说明文档",
        normalizedInput: { intent: "document.create", rawPrompt: "写一份产品说明文档" },
      })
    );

    expect(plan).toMatchObject([
      { id: "document-brief", label: "梳理文档目标和上游素材", phase: "prepare" },
      { id: "document-agent", label: "进入 Document Agent", phase: "route" },
      { id: "document-create", label: "创建文档内容", phase: "execute" },
      { id: "document-materialize", label: "投影为画布文档节点", phase: "materialize" },
    ]);
  });

  it("creates task-specific generated webpage plans", () => {
    const plan = buildRunPlan(
      input({
        message: "做个 30 秒 HTML 动画",
        normalizedInput: {
          intent: "webpage.create",
          rawPrompt: "做个 30 秒 HTML 动画",
        },
      })
    );

    expect(plan).toMatchObject([
      { id: "html-brief", label: "梳理 HTML 产物目标和交互要求", phase: "prepare" },
      { id: "document-agent", label: "进入 Document Agent", phase: "route" },
      { id: "html-create", label: "创建 HTML 页面", phase: "execute" },
      { id: "html-materialize", label: "投影为网页预览节点", phase: "materialize" },
    ]);
  });

  it("derives plans from artifact protocol before compatibility intent", () => {
    const plan = buildRunPlan(
      input({
        message: "做个 30 秒 HTML 动画",
        normalizedInput: {
          intent: "image.generate",
          operation: "create",
          artifact: { kind: "webpage", subtype: "animation", format: "html" },
          requiredCapabilities: ["html-artifact", "animation"],
          negativeCapabilities: ["image-generation"],
          rawPrompt: "做个 30 秒 HTML 动画",
        },
      })
    );

    expect(plan).toContainEqual({
      id: "html-create",
      label: "创建 HTML 页面",
      phase: "execute",
    });
    expect(plan).not.toContainEqual({
      id: "image-generate",
      label: "生成图片",
      phase: "execute",
    });
  });

  it("skips simple single-image plans but plans multi-image work", () => {
    expect(
      buildRunPlan(
        input({
          message: "生成一张黄瓜海报",
          normalizedInput: {
            intent: "image.generate",
            image: { resultCount: 1 },
            rawPrompt: "生成一张黄瓜海报",
          },
        })
      )
    ).toEqual([]);

    expect(
      buildRunPlan(
        input({
          message: "生成一组 3 张黄瓜海报",
          normalizedInput: {
            intent: "image.generate",
            image: { resultCount: 3 },
            rawPrompt: "生成一组 3 张黄瓜海报",
          },
        })
      )
    ).toContainEqual({
      id: "image-generate",
      label: "生成 3 张图片",
      phase: "execute",
    });
  });

  it("creates a retry recovery plan", () => {
    const plan = buildRunPlan(
      input({
        message: "重试",
        normalizedInput: { intent: "image.generate", rawPrompt: "重试" },
        retryFrom: {
          failedRunNodeId: "run-old",
          label: "generate_image",
          stepId: "generate_image",
          toolName: "generate_image",
        },
      })
    );

    expect(plan).toMatchObject([
      { label: "定位失败步骤：generate_image", phase: "prepare" },
      { label: "保留已完成的上游结果", phase: "prepare" },
      { label: "重试：generate_image", phase: "execute" },
      { label: "写入恢复后的画布结果", phase: "materialize" },
    ]);
  });
});

function input(overrides: Partial<AgentRunInput>): AgentRunInput {
  return {
    canvasId: "project-1",
    canvasSnapshot: { edges: [], nodes: [] },
    contextSummary: {
      omittedNodes: [],
      referenceNodes: [],
      selectedNodes: [],
      upstreamPath: [],
    },
    message: "hello",
    promptNodeId: "prompt-1",
    projectId: "project-1",
    runNodeId: "run-1",
    selectedNodeId: null,
    selectedNodeIds: [],
    upstreamContext: [],
    userId: "user-1",
    ...overrides,
  };
}
