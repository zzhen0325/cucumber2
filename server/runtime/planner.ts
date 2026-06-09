import type { BuiltContext, IntentResult, PlanStep } from "../../src/types/runtime.ts";
import {
  generateStructuredObjectWithProvider,
  type ModelProviderId,
} from "../model-providers.ts";
import { planSchema } from "./schemas.ts";
import { toolIds, type RuntimeToolDefinition, type ToolRegistry } from "./tool-registry.ts";
import { runtimeErrorCodes, throwAgentError } from "./errors.ts";
import { z } from "zod";

const defaultRetryPolicy = {
  maxRetries: 0,
  backoffMs: 0,
  retryableErrorCodes: [],
};

const plannerSystemPrompt = [
  "You are Cucumber's LLM Planner for an infinite canvas agent runtime.",
  "Return only a structured executable step graph matching the schema.",
  "Do not create ReactFlow nodes directly.",
  "Use only allowed tool ids from the prompt.",
  "Every tool step must name dependencies, risk, approval requirement, expected artifacts, and expected canvas operations.",
].join("\n");

const plannerOutputSchema = z.object({
  steps: planSchema,
});

export async function createPlan({
  context,
  generatePlanSteps,
  intent,
  modelProvider,
  toolRegistry,
}: {
  context: BuiltContext;
  generatePlanSteps?: (prompt: string) => Promise<PlanStep[]>;
  intent: IntentResult;
  modelProvider: ModelProviderId;
  toolRegistry: ToolRegistry;
}) {
  const deterministicPlan = planBeforeModel(intent);
  if (deterministicPlan) {
    const normalizedPlan = normalizePlan(deterministicPlan, {
      expectedImageCount: getExpectedImageCount(intent),
    });
    const validation = validatePlanAgainstRegistry(
      normalizedPlan,
      toolRegistry,
      context
    );

    if (!validation.ok) {
      throwAgentError({
        code: runtimeErrorCodes.PLAN_INVALID,
        message: validation.errors.join("; "),
        retryable: false,
        severity: "error",
        details: { validation },
      });
    }

    return {
      rawPlan: deterministicPlan,
      normalizedPlan,
      validation,
    };
  }

  const prompt = buildPlannerPrompt({ context, intent, toolRegistry });
  const rawPlan = generatePlanSteps
    ? await generatePlanSteps(prompt)
    : (
        await generateStructuredObjectWithProvider(modelProvider, {
          system: plannerSystemPrompt,
          prompt,
          schema: plannerOutputSchema,
          schemaName: "agent_plan",
          schemaDescription:
            "Executable PlanStep graph for the Cucumber Agent Runtime.",
          maxOutputTokens: 1_800,
        })
      ).steps;
  const normalizedPlan = normalizePlan(rawPlan, {
    expectedImageCount: getExpectedImageCount(intent),
  });
  const validation = validatePlanAgainstRegistry(
    normalizedPlan,
    toolRegistry,
    context
  );

  if (!validation.ok) {
    throwAgentError({
      code: runtimeErrorCodes.PLAN_INVALID,
      message: validation.errors.join("; "),
      retryable: false,
      severity: "error",
      details: { validation },
    });
  }

  return {
    rawPlan,
    normalizedPlan,
    validation,
  };
}

function planBeforeModel(intent: IntentResult): PlanStep[] | undefined {
  if (
    intent.requiredTools.includes(toolIds.generateImage) ||
    intent.requiredTools.includes(toolIds.expandPrompt)
  ) {
    return buildPlanFromIntentDeterministically(intent);
  }

  if (intent.requiredTools.includes(toolIds.searchWeb)) {
    return buildPlanFromIntentDeterministically(intent);
  }

  if (intent.requiredTools.includes(toolIds.generateHtml)) {
    return buildPlanFromIntentDeterministically(intent);
  }

  if (intent.requiredTools.includes(toolIds.writeDocument)) {
    return buildPlanFromIntentDeterministically(intent);
  }

  return undefined;
}

