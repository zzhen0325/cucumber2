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
  | "chat_agent_task"
  | "document_task"
  | "manager_task"
  | "simple_canvas"
  | "image_task"
  | "research_task"
  | "web_task";

export type AgentRunRouterSource =
  | "quick-router"
  | "llm-normalizer";

export type QuickAgentRunRoute = {
  canvasOperations?: CanvasOperation[];
  fallbackReason?: string;
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

const chatAgentSkippedSteps = ["input.normalize", "plan.build", "skills.retrieve"];
const routeOnlySkippedSteps = ["input.normalize"];
const simpleImageSkippedSteps = ["input.normalize", "skills.retrieve"];

export function routeNormalizedAgentRun(
  input: AgentRunInput,
  normalizedInput: NormalizedAgentInput,
  options: { allowSimpleChat?: boolean } = {}
): AgentRunRoute {
  if (options.allowSimpleChat !== false && isChatAgentRun(input, normalizedInput)) {
    return "chat_agent_task";
  }
  return routeForSpecialistRoute(selectAgentRoute(normalizedInput));
}

export function skippedStepsForNormalizedRoute(route: AgentRunRoute) {
  return route === "chat_agent_task" ? ["plan.build", "skills.retrieve"] : [];
}

export function routeAgentRunQuick(input: AgentRunInput): QuickAgentRunRoute {
  const prompt = normalizeText(input.message);

  if (isImageGenerationMetadataRequest(prompt)) {
    return {
      normalizedInput: buildDirectAnswerNormalizedInput(input, {
        negativeCapabilities: ["image-generation"],
      }),
      requiresModelNormalization: false,
      route: "chat_agent_task",
      routerSource: "quick-router",
      skippedSteps: chatAgentSkippedSteps,
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
      normalizedInput: buildDirectAnswerNormalizedInput(input),
      requiresModelNormalization: false,
      route: "chat_agent_task",
      routerSource: "quick-router",
      skippedSteps: chatAgentSkippedSteps,
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
    const route = routeNormalizedAgentRun(input, input.normalizedInput);
    return {
      normalizedInput: input.normalizedInput,
      requiresModelNormalization: false,
      route,
      routerSource: "quick-router",
      skippedSteps: [...routeOnlySkippedSteps, ...skippedStepsForNormalizedRoute(route)],
    };
  }

  return {
    requiresModelNormalization: true,
    route: "manager_task",
    routerSource: "quick-router",
    skippedSteps: [],
  };
}

function buildDirectAnswerNormalizedInput(
  input: AgentRunInput,
  options: { negativeCapabilities?: string[] } = {}
) {
  return finalizeNormalizedAgentInput(
    {
      rawPrompt: input.message,
      userGoal: input.message,
      operation: "answer",
      artifact: null,
      requiredCapabilities: [],
      negativeCapabilities: options.negativeCapabilities ?? [],
    },
    input.message
  );
}

function routeForSpecialistRoute(route: ReturnType<typeof selectAgentRoute>): AgentRunRoute {
  switch (route) {
    case "document":
      return "document_task";
    case "image":
      return "image_task";
    case "research":
      return "research_task";
    case "web":
      return "web_task";
    case "manager":
    default:
      return "manager_task";
  }
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

function isChatAgentRun(
  input: AgentRunInput,
  normalizedInput: NormalizedAgentInput
) {
  const prompt = normalizeText(input.message);
  if (input.retryFrom) {
    return false;
  }
  if (normalizedInput.artifact || selectAgentRoute(normalizedInput) !== "manager") {
    return false;
  }
  if (normalizedInput.operation !== "answer") {
    return false;
  }
  if ((normalizedInput.requiredCapabilities ?? []).length) {
    return false;
  }
  return prompt.length <= 160;
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}
