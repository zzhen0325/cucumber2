import type { AgentCanvasNode, ShapeVariant } from "../../src/types/canvas.ts";
import type { CanvasOperation } from "../../src/types/runtime.ts";
import type { AgentRunInput } from "./context.ts";
import {
  finalizeNormalizedAgentInput,
  isImageGenerationMetadataRequest,
  type NormalizedAgentInput,
} from "./input-normalizer.ts";
import {
  isImageArtifactTask,
  selectAgentRoute,
} from "./task-router.ts";

export type AgentRunRoute =
  | "smalltalk"
  | "simple_chat"
  | "simple_canvas"
  | "image_task"
  | "complex_agent_task";

export type AgentRunRouterSource =
  | "quick-router"
  | "fast-intent-router"
  | "llm-normalizer";

export type QuickAgentRunRoute = {
  canvasOperations?: CanvasOperation[];
  candidateTools?: string[];
  confidence?: number;
  directResponse?: string;
  fallbackReason?: string;
  normalizedInput?: NormalizedAgentInput;
  preferredRoute?: string;
  requiresModelNormalization: boolean;
  route: AgentRunRoute;
  routerSource: AgentRunRouterSource;
  skippedSteps: string[];
};

const slowPrepSteps = [
  "input.normalize",
  "plan.build",
  "skills.retrieve",
  "agent.start",
];

const routeOnlySkippedSteps = ["input.normalize"];
const simpleImageSkippedSteps = ["input.normalize", "skills.retrieve"];

export function routeAgentRunQuick(input: AgentRunInput): QuickAgentRunRoute {
  const prompt = normalizeText(input.message);

  const metadataResponse = buildImageGenerationMetadataResponse(input);
  if (metadataResponse) {
    return {
      directResponse: metadataResponse,
      normalizedInput: buildDirectAnswerNormalizedInput(input),
      requiresModelNormalization: false,
      route: "simple_chat",
      routerSource: "quick-router",
      skippedSteps: slowPrepSteps,
    };
  }

  if (input.normalizedInput && isImageArtifactTask(input.normalizedInput)) {
    return {
      normalizedInput: input.normalizedInput,
      requiresModelNormalization: false,
      route: "image_task",
      routerSource: "quick-router",
      skippedSteps: isSimpleImageFastPathInput(input, input.normalizedInput)
        ? simpleImageSkippedSteps
        : routeOnlySkippedSteps,
    };
  }

  if (isSmalltalk(prompt)) {
    return {
      directResponse: smalltalkResponse(prompt),
      normalizedInput: buildDirectAnswerNormalizedInput(input),
      requiresModelNormalization: false,
      route: "smalltalk",
      routerSource: "quick-router",
      skippedSteps: slowPrepSteps,
    };
  }

  const canvasOperations = buildSimpleCanvasOperations(input);
  if (canvasOperations.length) {
    return {
      canvasOperations,
      normalizedInput: buildCanvasOperationNormalizedInput(input),
      requiresModelNormalization: false,
      route: "simple_canvas",
      routerSource: "quick-router",
      skippedSteps: slowPrepSteps,
    };
  }

  if (input.normalizedInput) {
    return {
      normalizedInput: input.normalizedInput,
      requiresModelNormalization: false,
      route: routeForNormalizedInput(input.normalizedInput),
      routerSource: "quick-router",
      skippedSteps: routeOnlySkippedSteps,
    };
  }

  return {
    requiresModelNormalization: true,
    route: "complex_agent_task",
    routerSource: "quick-router",
    skippedSteps: [],
  };
}

function buildDirectAnswerNormalizedInput(input: AgentRunInput) {
  return finalizeNormalizedAgentInput(
    {
      rawPrompt: input.message,
      userGoal: input.message,
      operation: "answer",
      artifact: null,
      requiredCapabilities: [],
      negativeCapabilities: [],
    },
    input.message
  );
}

