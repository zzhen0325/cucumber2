import { describe, expect, it } from "vitest";

import {
  isCompositeWorkflowTask,
  isImageGenerationTask,
  isImageInspectionTask,
  isTextArtifactTask,
  selectAgentRoute,
  selectAgentRoutesForTask,
} from "./task-router.ts";
import { makeTaskFrame } from "./test-task-frame.ts";

describe("task router", () => {
  it("routes by routing.primaryAgent", () => {
    expect(
      selectAgentRoute(makeTaskFrame({ primaryAgent: "image_agent", domain: "image" }))
    ).toBe("image");
    expect(
      selectAgentRoute(makeTaskFrame({ primaryAgent: "document_agent", domain: "text" }))
    ).toBe("document");
    expect(
      selectAgentRoute(makeTaskFrame({ primaryAgent: "web_agent" }))
    ).toBe("web");
    expect(
      selectAgentRoute(makeTaskFrame({ primaryAgent: "research_agent" }))
    ).toBe("research");
    expect(
      selectAgentRoute(makeTaskFrame({ primaryAgent: "manager_agent" }))
    ).toBe("manager");
  });

  it("falls back to manager when no frame is provided", () => {
    expect(selectAgentRoute(undefined)).toBe("manager");
    expect(selectAgentRoute(null)).toBe("manager");
  });

  it("collects candidate specialist routes for composite tasks", () => {
    expect(
      selectAgentRoutesForTask(
        makeTaskFrame({
          primaryAgent: "web_agent",
          candidateAgents: ["research_agent", "document_agent", "manager_agent"],
        })
      )
    ).toEqual(["web", "research", "document"]);
  });

  it("routes hybrid workflows through Manager while preserving required specialists", () => {
    const frame = makeTaskFrame({
      domain: "mixed",
      intent: "hybrid.visual.code.create",
      action: "create",
      primaryAgent: "manager_agent",
      workflow: {
        mode: "hybrid",
        outputArtifacts: ["image", "code"],
        requiredAgents: ["image_agent", "document_agent"],
        stages: [
          {
            id: "generate-image",
            goal: "生成图片",
            action: "create",
            agent: "image_agent",
            outputArtifacts: ["image"],
          },
          {
            id: "create-code",
            goal: "生成代码",
            action: "create",
            agent: "document_agent",
            outputArtifacts: ["code"],
            dependsOn: ["generate-image"],
          },
        ],
        requiredCapabilities: ["image-generation", "code-artifact"],
      },
    });

    expect(isCompositeWorkflowTask(frame)).toBe(true);
    expect(selectAgentRoute(frame)).toBe("manager");
    expect(selectAgentRoutesForTask(frame)).toEqual(["image", "document"]);
  });

  it("classifies image generation vs inspection by action", () => {
    expect(
      isImageGenerationTask(
        makeTaskFrame({ domain: "image", action: "create", intent: "image.generate" })
      )
    ).toBe(true);
    expect(
      isImageInspectionTask(
        makeTaskFrame({ domain: "image", action: "analyze", intent: "media.analyze" })
      )
    ).toBe(true);
    expect(
      isImageGenerationTask(
        makeTaskFrame({ domain: "image", action: "analyze", intent: "media.analyze" })
      )
    ).toBe(false);
    expect(
      isImageGenerationTask(
        makeTaskFrame({
          domain: "mixed",
          action: "create",
          intent: "analysis.then.image",
          primaryAgent: "manager_agent",
          workflow: {
            mode: "multi_step",
            outputArtifacts: ["image"],
            requiredAgents: ["image_agent"],
            requiredCapabilities: ["media-analysis", "image-generation"],
          },
        })
      )
    ).toBe(true);
  });

  it("classifies text/code artifact tasks", () => {
    expect(
      isTextArtifactTask(
        makeTaskFrame({ domain: "text", action: "create", intent: "document.create" })
      )
    ).toBe(true);
    expect(
      isTextArtifactTask(
        makeTaskFrame({ domain: "code", action: "create", intent: "code.create" })
      )
    ).toBe(true);
    expect(
      isTextArtifactTask(
        makeTaskFrame({ domain: "image", action: "create", intent: "image.generate" })
      )
    ).toBe(false);
    expect(
      isTextArtifactTask(
        makeTaskFrame({
          domain: "mixed",
          action: "create",
          intent: "hybrid.code.doc",
          primaryAgent: "manager_agent",
          workflow: {
            mode: "hybrid",
            outputArtifacts: ["code", "doc"],
            requiredAgents: ["document_agent"],
          },
        })
      )
    ).toBe(true);
  });
});
