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
import {
  inferSeedreamResultCount,
  readSeedreamMaxOutputImagesFromEnv,
} from "../../seedream.ts";
import {
  toModelSafeUpstreamContext,
  toModelSafeUpstreamContextItem,
} from "../prompts.ts";
import type { AgentInput, IntentResult, StructuredTask } from "../../src/types/runtime.ts";
import { intentResultSchema } from "./schemas.ts";
import { toolIds, type ToolRegistry } from "./tool-registry.ts";
import { runtimeErrorCodes, throwAgentError } from "./errors.ts";

const intentRouterSystemPrompt = [
  "You are Cucumber's Intent Router for an infinite canvas agent runtime.",
  "Return only structured intent data that matches the schema.",
  "Do not execute tools, create canvas nodes, or decide final tool arguments.",
  "Use only capability ids and tool ids that are present in the prompt allowlist.",
  "Classify in layers: coarse intent, target object, operation, constraints, deliverables, confidence, then route.",
  "Represent those layers through primaryIntent, task.kind, task.targets, task.operations, task.constraints, task.deliverables, confidence, ambiguity, requiredCapabilities, and requiredTools.",
  "Every required field must be present. Arrays such as task.targets, task.constraints, task.deliverables, task.operations, and ambiguity must contain objects, never plain strings.",
  "Use the exact enum values shown in the prompt. Do not invent shorthand values such as generate or generate_images.",
  "Do not choose an image route unless the user explicitly asks to create or edit an image artifact.",
  "If the request is unsupported or ambiguous, still return a structured task and add ambiguity entries instead of silently choosing a nearby tool.",
].join("\n");

const taskKindValues = [
  "image_generation",
  "image_editing",
  "page_generation",
  "page_editing",
  "document_writing",
  "web_research",
  "file_analysis",
  "code_modification",
  "canvas_operation",
  "multi_step",
];

const targetKindValues = [
  "canvas_node",
  "artifact",
  "file",
  "webpage",
  "project",
  "unknown",
];

const constraintKindValues = [
  "style",
  "format",
  "policy",
  "budget",
  "quality",
  "other",
];

const deliverableKindValues = [
  "image",
  "document",
  "code",
  "webpage",
  "canvas_node",
  "analysis",
  "decision",
];

const operationKindValues = [
  "generate",
  "edit",
  "analyze",
  "write",
  "search",
  "create_canvas_node",
  "attach_artifact",
  "evaluate",
];

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
  const runtimeIntent = normalizeIntentForRuntimeContract({
    intent: routed,
    toolRegistry,
  });
  return validateRoutedIntent({ capabilities, intent: runtimeIntent, toolRegistry });
}

