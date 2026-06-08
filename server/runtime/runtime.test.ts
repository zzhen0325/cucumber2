import { z } from "zod";
import { describe, expect, it } from "vitest";

import { buildCapabilityRegistry } from "../capabilities";
import { buildContext } from "./context-builder";
import { normalizeAgentInput } from "./input-normalizer";
import {
  buildPlanFromIntentDeterministically,
  createPlan,
  validatePlanAgainstRegistry,
} from "./planner";
import {
  routeIntent,
  routeIntentDeterministically,
} from "./intent-router";
import {
  buildToolRegistry,
  ToolRegistry,
  getToolTraceMetadata,
  summarizeTool,
  toolIds,
} from "./tool-registry";
import {
  agentRunSchema,
  intentResultSchema,
  runtimeEventTypeSchema,
} from "./schemas";
import { runtimeEventTypes } from "../../src/types/runtime";
import type {
  BuiltContext,
  PlanStep,
  StructuredTask,
  ToolDefinition,
} from "../../src/types/runtime";

const promptExpandSkill = {
  id: "skill-1",
  ownerUserId: null,
  name: "prompt-expand",
  slug: "prompt-expand",
  description: "Expand image prompts.",
  instructions: "Only output an expanded prompt.",
  config: {},
  sourceManifest: {},
  isPublic: true,
  canEdit: false,
  createdAt: "2026-06-08T00:00:00.000Z",
  updatedAt: "2026-06-08T00:00:00.000Z",
};

