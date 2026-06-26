import type { CucumberAgentContext } from "../context.ts";
import {
  isImageDecomposeTask,
  isImageInspectionTask,
  isImageTask,
  isTextArtifactTask,
} from "../task-router.ts";

const IMAGE_GENERATION_TOOLS = new Set([
  "generate_image",
  "expand_image_prompt",
  "render_visual_style_prompt",
]);

export function assertImageToolAllowed(
  context: CucumberAgentContext,
  toolName: string
) {
  const normalizedInput = context.normalizedInput;
  if (!normalizedInput) {
    return;
  }

  if (!isImageTask(normalizedInput)) {
    throw new Error(
      `tool_policy_rejected: ${toolName} can only run for image-domain tasks.`
    );
  }

  // Generation tools must not run for image analysis/decomposition tasks.
  // upscale_image and image_matting operate on an existing image and stay allowed.
  if (IMAGE_GENERATION_TOOLS.has(toolName) && isImageInspectionTask(normalizedInput)) {
    throw new Error(
      `tool_policy_rejected: ${toolName} is blocked because this task is image analysis, not image generation.`
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
      "tool_policy_rejected: create_text_artifact can only run for text or code domain tasks."
    );
  }
}

export function assertImageInspectionToolAllowed(
  context: CucumberAgentContext,
  toolName: string,
  requiredCapability: "image-decompose"
) {
  void requiredCapability;
  const normalizedInput = context.normalizedInput;
  if (!normalizedInput) {
    return;
  }

  if (!isImageDecomposeTask(normalizedInput) && !isImageInspectionTask(normalizedInput)) {
    throw new Error(
      `tool_policy_rejected: ${toolName} requires an image analysis/decomposition task.`
    );
  }
}
