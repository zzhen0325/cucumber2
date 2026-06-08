import { z } from "zod";

import {
  generateSeedreamImage,
  inferSeedreamResultCountFromPrompts,
  readSeedreamMaxOutputImagesFromEnv,
  type SeedreamGenerateInput,
  type SeedreamUpstreamContext,
} from "../../../seedream.ts";
import {
  IMAGE_GENERATE_CAPABILITY_ID,
  PROMPT_EXPAND_CAPABILITY_ID,
  assertCapabilityMayExecute,
  requireCapability,
  type RegisteredCapability,
} from "../../capabilities.ts";
import {
  generateTextWithProvider,
  type ModelProviderId,
} from "../../model-providers.ts";
import {
  PROMPT_EXPAND_SYSTEM_PROMPT,
  REFERENCE_IMAGE_ANALYSIS_SYSTEM_PROMPT,
  renderRuntimePromptAssembly,
  selectPromptExpandMode,
  selectReferenceImages,
  selectRelevantSkillConfig,
  type PromptCanvasContext,
  type ReferenceImageInput,
} from "../../prompts.ts";
import { createArtifact, type AgentSkill } from "../../supabase.ts";
import type { AgentStep, BuiltContext } from "../../../src/types/runtime.ts";
import type { RuntimeToolDefinition } from "../tool-registry.ts";
import { toolResultSchema } from "../schemas.ts";
import { TOOL_DEFINITION_VERSION, toolIds } from "./ids.ts";

const referenceImageInputSchema = z.object({
  prompt: z.string().min(1),
  selectedNodeId: z.string().nullable(),
  imageCount: z.number().int().nonnegative(),
  referenceImages: z.array(
    z.object({
      nodeId: z.string(),
      imageUrl: z.string(),
      prompt: z.string().optional(),
      summary: z.string().optional(),
    })
  ),
  modelProvider: z.literal("ark"),
  promptTrace: z.record(z.string(), z.unknown()).optional(),
});

const referenceImageOutputSchema = z.object({
  imageCount: z.number().int().nonnegative(),
  analysis: z.string(),
  modelProvider: z.literal("ark"),
});

const promptExpandInputSchema = z.object({
  prompt: z.string().min(1),
  selectedNodeId: z.string().nullable(),
  upstreamContext: z.array(z.unknown()),
  contextTrace: z.unknown().optional(),
  skillSlug: z.literal("prompt-expand"),
  modelProvider: z.string(),
  referenceImageAnalysis: z.string().optional(),
  promptTrace: z.record(z.string(), z.unknown()).optional(),
});

const promptExpandOutputSchema = z.object({
  originalPrompt: z.string(),
  expandedPrompt: z.string().min(1),
  referenceImageAnalysis: z.string().optional(),
  capabilityId: z.string(),
  skill: z.object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
  }),
  promptTrace: z.record(z.string(), z.unknown()),
});

const generateImageInputSchema = z.object({
  prompt: z.string().min(1),
  originalPrompt: z.string().min(1),
  selectedNodeId: z.string().nullable(),
  upstreamContext: z.array(z.unknown()),
  resultCount: z.number().int().positive(),
  promptSkill: z.object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
  }),
  capabilityIds: z.array(z.string()),
  contextTrace: z.unknown().optional(),
  sourceContextCount: z.number().int().nonnegative(),
});

const generateImageOutputSchema = z.object({
  images: z.array(z.unknown()),
  artifacts: z.array(z.unknown()),
});