function buildCanvasOperationNormalizedInput(input: AgentRunInput) {
  return finalizeNormalizedAgentInput(
    {
      rawPrompt: input.message,
      userGoal: input.message,
      operation: "create",
      artifact: { kind: "canvas" },
      requiredCapabilities: ["canvas-operation"],
      negativeCapabilities: [],
    },
    input.message
  );
}

function isSmalltalk(prompt: string) {
  return /^(hi|hello|hey|yo|哈喽|哈咯|你好|您好|嗨|在吗|早上好|上午好|下午好|晚上好|你是谁|你叫什么)([!.。！?？~～\s]*)$/i.test(
    prompt
  );
}

function smalltalkResponse(prompt: string) {
  if (/你是谁|你叫什么/i.test(prompt)) {
    return "我是 Cucumber Manager，可以帮你处理画布、生成内容、整理文档或回答项目里的问题。";
  }
  return "你好呀，我在。你可以直接说要处理的画布、内容或图片任务。";
}

function buildSimpleCanvasOperations(input: AgentRunInput): CanvasOperation[] {
  const prompt = normalizeText(input.message);
  const stickyText = readStickyNoteText(prompt);
  if (stickyText) {
    const node = createCanvasNode(input, {
      data: {
        kind: "stickyNote",
        text: stickyText,
        color: readStickyNoteColor(prompt),
        createdAt: new Date().toISOString(),
      },
      idPrefix: "sticky",
      type: "stickyNoteNode",
    });
    return [
      {
        id: `op-${node.id}`,
        projectId: input.projectId,
        type: "createNode",
        payload: { node },
      },
    ];
  }

  const shape = readShapeRequest(prompt);
  if (shape) {
    const node = createCanvasNode(input, {
      data: {
        kind: "shape",
        shape: shape.shape,
        label: shape.label,
        createdAt: new Date().toISOString(),
      },
      idPrefix: "shape",
      type: "shapeNode",
    });
    return [
      {
        id: `op-${node.id}`,
        projectId: input.projectId,
        type: "createNode",
        payload: { node },
      },
    ];
  }

  return [];
}

function readStickyNoteText(prompt: string) {
  if (!/(新增|添加|创建|加一个|贴一个|add|create).{0,12}(便签|便利贴|note|sticky)/i.test(prompt)) {
    return null;
  }
  const textMatch =
    prompt.match(/(?:内容是|内容为|写着|写上|备注|[:：])\s*(.+)$/i) ??
    prompt.match(/(?:便签|便利贴|note|sticky)\s*[:：]\s*(.+)$/i);
  const text = normalizeText(textMatch?.[1] ?? "");
  return text || "新便签";
}

function readStickyNoteColor(prompt: string) {
  if (/绿色|green/i.test(prompt)) {
    return "green" as const;
  }
  if (/蓝色|blue/i.test(prompt)) {
    return "blue" as const;
  }
  if (/粉色|pink/i.test(prompt)) {
    return "pink" as const;
  }
  return "yellow" as const;
}

function readShapeRequest(prompt: string) {
  if (!/(新增|添加|创建|画一个|加一个|add|create).{0,12}(矩形|圆形|椭圆|菱形|三角形|胶囊|画框|shape|rectangle|ellipse|diamond|triangle|pill|frame)/i.test(prompt)) {
    return null;
  }
  const shape: ShapeVariant =
    /菱形|diamond/i.test(prompt)
      ? "diamond"
      : /三角形|triangle/i.test(prompt)
        ? "triangle"
        : /胶囊|pill/i.test(prompt)
          ? "pill"
          : /画框|frame/i.test(prompt)
            ? "frame"
            : /圆形|椭圆|ellipse/i.test(prompt)
              ? "ellipse"
              : "rectangle";
  const label = normalizeText(
    prompt.match(/(?:文字|标签|label|[:：])\s*(.+)$/i)?.[1] ?? ""
  ) || "形状";
  return { label, shape };
}

