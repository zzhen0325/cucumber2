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
    expect(screen.getAllByText("Thinking...")).toHaveLength(2);
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

  it("collapses automatically when generation succeeds", async () => {
    const { rerender } = renderRunNode({
      agentText: "正在生成",
      status: "running",
    });

    expect(screen.getByLabelText("Agent run stream")).toBeTruthy();

    rerender(
      <RunNodeHarness
        data={{
          agentText: "完成",
          kind: "run",
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

  it("shows a compact plan and current step", () => {
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

    expect(screen.getAllByTitle("生成图片产物").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("任务计划")).toBeTruthy();
    expect(screen.getByText("整理需求和上下文")).toBeTruthy();
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