export function createReferenceImageTool({
  canvasContext,
  imageCapability,
  referenceImages,
}: {
  canvasContext: PromptCanvasContext;
  imageCapability: RegisteredCapability;
  referenceImages: ReferenceImageInput[];
}): RuntimeToolDefinition {
  return {
    id: toolIds.analyzeReferenceImages,
    version: TOOL_DEFINITION_VERSION,
    toPlannerToolName: "analyze_reference_images",
    capabilityId: imageCapability.manifest.capabilityId,
    name: "Analyze reference images",
    description: "Analyze upstream image context before prompt expansion.",
    inputSchema: referenceImageInputSchema,
    outputSchema: referenceImageOutputSchema,
    policy: {
      ...imageCapability.manifest.policy,
      canUseNetwork: true,
      mayExternalCost: true,
    },
    timeoutMs: 60_000,
    retryPolicy: { maxRetries: 0, backoffMs: 0, retryableErrorCodes: [] },
    risk: "medium",
    renderHint: { kind: "text", label: "Reference image analysis" },
    prepareInput: ({ context }) => {
      const assembly = buildReferenceImagePromptAssembly({
        context,
        referenceImages,
      });
      return {
        prompt: canvasContext.prompt,
        selectedNodeId: canvasContext.selectedNodeId ?? null,
        imageCount: referenceImages.length,
        referenceImages: referenceImages.map((image) => ({
          nodeId: image.nodeId,
          imageUrl: image.imageUrl,
          prompt: image.prompt,
          summary: image.summary,
        })),
        modelProvider: "ark",
        promptTrace: assembly.trace,
      };
    },
    async execute(input, toolContext) {
      assertCapabilityMayExecute(imageCapability);
      const parsed = referenceImageInputSchema.parse(input);
      const assembly = buildReferenceImagePromptAssembly({
        context: toolContext.context,
        referenceImages: parsed.referenceImages,
      });
      const analysis = (
        await generateTextWithProvider("ark", {
          system: REFERENCE_IMAGE_ANALYSIS_SYSTEM_PROMPT,
          prompt: assembly.prompt,
          imageUrls: parsed.referenceImages.map((image) => image.imageUrl),
          maxOutputTokens: 900,
        })
      ).trim();

      if (!analysis) {
        throw new Error("Ark reference image analysis returned empty text.");
      }

      return toolResultSchema.parse({
        ok: true,
        data: {
          imageCount: parsed.imageCount,
          analysis,
          modelProvider: "ark",
        },
        artifacts: [],
        canvasOperations: [],
        logs: [toolLog("Reference images analyzed.")],
      });
    },
  };
}

export function createPromptExpandTool({
  canvasContext,
  modelProvider,
  promptExpandCapability,
  promptSkill,
}: {
  canvasContext: PromptCanvasContext;
  modelProvider: ModelProviderId;
  promptExpandCapability: RegisteredCapability;
  promptSkill: AgentSkill;
}): RuntimeToolDefinition {
  return {
    id: toolIds.expandPrompt,
    version: TOOL_DEFINITION_VERSION,
    toPlannerToolName: "expand_prompt",
    capabilityId: promptExpandCapability.manifest.capabilityId,
    name: "Expand prompt",
    description: "Expand the user prompt with the prompt-expand skill.",
    inputSchema: promptExpandInputSchema,
    outputSchema: promptExpandOutputSchema,
    policy: promptExpandCapability.manifest.policy,
    timeoutMs: 60_000,
    retryPolicy: { maxRetries: 0, backoffMs: 0, retryableErrorCodes: [] },
    risk: "low",
    renderHint: { kind: "text", label: "Expanded prompt" },
    prepareInput: ({ context, previousSteps }) => {
      const referenceImageAnalysis = readPreviousData<{ analysis?: string }>(
        previousSteps,
        toolIds.analyzeReferenceImages
      )?.analysis;
      const assembly = buildPromptExpandPromptAssembly({
        canvasContext,
        context,
        referenceImageAnalysis,
        skill: promptSkill,
      });
      return {
        prompt: canvasContext.prompt,
        selectedNodeId: canvasContext.selectedNodeId ?? null,
        upstreamContext: canvasContext.upstreamContext,
        contextTrace: canvasContext.contextTrace,
        skillSlug: "prompt-expand",
        modelProvider,
        referenceImageAnalysis,
        promptTrace: assembly.trace,
      };
    },
    async execute(input, toolContext) {
      assertCapabilityMayExecute(promptExpandCapability);
      const parsed = promptExpandInputSchema.parse(input);
      const skillAssembly = buildPromptExpandPromptAssembly({
        canvasContext,
        context: toolContext.context,
        referenceImageAnalysis: parsed.referenceImageAnalysis,
        skill: promptSkill,
      });
      const expandedPrompt = (
        await generateTextWithProvider(modelProvider, {
          system: PROMPT_EXPAND_SYSTEM_PROMPT,
          prompt: skillAssembly.prompt,
          maxOutputTokens: 1_200,
        })
      ).trim();

      if (!expandedPrompt) {
        throw new Error("prompt-expand skill returned an empty prompt.");
      }

      return toolResultSchema.parse({
        ok: true,
        data: {
          originalPrompt: canvasContext.prompt,
          expandedPrompt,
          referenceImageAnalysis: parsed.referenceImageAnalysis,
          capabilityId: promptExpandCapability.manifest.capabilityId,
          skill: getSkillToolSummary(promptSkill),
          promptTrace: skillAssembly.trace,
        },
        artifacts: [],
        canvasOperations: [],
        logs: [toolLog("Prompt expanded.")],
      });
    },
  };
}