function createCanvasNode(
  input: AgentRunInput,
  options: {
    data: AgentCanvasNode["data"];
    idPrefix: string;
    type: string;
  }
): AgentCanvasNode {
  const anchor =
    input.canvasSnapshot.nodes.find((node) => node.id === input.selectedNodeId) ??
    input.canvasSnapshot.nodes.find((node) => node.id === input.runNodeId) ??
    input.canvasSnapshot.nodes.at(-1);
  return {
    id: `${options.idPrefix}-${input.runNodeId}-${crypto.randomUUID().slice(0, 8)}`,
    type: options.type,
    position: {
      x: (anchor?.position.x ?? 0) + 360,
      y: anchor?.position.y ?? 0,
    },
    data: options.data,
  };
}

function isSimpleImageFastPathInput(
  input: AgentRunInput,
  normalizedInput: NormalizedAgentInput
) {
  if (input.retryFrom || input.upstreamContext.length || input.selectedNodeIds.length) {
    return false;
  }
  if (
    normalizedInput.operation !== "create" &&
    normalizedInput.intent !== "image.generate"
  ) {
    return false;
  }
  if (normalizedInput.artifact?.kind !== "image") {
    return false;
  }
  if (normalizedInput.negativeCapabilities?.includes("image-generation")) {
    return false;
  }
  return (normalizedInput.requiredCapabilities ?? []).every(
    (capability) => capability === "image-generation"
  );
}

function routeForNormalizedInput(normalizedInput: NormalizedAgentInput) {
  return isImageArtifactTask(normalizedInput) ||
    selectAgentRoute(normalizedInput) === "image"
    ? "image_task"
    : "complex_agent_task";
}

function buildImageGenerationMetadataResponse(input: AgentRunInput) {
  const prompt = normalizeText(input.message);
  if (!isImageGenerationMetadataRequest(prompt)) {
    return null;
  }

  const imageItems = input.upstreamContext.filter(
    (item) => item.type === "image"
  );
  const selectedImage =
    imageItems.find((item) => item.nodeId === input.selectedNodeId) ??
    (imageItems.length === 1 ? imageItems[0] : null);

  if (!selectedImage) {
    return "请先选中一张图片结果节点，我可以读取它记录的生成 prompt、模型、供应商和尺寸等信息。";
  }

  const metadata = selectedImage.artifact?.metadata ?? {};
  const sourcePrompt =
    readMetadataString(metadata.sourcePrompt) ?? selectedImage.prompt;
  const providerPrompt = readMetadataString(metadata.prompt);
  const provider = readMetadataString(metadata.provider);
  const model = readMetadataString(metadata.model);
  const sourceToolName = readMetadataString(metadata.sourceToolName);
  const width = readMetadataNumber(metadata.width);
  const height = readMetadataNumber(metadata.height);
  const dimensions = width && height ? `${width}x${height}` : null;
  const promptIndex = readMetadataNumber(metadata.promptIndex);
  const createdAt = readMetadataString(metadata.createdAt);

  const lines = ["这张图记录到的生成信息："];
  if (sourcePrompt) {
    lines.push(`- 原始需求：${sourcePrompt}`);
  }
  if (providerPrompt && providerPrompt !== sourcePrompt) {
    lines.push(`- 实际生成 prompt：${providerPrompt}`);
  }
  if (provider) {
    lines.push(`- 供应商：${provider}`);
  }
  if (model) {
    lines.push(`- 模型：${model}`);
  }
  if (dimensions) {
    lines.push(`- 尺寸：${dimensions}`);
  }
  if (sourceToolName) {
    lines.push(`- 生成工具：${sourceToolName}`);
  }
  if (promptIndex) {
    lines.push(`- 批次序号：${promptIndex}`);
  }
  if (createdAt) {
    lines.push(`- 记录时间：${createdAt}`);
  }

  if (lines.length === 1) {
    return "这张图没有记录可读的生成参数。当前能确认的是它来自一个图片结果节点，但缺少 prompt、模型或供应商等元数据。";
  }

  return lines.join("\n");
}

function readMetadataString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readMetadataNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}
