import {
  IMAGE_GENERATE_CAPABILITY_ID,
  PROMPT_EXPAND_CAPABILITY_ID,
  getCapabilitySummary,
  type RegisteredCapability,
} from "../capabilities.ts";
import {
  generateStructuredObjectWithProvider,
  type ModelProviderId,
} from "../model-providers.ts";
import type { AgentInput, IntentResult, StructuredTask } from "../../src/types/runtime.ts";
import { intentResultSchema } from "./schemas.ts";
import { toolIds, type ToolRegistry } from "./tool-registry.ts";
import { runtimeErrorCodes, throwAgentError } from "./errors.ts";

const intentRouterSystemPrompt = [
  "You are Cucumber's Intent Router for an infinite canvas agent runtime.",
  "Return only structured intent data that matches the schema.",
  "Do not execute tools, create canvas nodes, or decide final tool arguments.",
  "Use only capability ids and tool ids that are present in the prompt allowlist.",
  "If the request is unsupported or ambiguous, still return a structured task and add ambiguity entries.",
].join("\n");

const ROUTE_MISSING_INTENT = "capability.route_missing";

export async function routeIntent({
  capabilities,
  generateIntentResult,
  input,
  modelProvider,
  toolRegistry,
}: {
  capabilities: RegisteredCapability[];
  generateIntentResult?: (prompt: string) => Promise<IntentResult>;
  input: AgentInput;
  modelProvider: ModelProviderId;
  toolRegistry: ToolRegistry;
}): Promise<IntentResult> {
  const prompt = buildIntentRouterPrompt({ capabilities, input, toolRegistry });
  const routed = intentResultSchema.parse(
    generateIntentResult
      ? await generateIntentResult(prompt)
      : await generateStructuredObjectWithProvider(modelProvider, {
          system: intentRouterSystemPrompt,
          prompt,
          schema: intentResultSchema,
          schemaName: "intent_result",
          schemaDescription:
            "Structured task routing result for the Cucumber Agent Runtime.",
          maxOutputTokens: 1_400,
        })
  );
  const validation = validateIntentAgainstRegistry({
    capabilities,
    intent: routed,
    toolRegistry,
  });

  if (!validation.ok) {
    throwAgentError({
      code: runtimeErrorCodes.CAPABILITY_UNAVAILABLE,
      message: validation.errors.join("; "),
      retryable: false,
      severity: "error",
      details: { validation, intent: routed },
    });
  }

  return routed;
}

