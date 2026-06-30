// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RunNodeView } from "./RunNodeView";
import type { RunNodeData } from "@/types/canvas";

describe("RunNodeView", () => {
  beforeEach(() => {
    class MockResizeObserver {
      observe = vi.fn();
      disconnect = vi.fn();
    }

    globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
  });

  afterEach(() => {
    cleanup();
  });

  it("expands active runs by default", () => {
    renderRunNode({
      status: "queued",
    });

    expect(screen.getByLabelText("Agent run stream")).toBeTruthy();
    expect(screen.getByRole("button", { name: "收起输出" }).getAttribute(
      "aria-expanded"
    )).toBe("true");
    expect(screen.getAllByText("等待服务响应")).toHaveLength(2);
  });

  it("keeps tool and skill calls collapsed when the run is expanded", () => {
    renderRunNode({
      status: "running",
      toolParts: [
        {
          input: { skillName: "visual-prompt-cookbook" },
          output: { skillName: "visual-prompt-cookbook" },
          state: "output-available",
          toolCallId: "tool-1",
          type: "tool-activate_skill",
        },
      ],
    });

    expect(screen.getByText("激活技能")).toBeTruthy();
    expect(screen.queryByText("参数")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "激活技能完成" }));

    expect(screen.getByText("参数")).toBeTruthy();
  });

  it("collapses automatically when artifact generation succeeds", async () => {
    const { rerender } = renderRunNode({
      agentText: "正在生成",
      outputKind: "artifact",
      status: "running",
    });

    expect(screen.getByLabelText("Agent run stream")).toBeTruthy();

    rerender(
      <RunNodeHarness
        data={{
          agentText: "完成",
          kind: "run",
          outputKind: "artifact",
          prompt: "生成图片",
          status: "success",
        }}
      />
    );

    await waitFor(() => {
      expect(screen.queryByLabelText("Agent run stream")).toBeNull();
    });
    expect(screen.getByRole("button", { name: "展开输出" }).getAttribute(
      "aria-expanded"
    )).toBe("false");
  });

  it("keeps simple text output expanded when generation succeeds", async () => {
    const { rerender } = renderRunNode({
      agentText: "正在分析",
      status: "running",
    });

    rerender(
      <RunNodeHarness
        data={{
          agentText: "黄瓜是一种常见的葫芦科蔬菜。",
          kind: "run",
          outputKind: "simple",
          prompt: "黄瓜是什么？",
          status: "success",
        }}
      />
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Agent run stream")).toBeTruthy();
    });
    expect(screen.getByText("黄瓜是一种常见的葫芦科蔬菜。")).toBeTruthy();
    expect(screen.getByRole("button", { name: "收起输出" }).getAttribute(
      "aria-expanded"
    )).toBe("true");
  });

  it("expands persisted simple text output by default", () => {
    renderRunNode({
      agentText: "黄瓜是一种常见的葫芦科蔬菜。",
      outputKind: "simple",
      status: "success",
    });

    expect(screen.getByLabelText("Agent run stream")).toBeTruthy();
    expect(screen.getByText("黄瓜是一种常见的葫芦科蔬菜。")).toBeTruthy();
  });

  it("renders persisted agent message dialogue", () => {
    renderRunNode({
      agentMessages: [
        {
          agentName: "Image Agent",
          content: "我会先整理画面要求，然后调用图片工具。",
          id: "message-1",
          role: "assistant",
          status: "completed",
        },
      ],
      agentText: "Image Agent\n我会先整理画面要求，然后调用图片工具。",
      status: "running",
    });

    expect(screen.getByLabelText("Agent 对话")).toBeTruthy();
    expect(screen.getByText("Image Agent")).toBeTruthy();
    expect(screen.getByText("我会先整理画面要求，然后调用图片工具。")).toBeTruthy();
  });

  it("renders reasoning progress with the reasoning component", () => {
    renderRunNode({
      agentMessages: [
        {
          agentName: "Image Agent",
          content: "正在整理画面要求和参考图。",
          id: "progress-1",
          kind: "progress",
          role: "assistant",
          status: "streaming",
        },
      ],
      status: "running",
    });

    expect(screen.getByLabelText("Agent 推理")).toBeTruthy();
    expect(screen.getByRole("button", { name: /推理过程/ })).toBeTruthy();
    expect(screen.getByText("正在整理画面要求和参考图。")).toBeTruthy();
    expect(screen.queryByText("进展中")).toBeNull();
    expect(screen.queryByLabelText("Agent 对话")).toBeNull();
  });

  it("keeps completed reasoning collapsed under final output", () => {
    renderRunNode({
      agentMessages: [
        {
          agentName: "Image Agent",
          content: "正在整理画面要求和参考图。",
          id: "progress-1",
          kind: "progress",
          role: "assistant",
          status: "completed",
        },
      ],
      agentText: "图片已生成，结果已展示在画布上。",
      outputKind: "simple",
      status: "success",
    });

    expect(screen.getByText("图片已生成，结果已展示在画布上。")).toBeTruthy();
    expect(screen.queryByText("正在整理画面要求和参考图。")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /推理过程/ }));

    expect(screen.getByText("正在整理画面要求和参考图。")).toBeTruthy();
  });

  it("renders separate process text under final output as reasoning", () => {
    renderRunNode({
      agentMessages: [
        {
          agentName: "Image Agent",
          content: "用户询问 Agent Canvas 的定义，我将给出准确简洁的解释。",
          id: "message-1",
          role: "assistant",
          status: "completed",
        },
      ],
      agentText: "Agent Canvas 是面向多智能体协作的统一可视化工作空间。",
      outputKind: "simple",
      status: "success",
    });

    expect(
      screen.getByText("Agent Canvas 是面向多智能体协作的统一可视化工作空间。")
    ).toBeTruthy();
    expect(
      screen.queryByText("用户询问 Agent Canvas 的定义，我将给出准确简洁的解释。")
    ).toBeNull();
    expect(screen.queryByLabelText("Agent 对话")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /推理过程/ }));

    expect(
      screen.getByText("用户询问 Agent Canvas 的定义，我将给出准确简洁的解释。")
    ).toBeTruthy();
  });

  it("renders execution details as a task under the agent conversation", () => {
    renderRunNode({
      agentMessages: [
        {
          agentName: "Image Agent",
          content: "我会先整理画面要求，然后调用图片工具。",
          id: "message-1",
          role: "assistant",
          status: "completed",
        },
      ],
      status: "running",
      summaryItems: [
        {
          kind: "agent",
          label: "Agent",
          detail: "Cucumber Manager -> Image Agent",
        },
        {
          kind: "artifact",
          label: "产物",
          detail: "1 image",
        },
      ],
      plan: [
        { id: "prepare", label: "整理需求和上下文", status: "success" },
        { id: "execute", label: "生成图片产物", status: "running" },
      ],
    });

    expect(screen.getByLabelText("Agent 执行")).toBeTruthy();
    expect(screen.getByRole("button", { name: /执行计划/ })).toBeTruthy();
    expect(screen.getByText("Cucumber Manager -> Image Agent")).toBeTruthy();
    expect(screen.queryByText("1 image")).toBeNull();
    expect(
      screen
        .getByText("我会先整理画面要求，然后调用图片工具。")
        .compareDocumentPosition(screen.getByText("1/2 已完成")) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("shows plan items in the task", () => {
    renderRunNode({
      currentStep: {
        id: "generate_image",
        label: "生成图片产物",
        status: "running",
      },
      plan: [
        { id: "prepare", label: "整理需求和上下文", status: "success" },
        { id: "execute", label: "生成图片产物", status: "running" },
      ],
      status: "running",
    });

    expect(screen.getAllByText("生成图片产物").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Agent 执行")).toBeTruthy();
    expect(screen.getByText("1/2 已完成")).toBeTruthy();
    expect(screen.getByText("整理需求和上下文")).toBeTruthy();
  });

  it("does not render an empty task for simple output without plan", () => {
    renderRunNode({
      agentText: "黄瓜是一种常见的葫芦科蔬菜。",
      currentStep: {
        id: "run",
        label: "完成",
        status: "success",
      },
      outputKind: "simple",
      status: "success",
    });

    expect(screen.queryByLabelText("Agent 执行")).toBeNull();
    expect(screen.queryByRole("button", { name: /执行/ })).toBeNull();
  });

  it("does not expose internal connection steps in the run output", () => {
    renderRunNode({
      currentStep: {
        id: "client.connect",
        label: "连接 Agent",
        status: "running",
      },
      status: "running",
    });

    expect(screen.queryByText("连接 Agent")).toBeNull();
    expect(screen.queryByLabelText("Agent 执行")).toBeNull();
    expect(screen.getByText("等待模型输出")).toBeTruthy();
  });

  it("shows a current step fallback when no plan, summary, or tool is available", () => {
    renderRunNode({
      currentStep: {
        id: "input.normalize",
        label: "整理用户需求",
        status: "running",
      },
      status: "running",
    });

    expect(screen.getByLabelText("Agent 执行")).toBeTruthy();
    expect(screen.getAllByText("整理用户需求").length).toBeGreaterThan(0);
    expect(screen.getByText("进行中")).toBeTruthy();
  });

  it("shows useful tool previews before expanding details", () => {
    renderRunNode({
      status: "running",
      toolParts: [
        {
          input: { prompt: "生成一张绿色黄瓜海报", resultCount: 1 },
          state: "input-available",
          toolCallId: "tool-1",
          type: "tool-generate_image",
        },
      ],
    });

    expect(screen.getByRole("button", { name: "生成图片运行中" })).toBeTruthy();
    expect(screen.getByText("生成一张绿色黄瓜海报")).toBeTruthy();
    expect(screen.queryByText("参数")).toBeNull();
  });

  it("renders all task-specific plan items", () => {
    renderRunNode({
      plan: [
        { id: "one", label: "步骤一", status: "success" },
        { id: "two", label: "步骤二", status: "success" },
        { id: "three", label: "步骤三", status: "running" },
        { id: "four", label: "步骤四", status: "queued" },
        { id: "five", label: "步骤五", status: "queued" },
      ],
      status: "running",
    });

    expect(screen.getByText("步骤五")).toBeTruthy();
  });

  it("dispatches retry events for failed tool steps", () => {
    const listener = vi.fn();
    window.addEventListener("cucumber:retry-run", listener);

    renderRunNode({
      status: "error",
      toolParts: [
        {
          errorText: "Seedream missing",
          state: "output-error",
          type: "tool-generate_image",
        },
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: "展开输出" }));
    fireEvent.click(screen.getByRole("button", { name: "从生成图片重试" }));

    expect(listener).toHaveBeenCalledTimes(1);
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({
      retryFrom: { stepId: "generate_image" },
      runNodeId: "run-1",
    });

    window.removeEventListener("cucumber:retry-run", listener);
  });
});

function renderRunNode(data: Partial<RunNodeData>) {
  return render(
    <RunNodeHarness
      data={{
        kind: "run",
        prompt: "生成图片",
        status: "queued",
        ...data,
      }}
    />
  );
}

function RunNodeHarness({ data }: { data: RunNodeData }) {
  return (
    <ReactFlowProvider>
      <RunNodeView
        data={data}
        deletable={true}
        draggable={true}
        dragging={false}
        height={undefined}
        id="run-1"
        isConnectable={false}
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        selectable={true}
        selected={false}
        type="runNode"
        width={undefined}
        zIndex={0}
      />
    </ReactFlowProvider>
  );
}