describe("runtime core", () => {
  it("keeps runtime event schema aligned with the shared event type list", () => {
    expect(new Set(runtimeEventTypes).size).toBe(runtimeEventTypes.length);
    for (const eventType of runtimeEventTypes) {
      expect(runtimeEventTypeSchema.parse(eventType)).toBe(eventType);
    }
  });

  it("normalizes canvas input into a first-class AgentInput", () => {
    const input = normalizeAgentInput({
      userId: "user-1",
      projectId: "project-1",
      runNodeId: "run-1",
      modelProvider: "deepseek",
      messages: [],
      canvasContext: {
        prompt: "生成一张绿色黄瓜海报",
        promptNodeId: "prompt-1",
        selectedNodeId: null,
        upstreamContext: [],
      },
    });

    expect(input.metadata).toMatchObject({
      projectId: "project-1",
      runNodeId: "run-1",
      promptNodeId: "prompt-1",
    });
    expect(input.userMessage).toBe("生成一张绿色黄瓜海报");
  });

  it("parses an AgentRun snapshot with runtime contracts", () => {
    const now = "2026-06-08T00:00:00.000Z";
    const input = normalizeAgentInput({
      userId: "user-1",
      projectId: "project-1",
      runNodeId: "run-1",
      modelProvider: "deepseek",
      messages: [],
      canvasContext: {
        prompt: "生成图片",
        selectedNodeId: null,
        upstreamContext: [],
      },
    });

    const run = agentRunSchema.parse({
      id: "agent-run-1",
      userId: "user-1",
      projectId: "project-1",
      status: "queued",
      input,
      steps: [],
      artifacts: [],
      canvasOperations: [],
      errors: [],
      trace: { events: [] },
      createdAt: now,
      updatedAt: now,
    });

    expect(run.status).toBe("queued");
  });

  it("routes image generation and builds a tool allowlist context", async () => {
    const capabilities = buildCapabilityRegistry([promptExpandSkill]);
    const toolRegistry = createTestToolRegistry();
    const input = normalizeAgentInput({
      userId: "user-1",
      projectId: "project-1",
      runNodeId: "run-1",
      modelProvider: "deepseek",
      messages: [],
      canvasContext: {
        prompt: "参考这张图继续生成一张海报",
        selectedNodeId: "image-1",
        upstreamContext: [
          {
            nodeId: "image-1",
            type: "image",
            imageUrl: "https://cdn.example/1.png",
            summary: "绿色海报",
          },
        ],
      },
    });
    let routerPrompt = "";
    const intent = await routeIntent({
      capabilities,
      input,
      modelProvider: "deepseek",
      toolRegistry,
      async generateIntentResult(prompt) {
        routerPrompt = prompt;
        return routeIntentDeterministically({ capabilities, input, toolRegistry });
      },
    });
    const context = buildContext({
      input,
      intent,
      publicSkills: [promptExpandSkill],
      runId: "agent-run-1",
      toolRegistry,
    });

    expect(intent.primaryIntent).toBe("image_generation");
    expect(routerPrompt).toContain("AVAILABLE_CAPABILITIES");
    expect(routerPrompt).toContain(toolIds.generateImage);
    expect(intent.requiredTools).toEqual([
      toolIds.analyzeReferenceImages,
      toolIds.expandPrompt,
      toolIds.generateImage,
    ]);
    expect(context.selectedItems[0].nodeId).toBe("image-1");
    expect(context.availableTools.map((tool) => tool.id)).toEqual(
      intent.requiredTools
    );
  });

  it("keeps selected image context and includes attachment, history, and project refs", () => {
    const capabilities = buildCapabilityRegistry([promptExpandSkill]);
    const toolRegistry = createTestToolRegistry();
    const selectedSummary = "选中的参考图".repeat(40);
    const input = {
      ...normalizeAgentInput({
        userId: "user-1",
        projectId: "project-1",
        runNodeId: "run-1",
        modelProvider: "deepseek",
        messages: [],
        attachments: [
          {
            id: "attachment-1",
            kind: "doc",
            name: "brief.md",
            contentRef: "composer-attachment://brief.md",
            preview: "上传文档摘要",
          },
        ],
        canvasContext: {
          prompt: "基于图片和文档继续生成",
          selectedNodeId: "image-1",
          upstreamContext: [
            {
              nodeId: "image-1",
              type: "image",
              imageUrl: "https://cdn.example/image.png",
              summary: selectedSummary,
              priority: 100,
            },
            ...Array.from({ length: 8 }, (_, index) => ({
              nodeId: `doc-${index}`,
              type: "doc" as const,
              summary: "低优先级文档".repeat(1_000),
            })),
          ],
        },
      }),
      conversationHistory: [
        {
          id: "message-1",
          role: "user" as const,
          summary: "上一轮对话摘要",
        },
      ],
      projectRefs: [
        {
          id: "project-1",
          kind: "project" as const,
          title: "Campaign board",
          summary: "当前项目摘要",
        },
      ],
    };
    const intent = routeIntentDeterministically({
      capabilities,
      input,
      toolRegistry,
    });
    const context = buildContext({
      input,
      intent,
      publicSkills: [promptExpandSkill],
      runId: "agent-run-1",
      toolRegistry,
    });

    expect(context.selectedItems[0]).toMatchObject({
      nodeId: "image-1",
      source: "selected_node",
      inclusionReason: "selected_node_required",
    });
    expect(context.omittedItems.length).toBeGreaterThan(0);
    expect(context.selectedItems.map((item) => item.source)).toContain(
      "attachment"
    );
    expect(context.selectedItems.map((item) => item.source)).toContain(
      "history"
    );
    expect(context.selectedItems.map((item) => item.source)).toContain(
      "project"
    );
    expect(context.availableTools.map((tool) => tool.id)).toEqual(
      intent.requiredTools
    );
    expect(
      context.promptParts.find((part) => part.id === "runtime.selected-context")
        ?.content
    ).toContain("上一轮对话摘要");
    expect(context.promptParts.map((part) => part.id)).toEqual([
      "runtime.intent",
      "runtime.user-message",
      "runtime.selected-context",
      "runtime.omitted-context",
      "runtime.allowed-tools",
      "runtime.injected-skills",
    ]);
    expect(
      context.promptParts.find((part) => part.id === "runtime.omitted-context")
        ?.content
    ).toContain("context_budget_exceeded");
  });

  it("routes document writing to capability.route_missing instead of image generation", async () => {
    const capabilities = buildCapabilityRegistry([promptExpandSkill]);
    const toolRegistry = createTestToolRegistry();
    const input = normalizeAgentInput({
      userId: "user-1",
      projectId: "project-1",
      runNodeId: "run-1",
      modelProvider: "deepseek",
      messages: [],
      canvasContext: {
        prompt: "帮我写一份产品需求文档",
        selectedNodeId: null,
        upstreamContext: [],
      },
    });
    const intent = await routeIntent({
      capabilities,
      input,
      modelProvider: "deepseek",
      toolRegistry,
      async generateIntentResult() {
        return routeIntentDeterministically({ capabilities, input, toolRegistry });
      },
    });
    const plan = buildPlanFromIntentDeterministically(intent);

    expect(intent).toMatchObject({
      primaryIntent: "capability.route_missing",
      requiredCapabilities: ["document.write"],
      requiredTools: [],
      task: { kind: "document_writing" },
    });
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({
      id: "clarify_or_stop",
      kind: "approval",
      approvalRequired: true,
    });
  });

  it("keeps visual style analysis out of the image prompt expansion flow", async () => {
    const capabilities = buildCapabilityRegistry([promptExpandSkill]);
    const toolRegistry = createTestToolRegistry();
    const input = normalizeAgentInput({
      userId: "user-1",
      projectId: "project-1",
      runNodeId: "run-1",
      modelProvider: "deepseek",
      messages: [],
      canvasContext: {
        prompt: "分析Gemini的视觉风格",
        selectedNodeId: null,
        upstreamContext: [],
      },
    });
    const intent = await routeIntent({
      capabilities,
      input,
      modelProvider: "deepseek",
      toolRegistry,
      async generateIntentResult() {
        return {
          primaryIntent: "image_generation",
          confidence: 0.91,
          task: {
            kind: "image_generation",
            goals: [input.userMessage],
            targets: [],
            constraints: [],
            deliverables: [
              { kind: "image", description: "Incorrect image artifact." },
            ],
            operations: [
              { kind: "generate", target: "expanded_prompt", toolHint: toolIds.generateImage },
            ],
          },
          requiredCapabilities: ["prompt.expand", "image.generate"],
          requiredTools: [toolIds.expandPrompt, toolIds.generateImage],
          needsPlanning: true,
          ambiguity: [],
          routingReason: "Misrouted image generation fixture.",
        };
      },
    });
    const context = buildContext({
      input,
      intent,
      publicSkills: [promptExpandSkill],
      runId: "agent-run-1",
      toolRegistry,
    });
    const deterministicIntent = routeIntentDeterministically({
      capabilities,
      input,
      toolRegistry,
    });

    expect(intent).toMatchObject({
      primaryIntent: "capability.route_missing",
      requiredCapabilities: ["asset.analyze"],
      requiredTools: [],
      task: { kind: "file_analysis" },
    });
    expect(context.availableTools).toEqual([]);
    expect(context.injectedSkills).toEqual([]);
    expect(deterministicIntent).toMatchObject({
      primaryIntent: "capability.route_missing",
      requiredTools: [],
      task: { kind: "file_analysis" },
    });
  });

  it("routes text-first analysis to a Markdown document artifact when the document tool is available", async () => {
    const capabilities = buildCapabilityRegistry([promptExpandSkill]);
    const canvasContext = {
      prompt: "分析下Gemini的视觉风格",
      selectedNodeId: null,
      upstreamContext: [],
    };
    const toolRegistry = buildToolRegistry({
      canvasContext,
      capabilities,
      modelProvider: "deepseek",
      projectId: "project-1",
      runNodeId: "run-1",
    });
    const input = normalizeAgentInput({
      userId: "user-1",
      projectId: "project-1",
      runNodeId: "run-1",
      modelProvider: "deepseek",
      messages: [],
      canvasContext,
    });
    const intent = await routeIntent({
      capabilities,
      input,
      modelProvider: "deepseek",
      toolRegistry,
      async generateIntentResult() {
        return {
          primaryIntent: "image_generation",
          confidence: 0.91,
          task: {
            kind: "image_generation",
            goals: [input.userMessage],
            targets: [],
            constraints: [],
            deliverables: [
              { kind: "image", description: "Incorrect image artifact." },
            ],
            operations: [
              { kind: "generate", target: "expanded_prompt", toolHint: toolIds.generateImage },
            ],
          },
          requiredCapabilities: ["prompt.expand", "image.generate"],
          requiredTools: [toolIds.expandPrompt, toolIds.generateImage],
          needsPlanning: true,
          ambiguity: [],
          routingReason: "Misrouted image generation fixture.",
        };
      },
    });
    const context = buildContext({
      input,
      intent,
      publicSkills: [promptExpandSkill],
      runId: "agent-run-1",
      toolRegistry,
    });
    const plan = (
      await createPlan({
        context,
        generatePlanSteps: async () =>
          buildPlanFromIntentDeterministically(intent),
        intent,
        modelProvider: "deepseek",
        toolRegistry,
      })
    ).normalizedPlan;

    expect(intent).toMatchObject({
      primaryIntent: "document.analysis",
      requiredCapabilities: ["document.write"],
      requiredTools: [toolIds.writeDocument],
      task: {
        kind: "document_writing",
        deliverables: [{ kind: "document" }],
      },
    });
    expect(context.availableTools.map((tool) => tool.id)).toEqual([
      toolIds.writeDocument,
    ]);
    expect(plan.map((step) => step.id)).toEqual([
      "agent_text",
      "write_document",
      "evaluate_result",
    ]);
    expect(plan.find((step) => step.id === "write_document")).toMatchObject({
      toolId: toolIds.writeDocument,
      expectedArtifacts: [{ type: "doc", count: 1 }],
    });
  });

  it("routes executable document tasks before calling the model router", async () => {
    const capabilities = buildCapabilityRegistry([promptExpandSkill]);
    const canvasContext = {
      prompt: "分析下Gemini的视觉风格",
      selectedNodeId: null,
      upstreamContext: [],
    };
    const toolRegistry = buildToolRegistry({
      canvasContext,
      capabilities,
      modelProvider: "deepseek",
      projectId: "project-1",
      runNodeId: "run-1",
    });
    const input = normalizeAgentInput({
      userId: "user-1",
      projectId: "project-1",
      runNodeId: "run-1",
      modelProvider: "deepseek",
      messages: [],
      canvasContext,
    });
    let modelRouterCalled = false;
    const intent = await routeIntent({
      capabilities,
      input,
      modelProvider: "deepseek",
      toolRegistry,
      async generateIntentResult() {
        modelRouterCalled = true;
        throw new Error("model router should not be called for document routes");
      },
    });

    expect(modelRouterCalled).toBe(false);
    expect(intent).toMatchObject({
      primaryIntent: "document.analysis",
      requiredTools: [toolIds.writeDocument],
    });
  });

  it("plans document tasks before calling the model planner", async () => {
    const capabilities = buildCapabilityRegistry([promptExpandSkill]);
    const canvasContext = {
      prompt: "分析下Gemini的视觉风格",
      selectedNodeId: null,
      upstreamContext: [],
    };
    const toolRegistry = buildToolRegistry({
      canvasContext,
      capabilities,
      modelProvider: "deepseek",
      projectId: "project-1",
      runNodeId: "run-1",
    });
    const input = normalizeAgentInput({
      userId: "user-1",
      projectId: "project-1",
      runNodeId: "run-1",
      modelProvider: "deepseek",
      messages: [],
      canvasContext,
    });
    const intent = routeIntentDeterministically({
      capabilities,
      input,
      toolRegistry,
    });
    const context = buildContext({
      input,
      intent,
      publicSkills: [promptExpandSkill],
      runId: "agent-run-1",
      toolRegistry,
    });
    let modelPlannerCalled = false;
    const plan = await createPlan({
      context,
      intent,
      modelProvider: "deepseek",
      toolRegistry,
      async generatePlanSteps() {
        modelPlannerCalled = true;
        throw new Error("model planner should not be called for document routes");
      },
    });

    expect(modelPlannerCalled).toBe(false);
    expect(plan.normalizedPlan.map((step) => step.id)).toEqual([
      "agent_text",
      "write_document",
      "evaluate_result",
    ]);
  });

  it("turns unsupported non-image routing into a capability report document when possible", async () => {
    const capabilities = buildCapabilityRegistry([promptExpandSkill]);
    const canvasContext = {
      prompt: "修改代码并修复类型错误",
      selectedNodeId: null,
      upstreamContext: [],
    };
    const toolRegistry = buildToolRegistry({
      canvasContext,
      capabilities,
      modelProvider: "deepseek",
      projectId: "project-1",
      runNodeId: "run-1",
    });
    const input = normalizeAgentInput({
      userId: "user-1",
      projectId: "project-1",
      runNodeId: "run-1",
      modelProvider: "deepseek",
      messages: [],
      canvasContext,
    });
    const intent = await routeIntent({
      capabilities,
      input,
      modelProvider: "deepseek",
      toolRegistry,
      async generateIntentResult() {
        return {
          primaryIntent: "capability.route_missing",
          confidence: 0.44,
          task: createUnsupportedFixture(input.userMessage, "code_modification"),
          requiredCapabilities: ["code.modify"],
          requiredTools: [],
          needsPlanning: true,
          ambiguity: [
            {
              id: "missing-code-tool",
              question: "code.modify is not executable.",
              severity: "high",
            },
          ],
          routingReason: "No code modification executor.",
        };
      },
    });

    expect(intent).toMatchObject({
      primaryIntent: "document.capability_report",
      requiredCapabilities: ["document.write"],
      requiredTools: [toolIds.writeDocument],
      ambiguity: [{ severity: "medium" }],
    });
  });

  it("routes operational non-image requests to an honest capability report document", () => {
    const capabilities = buildCapabilityRegistry([promptExpandSkill]);
    const canvasContext = {
      prompt: "登录这个网站并完成支付",
      selectedNodeId: null,
      upstreamContext: [],
    };
    const toolRegistry = buildToolRegistry({
      canvasContext,
      capabilities,
      modelProvider: "deepseek",
      projectId: "project-1",
      runNodeId: "run-1",
    });
    const input = normalizeAgentInput({
      userId: "user-1",
      projectId: "project-1",
      runNodeId: "run-1",
      modelProvider: "deepseek",
      messages: [],
      canvasContext,
    });
    const intent = routeIntentDeterministically({
      capabilities,
      input,
      toolRegistry,
    });

    expect(intent).toMatchObject({
      primaryIntent: "document.capability_report",
      requiredTools: [toolIds.writeDocument],
      task: { kind: "document_writing" },
    });
  });

  it("routes web research through Tavily search before document writing", async () => {
    const capabilities = buildCapabilityRegistry([promptExpandSkill]);
    const toolRegistry = createRuntimeToolRegistry();
    const input = normalizeAgentInput({
      userId: "user-1",
      projectId: "project-1",
      runNodeId: "run-1",
      modelProvider: "deepseek",
      messages: [],
      canvasContext: {
        prompt: "搜索最新 AI SDK Tavily 文档并总结来源",
        selectedNodeId: null,
        upstreamContext: [],
      },
    });
    const intent = await routeIntent({
      capabilities,
      input,
      modelProvider: "deepseek",
      toolRegistry,
      async generateIntentResult() {
        throw new Error("model router should not be called for web research");
      },
    });
    const context = buildContext({
      input,
      intent,
      publicSkills: [promptExpandSkill],
      runId: "agent-run-1",
      toolRegistry,
    });
    const plan = (
      await createPlan({
        context,
        intent,
        modelProvider: "deepseek",
        toolRegistry,
        async generatePlanSteps() {
          throw new Error("model planner should not be called for web research");
        },
      })
    ).normalizedPlan;

    expect(intent).toMatchObject({
      primaryIntent: "web_research",
      requiredCapabilities: ["web.research", "document.write"],
      requiredTools: [toolIds.searchWeb, toolIds.writeDocument],
      task: { kind: "web_research" },
    });
    expect(context.availableTools.map((tool) => tool.id).sort()).toEqual(
      [toolIds.searchWeb, toolIds.writeDocument].sort()
    );
    expect(plan.map((step) => step.id)).toEqual([
      "agent_text",
      "search_web",
      "write_document",
      "evaluate_result",
    ]);
    expect(plan.find((step) => step.id === "search_web")).toMatchObject({
      toolId: toolIds.searchWeb,
      capabilityId: "web.research",
    });
  });

  it("routes landing page generation as an executable multi-step task", async () => {
    const capabilities = buildCapabilityRegistry([promptExpandSkill]);
    const toolRegistry = createRuntimeToolRegistry();
    const input = normalizeAgentInput({
      userId: "user-1",
      projectId: "project-1",
      runNodeId: "run-1",
      modelProvider: "deepseek",
      messages: [],
      canvasContext: {
        prompt: "根据网页和图片生成落地页并放到画布里",
        selectedNodeId: null,
        upstreamContext: [],
      },
    });
    const intent = routeIntentDeterministically({
      capabilities,
      input,
      toolRegistry,
    });

    expect(intent).toMatchObject({
      primaryIntent: "multi_step.landing_page",
      requiredCapabilities: [
        "web.research",
        "asset.analyze",
        "html.generate",
        "canvas.mutate",
      ],
      requiredTools: [
        toolIds.readWebpage,
        toolIds.analyzeAssets,
        toolIds.generateHtml,
        toolIds.createCanvasNode,
      ],
      task: { kind: "multi_step" },
    });
    expect(intent.task.operations.map((operation) => operation.kind)).toEqual([
      "search",
      "analyze",
      "write",
      "create_canvas_node",
    ]);

    const context = buildContext({
      input,
      intent,
      publicSkills: [promptExpandSkill],
      runId: "agent-run-1",
      toolRegistry,
    });
    expect(context.availableTools.map((tool) => tool.id)).toEqual(
      intent.requiredTools
    );

    const plan = (
      await createPlan({
        context,
        generatePlanSteps: async () =>
          buildPlanFromIntentDeterministically(intent),
        intent,
        modelProvider: "deepseek",
        toolRegistry,
      })
    ).normalizedPlan;

    expect(plan.map((step) => step.id)).toEqual([
      "agent_text",
      "read_webpage",
      "analyze_assets",
      "generate_html",
      "create_page_node",
      "evaluate_result",
    ]);
    expect(plan.find((step) => step.id === "generate_html")).toMatchObject({
      toolId: toolIds.generateHtml,
      expectedArtifacts: [{ type: "webpage" }],
      expectedCanvasOperations: [{ type: "createNode" }],
    });
  });

  it("routes compound analysis-to-page tasks through report and HTML tools without model planning", async () => {
    const capabilities = buildCapabilityRegistry([promptExpandSkill]);
    const toolRegistry = createRuntimeToolRegistry();
    const input = normalizeAgentInput({
      userId: "user-1",
      projectId: "project-1",
      runNodeId: "run-1",
      modelProvider: "deepseek",
      messages: [],
      canvasContext: {
        prompt: "帮我分析一个品牌的视觉风格，并做成 html 页面",
        selectedNodeId: null,
        upstreamContext: [],
      },
    });
    let modelRouterCalled = false;
    const intent = await routeIntent({
      capabilities,
      input,
      modelProvider: "deepseek",
      toolRegistry,
      async generateIntentResult() {
        modelRouterCalled = true;
        throw new Error("model router should not be called for compound page tasks");
      },
    });
    const context = buildContext({
      input,
      intent,
      publicSkills: [promptExpandSkill],
      runId: "agent-run-1",
      toolRegistry,
    });
    let modelPlannerCalled = false;
    const plan = await createPlan({
      context,
      intent,
      modelProvider: "deepseek",
      toolRegistry,
      async generatePlanSteps() {
        modelPlannerCalled = true;
        throw new Error("model planner should not be called for compound page tasks");
      },
    });

    expect(modelRouterCalled).toBe(false);
    expect(modelPlannerCalled).toBe(false);
    expect(intent).toMatchObject({
      primaryIntent: "multi_step.landing_page",
      requiredCapabilities: ["document.write", "html.generate"],
      requiredTools: [toolIds.writeDocument, toolIds.generateHtml],
      task: {
        kind: "multi_step",
        deliverables: [{ kind: "document" }, { kind: "webpage" }],
      },
    });
    expect(context.availableTools.map((tool) => tool.id)).toEqual([
      toolIds.writeDocument,
      toolIds.generateHtml,
    ]);
    expect(plan.normalizedPlan.map((step) => step.id)).toEqual([
      "agent_text",
      "write_report",
      "generate_html",
      "evaluate_result",
    ]);
    expect(plan.normalizedPlan.find((step) => step.id === "write_report"))
      .toMatchObject({
        toolId: toolIds.writeDocument,
        dependsOn: ["agent_text"],
        expectedArtifacts: [{ type: "doc", count: 1 }],
      });
    expect(plan.normalizedPlan.find((step) => step.id === "generate_html"))
      .toMatchObject({
        toolId: toolIds.generateHtml,
        dependsOn: ["write_report"],
        expectedArtifacts: [{ type: "webpage" }],
        expectedCanvasOperations: [],
      });
  });

  it("provides deterministic schema fixtures for common structured intents", () => {
    const capabilities = buildCapabilityRegistry([promptExpandSkill]);
    const baseRegistry = createTestToolRegistry();
    const canvasRegistry = new ToolRegistry([
      testTool(toolIds.analyzeReferenceImages, "image.generate"),
      testTool(toolIds.expandPrompt, "prompt.expand"),
      testTool(toolIds.generateImage, "image.generate"),
      testTool(toolIds.createCanvasNode, "canvas.mutate"),
    ] as never);
    const fixtures = [
      {
        name: "image_generation",
        prompt: "生成一张绿色黄瓜海报",
        registry: baseRegistry,
        upstreamContext: [],
        expected: { primaryIntent: "image_generation", taskKind: "image_generation" },
      },
      {
        name: "image_editing",
        prompt: "参考这张图继续生成一张海报",
        registry: baseRegistry,
        upstreamContext: [
          {
            nodeId: "image-1",
            type: "image" as const,
            imageUrl: "https://cdn.example/image.png",
          },
        ],
        selectedNodeId: "image-1",
        expected: { primaryIntent: "image_generation", taskKind: "image_editing" },
      },
      {
        name: "visual_style_analysis",
        prompt: "分析Gemini的视觉风格",
        registry: baseRegistry,
        upstreamContext: [],
        expected: {
          primaryIntent: "capability.route_missing",
          taskKind: "file_analysis",
        },
      },
      {
        name: "page_generation",
        prompt: "生成一个产品落地页",
        registry: baseRegistry,
        upstreamContext: [],
        expected: {
          primaryIntent: "capability.route_missing",
          taskKind: "page_generation",
        },
      },
      {
        name: "document_writing",
        prompt: "帮我写一份产品需求文档",
        registry: baseRegistry,
        upstreamContext: [],
        expected: {
          primaryIntent: "capability.route_missing",
          taskKind: "document_writing",
        },
      },
      {
        name: "web_research",
        prompt: "搜索网页并调研竞品",
        registry: baseRegistry,
        upstreamContext: [],
        expected: {
          primaryIntent: "capability.route_missing",
          taskKind: "web_research",
        },
      },
      {
        name: "file_analysis",
        prompt: "分析这个文件的内容",
        registry: baseRegistry,
        upstreamContext: [],
        expected: {
          primaryIntent: "capability.route_missing",
          taskKind: "file_analysis",
        },
      },
      {
        name: "code_modification",
        prompt: "修改代码并修复类型错误",
        registry: baseRegistry,
        upstreamContext: [],
        expected: {
          primaryIntent: "capability.route_missing",
          taskKind: "code_modification",
        },
      },
      {
        name: "canvas_operation",
        prompt: "在画布创建一个说明节点",
        registry: canvasRegistry,
        upstreamContext: [],
        expected: {
          primaryIntent: "canvas_operation",
          taskKind: "canvas_operation",
        },
      },
      {
        name: "multi_step",
        prompt: "根据网页和图片生成落地页并放到画布里",
        registry: baseRegistry,
        upstreamContext: [],
        expected: {
          primaryIntent: "capability.route_missing",
          taskKind: "multi_step",
        },
      },
    ];

    for (const fixture of fixtures) {
      const input = normalizeAgentInput({
        userId: "user-1",
        projectId: "project-1",
        runNodeId: `run-${fixture.name}`,
        modelProvider: "deepseek",
        messages: [],
        canvasContext: {
          prompt: fixture.prompt,
          selectedNodeId: fixture.selectedNodeId ?? null,
          upstreamContext: fixture.upstreamContext,
        },
      });
      const intent = routeIntentDeterministically({
        capabilities,
        input,
        toolRegistry: fixture.registry,
      });

      expect(intentResultSchema.parse(intent)).toMatchObject({
        primaryIntent: fixture.expected.primaryIntent,
        task: { kind: fixture.expected.taskKind },
      });
    }
  });

  it("does not expose all tools for unsupported complex tasks", () => {
    const capabilities = buildCapabilityRegistry([promptExpandSkill]);
    const toolRegistry = createTestToolRegistry();
    const input = normalizeAgentInput({
      userId: "user-1",
      projectId: "project-1",
      runNodeId: "run-1",
      modelProvider: "deepseek",
      messages: [],
      canvasContext: {
        prompt: "根据网页和图片生成落地页并放到画布里",
        selectedNodeId: null,
        upstreamContext: [],
      },
    });
    const intent = routeIntentDeterministically({
      capabilities,
      input,
      toolRegistry,
    });
    const context = buildContext({
      input,
      intent,
      publicSkills: [promptExpandSkill],
      runId: "agent-run-1",
      toolRegistry,
    });

    expect(intent.primaryIntent).toBe("capability.route_missing");
    expect(context.availableTools).toEqual([]);
    expect(context.trace.toolExposureReason).toContain("registry allowlist");
  });

  it("creates and validates the image generation plan", async () => {
    const capabilities = buildCapabilityRegistry([promptExpandSkill]);
    const toolRegistry = createTestToolRegistry();
    const input = normalizeAgentInput({
      userId: "user-1",
      projectId: "project-1",
      runNodeId: "run-1",
      modelProvider: "deepseek",
      messages: [],
      canvasContext: {
        prompt: "生成一张图",
        selectedNodeId: null,
        upstreamContext: [],
      },
    });
    const intent = routeIntentDeterministically({
      capabilities,
      input,
      toolRegistry,
    });
    const context = buildContext({
      input,
      intent,
      publicSkills: [promptExpandSkill],
      runId: "agent-run-1",
      toolRegistry,
    });
    let plannerPrompt = "";
    const plan = await createPlan({
      context,
      intent,
      modelProvider: "deepseek",
      toolRegistry,
      async generatePlanSteps(prompt) {
        plannerPrompt = prompt;
        return buildPlanFromIntentDeterministically(intent);
      },
    });

    expect(plannerPrompt).toContain("ALLOWED_TOOLS");
    expect(plannerPrompt).toContain(toolIds.expandPrompt);
    expect(plannerPrompt).toContain("promptParts");
    expect(plannerPrompt).toContain("runtime.selected-context");
    expect(plan.normalizedPlan.map((step) => step.id)).toEqual([
      "agent_text",
      "expand_prompt",
      "generate_image",
      "evaluate_result",
    ]);
    expect(
      plan.normalizedPlan.find((step) => step.id === "generate_image")
        ?.expectedCanvasOperations
    ).toEqual([
      {
        type: "attachArtifact",
        description: "Attach generated image artifact to the run branch.",
      },
    ]);
    expect(plan.validation.ok).toBe(true);
  });

  it("preserves requested image counts across intent and plan normalization", async () => {
    const capabilities = buildCapabilityRegistry([promptExpandSkill]);
    const toolRegistry = createTestToolRegistry();
    const input = normalizeAgentInput({
      userId: "user-1",
      projectId: "project-1",
      runNodeId: "run-1",
      modelProvider: "deepseek",
      messages: [],
      canvasContext: {
        prompt: "一次生成4张图片",
        selectedNodeId: null,
        upstreamContext: [],
      },
    });
    const intent = routeIntentDeterministically({
      capabilities,
      input,
      toolRegistry,
    });
    const context = buildContext({
      input,
      intent,
      publicSkills: [promptExpandSkill],
      runId: "agent-run-1",
      toolRegistry,
    });
    const rawPlan = buildPlanFromIntentDeterministically(intent).map((step) =>
      step.id === "generate_image"
        ? {
            ...step,
            expectedArtifacts: [
              { type: "image" as const, description: "Generated image" },
            ],
          }
        : step
    );
    const plan = await createPlan({
      context,
      intent,
      modelProvider: "deepseek",
      toolRegistry,
      async generatePlanSteps() {
        return rawPlan;
      },
    });

    expect(intent.task.deliverables).toContainEqual({
      kind: "image",
      description: "Generated image artifact attached to the run branch.",
      count: 4,
    });
    expect(
      plan.normalizedPlan.find((step) => step.id === "generate_image")
        ?.expectedArtifacts
    ).toEqual([
      { type: "image", description: "Generated image", count: 4 },
    ]);
  });

  it("builds image tool prompt traces from BuiltContext prompt parts", () => {
    const capabilities = buildCapabilityRegistry([promptExpandSkill]);
    const canvasContext = {
      prompt: "参考这张图生成海报",
      selectedNodeId: "image-1",
      upstreamContext: [
        {
          nodeId: "image-1",
          type: "image" as const,
          imageUrl: "https://cdn.example/image.png",
          summary: "绿色背景海报",
        },
      ],
    };
    const toolRegistry = buildToolRegistry({
      canvasContext,
      capabilities,
      modelProvider: "deepseek",
      projectId: "project-1",
      runNodeId: "run-1",
    });
    const input = normalizeAgentInput({
      userId: "user-1",
      projectId: "project-1",
      runNodeId: "run-1",
      modelProvider: "deepseek",
      messages: [],
      canvasContext,
    });
    const intent = routeIntentDeterministically({
      capabilities,
      input,
      toolRegistry,
    });
    const context = buildContext({
      input,
      intent,
      publicSkills: [promptExpandSkill],
      runId: "agent-run-1",
      toolRegistry,
    });
    const referenceTool = toolRegistry.requireTool(
      toolIds.analyzeReferenceImages
    );
    const expandTool = toolRegistry.requireTool(toolIds.expandPrompt);
    const referenceInput = referenceTool.prepareInput?.({
      context,
      previousSteps: [],
      step: buildToolStep("analyze_reference_images", referenceTool.id),
    }) as { promptTrace?: { selectedPromptPartIds?: string[] } };
    const expandInput = expandTool.prepareInput?.({
      context,
      previousSteps: [
        {
          id: "step-analyze_reference_images",
          planStepId: "analyze_reference_images",
          status: "success",
          output: {
            ok: true,
            data: { analysis: "视觉摘要" },
            artifacts: [],
            canvasOperations: [],
            logs: [],
          },
        },
      ],
      step: buildToolStep("expand_prompt", expandTool.id),
    }) as { promptTrace?: { selectedPromptPartIds?: string[] } };

    expect(referenceInput.promptTrace?.selectedPromptPartIds).toContain(
      "runtime.selected-context"
    );
    expect(expandInput.promptTrace?.selectedPromptPartIds).toContain(
      "runtime.selected-context"
    );
    expect(expandInput.promptTrace?.selectedPromptPartIds).toContain(
      "prompt-expand.skill-instructions"
    );
  });

  it("rejects a plan that references a non-exposed tool", () => {
    const toolRegistry = createTestToolRegistry();
    const context = buildTestContext(toolRegistry, [toolIds.expandPrompt]);

    const validation = validatePlanAgainstRegistry(
      [
        {
          id: "bad",
          title: "Bad",
          goal: "Use hidden tool",
          kind: "tool",
          toolId: toolIds.generateImage,
          dependsOn: [],
          expectedArtifacts: [],
          expectedCanvasOperations: [],
          risk: "low",
          approvalRequired: false,
        },
      ],
      toolRegistry,
      context
    );

    expect(validation.ok).toBe(false);
    expect(validation.errors.join(" ")).toContain("non-exposed");
  });

  it("rejects planner fixtures with unknown tools, cycles, missing input, and unauthorized canvas operations", () => {
    const strictToolId = "test.strict";
    const strictTool = testTool(
      strictToolId,
      "test.strict",
      z.object({ query: z.string().min(1) })
    );
    const toolRegistry = new ToolRegistry([
      testTool(toolIds.expandPrompt, "prompt.expand"),
      testTool(toolIds.generateImage, "image.generate"),
      strictTool,
    ] as never);
    const context = buildTestContext(toolRegistry, [
      toolIds.expandPrompt,
      toolIds.generateImage,
      strictToolId,
    ]);

    expect(
      validatePlanAgainstRegistry(
        [buildToolStep("unknown", "missing.tool")],
        toolRegistry,
        context
      ).errors.join(" ")
    ).toContain("unregistered tool");

    expect(
      validatePlanAgainstRegistry(
        [
          { ...buildToolStep("a", toolIds.expandPrompt), dependsOn: ["b"] },
          { ...buildToolStep("b", toolIds.expandPrompt), dependsOn: ["a"] },
        ],
        toolRegistry,
        context
      ).errors.join(" ")
    ).toContain("dependency cycle");

    expect(
      validatePlanAgainstRegistry(
        [buildToolStep("missing_input", strictToolId)],
        toolRegistry,
        context
      ).errors.join(" ")
    ).toContain("missing required input");

    expect(
      validatePlanAgainstRegistry(
        [
          {
            ...buildToolStep("unauthorized_canvas", toolIds.expandPrompt),
            expectedCanvasOperations: [
              {
                type: "createNode",
                description: "Create a node without a canvas proposal tool.",
              },
            ],
          },
        ],
        toolRegistry,
        context
      ).errors.join(" ")
    ).toContain("unauthorized canvas operation createNode");
  });

  it("exposes tool version and schema digests for trace metadata", () => {
    const toolRegistry = createTestToolRegistry();
    const tool = toolRegistry.requireTool(toolIds.expandPrompt);
    const summary = summarizeTool(tool);
    const metadata = getToolTraceMetadata(tool);

    expect(summary.version).toBe("test");
    expect(summary.inputSchemaDigest).toHaveLength(64);
    expect(summary.outputSchemaDigest).toHaveLength(64);
    expect(metadata).toMatchObject({
      toolId: toolIds.expandPrompt,
      capabilityId: "prompt.expand",
      toolDefinitionVersion: "test",
      inputSchemaDigest: summary.inputSchemaDigest,
      outputSchemaDigest: summary.outputSchemaDigest,
    });
  });

  it("registers canvas operation proposal tools with policy and render hints", () => {
    const registry = buildToolRegistry({
      canvasContext: {
        prompt: "生成图片",
        selectedNodeId: null,
        upstreamContext: [],
      },
      capabilities: buildCapabilityRegistry([promptExpandSkill]),
      modelProvider: "deepseek",
      projectId: "project-1",
      runNodeId: "run-1",
    });
    const canvasTools = [
      toolIds.createCanvasNode,
      toolIds.updateCanvasNode,
      toolIds.createCanvasEdge,
      toolIds.attachArtifact,
    ].map((toolId) => registry.requireTool(toolId));

    expect(canvasTools.map((tool) => tool.renderHint.kind)).toEqual([
      "canvas_operation",
      "canvas_operation",
      "canvas_operation",
      "canvas_operation",
    ]);
    expect(canvasTools.every((tool) => tool.policy.canModifyProject)).toBe(true);
  });
});

