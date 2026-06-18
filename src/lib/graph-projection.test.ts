import { describe, expect, it } from "vitest";

import { projectRunTraceToCanvas } from "./graph-projection";
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

  it("projects pending image nodes from normalized image input before tool input", () => {
    const projection = projectRunTraceToCanvas({
      runNodeId: "run-1",
      events: [
        event("run.created", "run", { prompt: "生成两张 16:9 海报", promptNodeId: "prompt-1" }),
        event("input.normalized", "input", {
          normalizedInput: {
            rawPrompt: "生成两张 16:9 海报",
            operation: "create",
            artifact: { kind: "image", subtype: "poster", format: "png" },
            intent: "image.generate",
            image: {
              contentPrompt: "海报",
              resultCount: 2,
              aspectRatio: "16:9",
            },
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
            rawPrompt: "把这个图拓展两个尺寸",
            operation: "create",
            artifact: { kind: "image", format: "png" },
            requiredCapabilities: ["image-generation", "image-outpaint"],
            intent: "image.generate",
            image: {
              contentPrompt: "基于参考图扩展画布",
              resultCount: 2,
              variants: [
                { width: 1125, height: 450 },
                { width: 900, height: 1200 },
              ],
            },
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

  it("projects pending artifact nodes from normalized non-image input", () => {
    const projection = projectRunTraceToCanvas({
      runNodeId: "run-1",
      events: [
        event("run.created", "run", { prompt: "写一份 PRD", promptNodeId: "prompt-1" }),
        event("input.normalized", "input", {
          normalizedInput: {
            rawPrompt: "写一份 PRD",
            operation: "create",
            artifact: { kind: "document", subtype: "prd", format: "markdown" },
            intent: "document.create",
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

  it("reuses pending artifact nodes when the final artifact arrives", () => {
    const projection = projectRunTraceToCanvas({
      projectId: "project-1",
      runNodeId: "run-1",
      events: [
        event("run.created", "run", { prompt: "写一份 PRD", promptNodeId: "prompt-1" }),
        event("input.normalized", "input", {
          normalizedInput: {
            rawPrompt: "写一份 PRD",
            operation: "create",
            artifact: { kind: "document", subtype: "prd", format: "markdown" },
            intent: "document.create",
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
            { id: "document-create", label: "创建文档 artifact", phase: "execute" },
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