export function normalizePlan(
  plan: PlanStep[],
  options: { expectedImageCount?: number } = {}
) {
  const expectedImageCount = Math.max(options.expectedImageCount ?? 1, 1);

  return planSchema.parse(
    plan.map((step, index) => ({
      ...step,
      id: step.id || `plan-step-${index + 1}`,
      dependsOn: step.dependsOn ?? [],
      expectedArtifacts: normalizeExpectedArtifacts(step, expectedImageCount),
      expectedCanvasOperations: step.expectedCanvasOperations ?? [],
      retryPolicy: step.retryPolicy ?? defaultRetryPolicy,
      approvalRequired: step.approvalRequired ?? false,
    }))
  );
}

export function validatePlanAgainstRegistry(
  plan: PlanStep[],
  toolRegistry: ToolRegistry,
  context: BuiltContext
) {
  const errors: string[] = [];
  const stepIds = new Set(plan.map((step) => step.id));
  const allowedTools = new Set(context.availableTools.map((tool) => tool.id));

  for (const step of plan) {
    for (const dependency of step.dependsOn) {
      if (!stepIds.has(dependency)) {
        errors.push(`Step ${step.id} depends on unknown step ${dependency}.`);
      }
    }

    if (step.kind === "tool" || step.kind === "canvas") {
      if (!step.toolId) {
        errors.push(`${step.kind} step ${step.id} is missing toolId.`);
        continue;
      }
      const tool = toolRegistry.getTool(step.toolId);
      if (!tool) {
        errors.push(`Tool step ${step.id} references unregistered tool ${step.toolId}.`);
        continue;
      }
      if (!allowedTools.has(step.toolId)) {
        errors.push(`Tool step ${step.id} references non-exposed tool ${step.toolId}.`);
      }
      errors.push(...validateStepInput(step, tool));
      if (step.kind === "canvas" && !tool.policy.canModifyProject) {
        errors.push(
          `Canvas step ${step.id} references tool ${step.toolId} without project mutation permission.`
        );
      }
    }

    for (const operation of step.expectedCanvasOperations) {
      const producer = findAllowedCanvasOperationProducer(
        operation.type,
        step.toolId,
        toolRegistry,
        allowedTools
      );
      if (!producer) {
        errors.push(
          `Step ${step.id} expects unauthorized canvas operation ${operation.type}.`
        );
      }
    }
  }

  if (hasCycle(plan)) {
    errors.push("Plan contains a dependency cycle.");
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

function validateStepInput(step: PlanStep, tool: RuntimeToolDefinition) {
  const errors: string[] = [];
  if (step.input === undefined) {
    if (tool.id === toolIds.generateHtml || tool.id === toolIds.writeDocument) {
      return errors;
    }
    if (tool.prepareInput) {
      return errors;
    }
    if (tool.inputSchema.safeParse({}).success) {
      return errors;
    }
    errors.push(`Step ${step.id} is missing required input for tool ${tool.id}.`);
    return errors;
  }

  const parsed = tool.inputSchema.safeParse(step.input);
  if (!parsed.success) {
    errors.push(`Step ${step.id} input does not match schema for tool ${tool.id}.`);
  }
  return errors;
}

function findAllowedCanvasOperationProducer(
  operationType: PlanStep["expectedCanvasOperations"][number]["type"],
  stepToolId: string | undefined,
  toolRegistry: ToolRegistry,
  allowedTools: Set<string>
) {
  const producerIds = canvasOperationProducerToolIds(operationType);
  if (
    stepToolId &&
    producerIds.includes(stepToolId) &&
    allowedTools.has(stepToolId)
  ) {
    return stepToolId;
  }

  return producerIds.find((toolId) => {
    const tool = toolRegistry.getTool(toolId);
    return tool && allowedTools.has(toolId);
  });
}

function canvasOperationProducerToolIds(
  operationType: PlanStep["expectedCanvasOperations"][number]["type"]
): string[] {
  switch (operationType) {
    case "attachArtifact":
      return [toolIds.attachArtifact, toolIds.generateImage];
    case "createNode":
      return [toolIds.createCanvasNode];
    case "createEdge":
      return [toolIds.createCanvasEdge];
    case "updateNode":
    case "setNodeStatus":
      return [toolIds.updateCanvasNode];
    default:
      return [];
  }
}

export function buildPlanFromIntentDeterministically(intent: IntentResult): PlanStep[] {
  if (intent.requiredTools.includes(toolIds.generateHtml)) {
    return buildLandingPagePlan(intent);
  }

  if (intent.requiredTools.includes(toolIds.searchWeb)) {
    return buildWebResearchPlan();
  }

  if (intent.requiredTools.includes(toolIds.writeDocument)) {
    return buildDocumentPlan(intent);
  }

  if (
    !intent.requiredTools.includes(toolIds.generateImage) ||
    intent.ambiguity.some((item) => item.severity === "high")
  ) {
    return [
      {
        id: "clarify_or_stop",
        title: "Clarify unsupported task",
        goal: intent.routingReason,
        kind: "approval",
        dependsOn: [],
        expectedArtifacts: [],
        expectedCanvasOperations: [],
        risk: "low",
        approvalRequired: true,
        retryPolicy: defaultRetryPolicy,
      },
    ];
  }

  const steps: PlanStep[] = [
    {
      id: "agent_text",
      title: "Run explanation",
      goal: "Explain the interpreted request without claiming tool success.",
      kind: "reasoning",
      dependsOn: [],
      expectedArtifacts: [],
      expectedCanvasOperations: [],
      risk: "low",
      approvalRequired: false,
      retryPolicy: defaultRetryPolicy,
    },
  ];

  if (intent.requiredTools.includes(toolIds.analyzeReferenceImages)) {
    steps.push({
      id: "analyze_reference_images",
      title: "Analyze reference images",
      goal: "Summarize visible upstream image context for prompt expansion.",
      kind: "tool",
      toolId: toolIds.analyzeReferenceImages,
      capabilityId: "image.generate",
      dependsOn: ["agent_text"],
      expectedArtifacts: [],
      expectedCanvasOperations: [],
      risk: "medium",
      approvalRequired: false,
      retryPolicy: defaultRetryPolicy,
    });
  }

  steps.push(
    {
      id: "expand_prompt",
      title: "Expand prompt",
      goal: "Convert the user request and selected context into an image prompt.",
      kind: "tool",
      toolId: toolIds.expandPrompt,
      capabilityId: "prompt.expand",
      dependsOn: [
        intent.requiredTools.includes(toolIds.analyzeReferenceImages)
          ? "analyze_reference_images"
          : "agent_text",
      ],
      expectedArtifacts: [],
      expectedCanvasOperations: [],
      risk: "low",
      approvalRequired: false,
      retryPolicy: defaultRetryPolicy,
    },
    {
      id: "generate_image",
      title: "Generate image",
      goal: "Generate image artifact(s) from the expanded prompt.",
      kind: "tool",
      toolId: toolIds.generateImage,
      capabilityId: "image.generate",
      dependsOn: ["expand_prompt"],
      expectedArtifacts: [
        {
          type: "image",
          count: getExpectedImageCount(intent),
          description: "Generated image",
        },
      ],
      expectedCanvasOperations: [
        {
          type: "attachArtifact",
          description: "Attach generated image artifact to the run branch.",
        },
      ],
      risk: "medium",
      approvalRequired: false,
      retryPolicy: defaultRetryPolicy,
    },
    {
      id: "evaluate_result",
      title: "Evaluate result",
      goal: "Check that required artifacts and canvas operations exist.",
      kind: "evaluation",
      dependsOn: ["generate_image"],
      expectedArtifacts: [],
      expectedCanvasOperations: [],
      risk: "low",
      approvalRequired: false,
      retryPolicy: defaultRetryPolicy,
    }
  );

  return steps;
}

function getExpectedImageCount(intent: IntentResult) {
  return Math.max(
    1,
    intent.task.deliverables
      .filter((deliverable) => deliverable.kind === "image")
      .reduce((total, deliverable) => total + (deliverable.count ?? 1), 0)
  );
}

function normalizeExpectedArtifacts(
  step: PlanStep,
  expectedImageCount: number
) {
  const expectedArtifacts = step.expectedArtifacts ?? [];
  if (step.toolId !== toolIds.generateImage) {
    return expectedArtifacts;
  }

  if (!expectedArtifacts.some((artifact) => artifact.type === "image")) {
    return [
      ...expectedArtifacts,
      {
        type: "image" as const,
        count: expectedImageCount,
        description: "Generated image",
      },
    ];
  }

  return expectedArtifacts.map((artifact) =>
    artifact.type === "image"
      ? {
          ...artifact,
          count: Math.max(artifact.count ?? expectedImageCount, expectedImageCount),
        }
      : artifact
  );
}

function buildLandingPagePlan(intent: IntentResult): PlanStep[] {
  const steps: PlanStep[] = [
    {
      id: "agent_text",
      title: "Run explanation",
      goal: "Explain the multi-step landing page workflow.",
      kind: "reasoning",
      dependsOn: [],
      expectedArtifacts: [],
      expectedCanvasOperations: [],
      risk: "low",
      approvalRequired: false,
      retryPolicy: defaultRetryPolicy,
    },
  ];
  const generationDependencies = ["agent_text"];
  const generateHtmlExpectedCanvasOperations = intent.requiredTools.includes(
    toolIds.createCanvasNode
  )
    ? [
        {
          type: "createNode" as const,
          description: "Create a canvas node for the generated page.",
        },
      ]
    : [];

  if (intent.requiredTools.includes(toolIds.readWebpage)) {
    steps.push({
      id: "read_webpage",
      title: "Read webpage sources",
      goal: "Read and summarize provided webpage sources.",
      kind: "tool",
      toolId: toolIds.readWebpage,
      capabilityId: "web.research",
      dependsOn: ["agent_text"],
      expectedArtifacts: [{ type: "webpage", description: "Read webpage source" }],
      expectedCanvasOperations: [],
      risk: "low",
      approvalRequired: false,
      retryPolicy: { maxRetries: 1, backoffMs: 500, retryableErrorCodes: [runtimeErrorCodes.TOOL_TIMEOUT] },
    });
    generationDependencies.push("read_webpage");
  }

  if (intent.requiredTools.includes(toolIds.searchWeb)) {
    steps.push({
      id: "search_web",
      title: "Search web",
      goal: "Search current web sources for the page brief.",
      kind: "tool",
      toolId: toolIds.searchWeb,
      capabilityId: "web.research",
      dependsOn: ["agent_text"],
      expectedArtifacts: [],
      expectedCanvasOperations: [],
      risk: "low",
      approvalRequired: false,
      retryPolicy: {
        maxRetries: 1,
        backoffMs: 500,
        retryableErrorCodes: [runtimeErrorCodes.TOOL_TIMEOUT],
      },
    });
    generationDependencies.push("search_web");
  }

  if (intent.requiredTools.includes(toolIds.analyzeAssets)) {
    steps.push({
      id: "analyze_assets",
      title: "Analyze visual assets",
      goal: "Summarize selected image or artifact context for the landing page.",
      kind: "tool",
      toolId: toolIds.analyzeAssets,
      capabilityId: "asset.analyze",
      dependsOn: ["agent_text"],
      expectedArtifacts: [],
      expectedCanvasOperations: [],
      risk: "low",
      approvalRequired: false,
      retryPolicy: defaultRetryPolicy,
    });
    generationDependencies.push("analyze_assets");
  }

  if (intent.requiredTools.includes(toolIds.writeDocument)) {
    steps.push({
      id: "write_report",
      title: "Write source report",
      goal: "Create a Markdown report that turns the user goal and gathered context into source material for the page.",
      kind: "tool",
      toolId: toolIds.writeDocument,
      capabilityId: "document.write",
      dependsOn: [...generationDependencies],
      expectedArtifacts: [
        {
          type: "doc",
          count: 1,
          description: "Markdown report artifact for downstream page generation.",
        },
      ],
      expectedCanvasOperations: [],
      risk: "low",
      approvalRequired: false,
      retryPolicy: defaultRetryPolicy,
    });
    generationDependencies.splice(0, generationDependencies.length, "write_report");
  }

  steps.push({
    id: "generate_html",
    title: "Generate HTML artifact",
    goal: "Create the complete standalone HTML page artifact from the task brief and previous tool results.",
    kind: "tool",
    toolId: toolIds.generateHtml,
    capabilityId: "html.generate",
    dependsOn: generationDependencies,
    expectedArtifacts: [{ type: "webpage", description: "Generated landing page artifact" }],
    expectedCanvasOperations: generateHtmlExpectedCanvasOperations,
    risk: "low",
    approvalRequired: false,
    retryPolicy: defaultRetryPolicy,
  });

  if (intent.requiredTools.includes(toolIds.createCanvasNode)) {
    steps.push({
      id: "create_page_node",
      title: "Create page node",
      goal: "Place the generated landing page artifact onto the canvas.",
      kind: "canvas",
      toolId: toolIds.createCanvasNode,
      capabilityId: "canvas.mutate",
      dependsOn: ["generate_html"],
      expectedArtifacts: [],
      expectedCanvasOperations: [
        {
          type: "createNode",
          description: "Create a canvas node for the generated landing page.",
        },
      ],
      risk: "medium",
      approvalRequired: false,
      retryPolicy: defaultRetryPolicy,
    });
  }

  steps.push({
    id: "evaluate_result",
    title: "Evaluate result",
    goal: "Check generated page artifact completeness and canvas visibility.",
    kind: "evaluation",
    dependsOn: [intent.requiredTools.includes(toolIds.createCanvasNode) ? "create_page_node" : "generate_html"],
    expectedArtifacts: [],
    expectedCanvasOperations: [],
    risk: "low",
    approvalRequired: false,
    retryPolicy: defaultRetryPolicy,
  });

  return steps;
}

function buildPlannerPrompt({
  context,
  intent,
  toolRegistry,
}: {
  context: BuiltContext;
  intent: IntentResult;
  toolRegistry: ToolRegistry;
}) {
  return [
    "INTENT_RESULT",
    JSON.stringify(intent, null, 2),
    "",
    "BUILT_CONTEXT",
    JSON.stringify(
      {
        taskContext: context.taskContext,
        selectedItems: context.selectedItems.map((item) => ({
          nodeId: item.nodeId,
          type: item.type,
          source: item.source,
          inclusionReason: item.inclusionReason,
          summary: item.summary,
          prompt: item.prompt,
          imageUrl: item.imageUrl,
          artifactType: item.artifact?.type,
          contentRef: item.contentRef,
        })),
        omittedItems: context.omittedItems.map((item) => ({
          nodeId: item.nodeId,
          type: item.type,
          omissionReason: item.omissionReason,
        })),
        injectedSkills: context.injectedSkills,
        promptParts: context.promptParts,
        budget: context.budget,
      },
      null,
      2
    ),
    "",
    "ALLOWED_TOOLS",
    JSON.stringify(toolRegistry.listToolsForPlanner(context), null, 2),
    "",
    "PLANNING_POLICY",
    [
      "Use a reasoning step first when user-facing run explanation is needed.",
      `For web research, current information, or source-grounded answers, use ${toolIds.searchWeb} before ${toolIds.writeDocument}.`,
      `For text-first analysis, summaries, reports, plans, answers, or capability reports, use ${toolIds.writeDocument} to create a Markdown document artifact.`,
      `For simple image generation, include ${toolIds.expandPrompt} and ${toolIds.generateImage}.`,
      `For page, component, landing page, website, or HTML work, use ${toolIds.readWebpage} when webpage sources are present, ${toolIds.analyzeAssets} for image or artifact context, ${toolIds.generateHtml} through the generate_html tool to create the complete standalone HTML artifact, and ${toolIds.createCanvasNode} when the page must appear on canvas.`,
      `Use ${toolIds.analyzeReferenceImages} before prompt expansion when selected/upstream images need visual analysis.`,
      "Canvas changes must be expectedCanvasOperations or tool-returned CanvasOperation proposals, never direct node mutation.",
      "If no executable tool is exposed for the task, create an approval step asking for clarification instead of inventing a tool.",
    ].join("\n"),
  ].join("\n");
}

function buildWebResearchPlan(): PlanStep[] {
  return [
    {
      id: "agent_text",
      title: "Run explanation",
      goal: "Explain that the run will search the web and produce a Markdown research document.",
      kind: "reasoning",
      dependsOn: [],
      expectedArtifacts: [],
      expectedCanvasOperations: [],
      risk: "low",
      approvalRequired: false,
      retryPolicy: defaultRetryPolicy,
    },
    {
      id: "search_web",
      title: "Search web",
      goal: "Search current web sources for the requested research question.",
      kind: "tool",
      toolId: toolIds.searchWeb,
      capabilityId: "web.research",
      dependsOn: ["agent_text"],
      expectedArtifacts: [],
      expectedCanvasOperations: [],
      risk: "low",
      approvalRequired: false,
      retryPolicy: {
        maxRetries: 1,
        backoffMs: 500,
        retryableErrorCodes: [runtimeErrorCodes.TOOL_TIMEOUT],
      },
    },
    {
      id: "write_document",
      title: "Write research document",
      goal: "Create a source-grounded Markdown document from the search results and available context.",
      kind: "tool",
      toolId: toolIds.writeDocument,
      capabilityId: "document.write",
      dependsOn: ["search_web"],
      expectedArtifacts: [
        {
          type: "doc",
          count: 1,
          description: "Markdown research document artifact.",
        },
      ],
      expectedCanvasOperations: [],
      risk: "low",
      approvalRequired: false,
      retryPolicy: defaultRetryPolicy,
    },
    {
      id: "evaluate_result",
      title: "Evaluate result",
      goal: "Check that the Markdown research document artifact exists and has content.",
      kind: "evaluation",
      dependsOn: ["write_document"],
      expectedArtifacts: [],
      expectedCanvasOperations: [],
      risk: "low",
      approvalRequired: false,
      retryPolicy: defaultRetryPolicy,
    },
  ];
}

function buildDocumentPlan(intent: IntentResult): PlanStep[] {
  return [
    {
      id: "agent_text",
      title: "Run explanation",
      goal: "Explain that the run will produce a Markdown document artifact.",
      kind: "reasoning",
      dependsOn: [],
      expectedArtifacts: [],
      expectedCanvasOperations: [],
      risk: "low",
      approvalRequired: false,
      retryPolicy: defaultRetryPolicy,
    },
    {
      id: "write_document",
      title:
        intent.primaryIntent === "document.capability_report"
          ? "Write capability report"
          : "Write document",
      goal: "Create the requested Markdown document artifact from the routed task and available context.",
      kind: "tool",
      toolId: toolIds.writeDocument,
      capabilityId: "document.write",
      dependsOn: ["agent_text"],
      expectedArtifacts: [
        {
          type: "doc",
          count: 1,
          description: "Markdown document artifact.",
        },
      ],
      expectedCanvasOperations: [],
      risk: "low",
      approvalRequired: false,
      retryPolicy: defaultRetryPolicy,
    },
    {
      id: "evaluate_result",
      title: "Evaluate result",
      goal: "Check that the Markdown document artifact exists and has content.",
      kind: "evaluation",
      dependsOn: ["write_document"],
      expectedArtifacts: [],
      expectedCanvasOperations: [],
      risk: "low",
      approvalRequired: false,
      retryPolicy: defaultRetryPolicy,
    },
  ];
}

function hasCycle(plan: PlanStep[]) {
  const byId = new Map(plan.map((step) => [step.id, step]));
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(stepId: string): boolean {
    if (visited.has(stepId)) {
      return false;
    }
    if (visiting.has(stepId)) {
      return true;
    }
    const step = byId.get(stepId);
    if (!step) {
      return false;
    }

    visiting.add(stepId);
    for (const dependency of step.dependsOn) {
      if (visit(dependency)) {
        return true;
      }
    }
    visiting.delete(stepId);
    visited.add(stepId);
    return false;
  }

  return plan.some((step) => visit(step.id));
}