function createTestToolRegistry() {
  return new ToolRegistry([
    testTool(toolIds.analyzeReferenceImages, "image.generate"),
    testTool(toolIds.expandPrompt, "prompt.expand"),
    testTool(toolIds.generateImage, "image.generate"),
  ] as never);
}

function createRuntimeToolRegistry() {
  return buildToolRegistry({
    canvasContext: {
      prompt: "根据网页和图片生成落地页并放到画布里",
      selectedNodeId: null,
      upstreamContext: [],
    },
    capabilities: buildCapabilityRegistry([promptExpandSkill]),
    modelProvider: "deepseek",
    projectId: "project-1",
    runNodeId: "run-1",
  });
}

function buildTestContext(
  toolRegistry: ToolRegistry,
  exposedToolIds: string[]
): BuiltContext {
  return {
    runId: "agent-run-1",
    taskContext: "",
    selectedItems: [],
    omittedItems: [],
    availableTools: exposedToolIds.map((toolId) =>
      summarizeTool(toolRegistry.requireTool(toolId))
    ),
    injectedSkills: [],
    promptParts: [],
    tokenEstimate: 1,
    budget: { maxTokens: 10, usedTokens: 1, omittedTokens: 0 },
    trace: {
      selectedCount: 0,
      omittedCount: 0,
      toolExposureReason: "test",
      skillInjectionReason: "test",
    },
  };
}