function validateRoutedIntent({
  capabilities,
  intent,
  toolRegistry,
}: {
  capabilities: RegisteredCapability[];
  intent: IntentResult;
  toolRegistry: ToolRegistry;
}) {
  const validation = validateIntentAgainstRegistry({
    capabilities,
    intent,
    toolRegistry,
  });

  if (!validation.ok) {
    throwAgentError({
      code: runtimeErrorCodes.CAPABILITY_UNAVAILABLE,
      message: validation.errors.join("; "),
      retryable: false,
      severity: "error",
      details: { validation, intent },
    });
  }

  return intent;
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
    const documentRoute = !isExplicitImageGenerationRequest(input)
      ? inferDocumentRoute(text, input, toolRegistry)
      : undefined;
    if (documentRoute) {
      return intentResultSchema.parse({
        ...documentRoute,
        routingReason: `Matched non-image capability ${nonImageCapability.manifest.capabilityId}; routed to Markdown document output instead of image generation.`,
      });
    }

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
      task: getMissingComplexRouteTask(input, complexRoute),
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

  if (!isExplicitImageGenerationRequest(input)) {
    const documentRoute = inferDocumentRoute(text, input, toolRegistry);
    if (documentRoute) {
      return documentRoute;
    }

    const missingCapability =
      inferMissingCapability(text) ?? inferAnalysisCapability(text);
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

    const capabilityId = "capability.unsupported";
    return intentResultSchema.parse({
      primaryIntent: ROUTE_MISSING_INTENT,
      confidence: 0.66,
      task: createUnsupportedTask(
        input,
        capabilityId,
        "multi_step"
      ),
      requiredCapabilities: [capabilityId],
      requiredTools: [],
      needsPlanning: true,
      ambiguity: [
        {
          id: ROUTE_MISSING_INTENT,
          question: `Capability ${capabilityId} is required before this request can run.`,
          severity: "high",
        },
      ],
      routingReason:
        "Request does not explicitly ask for an image artifact, so it is not routed to image generation.",
    });
  }

  const requiredTools = [toolIds.expandPrompt, toolIds.generateImage];

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

  if (
    isRuntimeImageIntent(intent) &&
    intent.requiredTools.includes(toolIds.generateImage) &&
    !intent.requiredTools.includes(toolIds.expandPrompt)
  ) {
    errors.push(
      `Image generation intent must expose ${toolIds.expandPrompt} before ${toolIds.generateImage}.`
    );
  }

  if (!intent.primaryIntent.trim()) {
    errors.push("Intent is missing primaryIntent.");
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

function normalizeIntentForRuntimeContract({
  intent,
  toolRegistry,
}: {
  intent: IntentResult;
  toolRegistry: ToolRegistry;
}): IntentResult {
  if (
    !isRuntimeImageIntent(intent) ||
    !toolRegistry.getTool(toolIds.generateImage)
  ) {
    return intent;
  }

  const requiredImageTools = [
    ...(toolRegistry.getTool(toolIds.expandPrompt) ? [toolIds.expandPrompt] : []),
    toolIds.generateImage,
  ];
  const imageToolSet = new Set<string>(requiredImageTools);
  const requiredTools = uniqueInOrder([
    ...requiredImageTools,
    ...intent.requiredTools.filter((toolId) => !imageToolSet.has(toolId)),
  ]);
  const requiredCapabilities = uniqueInOrder([
    ...(toolRegistry.getTool(toolIds.expandPrompt)
      ? [PROMPT_EXPAND_CAPABILITY_ID]
      : []),
    IMAGE_GENERATE_CAPABILITY_ID,
    ...intent.requiredCapabilities,
  ]);

  return intentResultSchema.parse({
    ...intent,
    requiredCapabilities,
    requiredTools,
  });
}

function isRuntimeImageIntent(intent: IntentResult) {
  return (
    intent.primaryIntent === "image_generation" ||
    intent.primaryIntent === "image_editing" ||
    intent.task.kind === "image_generation" ||
    intent.task.kind === "image_editing" ||
    intent.requiredTools.includes(toolIds.generateImage)
  );
}

function uniqueInOrder<T>(items: T[]) {
  return Array.from(new Set(items));
}

function isExplicitImageGenerationRequest(input: AgentInput) {
  const text = input.userMessage.toLowerCase();
  const hasReferenceImage = input.canvasContext.upstreamContext.some(
    (item) => item.type === "image" || item.artifact?.type === "image"
  );
  const asksForImageArtifact =
    /(图片|图像|照片|海报|插画|一张图|[一二三四五六七八九十百两\d]+张.{0,16}图|的图|出图|logo|image|picture|photo|poster|illustration|graphic)/i.test(
      text
    );
  const asksToCreateOrEdit =
    /(生成|绘制|画|做一张|创建|出图|改成|重绘|编辑|generate|create|make|draw|render|edit|modify)/i.test(
      text
    );

  if (asksForImageArtifact && asksToCreateOrEdit) {
    return true;
  }

  return (
    hasReferenceImage &&
    /(参考|基于|继续|改|编辑|变成|重绘|reference|based on|edit|modify)/i.test(
      text
    ) &&
    asksToCreateOrEdit
  );
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
          contentRef:
            attachment.kind === "image" ? undefined : attachment.contentRef,
          artifactType: attachment.artifact?.type,
        })),
        selectedNodeId: input.canvasContext.selectedNodeId ?? null,
        selectedNode: (() => {
          const selected = input.canvasContext.upstreamContext.find(
            (item) => item.nodeId === input.canvasContext.selectedNodeId
          );
          return selected ? toModelSafeUpstreamContextItem(selected) : undefined;
        })(),
        upstreamContext: toModelSafeUpstreamContext(
          input.canvasContext.upstreamContext
        ),
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
    "INTENT_RESULT_REQUIRED_SHAPE",
    buildIntentResultShapeHint(),
    "",
    "ENUM_VALUES",
    JSON.stringify(
      {
        taskKind: taskKindValues,
        targetKind: targetKindValues,
        constraintKind: constraintKindValues,
        deliverableKind: deliverableKindValues,
        operationKind: operationKindValues,
        ambiguitySeverity: ["low", "medium", "high"],
      },
      null,
      2
    ),
    "",
    "PREFERRED_INTENT_EXAMPLE",
    JSON.stringify(buildPreferredIntentExample({ input, toolRegistry }), null, 2),
    "",
    "SAFETY_POLICY",
    "Models may only choose capabilities and tools from the allowlist. Unsupported tasks must be explicit ambiguity instead of silently choosing image generation.",
  ].join("\n");
}