export function createGenerateImageTool({
  canvasContext,
  capabilities,
  imageCapability,
  projectId,
  runNodeId,
}: {
  canvasContext: PromptCanvasContext;
  capabilities: RegisteredCapability[];
  imageCapability: RegisteredCapability;
  projectId: string;
  runNodeId: string;
}): RuntimeToolDefinition {
  return {
    id: toolIds.generateImage,
    version: TOOL_DEFINITION_VERSION,
    toPlannerToolName: "generate_image",
    capabilityId: imageCapability.manifest.capabilityId,
    name: "Generate image",
    description: "Generate image artifacts with Seedream.",
    inputSchema: generateImageInputSchema,
    outputSchema: generateImageOutputSchema,
    policy: imageCapability.manifest.policy,
    timeoutMs: 180_000,
    retryPolicy: { maxRetries: 0, backoffMs: 0, retryableErrorCodes: [] },
    risk: "medium",
    renderHint: { kind: "image", label: "Generated images" },
    prepareInput: ({ previousSteps }) => {
      const promptOutput = readPreviousData<{ expandedPrompt?: string }>(
        previousSteps,
        toolIds.expandPrompt
      );
      if (!promptOutput?.expandedPrompt) {
        throw new Error("Cannot generate image before prompt.expand output.");
      }
      const promptSkill =
        requireCapability(capabilities, PROMPT_EXPAND_CAPABILITY_ID).skill;
      if (!promptSkill) {
        throw new Error("请先在 Skill 面板上传 prompt-expand skill。");
      }
      const capabilityIds = [
        PROMPT_EXPAND_CAPABILITY_ID,
        IMAGE_GENERATE_CAPABILITY_ID,
      ];

      return {
        prompt: promptOutput.expandedPrompt,
        originalPrompt: canvasContext.prompt,
        selectedNodeId: canvasContext.selectedNodeId ?? null,
        upstreamContext: toSeedreamUpstreamContext(canvasContext.upstreamContext),
        resultCount: inferSeedreamResultCountFromPrompts(
          [canvasContext.prompt, promptOutput.expandedPrompt],
          readSeedreamMaxOutputImagesFromEnv()
        ),
        promptSkill: getSkillToolSummary(promptSkill as AgentSkill),
        capabilityIds,
        contextTrace: canvasContext.contextTrace,
        sourceContextCount: canvasContext.upstreamContext.length,
      };
    },
    async execute(input, context) {
      assertCapabilityMayExecute(imageCapability);
      const parsed = generateImageInputSchema.parse(input);
      const output = await generateSeedreamImage(parsed as SeedreamGenerateInput);
      const artifacts = [];
      const images = [];

      for (const image of output.images) {
        const artifact = await createArtifact({
          id: image.id,
          projectId,
          runNodeId,
          type: "image",
          uri: image.url,
          title: image.title,
          metadata: image.metadata ?? {},
          toolCallId: context.step.id,
          sourceNodeId: canvasContext.selectedNodeId ?? null,
        });
        artifacts.push(artifact);
        images.push({ ...image, artifact });
      }

      return toolResultSchema.parse({
        ok: true,
        data: { images, artifacts },
        artifacts,
        canvasOperations: artifacts.map((artifact) => ({
          id: `patch-${runNodeId}-${artifact.id}`,
          projectId,
          type: "attachArtifact",
          payload: {
            nodeId: `image-${artifact.id}`,
            artifactId: artifact.id,
            artifact,
          },
        })),
        logs: [toolLog(`Generated ${artifacts.length} image artifact(s).`)],
      });
    },
  };
}

export function selectRuntimeReferenceImages(canvasContext: PromptCanvasContext) {
  return selectReferenceImages(canvasContext, 4);
}