function buildToolStep(id: string, toolId: string): PlanStep {
  return {
    id,
    title: id,
    goal: id,
    kind: "tool",
    toolId,
    dependsOn: [],
    expectedArtifacts: [],
    expectedCanvasOperations: [],
    risk: "low",
    approvalRequired: false,
  };
}

function createUnsupportedFixture(
  prompt: string,
  kind: StructuredTask["kind"]
): StructuredTask {
  return {
    kind,
    goals: [prompt],
    targets: [],
    constraints: [
      {
        kind: "policy",
        text: "Unsupported fixture for route guard test.",
      },
    ],
    deliverables: [{ kind: "analysis", description: "Capability report" }],
    operations: [],
  };
}

function testTool(
  id: string,
  capabilityId: string,
  inputSchema: z.ZodType = z.object({})
): ToolDefinition {
  const outputSchema = z.object({});
  return {
    id,
    version: "test",
    capabilityId,
    name: id,
    description: id,
    inputSchema,
    outputSchema,
    policy: {
      canUseNetwork: false,
      canWriteFiles: false,
      canModifyProject: false,
      requiresApproval: false,
      mayExternalCost: false,
    },
    timeoutMs: 1,
    retryPolicy: { maxRetries: 0, backoffMs: 0, retryableErrorCodes: [] },
    risk: "low",
    renderHint: { kind: "text", label: id },
    async execute() {
      return {
        ok: true,
        artifacts: [],
        canvasOperations: [],
        logs: [],
      };
    },
  };
}
