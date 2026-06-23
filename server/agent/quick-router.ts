import type { AgentCanvasNode, ShapeVariant } from "../../src/types/canvas.ts";
import type { CanvasOperation } from "../../src/types/runtime.ts";
import type { AgentRunInput } from "./context.ts";
import {
  finalizeNormalizedAgentInput,
  isImageArtifactTask,
  selectAgentRoute,
  type NormalizedAgentInput,
} from "./input-normalizer.ts";

export type AgentRunRoute =
  | "smalltalk"
  | "simple_chat"
  | "simple_canvas"
  | "image_task"
  | "complex_agent_task";

export type AgentRunRouterSource = "quick-router" | "llm-normalizer";

export type QuickAgentRunRoute = {
  canvasOperations?: CanvasOperation[];
  directResponse?: string;
  normalizedInput?: NormalizedAgentInput;
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

const simpleModelSkippedSteps = [
  "input.normalize",
  "plan.build",
  "skills.retrieve",
];

const routeOnlySkippedSteps = ["input.normalize"];
const simpleImageSkippedSteps = ["input.normalize", "skills.retrieve"];

export function routeAgentRunQuick(input: AgentRunInput): QuickAgentRunRoute {
  const prompt = normalizeText(input.message);
  const localNormalized = buildLocalNormalizedInput(input);

  if (isImageArtifactTask(localNormalized)) {
    return {
      normalizedInput: localNormalized,
      requiresModelNormalization: false,
      route: "image_task",
      routerSource: "quick-router",
      skippedSteps: isSimpleImageFastPathInput(input, localNormalized)
        ? simpleImageSkippedSteps
        : routeOnlySkippedSteps,
    };
  }

  if (isSmalltalk(prompt)) {
    return {
      directResponse: smalltalkResponse(prompt),
      normalizedInput: localNormalized,
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
      normalizedInput: localNormalized,
      requiresModelNormalization: false,
      route: "simple_canvas",
      routerSource: "quick-router",
      skippedSteps: slowPrepSteps,
    };
  }

  if (isSimpleChatRun(input, localNormalized)) {
    return {
      normalizedInput: localNormalized,
      requiresModelNormalization: false,
      route: "simple_chat",
      routerSource: "quick-router",
      skippedSteps: simpleModelSkippedSteps,
    };
  }

  if (isHighConfidenceStructuredTask(localNormalized)) {
    return {
      normalizedInput: localNormalized,
      requiresModelNormalization: false,
      route: "complex_agent_task",
      routerSource: "quick-router",
      skippedSteps: routeOnlySkippedSteps,
    };
  }

  return {
    requiresModelNormalization: true,
    route: "complex_agent_task",
    routerSource: "llm-normalizer",
    skippedSteps: [],
  };
}

function buildLocalNormalizedInput(input: AgentRunInput) {
  if (input.normalizedInput) {
    return input.normalizedInput;
  }

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

function isSimpleChatRun(
  input: AgentRunInput,
  normalizedInput: NormalizedAgentInput
) {
  const prompt = normalizeText(input.message);
  if (input.retryFrom || input.selectedNodeIds.length || input.upstreamContext.length) {
    return false;
  }
  if (normalizedInput.artifact || selectAgentRoute(normalizedInput) !== "manager") {
    return false;
  }
  if (prompt.length > 160) {
    return false;
  }
  return !hasComplexTaskSignal(prompt);
}

function isHighConfidenceStructuredTask(input: NormalizedAgentInput) {
  return Boolean(
    input.artifact ||
      input.requiredCapabilities?.length ||
      input.negativeCapabilities?.length ||
      selectAgentRoute(input) !== "manager"
  );
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

function hasComplexTaskSignal(prompt: string) {
  return /https?:\/\/|详细|完整|系统|深入|全面|调研|研究|报告|文档|方案|规划|roadmap|引用|来源|citation|sources?|批量|多张|系列|参考|基于|根据|然后|同时|并且/i.test(
    prompt
  );
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}
