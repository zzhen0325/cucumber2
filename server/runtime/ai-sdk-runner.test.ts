import { describe, expect, it } from "vitest";

import { buildCapabilityRegistry } from "../capabilities";
import { buildContext } from "./context-builder";
import { normalizeAgentInput } from "./input-normalizer";
import { buildPlanFromIntentDeterministically } from "./planner";
import {
  normalizeAiSdkPlanForIntent,
  selectAiSdkActiveToolNames,
} from "./ai-sdk-runner";
import { buildToolRegistry, toolIds } from "./tool-registry";
import type { IntentResult, PlanStep } from "../../src/types/runtime";

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

describe("AI SDK runner planning policy", () => {
  it("normalizes plans against the schema-validated model intent", () => {
    const setup = createPlanningSetup("生成一张小狗图片");
    const modelIntent = documentIntentFixture("生成一张小狗图片");
    const context = buildContext({
      input: setup.input,
      intent: modelIntent,
      publicSkills: [promptExpandSkill],
      runId: "agent-run-1",
      toolRegistry: setup.toolRegistry,
    });
    const planning = normalizeAiSdkPlanForIntent({
      context,
      intent: modelIntent,
      modelPlan: invalidImageDocumentPlan(),
      toolRegistry: setup.toolRegistry,
    });

    expect(modelIntent).toMatchObject({
      primaryIntent: "document_writing",
      requiredTools: [toolIds.writeDocument],
      task: { kind: "document_writing" },
    });
    expect(planning.correctedPlan).toBe(true);
    expect(planning.normalizedPlan.map((step) => step.id)).toEqual([
      "agent_text",
      "write_document",
      "evaluate_result",
    ]);
  });

  it("corrects image-generation plans that try to write a Markdown document instead of generating an image", () => {
    const setup = createPlanningSetup("生成一张小狗图片");
    const modelIntent = imageIntentFixture("生成一张小狗图片");
    const context = buildContext({
      input: setup.input,
      intent: modelIntent,
      publicSkills: [promptExpandSkill],
      runId: "agent-run-1",
      toolRegistry: setup.toolRegistry,
    });
    const planning = normalizeAiSdkPlanForIntent({
      context,
      intent: modelIntent,
      modelPlan: invalidImageDocumentPlan(),
      toolRegistry: setup.toolRegistry,
    });

    expect(modelIntent).toMatchObject({
      primaryIntent: "image_generation",
      requiredTools: [toolIds.expandPrompt, toolIds.generateImage],
    });
    expect(planning.correctedPlan).toBe(true);
    expect(planning.normalizedPlan.map((step) => step.id)).toEqual([
      "agent_text",
      "expand_prompt",
      "generate_image",
      "evaluate_result",
    ]);
    expect(
      planning.normalizedPlan.find((step) => step.id === "generate_image")
        ?.expectedArtifacts
    ).toEqual([
      {
        type: "image",
        count: 1,
        description: "Generated image",
      },
    ]);
  });

  it("uses planned tool names after planning", () => {
    expect(
      selectAiSdkActiveToolNames({
        fallbackToolNames: ["write_document"],
        state: {
          plan: buildPlanFromIntentDeterministically(
            imageIntentFixture("生成一张小狗图片")
          ),
          toolNamesById: new Map([
            [toolIds.expandPrompt, "expand_prompt"],
            [toolIds.generateImage, "generate_image"],
            [toolIds.writeDocument, "write_document"],
          ]),
        },
      })
    ).toEqual(["expand_prompt", "generate_image"]);
  });

  it("exposes no runtime tools before the structured plan is available", () => {
    expect(
      selectAiSdkActiveToolNames({
        fallbackToolNames: [],
        state: {
          plan: [],
          toolNamesById: new Map([
            [toolIds.expandPrompt, "expand_prompt"],
            [toolIds.generateImage, "generate_image"],
            [toolIds.writeDocument, "write_document"],
          ]),
        },
      })
    ).toEqual([]);
  });
});

function createPlanningSetup(prompt: string) {
  const capabilities = buildCapabilityRegistry([promptExpandSkill]);
  const canvasContext = {
    prompt,
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
  return { input, toolRegistry };
}

function imageIntentFixture(prompt: string): IntentResult {
  return {
    primaryIntent: "image_generation",
    confidence: 0.91,
    task: {
      kind: "image_generation",
      goals: [prompt],
      targets: [],
      constraints: [],
      deliverables: [
        {
          kind: "image",
          description: "Generated image artifact attached to the run branch.",
          count: 1,
        },
      ],
      operations: [
        {
          kind: "generate",
          target: "expanded_prompt",
          toolHint: toolIds.generateImage,
        },
      ],
    },
    requiredCapabilities: ["prompt.expand", "image.generate"],
    requiredTools: [toolIds.expandPrompt, toolIds.generateImage],
    needsPlanning: true,
    ambiguity: [],
    routingReason: "Model inferred image generation.",
  };
}

function documentIntentFixture(prompt: string): IntentResult {
  return {
    primaryIntent: "document_writing",
    confidence: 0.84,
    task: {
      kind: "document_writing",
      goals: [prompt],
      targets: [],
      constraints: [],
      deliverables: [
        {
          kind: "document",
          description: "Markdown document artifact.",
          count: 1,
        },
      ],
      operations: [
        {
          kind: "write",
          target: "markdown_document",
          toolHint: toolIds.writeDocument,
        },
      ],
    },
    requiredCapabilities: ["document.write"],
    requiredTools: [toolIds.writeDocument],
    needsPlanning: true,
    ambiguity: [],
    routingReason: "Model inferred text document output.",
  };
}

function invalidImageDocumentPlan(): PlanStep[] {
  return [
    planStep({
      id: "expand_prompt",
      title: "扩写小狗图片提示词",
      goal: "Expand the dog image prompt.",
      toolId: toolIds.expandPrompt,
      capabilityId: "prompt.expand",
      expectedArtifacts: [],
    }),
    planStep({
      id: "write_document",
      title: "Write Markdown document",
      goal: "Write the expanded prompt as a Markdown document.",
      toolId: toolIds.writeDocument,
      capabilityId: "document.write",
      dependsOn: ["expand_prompt"],
      expectedArtifacts: [{ type: "doc", count: 1 }],
    }),
  ];
}

function planStep(
  step: Pick<PlanStep, "id" | "title" | "goal" | "toolId" | "capabilityId"> &
    Partial<PlanStep>
): PlanStep {
  return {
    kind: "tool",
    dependsOn: [],
    expectedArtifacts: [],
    expectedCanvasOperations: [],
    risk: "low",
    approvalRequired: false,
    retryPolicy: { maxRetries: 0, backoffMs: 0, retryableErrorCodes: [] },
    ...step,
  };
}
