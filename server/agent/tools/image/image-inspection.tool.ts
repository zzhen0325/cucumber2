import { tool } from "@openai/agents";
import { z } from "zod";

import type { ArtifactRef } from "../../../../src/types/canvas.ts";
import { storeTextArtifactContent } from "../../../storage.ts";
import type { CucumberAgentContext } from "../../context.ts";
import { assertImageInspectionToolAllowed } from "../../policy/task-artifact-policy.ts";
import {
  resolveSingleSourceImage,
  type ResolvedImageSource,
} from "./image-source.ts";

const stringListSchema = z.array(z.string().trim().min(1)).max(16).optional();

const decomposeImageInputSchema = z.object({
  colorAndLighting: z.string().trim().min(1).optional(),
  composition: z.string().trim().min(1).optional(),
  limitations: stringListSchema,
  nextSteps: stringListSchema,
  promptStructure: z.string().trim().min(1),
  styleSummary: z.string().trim().min(1),
  subjectStructure: z.string().trim().min(1).optional(),
  title: z.string().trim().min(1).max(160).optional(),
});

const decomposeImageJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    colorAndLighting: {
      type: "string",
      description: "Reusable color, lighting, texture, and mood rules.",
    },
    composition: {
      type: "string",
      description: "Reusable layout, camera, framing, hierarchy, and spatial rules.",
    },
    limitations: {
      type: "array",
      items: { type: "string" },
      description:
        "What could not be confirmed from available trusted context. Do not hide missing pixel-level access.",
    },
    nextSteps: {
      type: "array",
      items: { type: "string" },
      description: "Concrete follow-up actions the user can take.",
    },
    promptStructure: {
      type: "string",
      description:
        "A reusable prompt structure or template distilled from the image context.",
    },
    styleSummary: {
      type: "string",
      description: "Short style decomposition summary.",
    },
    subjectStructure: {
      type: "string",
      description: "Reusable subject, props, text, and scene rules.",
    },
    title: {
      type: "string",
      maxLength: 160,
      description: "Optional artifact title.",
    },
  },
  required: ["styleSummary", "promptStructure"],
} as const;

export const decomposeImageTool = tool({
  name: "decompose_image",
  description:
    "Create a markdown artifact that decomposes a selected/upstream image into reusable visual style, composition, color, lighting, subject, and prompt-structure rules. Use for 拆风格, 拆构图, 拆光影, 拆 prompt 线索, or summarizing reusable visual prompt structure. Do not claim unobserved pixel details; state limitations explicitly.",
  parameters: decomposeImageJsonSchema as never,
  strict: false,
  errorFunction: null,
  async execute(rawArgs, runContext) {
    const context = requireCucumberContext(runContext?.context);
    assertImageInspectionToolAllowed(context, "decompose_image", "image-decompose");
    const parsed = decomposeImageInputSchema.safeParse(rawArgs);
    if (!parsed.success) {
      return {
        error: `invalid_decompose_image_input: ${parsed.error.issues
          .map((issue) => `${issue.path.join(".")} ${issue.message}`)
          .join("; ")}`,
      };
    }
    const source = await resolveSingleSourceImage(
      context,
      "请选择一张图片后再执行风格拆解。"
    );
    const content = buildDecomposeContent(parsed.data, source, context.prompt);
    const artifact = await storeImageTextArtifact({
      content,
      context,
      metadata: {
        operation: "decompose",
        sourceNodeId: source.nodeId,
      },
      title: parsed.data.title ?? "图像风格拆解",
      toolName: "decompose_image",
    });

    return {
      artifactId: artifact.id,
      note: "Image decomposition artifact created and rendered to the canvas.",
      title: artifact.title,
    };
  },
});

function buildDecomposeContent(
  input: z.infer<typeof decomposeImageInputSchema>,
  source: ResolvedImageSource,
  userRequest: string
) {
  return [
    `# ${input.title ?? "图像风格拆解"}`,
    "",
    `用户需求：${userRequest}`,
    "",
    "## 输入",
    formatSource(source),
    "",
    "## 风格摘要",
    input.styleSummary,
    "",
    input.composition ? ["## 构图与镜头", input.composition, ""].join("\n") : "",
    input.colorAndLighting
      ? ["## 配色、光影与质感", input.colorAndLighting, ""].join("\n")
      : "",
    input.subjectStructure
      ? ["## 主体、元素与文案结构", input.subjectStructure, ""].join("\n")
      : "",
    "## 可复用 Prompt 结构",
    input.promptStructure,
    "",
    formatList("## 限制", input.limitations),
    formatList("## 下一步建议", input.nextSteps),
  ]
    .filter(Boolean)
    .join("\n");
}

function formatSource(source: ResolvedImageSource) {
  const lines = [
    `- 节点：${source.nodeId}`,
    source.title ? `- 标题：${source.title}` : "",
    source.summary ? `- 摘要：${source.summary}` : "",
    source.prompt ? `- 关联提示词：${source.prompt}` : "",
    source.artifact?.id ? `- Artifact：${source.artifact.id}` : "",
  ].filter(Boolean);
  return lines.join("\n") || "- 已选择一张图片";
}

function formatList(title: string, values: string[] | undefined) {
  if (!values?.length) {
    return "";
  }
  return [title, ...values.map((value) => `- ${value}`), ""].join("\n");
}

async function storeImageTextArtifact({
  content,
  context,
  metadata,
  title,
  toolName,
}: {
  content: string;
  context: CucumberAgentContext;
  metadata?: Record<string, unknown>;
  title: string;
    toolName: "decompose_image";
}) {
  const artifact = await storeTextArtifactContent({
    content,
    metadata,
    projectId: context.projectId,
    runNodeId: context.runNodeId,
    sourceToolName: toolName,
    title,
    type: "doc",
    userId: context.userId,
  });
  context.producedArtifacts.push(artifact);
  emitArtifactCreated(context, artifact, toolName);
  return artifact;
}

function emitArtifactCreated(
  context: CucumberAgentContext,
  artifact: ArtifactRef,
  toolName: "decompose_image"
) {
  const event = {
    type: "artifact_created" as const,
    artifact,
    toolName,
  };
  if (context.pushLiveEvent) {
    context.pushLiveEvent(event);
  } else {
    context.pendingEvents.push(event);
  }
}

function requireCucumberContext(context: unknown): CucumberAgentContext {
  if (!context || typeof context !== "object") {
    throw new Error("Cucumber agent context is missing.");
  }
  return context as CucumberAgentContext;
}