export function routeIntentDeterministically({
  capabilities,
  input,
  toolRegistry,
}: {
  capabilities: RegisteredCapability[];
  input: AgentInput;
  toolRegistry: ToolRegistry;
}): IntentResult {
  const text = input.userMessage.toLowerCase();
  const hasReferenceImage = input.canvasContext.upstreamContext.some(
    (item) => item.type === "image" || item.artifact?.type === "image"
  );
  const matchedCapabilities = capabilities.filter((capability) =>
    capability.manifest.triggers.some((trigger) =>
      text.includes(trigger.toLowerCase())
    )
  );
  const nonImageCapability = matchedCapabilities.find(
    (capability) =>
      capability.manifest.capabilityId !== IMAGE_GENERATE_CAPABILITY_ID &&
      capability.manifest.capabilityId !== PROMPT_EXPAND_CAPABILITY_ID
  );

  if (nonImageCapability) {
    return intentResultSchema.parse({
      primaryIntent: ROUTE_MISSING_INTENT,
      confidence: 0.72,
      task: createUnsupportedTask(input, nonImageCapability.manifest.capabilityId),
      requiredCapabilities: [nonImageCapability.manifest.capabilityId],
      requiredTools: [],
      needsPlanning: true,
      ambiguity: [
        {
          id: ROUTE_MISSING_INTENT,
          question: `Capability ${nonImageCapability.manifest.capabilityId} is matched but no executor is registered yet.`,
          severity: "high",
        },
      ],
      routingReason: `Matched capability ${nonImageCapability.manifest.capabilityId}; available executor tools are ${toolRegistry.listAll().map((tool) => tool.id).join(", ")}.`,
    });
  }

  const complexRoute = inferComplexRoute(text, input);
  if (complexRoute) {
    const missingTools = complexRoute.requiredTools.filter(
      (toolId) => !toolRegistry.getTool(toolId)
    );
    if (!missingTools.length) {
      return intentResultSchema.parse({
        primaryIntent: "multi_step.landing_page",
        confidence: 0.82,
        task: complexRoute.task,
        requiredCapabilities: complexRoute.requiredCapabilities,
        requiredTools: complexRoute.requiredTools,
        needsPlanning: true,
        ambiguity: [],
        routingReason: `Request is routed to executable multi-step landing page workflow using ${complexRoute.requiredTools.join(", ")}.`,
      });
    }

    return intentResultSchema.parse({
      primaryIntent: ROUTE_MISSING_INTENT,
      confidence: 0.7,
      task: complexRoute.task,
      requiredCapabilities: complexRoute.requiredCapabilities,
      requiredTools: [],
      needsPlanning: true,
      ambiguity: [
        {
          id: ROUTE_MISSING_INTENT,
          question: `This multi-step request requires missing tools ${missingTools.join(", ")} before it can run end-to-end.`,
          severity: "high",
        },
      ],
      routingReason: `Request is a multi-step workflow but registry is missing ${missingTools.join(", ")}.`,
    });
  }

  const canvasOperation = inferCanvasOperation(text, input);
  if (canvasOperation) {
    return intentResultSchema.parse(canvasOperation);
  }

  const missingCapability = inferMissingCapability(text);
  if (missingCapability) {
    return intentResultSchema.parse({
      primaryIntent: ROUTE_MISSING_INTENT,
      confidence: 0.68,
      task: createUnsupportedTask(
        input,
        missingCapability.capabilityId,
        missingCapability.taskKind
      ),
      requiredCapabilities: [missingCapability.capabilityId],
      requiredTools: [],
      needsPlanning: true,
      ambiguity: [
        {
          id: ROUTE_MISSING_INTENT,
          question: `Capability ${missingCapability.capabilityId} is required before this request can run.`,
          severity: "high",
        },
      ],
      routingReason: `Request requires ${missingCapability.capabilityId}, but no executor tool is registered for that capability.`,
    });
  }

  const requiredTools = [
    ...(hasReferenceImage ? [toolIds.analyzeReferenceImages] : []),
    toolIds.expandPrompt,
    toolIds.generateImage,
  ];

  return intentResultSchema.parse({
    primaryIntent: "image_generation",
    confidence: 0.9,
    task: createImageTask(input, hasReferenceImage),
    requiredCapabilities: [
      PROMPT_EXPAND_CAPABILITY_ID,
      IMAGE_GENERATE_CAPABILITY_ID,
    ],
    requiredTools,
    needsPlanning: true,
    ambiguity: [],
    routingReason: [
      "Input is routed to image_generation because the current runtime has image generation tools registered.",
      `Reference image context: ${hasReferenceImage ? "yes" : "no"}.`,
      `Capability summaries: ${capabilities.map(getCapabilitySummary).map((summary) => summary.capabilityId).join(", ")}.`,
    ].join(" "),
  });
}