function buildIntentResultShapeHint() {
  return JSON.stringify(
    {
      primaryIntent: "image_generation | document_writing | web_research | multi_step | ...",
      confidence: 0.9,
      task: {
        kind: "one taskKind enum value",
        goals: ["user-facing goal text"],
        targets: [
          {
            id: "optional canvas/artifact id",
            kind: "one targetKind enum value",
            ref: "optional reference",
            summary: "optional target summary",
          },
        ],
        constraints: [
          {
            kind: "one constraintKind enum value",
            text: "constraint text",
          },
        ],
        deliverables: [
          {
            kind: "one deliverableKind enum value",
            description: "expected output artifact",
            count: 1,
          },
        ],
        operations: [
          {
            kind: "one operationKind enum value",
            target: "operation target",
            toolHint: "optional runtime tool id from AVAILABLE_TOOLS",
          },
        ],
      },
      requiredCapabilities: ["capability.id.from.allowlist"],
      requiredTools: ["runtime.toolId.from.allowlist"],
      needsPlanning: true,
      ambiguity: [
        {
          id: "question-id",
          question: "clarifying question or limitation",
          options: ["optional choice"],
          severity: "low | medium | high",
        },
      ],
      routingReason: "short reason grounded in the user request and allowlist",
    },
    null,
    2
  );
}

