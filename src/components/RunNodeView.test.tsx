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
