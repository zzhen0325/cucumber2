import { describe, expect, it } from "vitest";

import type { AgentRunInput } from "./context.ts";
import { buildRunPlan } from "./run-plan.ts";
import { makeTaskFrame } from "./test-task-frame.ts";

describe("buildRunPlan", () => {
  it("skips simple short text runs", () => {
    const plan = buildRunPlan(
      input({
        message: "你好",
        normalizedInput: makeTaskFrame({
          rawInput: "你好",
          domain: "text",
          intent: "text.answer",
          action: "analyze",
        }),
      })
    );

    expect(plan).toEqual([]);
  });

  it("skips prompt text edit plans even with an upstream prompt node", () => {
    const plan = buildRunPlan(
      input({
        message: "取消标题",
        normalizedInput: makeTaskFrame({
          rawInput: "取消标题",
          domain: "text",
          intent: "prompt.edit",
          action: "edit",
        }),
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

  it("skips ordinary document plans but plans long-form document work", () => {
    expect(
      buildRunPlan(
        input({
          message: "写一段产品说明",
          normalizedInput: makeTaskFrame({
            rawInput: "写一段产品说明",
            domain: "text",
            intent: "document.create",
            action: "create",
            primaryAgent: "document_agent",
          }),
        })
      )
    ).toEqual([]);

    const plan = buildRunPlan(
      input({
        message: "写一份完整规划方案文档",
        normalizedInput: makeTaskFrame({
          rawInput: "写一份完整规划方案文档",
          domain: "text",
          intent: "document.create",
          action: "create",
          primaryAgent: "document_agent",
        }),
      })
    );

    expect(plan).toMatchObject([
      { id: "document-brief", label: "梳理文档目标和上游素材", phase: "prepare" },
      { id: "document-tools", label: "选择文档工具和技能", phase: "route" },
      { id: "document-create", label: "创建文档内容", phase: "execute" },
      { id: "document-materialize", label: "投影为画布文档节点", phase: "materialize" },
    ]);
  });

  it("creates task-specific generated webpage plans", () => {
    const plan = buildRunPlan(
      input({
        message: "做个 30 秒 HTML 动画",
        normalizedInput: makeTaskFrame({
          rawInput: "做个 30 秒 HTML 动画",
          domain: "text",
          intent: "webpage.create",
          action: "create",
          primaryAgent: "document_agent",
        }),
      })
    );

    expect(plan).toMatchObject([
      { id: "html-brief", label: "梳理 HTML 产物目标和交互要求", phase: "prepare" },
      { id: "html-tools", label: "选择 HTML 文本产物工具", phase: "route" },
      { id: "html-create", label: "创建 HTML 页面", phase: "execute" },
      { id: "html-materialize", label: "投影为网页预览节点", phase: "materialize" },
    ]);
  });

  it("creates stage-aware plans for hybrid workflows", () => {
    const plan = buildRunPlan(
      input({
        message: "分析这张图，生成海报和 HTML 代码",
        normalizedInput: makeTaskFrame({
          rawInput: "分析这张图，生成海报和 HTML 代码",
          domain: "mixed",
          intent: "hybrid.visual.code.create",
          action: "create",
          primaryAgent: "manager_agent",
          workflow: {
            mode: "hybrid",
            outputArtifacts: ["image", "code"],
            requiredAgents: ["image_agent", "document_agent"],
            requiredCapabilities: [
              "media-analysis",
              "image-generation",
              "code-artifact",
            ],
            stages: [
              {
                id: "analyze-reference",
                goal: "分析参考图的视觉线索",
                action: "analyze",
                agent: "image_agent",
                inputModalities: ["image"],
                outputArtifacts: ["answer"],
              },
              {
                id: "generate-image",
                goal: "生成海报图片",
                action: "create",
                agent: "image_agent",
                outputArtifacts: ["image"],
                dependsOn: ["analyze-reference"],
              },
              {
                id: "create-code",
                goal: "生成 HTML 代码",
                action: "create",
                agent: "document_agent",
                outputArtifacts: ["code"],
                dependsOn: ["generate-image"],
              },
            ],
          },
        }),
      })
    );

    expect(plan).toMatchObject([
      { id: "workflow-goal", label: "明确复合任务目标和依赖", phase: "prepare" },
      {
        id: "workflow-1-analyze-reference-route",
        label: "选择 image 能力：分析参考图的视觉线索",
        phase: "route",
      },
      {
        id: "workflow-1-analyze-reference-execute",
        label: "分析参考图的视觉线索",
        phase: "execute",
      },
      {
        id: "workflow-2-generate-image-route",
        label: "选择 image 能力：生成海报图片",
        phase: "route",
      },
      {
        id: "workflow-2-generate-image-execute",
        label: "生成海报图片",
        phase: "execute",
      },
      {
        id: "workflow-3-create-code-route",
        label: "选择 document 能力：生成 HTML 代码",
        phase: "route",
      },
      {
        id: "workflow-3-create-code-execute",
        label: "生成 HTML 代码",
        phase: "execute",
      },
      { id: "workflow-materialize", label: "投影复合任务产物", phase: "materialize" },
    ]);
  });

  it("skips simple single-image plans but plans multi-image work", () => {
    expect(
      buildRunPlan(
        input({
          message: "生成一张黄瓜海报",
          normalizedInput: makeTaskFrame({
            rawInput: "生成一张黄瓜海报",
            domain: "image",
            intent: "image.generate",
            action: "create",
            primaryAgent: "image_agent",
          }),
        })
      )
    ).toEqual([]);

    expect(
      buildRunPlan(
        input({
          message: "生成一组 3 张黄瓜海报",
          normalizedInput: makeTaskFrame({
            rawInput: "生成一组 3 张黄瓜海报",
            domain: "image",
            intent: "image.generate",
            action: "create",
            primaryAgent: "image_agent",
            explicit: [
              { key: "output_count", value: "3", sourceText: "3 张" },
            ],
          }),
        })
      )
    ).toContainEqual({
      id: "image-generate",
      label: "生成 3 张图片",
      phase: "execute",
    });
  });

  it("skips single-step image transforms but plans multi-reference generation", () => {
    expect(
      buildRunPlan(
        input({
          message: "抠出主体",
          normalizedInput: makeTaskFrame({
            rawInput: "抠出主体",
            domain: "image",
            intent: "image.matting",
            action: "transform",
            primaryAgent: "image_agent",
          }),
          selectedNodeIds: ["image-1"],
          upstreamContext: [{ nodeId: "image-1", type: "image", summary: "参考图" }],
        })
      )
    ).toEqual([]);

    expect(
      buildRunPlan(
        input({
          message: "高清放大这张图",
          normalizedInput: makeTaskFrame({
            rawInput: "高清放大这张图",
            domain: "image",
            intent: "image.upscale",
            action: "upscale",
            primaryAgent: "image_agent",
          }),
          selectedNodeIds: ["image-1"],
          upstreamContext: [{ nodeId: "image-1", type: "image", summary: "参考图" }],
        })
      )
    ).toEqual([]);

    expect(
      buildRunPlan(
        input({
          message: "参考这些图生成海报",
          normalizedInput: makeTaskFrame({
            rawInput: "参考这些图生成海报",
            domain: "image",
            intent: "image.generate",
            action: "create",
            primaryAgent: "image_agent",
          }),
          upstreamContext: [
            { nodeId: "image-1", type: "image", summary: "参考图 1" },
            { nodeId: "image-2", type: "image", summary: "参考图 2" },
          ],
        })
      )
    ).toContainEqual({
      id: "image-brief",
      label: "整理画面要求和引用图",
      phase: "prepare",
    });
  });

  it("only uses upstream context as a plan signal when it is multi-node or explicit", () => {
    expect(
      buildRunPlan(
        input({
          message: "总结一下",
          normalizedInput: makeTaskFrame({
            rawInput: "总结一下",
            domain: "text",
            intent: "text.answer",
            action: "analyze",
          }),
          selectedNodeIds: ["doc-1"],
          upstreamContext: [{ nodeId: "doc-1", type: "doc", summary: "文档" }],
        })
      )
    ).toEqual([]);

    expect(
      buildRunPlan(
        input({
          message: "基于这个节点回答",
          normalizedInput: makeTaskFrame({
            rawInput: "基于这个节点回答",
            domain: "text",
            intent: "text.answer",
            action: "analyze",
          }),
          selectedNodeIds: ["doc-1"],
          upstreamContext: [{ nodeId: "doc-1", type: "doc", summary: "文档" }],
        })
      )
    ).toContainEqual({
      id: "answer-context",
      label: "梳理问题和上游素材",
      phase: "prepare",
    });

    expect(
      buildRunPlan(
        input({
          message: "总结一下",
          normalizedInput: makeTaskFrame({
            rawInput: "总结一下",
            domain: "text",
            intent: "text.answer",
            action: "analyze",
          }),
          selectedNodeIds: ["doc-1", "doc-2"],
          upstreamContext: [
            { nodeId: "doc-1", type: "doc", summary: "文档 1" },
            { nodeId: "doc-2", type: "doc", summary: "文档 2" },
          ],
        })
      )
    ).toContainEqual({
      id: "answer-context",
      label: "梳理问题和上游素材",
      phase: "prepare",
    });
  });

  it("creates a retry recovery plan", () => {
    const plan = buildRunPlan(
      input({
        message: "重试",
        normalizedInput: makeTaskFrame({
          rawInput: "重试",
          domain: "image",
          intent: "image.generate",
          action: "create",
          primaryAgent: "image_agent",
        }),
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