function buildPreferredIntentExample({
  input,
  toolRegistry,
}: {
  input: AgentInput;
  toolRegistry: ToolRegistry;
}) {
  const hasReferenceImage = input.canvasContext.upstreamContext.some(
    (item) => item.type === "image" || item.artifact?.type === "image"
  );
  if (
    !isExplicitImageGenerationRequest(input) ||
    !toolRegistry.getTool(toolIds.generateImage)
  ) {
    return {
      note:
        "No preferred example for this request. Return the required shape using the allowlisted capabilities and tools.",
    };
  }

  const requiredTools = [
    ...(toolRegistry.getTool(toolIds.expandPrompt) ? [toolIds.expandPrompt] : []),
    toolIds.generateImage,
  ];

  return intentResultSchema.parse({
    primaryIntent: hasReferenceImage ? "image_editing" : "image_generation",
    confidence: 0.9,
    task: createImageTask(input, hasReferenceImage),
    requiredCapabilities: [
      ...(toolRegistry.getTool(toolIds.expandPrompt)
        ? [PROMPT_EXPAND_CAPABILITY_ID]
        : []),
      IMAGE_GENERATE_CAPABILITY_ID,
    ],
    requiredTools,
    needsPlanning: true,
    ambiguity: [],
    routingReason: [
      "User explicitly asks to create image artifacts.",
      `Reference image context: ${hasReferenceImage ? "yes" : "no"}.`,
    ].join(" "),
  });
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
  const wantsPage = isPageRequest(text);
  const wantsWeb =
    /(https?:\/\/|调研|搜索|查找|资料|来源|联网|research|search|sources?|current|latest|(?:根据|基于|参考).{0,12}网页|网页.{0,8}(?:资料|来源|调研|搜索))/i.test(
      text
    );
  const webSourceToolId = hasExplicitWebpageSource(text, input)
    ? toolIds.readWebpage
    : toolIds.searchWeb;
  const wantsAssetContext =
    /(图片|图像|照片|素材|image|photo|asset)/i.test(text) ||
    input.canvasContext.upstreamContext.some(
      (item) => item.type === "image" || item.artifact?.type === "image"
    );
  const wantsCanvas = /(画布|放到画布|canvas|节点|node)/i.test(text);
  const wantsReportFirst =
    wantsTextDocumentOutput(text) ||
    /(分析|报告|研究|总结|梳理|视觉风格|风格|analysis|report|style)/i.test(text);

  if (!wantsPage) {
    return undefined;
  }

  const requiredCapabilities = [
    ...(wantsWeb ? ["web.research"] : []),
    ...(wantsAssetContext ? ["asset.analyze"] : []),
    ...(wantsReportFirst ? ["document.write"] : []),
    "html.generate",
    ...(wantsCanvas ? ["canvas.mutate"] : []),
  ];
  const requiredTools = [
    ...(wantsWeb ? [webSourceToolId] : []),
    ...(wantsAssetContext ? [toolIds.analyzeAssets] : []),
    ...(wantsReportFirst ? [toolIds.writeDocument] : []),
    toolIds.generateHtml,
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
        ...(wantsReportFirst
          ? [
              {
                kind: "document" as const,
                description: "Markdown analysis report used as source material for the HTML page.",
              },
            ]
          : []),
        {
          kind: "webpage",
          description: wantsReportFirst
            ? "Generated HTML page artifact based on the analysis report."
            : "Generated landing page artifact.",
        },
        ...(wantsCanvas
          ? [
              {
                kind: "canvas_node" as const,
                description:
                  "Canvas node containing or linking to the generated page artifact.",
              },
            ]
          : []),
      ],
    operations: [
        ...(wantsWeb
          ? [{ kind: "search" as const, target: "web_sources", toolHint: webSourceToolId }]
          : []),
        ...(wantsAssetContext
          ? [
              {
                kind: "analyze" as const,
                target: "image_context",
                toolHint: toolIds.analyzeAssets,
              },
            ]
          : []),
        ...(wantsReportFirst
          ? [
              {
                kind: "write" as const,
                target: "analysis_report",
                toolHint: toolIds.writeDocument,
              },
            ]
          : []),
        {
          kind: "write",
          target: wantsReportFirst ? "html_page_from_report" : "landing_page",
          toolHint: toolIds.generateHtml,
        },
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

function hasExplicitWebpageSource(text: string, input: AgentInput) {
  if (/https?:\/\/\S+/i.test(text)) {
    return true;
  }

  return input.canvasContext.upstreamContext.some(
    (item) =>
      item.type === "webpage" ||
      item.artifact?.type === "webpage" ||
      isHttpUrl(item.contentRef) ||
      isHttpUrl(item.artifact?.uri) ||
      isHttpUrl(item.artifact?.contentRef)
  );
}

function getMissingComplexRouteTask(
  input: AgentInput,
  complexRoute: NonNullable<ReturnType<typeof inferComplexRoute>>
): StructuredTask {
  if (
    complexRoute.requiredTools.length === 1 &&
    complexRoute.requiredTools[0] === toolIds.generateHtml
  ) {
    return createUnsupportedTask(input, "html.generate", "page_generation");
  }

  return complexRoute.task;
}

function inferDocumentRoute(
  text: string,
  input: AgentInput,
  toolRegistry: ToolRegistry
): IntentResult | undefined {
  if (!toolRegistry.getTool(toolIds.writeDocument)) {
    return undefined;
  }

  const wantsWebResearch =
    /(最新|今天|现在|近期|网页|联网|调研|搜索|查找|资料|来源|news|latest|current|recent|research|search|web|sources?)/i.test(
      text
    );
  if (wantsWebResearch && toolRegistry.getTool(toolIds.searchWeb)) {
    return intentResultSchema.parse({
      primaryIntent: "web_research",
      confidence: 0.82,
      task: {
        kind: "web_research",
        goals: [input.userMessage],
        targets: input.canvasContext.selectedNodeId
          ? [
              {
                id: input.canvasContext.selectedNodeId,
                kind: "canvas_node",
                ref: input.canvasContext.selectedNodeId,
                summary: "Selected canvas context for web research",
              },
            ]
          : [],
        constraints: [
          {
            kind: "policy",
            text: "Web research must use the registered search tool and cite returned sources in the Markdown document artifact.",
          },
        ],
        deliverables: [
          {
            kind: "document",
            description:
              "Markdown research document grounded in Tavily search results.",
          },
        ],
        operations: [
          { kind: "search", target: "web_sources", toolHint: toolIds.searchWeb },
          {
            kind: "write",
            target: "research_document",
            toolHint: toolIds.writeDocument,
          },
          { kind: "evaluate", target: "document_artifact" },
        ],
      },
      requiredCapabilities: ["web.research", "document.write"],
      requiredTools: [toolIds.searchWeb, toolIds.writeDocument],
      needsPlanning: true,
      ambiguity: [],
      routingReason:
        "Request asks for web research/current sources; route to Tavily web search followed by Markdown document output.",
    });
  }

  const wantsDocument = wantsTextDocumentOutput(text);
  const missingCapability = inferMissingCapability(text);
  const analysisCapability = inferAnalysisCapability(text);
  const operationalOnly = isOperationalOnlyRequest(text);
  const isCapabilityReport = Boolean(
    !wantsDocument && (missingCapability || (operationalOnly && !analysisCapability))
  );
  const primaryIntent = isCapabilityReport
    ? "document.capability_report"
    : analysisCapability
      ? "document.analysis"
      : "document_writing";
  const operations = [
    ...(analysisCapability
      ? [{ kind: "analyze" as const, target: "available_context" }]
      : []),
    {
      kind: "write" as const,
      target: isCapabilityReport ? "capability_gap_report" : "markdown_document",
      toolHint: toolIds.writeDocument,
    },
    { kind: "evaluate" as const, target: "document_artifact" },
  ];

  return intentResultSchema.parse({
    primaryIntent,
    confidence: isCapabilityReport ? 0.58 : 0.78,
    task: {
      kind: "document_writing",
      goals: [input.userMessage],
      targets: input.canvasContext.selectedNodeId
        ? [
            {
              id: input.canvasContext.selectedNodeId,
              kind: "canvas_node",
              ref: input.canvasContext.selectedNodeId,
              summary: "Selected canvas context for document output",
            },
          ]
        : [],
      constraints: [
        {
          kind: "policy",
          text: "Text-first tasks must produce a Markdown document artifact instead of silently routing to image generation.",
        },
        ...(isCapabilityReport && missingCapability
          ? [
              {
                kind: "policy" as const,
                text: `The requested ${missingCapability.capabilityId} action is not executable; document the limitation and next steps without claiming completion.`,
              },
            ]
          : []),
      ],
      deliverables: [
        {
          kind: "document",
          description: isCapabilityReport
            ? "Markdown document explaining the unsupported capability and next steps."
            : "Markdown document artifact with the requested analysis or written output.",
        },
      ],
      operations,
    },
    requiredCapabilities: ["document.write"],
    requiredTools: [toolIds.writeDocument],
    needsPlanning: true,
    ambiguity: isCapabilityReport
      ? [
          {
            id: "document.capability_report",
            question:
              "The requested operational capability is not executable in this runtime, so a document report will be produced instead.",
            severity: "medium",
          },
        ]
      : [],
    routingReason: isCapabilityReport
      ? "Request needs an unavailable operational capability; route to a Markdown capability report so the user still gets an honest artifact."
      : "Request is text-first and does not explicitly ask for an image artifact; route to Markdown document output.",
  });
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
  const resultCount = inferSeedreamResultCount(
    input.userMessage,
    readSeedreamMaxOutputImagesFromEnv()
  );

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
      ...(hasReferenceImage
        ? [
            {
              kind: "policy" as const,
              text: "Reference images are passed directly to the image generation provider and must not be analyzed by the language model.",
            },
          ]
        : []),
    ],
    deliverables: [
      {
        kind: "image",
        description: "Generated image artifact attached to the run branch.",
        count: resultCount,
      },
    ],
    operations: [
      {
        kind: "generate",
        target: "expanded_prompt",
        toolHint: toolIds.expandPrompt,
      },
      {
        kind: "attach_artifact",
        target: "run_canvas_branch",
      },
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
  if (isPageRequest(text)) {
    return { capabilityId: "html.generate", taskKind: "page_generation" };
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

function isPageRequest(text: string) {
  if (/(落地页|官网|单页|h5|html|landing\s*page|web\s*page|homepage)/i.test(text)) {
    return true;
  }

  return (
    /(网页|页面|网站|站点|website|site|\bpage\b)/i.test(text) &&
    /(生成|创建|制作|做|设计|写|搭|输出|预览|create|make|build|design|generate|write|prototype)/i.test(
      text
    ) &&
    !isOperationalOnlyRequest(text)
  );
}

function inferAnalysisCapability(text: string):
  | {
      capabilityId: string;
      taskKind: StructuredTask["kind"];
    }
  | undefined {
  if (/(分析|视觉风格|风格|analyze|analysis|style)/i.test(text)) {
    return { capabilityId: "asset.analyze", taskKind: "file_analysis" };
  }

  return undefined;
}

function wantsTextDocumentOutput(text: string) {
  return /(分析|总结|报告|文档|方案|规划|计划|说明|解释|比较|评估|复盘|建议|问答|回答|写|输出\s*(?:md|markdown)|analyze|analysis|summarize|summary|report|document|doc|plan|explain|compare|evaluate|write|answer)/i.test(
    text
  );
}

function isOperationalOnlyRequest(text: string) {
  return /(修改代码|修复代码|提交代码|创建文件|删除文件|部署|发邮件|付款|支付|登录|操作浏览器|code\s*(?:modify|patch|change)|deploy|send email|payment|login|browser automation)/i.test(
    text
  );
}

function isHttpUrl(value: unknown): value is string {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}
