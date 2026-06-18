import { tool } from "@openai/agents";
import { z } from "zod";

import type { ArtifactRef } from "../../../../src/types/canvas.ts";
import type { CucumberAgentContext } from "../../context.ts";
import { assertImageToolAllowed } from "../../policy/task-artifact-policy.ts";
import { normalizeSeedreamProviderPrompt } from "./generate-image.request.ts";
import {
  createImageMattingArtifactId,
  runImageMatting,
} from "./image-matting-provider.ts";
import {
  resolveSingleSourceImage,
  storeImageToolArtifactFromBytes,
  type ResolvedImageSource,
} from "./image-source.ts";

const imageMattingInputSchema = z.object({
  aspectRatio: z.string().min(1).optional(),
  background: z.enum(["transparent", "white", "neutral"]).optional(),
  height: z.number().int().positive().optional(),
  prompt: z.string().trim().min(1).optional(),
  subject: z.string().trim().min(1).optional(),
  width: z.number().int().positive().optional(),
});

const imageMattingJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    aspectRatio: {
      type: "string",
      description: "Optional output aspect ratio. Omit to preserve provider default geometry.",
    },
    background: {
      type: "string",
      enum: ["transparent", "white", "neutral"],
      description:
        "Preferred output background. Use transparent for cutout/material requests unless the user asks otherwise.",
    },
    height: {
      type: "integer",
      minimum: 1,
      description: "Optional explicit output height. Use only with width.",
    },
    prompt: {
      type: "string",
      description:
        "Optional user-facing instruction for the matting operation, such as preserving hair detail or product edges.",
    },
    subject: {
      type: "string",
      description:
        "Optional subject to extract when the image contains multiple possible subjects.",
    },
    width: {
      type: "integer",
      minimum: 1,
      description: "Optional explicit output width. Use only with height.",
    },
  },
} as const;

export const imageMattingTool = tool({
  name: "image_matting",
  description:
    "Extract the main subject from exactly one selected or upstream image and create a new image artifact. Use for 抠图, 去背景, 透明底, 只保留主体, 做贴纸, or 素材提取. The source image is resolved by the Cucumber runtime and is not exposed as a URL to the model.",
  parameters: imageMattingJsonSchema as never,
  strict: false,
  errorFunction: null,
  async execute(rawArgs, runContext, details) {
    const context = requireCucumberContext(runContext?.context);
    assertImageToolAllowed(context, "image_matting");
    const parsed = imageMattingInputSchema.safeParse(rawArgs);
    if (!parsed.success) {
      return {
        error: `invalid_image_matting_input: ${parsed.error.issues
          .map((issue) => `${issue.path.join(".")} ${issue.message}`)
          .join("; ")}`,
      };
    }

    const source = await resolveSingleSourceImage(
      context,
      "请选择一张图片后再执行抠图。"
    );
    const prompt = buildMattingPrompt({
      background: parsed.data.background,
      prompt: parsed.data.prompt,
      source,
      subject: parsed.data.subject,
    });
    const artifacts: ArtifactRef[] = [];
    const result = await runImageMatting({
      aspectRatio: parsed.data.aspectRatio,
      background: parsed.data.background ?? "transparent",
      height: parsed.data.height,
      signal: details?.signal ?? context.signal,
      sourceUrl: source.imageUrl,
      width: parsed.data.width,
    });
    const artifact = await storeImageToolArtifactFromBytes({
      bytes: result.bytes,
      context,
      image: {
        id: createImageMattingArtifactId(),
        metadata: {
          engine: result.engine,
          provider: result.provider,
          ...result.metadata,
        },
        title: "抠图结果",
      },
      metadata: {
        background: parsed.data.background ?? "transparent",
        operation: "matting",
        prompt,
        sourceNodeId: source.nodeId,
        sourcePrompt: context.prompt,
      },
      mimeType: result.mimeType,
      sourceNodeId: source.nodeId,
      toolName: "image_matting",
    });
    artifacts.push(artifact);

    return {
      artifactIds: artifacts.map((artifact) => artifact.id),
      matted: artifacts.length,
      note: "Matted image rendered to the canvas. Image URLs are intentionally omitted from your context.",
    };
  },
});

function buildMattingPrompt({
  background,
  prompt,
  source,
  subject,
}: {
  background?: "transparent" | "white" | "neutral";
  prompt?: string;
  source: ResolvedImageSource;
  subject?: string;
}) {
  const targetBackground = background ?? "transparent";
  const subjectText = subject?.trim()
    ? `Extract only this subject: ${subject.trim()}.`
    : "Extract the main subject from the reference image.";
  const backgroundText =
    targetBackground === "transparent"
      ? "Remove the background and output a transparent-background PNG if the image service supports alpha; otherwise use a clean plain white fallback background."
      : targetBackground === "white"
        ? "Remove the original background and place the subject on a clean plain white background."
        : "Remove the original background and place the subject on a clean neutral background.";
  const detailText =
    prompt?.trim() ??
    "Preserve the subject identity, silhouette, hair/fur edges, product edges, clothing, color, texture, and natural proportions. Do not invent a new subject.";
  const sourceText = [source.title, source.summary, source.prompt]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join(" ");
  return normalizeSeedreamProviderPrompt(
    [
      subjectText,
      backgroundText,
      detailText,
      sourceText ? `Known source context: ${sourceText}` : "",
      "Return a finished cutout material suitable for editing and compositing. No watermark, no app UI, no QR code.",
    ]
      .filter(Boolean)
      .join("\n")
  );
}

function requireCucumberContext(context: unknown): CucumberAgentContext {
  if (!context || typeof context !== "object") {
    throw new Error("Cucumber agent context is missing.");
  }
  return context as CucumberAgentContext;
}
