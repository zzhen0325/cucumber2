import type { CucumberAgentContext } from "../context.ts";
import {
  hasNegativeCapability,
  isImageArtifactTask,
  isTextArtifactTask,
} from "../input-normalizer.ts";

export function assertImageToolAllowed(
  context: CucumberAgentContext,
  toolName: string
) {
  const normalizedInput = context.normalizedInput;
  if (!normalizedInput) {
    return;
  }

  if (
    hasNegativeCapability(normalizedInput, "image-generation") &&
    toolName !== "upscale_image" &&
    toolName !== "image_matting"
  ) {
    throw new Error(
      `tool_policy_rejected: ${toolName} is blocked because this task forbids image-generation.`
    );
  }

  if (!isImageArtifactTask(normalizedInput)) {
    throw new Error(
      `tool_policy_rejected: ${toolName} can only run for artifact.kind=image tasks.`
    );
  }
}

export function assertTextArtifactToolAllowed(context: CucumberAgentContext) {
  const normalizedInput = context.normalizedInput;
  if (!normalizedInput) {
    return;
  }

  if (!isTextArtifactTask(normalizedInput)) {
    throw new Error(
      "tool_policy_rejected: create_text_artifact can only run for markdown, document, diagram, code, or webpage artifact tasks."
    );
  }
}

export function assertImageInspectionToolAllowed(
  context: CucumberAgentContext,
  toolName: string,
  requiredCapability: "image-decompose" | "media-analysis"
) {
  const normalizedInput = context.normalizedInput;
  if (!normalizedInput) {
    return;
  }

  if (!(normalizedInput.requiredCapabilities ?? []).includes(requiredCapability)) {
    throw new Error(
      `tool_policy_rejected: ${toolName} requires ${requiredCapability}.`
    );
  }

  const kind = normalizedInput.artifact?.kind;
  if (kind && !["image", "markdown", "document"].includes(kind)) {
    throw new Error(
      `tool_policy_rejected: ${toolName} can only run for image, markdown, or document artifact tasks.`
    );
  }
}