export function validateIntentAgainstRegistry({
  capabilities,
  intent,
  toolRegistry,
}: {
  capabilities: RegisteredCapability[];
  intent: IntentResult;
  toolRegistry: ToolRegistry;
}) {
  const errors: string[] = [];
  const capabilityIds = new Set(
    [
      ...capabilities.map((capability) => capability.manifest.capabilityId),
      ...toolRegistry.listAll().map((tool) => tool.capabilityId),
    ]
  );
  const toolIdsByRegistry = new Set(
    toolRegistry.listAll().map((tool) => tool.id)
  );

  for (const capabilityId of intent.requiredCapabilities) {
    if (
      !capabilityIds.has(capabilityId) &&
      intent.primaryIntent !== ROUTE_MISSING_INTENT
    ) {
      errors.push(`Intent requires unavailable capability ${capabilityId}.`);
    }
  }

  for (const requiredToolId of intent.requiredTools) {
    if (!toolIdsByRegistry.has(requiredToolId)) {
      errors.push(`Intent requires unregistered tool ${requiredToolId}.`);
    }
  }

  if (!intent.primaryIntent.trim()) {
    errors.push("Intent is missing primaryIntent.");
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

function buildIntentRouterPrompt({
  capabilities,
  input,
  toolRegistry,
}: {
  capabilities: RegisteredCapability[];
  input: AgentInput;
  toolRegistry: ToolRegistry;
}) {
  return [
    "NORMALIZED_INPUT",
    JSON.stringify(
      {
        userMessage: input.userMessage,
        attachments: input.attachments.map((attachment) => ({
          id: attachment.id,
          kind: attachment.kind,
          name: attachment.name,
          mimeType: attachment.mimeType,
          contentRef: attachment.contentRef,
          artifactType: attachment.artifact?.type,
        })),
        selectedNodeId: input.canvasContext.selectedNodeId ?? null,
        selectedNode: input.canvasContext.upstreamContext.find(
          (item) => item.nodeId === input.canvasContext.selectedNodeId
        ),
        upstreamContext: input.canvasContext.upstreamContext.map((item) => ({
          nodeId: item.nodeId,
          type: item.type,
          artifactType: item.artifact?.type,
          title: item.title,
          summary: item.summary,
          prompt: item.prompt,
          contentRef: item.contentRef,
        })),
      },
      null,
      2
    ),
    "",
    "AVAILABLE_CAPABILITIES",
    JSON.stringify(capabilities.map(getCapabilitySummary), null, 2),
    "",
    "AVAILABLE_TOOLS",
    JSON.stringify(
      toolRegistry.listAll().map((tool) => ({
        id: tool.id,
        capabilityId: tool.capabilityId,
        name: tool.name,
        description: tool.description,
        policy: tool.policy,
        risk: tool.risk,
      })),
      null,
      2
    ),
    "",
    "SAFETY_POLICY",
    "Models may only choose capabilities and tools from the allowlist. Unsupported tasks must be explicit ambiguity instead of silently choosing image generation.",
  ].join("\n");
}

function inferComplexRoute(
  text: string,
  input: AgentInput
):
  | {
      requiredCapabilities: string[];
      requiredTools: string[];
      task: StructuredTask;
    }
  | undefined {
  const wantsPage = /(落地页|页面|网站|landing|page|website)/i.test(text);
  const wantsWeb = /(网页|调研|搜索|research|search|web)/i.test(text);
  const wantsImage = /(图片|图像|image|photo|视觉)/i.test(text);
  const wantsCanvas = /(画布|放到画布|canvas|节点|node)/i.test(text);

  if (!(wantsPage && (wantsWeb || wantsImage || wantsCanvas))) {
    return undefined;
  }

  const requiredCapabilities = [
    ...(wantsWeb ? ["web.research"] : []),
    ...(wantsImage ? ["asset.analyze"] : []),
    "page.generate",
    ...(wantsCanvas ? ["canvas.mutate"] : []),
  ];
  const requiredTools = [
    ...(wantsWeb ? [toolIds.readWebpage] : []),
    ...(wantsImage ? [toolIds.analyzeAssets] : []),
    toolIds.generatePage,
    ...(wantsCanvas ? [toolIds.createCanvasNode] : []),
  ];

  return {
    requiredCapabilities: [...new Set(requiredCapabilities)],
    requiredTools: [...new Set(requiredTools)],
    task: {
      kind: "multi_step",
      goals: [input.userMessage],
      targets: input.canvasContext.selectedNodeId
        ? [
            {
              id: input.canvasContext.selectedNodeId,
              kind: "canvas_node",
              ref: input.canvasContext.selectedNodeId,
              summary: "Selected canvas context for multi-step task",
            },
          ]
        : [],
      constraints: [
        {
          kind: "policy",
          text: "Do not silently route unsupported multi-step work to image generation.",
        },
      ],
      deliverables: [
        {
          kind: "webpage",
          description: "Generated landing page artifact.",
        },
        {
          kind: "canvas_node",
          description: "Canvas node containing or linking to the generated page.",
        },
      ],
      operations: [
        ...(wantsWeb
          ? [{ kind: "search" as const, target: "web_sources", toolHint: toolIds.readWebpage }]
          : []),
        ...(wantsImage
          ? [
              {
                kind: "analyze" as const,
                target: "image_context",
                toolHint: toolIds.analyzeAssets,
              },
            ]
          : []),
        { kind: "write", target: "landing_page", toolHint: toolIds.generatePage },
        ...(wantsCanvas
          ? [
              {
                kind: "create_canvas_node" as const,
                target: "generated_page",
                toolHint: toolIds.createCanvasNode,
              },
            ]
          : []),
      ],
    },
  };
}

function inferCanvasOperation(
  text: string,
  input: AgentInput
): IntentResult | undefined {
  if (!/(画布|canvas|节点|node|连线|edge|连接)/i.test(text)) {
    return undefined;
  }

  return {
    primaryIntent: "canvas_operation",
    confidence: 0.74,
    task: {
      kind: "canvas_operation",
      goals: [input.userMessage],
      targets: input.canvasContext.selectedNodeId
        ? [
            {
              id: input.canvasContext.selectedNodeId,
              kind: "canvas_node",
              ref: input.canvasContext.selectedNodeId,
              summary: "Selected canvas node",
            },
          ]
        : [],
      constraints: [
        {
          kind: "policy",
          text: "Canvas operations must be returned as validated CanvasOperation proposals.",
        },
      ],
      deliverables: [
        {
          kind: "canvas_node",
          description: "Canvas mutation proposal.",
        },
      ],
      operations: [
        {
          kind: "create_canvas_node",
          target: "canvas",
          toolHint: toolIds.createCanvasNode,
        },
      ],
    },
    requiredCapabilities: ["canvas.mutate"],
    requiredTools: [toolIds.createCanvasNode],
    needsPlanning: true,
    ambiguity: [],
    routingReason:
      "Input asks for a canvas operation and the runtime exposes canvas proposal tools.",
  };
}

function createImageTask(
  input: AgentInput,
  hasReferenceImage: boolean
): StructuredTask {
  return {
    kind: hasReferenceImage ? "image_editing" : "image_generation",
    goals: [input.userMessage],
    targets: input.canvasContext.selectedNodeId
      ? [
          {
            id: input.canvasContext.selectedNodeId,
            kind: "canvas_node",
            ref: input.canvasContext.selectedNodeId,
            summary: "Selected upstream canvas node",
          },
        ]
      : [],
    constraints: [
      {
        kind: "policy",
        text: "Model outputs must become validated tool inputs or canvas operation proposals.",
      },
    ],
    deliverables: [
      {
        kind: "image",
        description: "Generated image artifact attached to the run branch.",
      },
    ],
    operations: [
      ...(hasReferenceImage
        ? [
            {
              kind: "analyze" as const,
              target: "reference_images",
              toolHint: toolIds.analyzeReferenceImages,
            },
          ]
        : []),
      { kind: "generate", target: "expanded_prompt", toolHint: toolIds.generateImage },
      { kind: "attach_artifact", target: "run_canvas_branch", toolHint: toolIds.attachArtifact },
      { kind: "evaluate", target: "image_artifacts" },
    ],
  };
}

function createUnsupportedTask(
  input: AgentInput,
  capabilityId: string,
  taskKind: StructuredTask["kind"] = "multi_step"
): StructuredTask {
  return {
    kind: taskKind,
    goals: [input.userMessage],
    targets: [],
    constraints: [
      {
        kind: "policy",
        text: "Do not silently route unsupported capabilities to image generation.",
      },
    ],
    deliverables: [
      {
        kind: "analysis",
        description: `Capability ${capabilityId} needs executor registration before it can run.`,
      },
    ],
    operations: [],
  };
}

function inferMissingCapability(text: string):
  | {
      capabilityId: string;
      taskKind: StructuredTask["kind"];
    }
  | undefined {
  if (/(写|文档|报告|总结|document|doc|report|write)/i.test(text)) {
    return { capabilityId: "document.write", taskKind: "document_writing" };
  }
  if (/(落地页|页面|网站|landing|page|website)/i.test(text)) {
    return { capabilityId: "page.generate", taskKind: "page_generation" };
  }
  if (/(网页|调研|搜索|research|search|web)/i.test(text)) {
    return { capabilityId: "web.research", taskKind: "web_research" };
  }
  if (/(代码|修改代码|code|refactor|patch)/i.test(text)) {
    return { capabilityId: "code.modify", taskKind: "code_modification" };
  }
  if (/(文件|分析文件|file|analyze file)/i.test(text)) {
    return { capabilityId: "file.analyze", taskKind: "file_analysis" };
  }

  return undefined;
}
