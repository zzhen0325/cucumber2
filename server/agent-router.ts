import { z } from "zod";

import {
  CapabilityRuntimeError,
  IMAGE_GENERATE_CAPABILITY_ID,
  PROMPT_EXPAND_CAPABILITY_ID,
  getCapabilitySummary,
  requireCapability,
  type RegisteredCapability,
} from "./capabilities.ts";
import type { PromptCanvasContext } from "./prompts.ts";

export const agentPlanToolNameSchema = z.enum([
  "analyze_reference_images",
  "expand_prompt",
  "generate_image",
]);

export const agentPlanStepSchema = z.object({
  id: z.string().trim().min(1),
  label: z.string().trim().min(1),
  capabilityId: z.string().trim().min(1).optional(),
  toolName: agentPlanToolNameSchema.optional(),
  dependsOn: z.array(z.string().trim().min(1)).default([]),
});

export const agentStepGraphSchema = z
  .object({
    nodes: z.array(agentPlanStepSchema).min(1),
  })
  .superRefine((graph, context) => {
    const stepIds = new Set(graph.nodes.map((node) => node.id));
    for (const node of graph.nodes) {
      for (const dependency of node.dependsOn) {
        if (!stepIds.has(dependency)) {
          context.addIssue({
            code: "custom",
            path: ["nodes", node.id, "dependsOn"],
            message: `Unknown dependency: ${dependency}`,
          });
        }
      }
    }
  });

export const agentRunPlanSchema = z.object({
  selectedCapabilityIds: z.array(z.string().trim().min(1)).min(1),
  router: z.object({
    strategy: z.enum(["rules", "llm"]),
    prompt: z.string().optional(),
    result: z.record(z.string(), z.unknown()).default({}),
  }),
  stepGraph: agentStepGraphSchema,
});

export type AgentPlanToolName = z.infer<typeof agentPlanToolNameSchema>;
export type AgentPlanStep = z.infer<typeof agentPlanStepSchema>;
export type AgentStepGraph = z.infer<typeof agentStepGraphSchema>;
export type AgentRunPlan = z.infer<typeof agentRunPlanSchema>;

export function planAgentRun({
  canvasContext,
  capabilities,
  hasReferenceImages,
}: {
  canvasContext: PromptCanvasContext;
  capabilities: RegisteredCapability[];
  hasReferenceImages: boolean;
}): AgentRunPlan {
  const promptExpand = requireCapability(
    capabilities,
    PROMPT_EXPAND_CAPABILITY_ID
  );
  const imageGenerate = requireCapability(
    capabilities,
    IMAGE_GENERATE_CAPABILITY_ID
  );
  const matchedTerminalCapabilities = selectTerminalCapabilities(
    canvasContext,
    capabilities
  );

  if (
    matchedTerminalCapabilities.length > 1 &&
    !matchedTerminalCapabilities.some(
      (capability) =>
        capability.manifest.capabilityId === IMAGE_GENERATE_CAPABILITY_ID
    )
  ) {
    throw new CapabilityRuntimeError(
      "capability.route_missing",
      "多个 capability 同时匹配，当前规则路由无法选择唯一执行计划。",
      {
        matchedCapabilityIds: matchedTerminalCapabilities.map(
          (capability) => capability.manifest.capabilityId
        ),
      }
    );
  }

  return agentRunPlanSchema.parse({
    selectedCapabilityIds: [
      promptExpand.manifest.capabilityId,
      imageGenerate.manifest.capabilityId,
    ],
    router: {
      strategy: "rules",
      result: {
        selectedNodeId: canvasContext.selectedNodeId ?? null,
        selectedNodeType: getSelectedNodeType(canvasContext),
        upstreamArtifactTypes: getUpstreamArtifactTypes(canvasContext),
        matchedCapabilityIds: matchedTerminalCapabilities.map(
          (capability) => capability.manifest.capabilityId
        ),
        selectedCapabilities: [
          getCapabilitySummary(promptExpand),
          getCapabilitySummary(imageGenerate),
        ],
      },
    },
    stepGraph: {
      nodes: getImagePlanSteps(hasReferenceImages),
    },
  });
}

export function kernelStepsFromPlan(plan: AgentRunPlan) {
  return plan.stepGraph.nodes.map((step) => ({
    id: step.id,
    label: step.label,
    toolName: step.toolName,
  }));
}

function selectTerminalCapabilities(
  canvasContext: PromptCanvasContext,
  capabilities: RegisteredCapability[]
) {
  const terminalCapabilities = capabilities.filter(
    (capability) =>
      capability.manifest.capabilityId !== PROMPT_EXPAND_CAPABILITY_ID
  );
  const matched = terminalCapabilities.filter((capability) =>
    matchesCapability(canvasContext, capability)
  );

  if (matched.length) {
    return matched;
  }

  return terminalCapabilities.filter(
    (capability) =>
      capability.manifest.capabilityId === IMAGE_GENERATE_CAPABILITY_ID
  );
}

function matchesCapability(
  canvasContext: PromptCanvasContext,
  capability: RegisteredCapability
) {
  const haystack = [
    canvasContext.prompt,
    canvasContext.upstreamContext.map((item) => item.type).join(" "),
  ]
    .join(" ")
    .toLowerCase();

  return capability.manifest.triggers.some((trigger) =>
    haystack.includes(trigger.toLowerCase())
  );
}

function getImagePlanSteps(hasReferenceImages: boolean): AgentPlanStep[] {
  const steps: AgentPlanStep[] = [
    {
      id: "agent_text",
      label: "Run explanation",
      dependsOn: [],
    },
  ];

  if (hasReferenceImages) {
    steps.push({
      id: "analyze_reference_images",
      label: "Analyze reference images",
      capabilityId: IMAGE_GENERATE_CAPABILITY_ID,
      toolName: "analyze_reference_images",
      dependsOn: ["agent_text"],
    });
  }

  steps.push(
    {
      id: "expand_prompt",
      label: "Expand prompt",
      capabilityId: PROMPT_EXPAND_CAPABILITY_ID,
      toolName: "expand_prompt",
      dependsOn: [hasReferenceImages ? "analyze_reference_images" : "agent_text"],
    },
    {
      id: "generate_image",
      label: "Generate image",
      capabilityId: IMAGE_GENERATE_CAPABILITY_ID,
      toolName: "generate_image",
      dependsOn: ["expand_prompt"],
    }
  );

  return steps;
}

function getSelectedNodeType(canvasContext: PromptCanvasContext) {
  if (!canvasContext.selectedNodeId) {
    return null;
  }

  return (
    canvasContext.upstreamContext.find(
      (item) => item.nodeId === canvasContext.selectedNodeId
    )?.type ?? null
  );
}

function getUpstreamArtifactTypes(canvasContext: PromptCanvasContext) {
  return canvasContext.upstreamContext.map((item) => item.artifact?.type ?? item.type);
}