function buildReferenceImagePromptAssembly({
  context,
  referenceImages,
}: {
  context: BuiltContext;
  referenceImages: ReferenceImageInput[];
}) {
  return renderRuntimePromptAssembly([
    ...context.promptParts,
    runtimePromptPart(
      "reference-analysis.reference-images",
      "reference_images",
      referenceImages
        .map((image, index) =>
          [
            `[${index + 1}]`,
            `nodeId: ${image.nodeId}`,
            `summary: ${image.summary?.trim() || "None"}`,
            `prompt: ${image.prompt?.trim() || "None"}`,
            `imageUrl: ${image.imageUrl}`,
          ].join("\n")
        )
        .join("\n\n") || "None"
    ),
    runtimePromptPart(
      "reference-analysis.instruction",
      "instruction",
      "请输出一段中文视觉摘要，聚焦主体、风格、构图、色彩、材质、光影、文字版式和与当前用户需求相关的可复用约束。"
    ),
  ]);
}

function buildPromptExpandPromptAssembly({
  canvasContext,
  context,
  referenceImageAnalysis,
  skill,
}: {
  canvasContext: PromptCanvasContext;
  context: BuiltContext;
  referenceImageAnalysis?: string;
  skill: AgentSkill;
}) {
  const mode = selectPromptExpandMode(canvasContext);
  const relevantConfig = selectRelevantSkillConfig(skill, mode);

  return renderRuntimePromptAssembly([
    ...context.promptParts,
    runtimePromptPart(
      "prompt-expand.skill-metadata",
      "skill_metadata",
      [
        `name: ${skill.name}`,
        `description: ${skill.description?.trim() || "None"}`,
        `mode: ${mode}`,
      ].join("\n")
    ),
    runtimePromptPart(
      "prompt-expand.skill-instructions",
      "skill_instructions",
      skill.instructions
    ),
    runtimePromptPart(
      "prompt-expand.relevant-config",
      "skill_config",
      JSON.stringify(relevantConfig, null, 2)
    ),
    runtimePromptPart(
      "prompt-expand.reference-image-analysis",
      "reference_image_analysis",
      referenceImageAnalysis?.trim() || "None"
    ),
    runtimePromptPart(
      "prompt-expand.instruction",
      "instruction",
      "请根据以上 section 输出一段可直接用于图像生成的自然语言 prompt，保持用户原意，优先吸收参考图视觉摘要和相关上游上下文。若用户要求生成多张/多个结果，这只是输出数量要求，不要改写为一组、拼图、四宫格、合集或单张图内的多图构图，除非用户明确要求单张图内包含组合画面。"
    ),
  ]);
}

function runtimePromptPart(id: string, category: string, content: string) {
  return {
    id,
    category,
    content,
    tokenEstimate: estimatePromptTokens(content),
  };
}

function estimatePromptTokens(text: string) {
  return Math.max(1, Math.ceil(Array.from(text.trim() || "None").length / 4));
}

function readPreviousData<T>(
  steps: AgentStep[],
  toolId: string
): T | undefined {
  const aliases = getToolStepAliases(toolId);
  const match = steps
    .slice()
    .reverse()
    .find(
      (step) =>
        step.output?.data &&
        aliases.some(
          (alias) => step.planStepId === alias || step.id.includes(alias)
        )
    );

  return match?.output?.data as T | undefined;
}

function getToolStepAliases(toolId: string) {
  const aliases: Record<string, string[]> = {
    [toolIds.analyzeReferenceImages]: [
      toolIds.analyzeReferenceImages,
      "analyze_reference_images",
    ],
    [toolIds.expandPrompt]: [toolIds.expandPrompt, "expand_prompt"],
    [toolIds.generateImage]: [toolIds.generateImage, "generate_image"],
  };

  return aliases[toolId] ?? [toolId];
}

function toSeedreamUpstreamContext(
  upstreamContext: PromptCanvasContext["upstreamContext"]
): SeedreamUpstreamContext[] {
  return upstreamContext.flatMap((item) => {
    if (item.type === "prompt") {
      return {
        nodeId: item.nodeId,
        type: "prompt" as const,
        prompt: item.prompt,
        summary: item.summary,
      };
    }

    const imageUrl =
      item.imageUrl ??
      (item.artifact?.type === "image" ? item.artifact.uri : undefined);
    if (!imageUrl) {
      return [];
    }

    return {
      nodeId: item.nodeId,
      type: "image" as const,
      prompt: item.prompt,
      imageUrl,
      summary: item.summary,
    };
  });
}

function getSkillToolSummary(skill: AgentSkill) {
  return {
    id: skill.id,
    name: skill.name,
    slug: skill.slug,
  };
}

function toolLog(message: string) {
  return {
    level: "info" as const,
    message,
    createdAt: new Date().toISOString(),
  };
}
