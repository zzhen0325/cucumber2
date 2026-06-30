import { describe, expect, it } from "vitest";

import { projectRunTraceToCanvas } from "./graph-projection";
import type { AgentCanvasNode } from "@/types/canvas";
import type { AgentEvent, AgentEventType } from "@/types/runtime";

describe("agent event graph projection", () => {
  it("projects final text and image artifacts into the run graph", () => {
    const projection = projectRunTraceToCanvas({
      projectId: "project-1",
      runNodeId: "run-1",
      events: [
        event("run.created", "run", {
          prompt: "生成图片",
          promptNodeId: "prompt-1",
          selectedNodeId: null,
          runtime: "openai-agents-sdk",
        }),
        event("artifact.created", "generate_image", {
          artifact: {
            contentRef:
              "r2://agent-assets/projects/project-1/runs/run-1/artifacts/artifact-1.png",
            id: "artifact-1",
            type: "image",
            uri: "/api/projects/project-1/artifacts/artifact-1/content",
          },
        }),
        event("run.completed", "run", {
          finalOutput: "图片已生成",
          artifactIds: ["artifact-1"],
          status: "completed",
        }),
      ],
    });

    const run = projection.nodes.find((node) => node.id === "run-1");
    const image = projection.nodes.find((node) => node.data.kind === "imageResult");
    expect(run?.data).toMatchObject({
      kind: "run",
      status: "success",
      agentText: "图片已生成",
      outputKind: "artifact",
    });
    expect(image?.data).toMatchObject({
      kind: "imageResult",
      status: "ready",
      artifact: { id: "artifact-1" },
      image: {
        url: "/api/projects/project-1/artifacts/artifact-1/content",
      },
    });
  });

  it("projects agent, handoff, and tool lifecycle summaries", () => {
    const projection = projectRunTraceToCanvas({
      runNodeId: "run-1",
      events: [
        event("run.created", "run", { prompt: "生成图片", promptNodeId: "prompt-1" }),
        event("agent.active", "agent", { agentName: "Cucumber Manager" }),
        event("handoff.completed", "handoff", { toAgent: "Cucumber Image Agent" }),
        event("tool.input", "generate_image", {
          toolCallId: "call-1",
          toolName: "generate_image",
          input: { resultCount: 1 },
        }),
        event("tool.output", "generate_image", {
          toolCallId: "call-1",
          toolName: "generate_image",
          output: { generated: 1 },
        }),
      ],
    });
    const run = projection.nodes.find((node) => node.id === "run-1");

    expect(run?.data).toMatchObject({
      kind: "run",
      summaryItems: [
        { kind: "agent", detail: "Cucumber Manager" },
        { kind: "handoff", detail: "Cucumber Image Agent" },
      ],
      toolParts: [
        expect.objectContaining({
          type: "tool-generate_image",
          state: "output-available",
        }),
      ],
    });
  });

  it("projects run plans and current steps from trace events", () => {
    const projection = projectRunTraceToCanvas({
      runNodeId: "run-1",
      events: [
        event("run.created", "run", { prompt: "生成图片", promptNodeId: "prompt-1" }),
        event("input.normalized", "input", {
          normalizedInput: { intent: "image.generate", rawPrompt: "生成图片" },
        }),
        event("run.plan.created", "plan", {
          items: [
            { id: "prepare", label: "整理需求和上下文" },
            { id: "route", label: "选择合适的 Agent / 工具" },
            { id: "execute", label: "生成图片产物" },
            { id: "materialize", label: "写入画布结果" },
          ],
        }),
        event("tool.input", "generate_image", {
          toolCallId: "call-1",
          toolName: "generate_image",
          input: { prompt: "生成图片" },
        }),
      ],
    });
    const run = projection.nodes.find((node) => node.id === "run-1");

    expect(run?.data).toMatchObject({
      kind: "run",
      currentStep: {
        id: "generate_image",
        label: "generate_image",
        status: "running",
      },
      plan: [
        { id: "prepare", status: "success" },
        { id: "route", status: "success" },
        { id: "execute", status: "running" },
        { id: "materialize", status: "queued" },
      ],
    });
  });

  it("does not synthesize a fixed run plan when no plan event exists", () => {
    const projection = projectRunTraceToCanvas({
      runNodeId: "run-1",
      events: [
        event("run.created", "run", { prompt: "你好", promptNodeId: "prompt-1" }),
        event("input.normalized", "input", {
          normalizedInput: { intent: "text.answer", rawPrompt: "你好" },
        }),
      ],
    });
    const run = projection.nodes.find((node) => node.id === "run-1");

    expect(run?.data).toMatchObject({
      kind: "run",
      plan: [],
    });
  });

  it("uses requirement wording for routing and normalization run steps", () => {
    const projection = projectRunTraceToCanvas({
      runNodeId: "run-1",
      events: [
        event("run.created", "run", { prompt: "生成图片", promptNodeId: "prompt-1" }),
        event("run.step.completed", "quick.route", {
          label: "快速路由",
          phase: "prepare",
        }),
        event("run.step.started", "input.normalize", {
          label: "归一化用户输入",
          phase: "prepare",
        }),
      ],
    });
    const run = projection.nodes.find((node) => node.id === "run-1");

    expect(run?.data).toMatchObject({
      kind: "run",
      currentStep: {
        id: "input.normalize",
        label: "整理用户需求",
        status: "running",
      },
      stepTimeline: [
        { id: "quick.route", label: "整理用户需求", status: "success" },
        { id: "input.normalize", label: "整理用户需求", status: "running" },
      ],
    });
  });

  it("projects pending image nodes from normalized image input before tool input", () => {
    const projection = projectRunTraceToCanvas({
      runNodeId: "run-1",
      events: [
        event("run.created", "run", { prompt: "生成两张 16:9 海报", promptNodeId: "prompt-1" }),
        event("input.normalized", "input", {
          normalizedInput: {
            rawInput: "生成两张 16:9 海报",
            task: { domain: "image", intent: "image.generate", action: "create", confidence: 1 },
            routing: { primaryAgent: "image_agent", candidateAgents: [] },
            inputs: { text: "生成两张 16:9 海报", images: [], files: [] },
            constraints: {
              explicit: [
                { key: "output_count", value: "2", sourceText: "两张" },
                { key: "aspect_ratio", value: "16:9", sourceText: "16:9" },
              ],
              inferred: [],
            },
            ambiguities: [],
          },
        }),
      ],
    });

    const imageNodes = projection.nodes.filter(
      (node) => node.data.kind === "imageResult"
    );
    expect(imageNodes).toHaveLength(2);
    expect(imageNodes[0].data).toMatchObject({
      kind: "imageResult",
      status: "loading",
      request: { index: 1, count: 2, aspectRatio: "16:9" },
    });
  });

  it("projects pending image nodes with per-variant request metadata", () => {
    const projection = projectRunTraceToCanvas({
      runNodeId: "run-1",
      events: [
        event("run.created", "run", {
          prompt: "把这个图拓展两个尺寸",
          promptNodeId: "prompt-1",
        }),
        event("input.normalized", "input", {
          normalizedInput: {
            rawInput: "把这个图拓展两个尺寸",
            task: { domain: "image", intent: "image.generate image-outpaint", action: "create", confidence: 1 },
            routing: { primaryAgent: "image_agent", candidateAgents: [] },
            inputs: { text: "把这个图拓展两个尺寸", images: [], files: [] },
            constraints: {
              explicit: [
                { key: "dimension", value: "1125x450", sourceText: "1125x450" },
                { key: "dimension", value: "900x1200", sourceText: "900x1200" },
              ],
              inferred: [],
            },
            ambiguities: [],
          },
        }),
      ],
    });

    const imageNodes = projection.nodes.filter(
      (node) => node.data.kind === "imageResult"
    );
    expect(imageNodes).toHaveLength(2);
    expect(imageNodes.map((node) => node.data.kind === "imageResult" && node.data.request))
      .toEqual([
        { index: 1, count: 2, width: 1125, height: 450, aspectRatio: "5:2" },
        { index: 2, count: 2, width: 900, height: 1200, aspectRatio: "3:4" },
      ]);
  });

  it("does not project failed image nodes when image decomposition fails before generation starts", () => {
    const projection = projectRunTraceToCanvas({
      runNodeId: "run-1",
      events: [
        event("run.created", "run", {
          prompt: "分析参考图中的 IP 形象并生成 4 张图片",
          promptNodeId: "prompt-1",
        }),
        event("input.normalized", "input", {
          normalizedInput: {
            rawPrompt: "分析参考图中的 IP 形象并生成 4 张图片",
            operation: "create",
            artifact: { kind: "image", format: "png" },
            requiredCapabilities: ["image-decompose", "image-generation"],
            intent: "image.generate",
            image: {
              contentPrompt: "基于参考图中的 IP 形象生成图片",
              resultCount: 4,
              aspectRatio: "3:4",
            },
          },
        }),
        event(
          "tool.error",
          "decompose_image",
          {
            toolCallId: "call-decompose",
            toolName: "decompose_image",
            errorText:
              "tool_policy_rejected: decompose_image requires image-decompose.",
          },
          "tool_policy_rejected: decompose_image requires image-decompose."
        ),
        event(
          "run.failed",
          "run",
          {
            errorText:
              "tool_policy_rejected: decompose_image requires image-decompose.",
          },
          "tool_policy_rejected: decompose_image requires image-decompose."
        ),
      ],
    });

    expect(
      projection.nodes.some((node) => node.data.kind === "imageResult")
    ).toBe(false);
    expect(projection.nodes.find((node) => node.id === "run-1")?.data).toMatchObject({
      kind: "run",
      status: "error",
      toolParts: [
        expect.objectContaining({
          type: "tool-decompose_image",
          state: "output-error",
        }),
      ],
    });
  });

  it("projects pending artifact nodes from normalized non-image input", () => {
    const projection = projectRunTraceToCanvas({
      runNodeId: "run-1",
      events: [
        event("run.created", "run", { prompt: "写一份 PRD", promptNodeId: "prompt-1" }),
        event("input.normalized", "input", {
          normalizedInput: {
            rawInput: "写一份 PRD",
            task: { domain: "text", intent: "document.create", action: "create", confidence: 1 },
            routing: { primaryAgent: "document_agent", candidateAgents: [] },
            inputs: { text: "写一份 PRD", images: [], files: [] },
            constraints: { explicit: [], inferred: [] },
            ambiguities: [],
          },
        }),
      ],
    });

    const pendingDocument = projection.nodes.find(
      (node) => node.id === "markdown-pending-run-1-1"
    );
    expect(pendingDocument?.data).toMatchObject({
      kind: "markdown",
      artifact: {
        id: "pending-run-1-markdown-1",
        type: "doc",
        metadata: { pending: true },
      },
      runId: "run-1",
      summary: "正在生成，结果会自动写入这个节点。",
    });
    expect(
      projection.edges.some(
        (edge) => edge.source === "run-1" && edge.target === "markdown-pending-run-1-1"
      )
    ).toBe(true);
  });

  it("does not project pending markdown nodes for plain text answers", () => {
    const projection = projectRunTraceToCanvas({
      runNodeId: "run-1",
      events: [
        event("run.created", "run", { prompt: "你好", promptNodeId: "prompt-1" }),
        event("input.normalized", "input", {
          route: "chat_agent_task",
          normalizedInput: {
            rawInput: "你好",
            task: { domain: "text", intent: "text.answer", action: "analyze", confidence: 1 },
            routing: { primaryAgent: "manager_agent", candidateAgents: [] },
            inputs: { text: "你好", images: [], files: [] },
            constraints: { explicit: [], inferred: [] },
            ambiguities: [],
          },
        }),
      ],
    });

    expect(
      projection.nodes.some((node) => node.id.startsWith("markdown-pending-"))
    ).toBe(false);
    expect(
      projection.nodes.some((node) => node.data.kind === "markdown")
    ).toBe(false);
  });

  it("reuses pending artifact nodes when the final artifact arrives", () => {
    const projection = projectRunTraceToCanvas({
      projectId: "project-1",
      runNodeId: "run-1",
      events: [
        event("run.created", "run", { prompt: "写一份 PRD", promptNodeId: "prompt-1" }),
        event("input.normalized", "input", {
          normalizedInput: {
            rawInput: "写一份 PRD",
            task: { domain: "text", intent: "document.create", action: "create", confidence: 1 },
            routing: { primaryAgent: "document_agent", candidateAgents: [] },
            inputs: { text: "写一份 PRD", images: [], files: [] },
            constraints: { explicit: [], inferred: [] },
            ambiguities: [],
          },
        }),
        event("artifact.created", "create_text_artifact", {
          artifact: {
            id: "doc-1",
            type: "doc",
            title: "PRD",
            metadata: {
              format: "markdown",
              preview: "PRD 正文",
              summary: "PRD 摘要",
            },
          },
          toolName: "create_text_artifact",
        }),
      ],
    });

    const documentNodes = projection.nodes.filter(
      (node) => node.data.kind === "markdown"
    );
    expect(documentNodes).toHaveLength(1);
    expect(documentNodes[0]).toMatchObject({
      id: "markdown-pending-run-1-1",
      data: {
        kind: "markdown",
        artifact: { id: "doc-1" },
        content: "PRD 正文",
        summary: "PRD 摘要",
        title: "PRD",
      },
    });
  });

  it("renders text artifacts that carry preview fields at the artifact top level", () => {
    const projection = projectRunTraceToCanvas({
      projectId: "project-1",
      runNodeId: "run-1",
      events: [
        event("run.created", "run", {
          prompt: "帮我分析描述这个 IP 形象的特征",
          promptNodeId: "prompt-1",
        }),
        event("input.normalized", "input", {
          normalizedInput: {
            rawInput: "帮我分析描述这个 IP 形象的特征",
            task: { domain: "text", intent: "document.create", action: "create", confidence: 1 },
            routing: { primaryAgent: "document_agent", candidateAgents: [] },
            inputs: { text: "帮我分析描述这个 IP 形象的特征", images: [], files: [] },
            constraints: { explicit: [], inferred: [] },
            ambiguities: [],
          },
        }),
        event("artifact.created", "create_text_artifact", {
          artifact: {
            id: "text-1",
            mimeType: "text/markdown",
            preview: "# IP 形象特征分析\n\n这是最终报告正文。",
            previewKind: "markdown",
            sizeBytes: 128,
            summary: "IP 形象特征分析摘要",
            title: "上传IP形象特征分析报告",
            type: "doc",
            version: 1,
          },
          toolName: "create_text_artifact",
        }),
      ],
    });

    const documentNodes = projection.nodes.filter(
      (node) => node.data.kind === "markdown"
    );
    expect(documentNodes).toHaveLength(1);
    expect(documentNodes[0]).toMatchObject({
      id: "markdown-pending-run-1-1",
      data: {
        kind: "markdown",
        artifact: {
          id: "text-1",
          mimeType: "text/markdown",
          preview: "# IP 形象特征分析\n\n这是最终报告正文。",
          previewKind: "markdown",
          sizeBytes: 128,
          summary: "IP 形象特征分析摘要",
          version: 1,
        },
        content: "# IP 形象特征分析\n\n这是最终报告正文。",
        summary: "IP 形象特征分析摘要",
        title: "上传IP形象特征分析报告",
      },
    });
  });

  it("projects complete HTML artifact previews into webpage nodes", () => {
    const html =
      "<!doctype html><html><head><title>Guide</title></head><body><main>Guide</main></body></html>";
    const projection = projectRunTraceToCanvas({
      projectId: "project-1",
      runNodeId: "run-1",
      events: [
        event("run.created", "run", {
          prompt: "生成 HTML 页面",
          promptNodeId: "prompt-1",
        }),
        event("artifact.created", "create_text_artifact", {
          artifact: {
            id: "text-html-1",
            metadata: {
              format: "html",
              mimeType: "text/html",
              previewKind: "webpage",
              projectId: "project-1",
              sourceUrl: "https://example.com/guide",
              sourceToolName: "create_text_artifact",
            },
            mimeType: "text/html",
            preview: html,
            previewKind: "webpage",
            summary: "Guide",
            title: "Guide.html",
            type: "webpage",
            uri: "/api/projects/project-1/artifacts/text-html-1/content",
          },
          toolName: "create_text_artifact",
        }),
      ],
    });

    const webpage = projection.nodes.find((node) => node.data.kind === "webpage");
    expect(webpage).toMatchObject({
      id: "webpage-text-html-1",
      type: "webpageNode",
      height: 320,
      style: { height: 320, width: 420 },
      width: 420,
      data: {
        kind: "webpage",
        html,
        sourceUrl: "https://example.com/guide",
        artifact: {
          id: "text-html-1",
          metadata: expect.objectContaining({ projectId: "project-1" }),
        },
      },
    });
  });

  it("keeps explicit text artifact node dimensions during re-projection", () => {
    const existingMarkdown: AgentCanvasNode = {
      id: "markdown-text-1",
      type: "markdownNode",
      position: { x: 10, y: 20 },
      width: 560,
      height: 420,
      style: { width: 560, height: 420 },
      data: {
        kind: "markdown",
        artifact: { id: "text-1", type: "doc" },
        content: "old",
        title: "Agent reply",
      },
    };
    const projection = projectRunTraceToCanvas({
      existingNodes: [existingMarkdown],
      runNodeId: "run-1",
      events: [
        event("run.created", "run", {
          prompt: "生成文档",
          promptNodeId: "prompt-1",
        }),
        event("artifact.created", "create_text_artifact", {
          artifact: {
            id: "text-1",
            metadata: {
              format: "markdown",
              preview: "# 新内容",
              previewKind: "markdown",
            },
            title: "Agent reply",
            type: "doc",
          },
        }),
      ],
    });

    const markdown = projection.nodes.find((node) => node.id === "markdown-text-1");
    expect(markdown).toMatchObject({
      position: { x: 10, y: 20 },
      width: 560,
      height: 420,
      style: { width: 560, height: 420 },
      data: {
        kind: "markdown",
        content: "# 新内容",
      },
    });
  });

  it("projects task-specific plan item phases", () => {
    const projection = projectRunTraceToCanvas({
      runNodeId: "run-1",
      events: [
        event("run.created", "run", { prompt: "写文档", promptNodeId: "prompt-1" }),
        event("input.normalized", "input", {
          normalizedInput: { intent: "document.create", rawPrompt: "写文档" },
        }),
        event("run.plan.created", "plan", {
          items: [
            { id: "document-brief", label: "梳理文档目标和上游素材", phase: "prepare" },
            { id: "document-agent", label: "委派 Document Agent", phase: "route" },
            { id: "document-create", label: "创建文档内容", phase: "execute" },
            { id: "document-materialize", label: "投影为画布文档节点", phase: "materialize" },
          ],
        }),
        event("tool.input", "create_text_artifact", {
          toolCallId: "call-1",
          toolName: "create_text_artifact",
          input: { title: "文档" },
        }),
      ],
    });
    const run = projection.nodes.find((node) => node.id === "run-1");

    expect(run?.data).toMatchObject({
      kind: "run",
      plan: [
        { id: "document-brief", status: "success" },
        { id: "document-agent", status: "success" },
        { id: "document-create", status: "running" },
        { id: "document-materialize", status: "queued" },
      ],
    });
  });

  it("keeps prompt expansion and image generation as separate visible tools", () => {
    const projection = projectRunTraceToCanvas({
      projectId: "project-1",
      runNodeId: "run-1",
      events: [
        event("run.created", "run", {
          prompt: "黄瓜海报",
          promptNodeId: "prompt-1",
        }),
        event("tool.input", "expand_image_prompt", {
          toolCallId: "call-expand",
          toolName: "expand_image_prompt",
          input: { prompt: "黄瓜海报" },
        }),
        event("tool.output", "expand_image_prompt", {
          toolCallId: "call-expand",
          toolName: "expand_image_prompt",
          output: {
            expandedPrompt:
              "一张清爽的黄瓜饮品海报，16:9 横版构图，明亮自然光。",
            skillId: "skill-1",
            skillName: "imagegen-prompt-expander",
          },
        }),
        event("tool.input", "generate_image", {
          toolCallId: "call-image",
          toolName: "generate_image",
          input: {
            prompt: "一张清爽的黄瓜饮品海报，16:9 横版构图，明亮自然光。",
            resultCount: 1,
          },
        }),
        event("artifact.created", "generate_image", {
          artifact: {
            id: "artifact-1",
            metadata: {
              prompt: "一张清爽的黄瓜饮品海报，16:9 横版构图，明亮自然光。",
              sourcePrompt: "黄瓜海报",
            },
            type: "image",
            uri: "/api/projects/project-1/artifacts/artifact-1/content",
          },
        }),
        event("run.completed", "run", {
          finalOutput: "图片已生成",
          artifactIds: ["artifact-1"],
        }),
      ],
    });
    const run = projection.nodes.find((node) => node.id === "run-1");
    const image = projection.nodes.find((node) => node.data.kind === "imageResult");

    expect(run?.data).toMatchObject({
      kind: "run",
      toolParts: [
        expect.objectContaining({
          type: "tool-expand_image_prompt",
          state: "output-available",
        }),
        expect.objectContaining({
          type: "tool-generate_image",
          state: "input-available",
        }),
      ],
    });
    expect(image?.data).toMatchObject({
      kind: "imageResult",
      prompt: "一张清爽的黄瓜饮品海报，16:9 横版构图，明亮自然光。",
      request: expect.objectContaining({ aspectRatio: "16:9" }),
    });
    expect(image).toMatchObject({
      width: 240,
      height: 135,
      style: {
        width: 240,
        height: 135,
      },
    });
  });

  it("keeps streamed text when tool input arrives", () => {
    const projection = projectRunTraceToCanvas({
      runNodeId: "run-1",
      streamedAgentTextByRunId: new Map([["run-1", "我会先理解需求，再调用工具。"]]),
      events: [
        event("run.created", "run", { prompt: "生成图片", promptNodeId: "prompt-1" }),
        event("tool.input", "generate_image", {
          toolCallId: "call-1",
          toolName: "generate_image",
          input: { prompt: "green cucumber" },
        }),
      ],
    });
    const run = projection.nodes.find((node) => node.id === "run-1");

    expect(run?.data).toMatchObject({
      kind: "run",
      status: "running",
      agentText: "我会先理解需求，再调用工具。",
    });
  });

  it("projects persisted agent message deltas while the run is active", () => {
    const projection = projectRunTraceToCanvas({
      runNodeId: "run-1",
      events: [
        event("run.created", "run", { prompt: "生成图片", promptNodeId: "prompt-1" }),
        event("agent.active", "agent", { agentName: "Cucumber Manager" }),
        event("agent.message.delta", "agent-message", {
          agentName: "Cucumber Manager",
          delta: "我会先整理需求，",
          index: 0,
          messageId: "message-1",
          role: "assistant",
        }),
        event("agent.message.delta", "agent-message", {
          agentName: "Cucumber Manager",
          delta: "再调用图片工具。",
          index: 1,
          messageId: "message-1",
          role: "assistant",
        }),
      ],
    });
    const run = projection.nodes.find((node) => node.id === "run-1");

    expect(run?.data).toMatchObject({
      kind: "run",
      status: "running",
      agentText: "Cucumber Manager\n我会先整理需求，再调用图片工具。",
      agentMessages: [
        {
          agentName: "Cucumber Manager",
          content: "我会先整理需求，再调用图片工具。",
          id: "message-1",
          role: "assistant",
          status: "streaming",
        },
      ],
    });
  });

  it("keeps completed agent messages visible on failed runs", () => {
    const projection = projectRunTraceToCanvas({
      runNodeId: "run-1",
      events: [
        event("run.created", "run", { prompt: "生成图片", promptNodeId: "prompt-1" }),
        event("agent.message.completed", "agent-message", {
          agentName: "Image Agent",
          content: "我已经准备好提示词，开始调用 Seedream。",
          messageId: "message-1",
          role: "assistant",
        }),
        event("tool.error", "generate_image", {
          toolCallId: "call-1",
          toolName: "generate_image",
          errorText: "Seedream missing",
        }, "Seedream missing"),
        event("run.failed", "run", { errorText: "Seedream missing" }, "Seedream missing"),
      ],
    });
    const run = projection.nodes.find((node) => node.id === "run-1");

    expect(run?.data).toMatchObject({
      kind: "run",
      status: "error",
      agentText: "Image Agent\n我已经准备好提示词，开始调用 Seedream。",
      agentMessages: [
        expect.objectContaining({
          agentName: "Image Agent",
          content: "我已经准备好提示词，开始调用 Seedream。",
          status: "completed",
        }),
      ],
    });
  });

  it("keeps reasoning progress visible without making it the final run text", () => {
    const projection = projectRunTraceToCanvas({
      runNodeId: "run-1",
      events: [
        event("run.created", "run", { prompt: "生成图片", promptNodeId: "prompt-1" }),
        event("agent.message.completed", "agent-message", {
          agentName: "Image Agent",
          content: "正在整理画面要求和参考图。",
          messageId: "progress-1",
          messageKind: "progress",
          role: "assistant",
        }),
        event("agent.message.completed", "agent-message", {
          agentName: "Image Agent",
          content: "已生成图片。",
          messageId: "message-1",
          messageKind: "assistant",
          role: "assistant",
        }),
        event("run.completed", "run", {
          artifactIds: [],
          finalOutput: "已生成图片。",
        }),
      ],
    });
    const run = projection.nodes.find((node) => node.id === "run-1");

    expect(run?.data).toMatchObject({
      kind: "run",
      status: "success",
      agentText: "已生成图片。",
      agentMessages: [
        expect.objectContaining({
          content: "正在整理画面要求和参考图。",
          kind: "progress",
        }),
        expect.objectContaining({
          content: "已生成图片。",
          kind: "assistant",
        }),
      ],
    });
  });

  it("does not promote lone reasoning progress to run text", () => {
    const projection = projectRunTraceToCanvas({
      runNodeId: "run-1",
      events: [
        event("run.created", "run", { prompt: "生成图片", promptNodeId: "prompt-1" }),
        event("agent.message.delta", "agent-message", {
          agentName: "Image Agent",
          delta: "正在整理画面要求和参考图。",
          index: 0,
          messageId: "progress-1",
          messageKind: "progress",
          role: "assistant",
        }),
      ],
    });
    const run = projection.nodes.find((node) => node.id === "run-1");

    expect(run?.data).toMatchObject({
      kind: "run",
      status: "running",
      agentMessages: [
        expect.objectContaining({
          content: "正在整理画面要求和参考图。",
          kind: "progress",
        }),
      ],
    });
    expect(run?.data.kind === "run" ? run.data.agentText : null).toBeUndefined();
  });

  it("maps legacy reasoning source messages to progress", () => {
    const projection = projectRunTraceToCanvas({
      runNodeId: "run-1",
      events: [
        event("run.created", "run", { prompt: "生成图片", promptNodeId: "prompt-1" }),
        event("agent.message.delta", "agent-message", {
          agentName: "Image Agent",
          delta: "正在整理画面要求和参考图。",
          index: 0,
          messageId: "legacy-reasoning-1",
          messageKind: "assistant",
          role: "assistant",
          source: "reasoning_summary",
        }),
      ],
    });
    const run = projection.nodes.find((node) => node.id === "run-1");

    expect(run?.data).toMatchObject({
      kind: "run",
      agentMessages: [
        expect.objectContaining({
          content: "正在整理画面要求和参考图。",
          kind: "progress",
        }),
      ],
    });
    expect(run?.data.kind === "run" ? run.data.agentText : null).toBeUndefined();
  });

  it("uses terminal final output instead of completed agent chatter", () => {
    const projection = projectRunTraceToCanvas({
      runNodeId: "run-1",
      events: [
        event("run.created", "run", { prompt: "生成4张图片", promptNodeId: "prompt-1" }),
        event("agent.message.completed", "agent-message", {
          agentName: "Image Agent",
          content: "我会先扩展描述，再调用图片生成工具。",
          messageId: "message-1",
          messageKind: "assistant",
          role: "assistant",
        }),
        event("artifact.created", "generate_image", {
          artifact: {
            id: "artifact-1",
            type: "image",
            uri: "/api/projects/project-1/artifacts/artifact-1/content",
          },
        }),
        event("agent.message.completed", "agent-message", {
          agentName: "Image Agent",
          content: "任务已完成，我将告知用户结果。图片已生成。",
          messageId: "message-2",
          messageKind: "assistant",
          role: "assistant",
        }),
        event("run.completed", "run", {
          artifactIds: ["artifact-1"],
          finalOutput: "图片已生成，结果已展示在画布上。",
        }),
      ],
    });
    const run = projection.nodes.find((node) => node.id === "run-1");

    expect(run?.data).toMatchObject({
      kind: "run",
      status: "success",
      agentText: "图片已生成，结果已展示在画布上。",
      outputKind: "artifact",
    });
  });

  it("replays persisted traces without streamed text", () => {
    const projection = projectRunTraceToCanvas({
      runNodeId: "run-1",
      events: [
        event("run.created", "run", { prompt: "生成图片", promptNodeId: "prompt-1" }),
        event("run.completed", "run", {
          finalOutput: "历史最终输出",
          artifactIds: [],
        }),
      ],
    });
    const run = projection.nodes.find((node) => node.id === "run-1");

    expect(run?.data).toMatchObject({
      kind: "run",
      status: "success",
      agentText: "历史最终输出",
      outputKind: "simple",
    });
  });

  it("keeps simple text replies in the run node", () => {
    const projection = projectRunTraceToCanvas({
      runNodeId: "run-1",
      events: [
        event("run.created", "run", {
          prompt: "黄瓜是什么？",
          promptNodeId: "prompt-new",
          selectedNodeId: null,
        }),
        event("run.completed", "run", {
          finalOutput: "黄瓜是一种常见的葫芦科蔬菜。",
          artifactIds: [],
        }),
      ],
    });
    const inputPrompt = projection.nodes.find((node) => node.id === "prompt-new");
    const runNode = projection.nodes.find((node) => node.id === "run-1");

    expect(inputPrompt?.data).toMatchObject({
      kind: "prompt",
      prompt: "黄瓜是什么？",
    });
    expect(inputPrompt?.data).not.toHaveProperty("response");
    expect(runNode?.data).toMatchObject({
      kind: "run",
      status: "success",
      agentText: "黄瓜是一种常见的葫芦科蔬菜。",
      outputKind: "simple",
    });
    expect(
      projection.nodes.find((node) => node.id === "prompt-result-run-1")
    ).toBeUndefined();
    expect(
      projection.edges.find(
        (edge) => edge.source === "run-1" && edge.target === "prompt-result-run-1"
      )
    ).toBeUndefined();
  });

  it("ignores legacy final_output artifacts for simple text replies", () => {
    const projection = projectRunTraceToCanvas({
      projectId: "project-1",
      runNodeId: "run-1",
      events: [
        event("run.created", "run", {
          prompt: "哈喽",
          promptNodeId: "prompt-1",
        }),
        event("artifact.created", "final_output", {
          artifact: {
            id: "legacy-text-1",
            metadata: {
              format: "markdown",
              preview: "你好呀",
              sourceRunNodeId: "run-1",
              sourceToolName: "final_output",
            },
            title: "Agent reply",
            type: "doc",
          },
          toolName: "final_output",
        }),
        event("run.completed", "run", {
          artifactIds: ["legacy-text-1"],
          finalOutput: "你好呀",
        }),
      ],
    });

    expect(
      projection.nodes.find((node) => node.id === "markdown-legacy-text-1")
    ).toBeUndefined();
    expect(projection.nodes.find((node) => node.id === "run-1")?.data).toMatchObject({
      kind: "run",
      agentText: "你好呀",
      outputKind: "simple",
      status: "success",
    });
  });

  it("does not create a prompt result node for artifact task final text", () => {
    const projection = projectRunTraceToCanvas({
      projectId: "project-1",
      runNodeId: "run-1",
      events: [
        event("run.created", "run", {
          prompt: "生成图片",
          promptNodeId: "prompt-1",
          selectedNodeId: null,
        }),
        event("artifact.created", "generate_image", {
          artifact: {
            id: "artifact-2",
            type: "image",
            uri: "/api/projects/project-1/artifacts/artifact-2/content",
          },
        }),
        event("run.completed", "run", {
          finalOutput: "图片已生成",
          artifactIds: ["artifact-2"],
        }),
      ],
    });
    const promptResult = projection.nodes.find(
      (node) => node.id === "prompt-result-run-1"
    );

    expect(promptResult).toBeUndefined();
  });

  it("uses streamed text without tool status placeholders while running", () => {
    const projection = projectRunTraceToCanvas({
      runNodeId: "run-1",
      streamedAgentTextByRunId: new Map([["run-1", "实时模型文字"]]),
      events: [
        event("run.created", "run", { prompt: "分析", promptNodeId: "prompt-1" }),
      ],
    });
    const run = projection.nodes.find((node) => node.id === "run-1");

    expect(run?.data).toMatchObject({
      kind: "run",
      status: "running",
      agentText: "实时模型文字",
    });
  });

  it("projects tool failures and run errors", () => {
    const projection = projectRunTraceToCanvas({
      runNodeId: "run-1",
      events: [
        event("run.created", "run", { prompt: "生成图片", promptNodeId: "prompt-1" }),
        event("tool.error", "generate_image", {
          toolCallId: "call-1",
          toolName: "generate_image",
          errorText: "Seedream missing",
        }, "Seedream missing"),
        event("run.failed", "run", { errorText: "Seedream missing" }, "Seedream missing"),
      ],
    });
    const run = projection.nodes.find((node) => node.id === "run-1");

    expect(run?.data).toMatchObject({
      kind: "run",
      status: "error",
      error: "Seedream 调用失败：Seedream missing",
      toolParts: [expect.objectContaining({ state: "output-error" })],
    });
  });

  it("summarizes trace persistence failures separately from model failures", () => {
    const projection = projectRunTraceToCanvas({
      runNodeId: "run-1",
      events: [
        event("run.created", "run", { prompt: "分析", promptNodeId: "prompt-1" }),
        event("run.failed", "run", {
          errorCode: "agent_trace_persistence_failed",
          errorSource: "trace_storage",
          errorText:
            'new row for relation "agent_run_events" violates check constraint "agent_run_events_type_check"',
        }),
      ],
    });

    expect(projection.nodes.find((node) => node.id === "run-1")?.data).toMatchObject({
      kind: "run",
      status: "error",
      error: "Trace 存储失败。",
    });
  });

  it("does not project duplicate image nodes for the same artifact id", () => {
    const artifact = {
      id: "artifact-dup",
      type: "image",
      uri: "/api/projects/project-1/artifacts/artifact-dup/content",
    };
    const projection = projectRunTraceToCanvas({
      projectId: "project-1",
      runNodeId: "run-1",
      events: [
        event("run.created", "run", {
          prompt: "生成图片",
          promptNodeId: "prompt-1",
        }),
        event("tool.input", "generate_image", {
          toolCallId: "call-1",
          toolName: "generate_image",
          input: { prompt: "生成图片", resultCount: 1 },
        }),
        event("artifact.created", "generate_image", { artifact }),
        event("artifact.created", "generate_image", { artifact }),
      ],
    });

    const imageNodes = projection.nodes.filter(
      (node) => node.data.kind === "imageResult"
    );
    expect(imageNodes).toHaveLength(1);
    expect(imageNodes[0].data).toMatchObject({
      kind: "imageResult",
      image: { id: "artifact-dup" },
    });
  });

  it("projects markdown artifacts as typed content nodes", () => {
    const projection = projectRunTraceToCanvas({
      projectId: "project-1",
      runNodeId: "run-1",
      events: [
        event("run.created", "run", {
          prompt: "总结画布",
          promptNodeId: "prompt-1",
        }),
        event("artifact.created", "create_text_artifact", {
          artifact: {
            contentRef:
              "r2://agent-assets/projects/project-1/runs/run-1/artifacts/text-1.md",
            id: "text-1",
            metadata: {
              byteSize: 42,
              digest: "sha256:abc",
              format: "markdown",
              mimeType: "text/markdown",
              preview: "# 总结\n\n这是一个 markdown 结果。",
              previewKind: "markdown",
              sourceRunNodeId: "run-1",
              sourceToolName: "create_text_artifact",
            },
            title: "Agent reply",
            type: "doc",
          },
        }),
        event("run.completed", "run", {
          finalOutput: "# 总结\n\n这是一个 markdown 结果。",
          artifactIds: ["text-1"],
        }),
      ],
    });

    const markdown = projection.nodes.find((node) => node.data.kind === "markdown");
    expect(markdown).toMatchObject({
      id: "markdown-text-1",
      type: "markdownNode",
      height: 360,
      style: { height: 360, width: 420 },
      width: 420,
      data: {
        kind: "markdown",
        content: "# 总结\n\n这是一个 markdown 结果。",
        artifact: {
          id: "text-1",
          metadata: expect.objectContaining({
            digest: "sha256:abc",
            sourceToolName: "create_text_artifact",
          }),
        },
      },
    });
  });

  it("does not leave pending image placeholders for aborted runs", () => {
    const projection = projectRunTraceToCanvas({
      runNodeId: "run-1",
      events: [
        event("run.created", "run", {
          prompt: "生成图片",
          promptNodeId: "prompt-1",
        }),
        event("tool.input", "generate_image", {
          toolCallId: "call-1",
          toolName: "generate_image",
          input: { prompt: "生成图片", resultCount: 1 },
        }),
        event("run.failed", "run", {
          errorCode: "agent_run_aborted",
          errorSource: "user",
          errorText: "Run stopped by user.",
        }),
      ],
    });

    expect(
      projection.nodes.some((node) => node.data.kind === "imageResult")
    ).toBe(false);
    expect(projection.nodes.find((node) => node.id === "run-1")?.data).toMatchObject({
      kind: "run",
      status: "error",
      error: "运行已停止。",
    });
  });

  it("applies validated canvas operations", () => {
    const projection = projectRunTraceToCanvas({
      projectId: "project-1",
      runNodeId: "run-1",
      events: [
        event("run.created", "run", { prompt: "创建便签", promptNodeId: "prompt-1" }),
        event("canvas.operation.applied", "propose_canvas_operations", {
          operation: {
            id: "op-1",
            projectId: "project-1",
            type: "createNode",
            payload: {
              node: {
                id: "note-1",
                type: "stickyNoteNode",
                position: { x: 500, y: 300 },
                data: {
                  kind: "stickyNote",
                  text: "完成",
                  color: "yellow",
                  createdAt: "2026-06-11T00:00:00.000Z",
                },
              },
            },
          },
        }),
      ],
    });

    expect(projection.nodes.some((node) => node.id === "note-1")).toBe(true);
    expect(projection.rejectedPatches).toEqual([]);
  });
});

function event(
  type: AgentEventType,
  stepId: string,
  payload: Record<string, unknown>,
  errorText?: string
): AgentEvent {
  return {
    projectId: "project-1",
    runNodeId: "run-1",
    stepId,
    type,
    payload,
    errorText,
    createdAt: `2026-06-11T00:00:${String(sequence++).padStart(2, "0")}.000Z`,
  };
}

let sequence = 0;
