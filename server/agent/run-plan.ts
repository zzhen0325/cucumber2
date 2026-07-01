import type { AgentRunInput } from "./context.ts";
import {
  getExplicitConstraint,
  getExplicitConstraints,
  type NormalizedAgentInput,
} from "./input-normalizer.ts";
import { isCompositeWorkflowTask } from "./task-router.ts";

export type RunPlanPhase = "prepare" | "route" | "execute" | "materialize";

export type RuntimeRunPlanItem = {
  id: string;
  label: string;
  phase: RunPlanPhase;
};

// Coarse plan intents derived from the Task Frame for step-skeleton selection only.
type PlanIntent =
  | "image.generate"
  | "image.matting"
  | "image.decompose"
  | "image.upscale"
  | "media.analyze"
  | "document.create"
  | "document.edit"
  | "web.fetch"
  | "webpage.create"
  | "research.answer"
  | "canvas.operation"
  | "code.create"
  | "data.analyze"
  | "workflow.plan"
  | "prompt.edit"
  | "text.answer"
  | "unsupported";

const ALWAYS_PLAN_INTENTS = new Set<PlanIntent>([
  "research.answer",
  "web.fetch",
  "webpage.create",
  "workflow.plan",
]);

const IMAGE_INTENTS = new Set<PlanIntent>([
  "image.generate",
  "image.matting",
  "image.decompose",
  "image.upscale",
  "media.analyze",
]);

export function buildRunPlan(input: AgentRunInput): RuntimeRunPlanItem[] {
  if (!shouldCreateRunPlan(input)) {
    return [];
  }

  if (input.retryFrom) {
    return retryPlan(input);
  }

  const workflowPlan = buildWorkflowPlan(input.normalizedInput);
  if (workflowPlan.length) {
    return workflowPlan;
  }

  const intent = getPlanIntent(input);
  switch (intent) {
    case "document.create":
      return [
        step("document-brief", "梳理文档目标和上游素材", "prepare"),
        step("document-agent", "进入 Document Agent", "route"),
        step("document-create", "创建文档内容", "execute"),
        step("document-materialize", "投影为画布文档节点", "materialize"),
      ];
    case "document.edit":
      return [
        step("document-source", "读取上游文档和改写要求", "prepare"),
        step("document-agent", "进入 Document Agent", "route"),
        step("document-rewrite", "生成改写后的文档内容", "execute"),
        step("document-materialize", "投影为画布文档节点", "materialize"),
      ];
    case "web.fetch":
      return [
        step("web-boundary", "确认公开 URL 和访问边界", "prepare"),
        step("web-agent", "进入 Web Agent", "route"),
        step("web-fetch", "抓取网页并保存内容", "execute"),
        step("web-materialize", "投影网页摘要节点", "materialize"),
      ];
    case "webpage.create":
      return [
        step("html-brief", "梳理 HTML 产物目标和交互要求", "prepare"),
        step("document-agent", "进入 Document Agent", "route"),
        step("html-create", "创建 HTML 页面", "execute"),
        step("html-materialize", "投影为网页预览节点", "materialize"),
      ];
    case "research.answer":
      return [
        step("research-sources", "梳理来源和搜索策略", "prepare"),
        step("research-agent", "进入 Research Agent", "route"),
        step("research-collect", "搜索或收集来源 citation", "execute"),
        step("research-artifact", "生成调研内容", "execute"),
        step("research-materialize", "投影调研结果节点", "materialize"),
      ];
    case "image.generate":
      return [
        step("image-brief", "整理画面要求和引用图", "prepare"),
        step("image-agent", "进入 Image Agent", "route"),
        step("image-generate", `生成${getImageCountLabel(input)}图片`, "execute"),
        step("image-materialize", "投影图片结果节点", "materialize"),
      ];
    case "image.matting":
      return [
        step("matting-source", "确认要抠图的图片", "prepare"),
        step("image-agent", "进入 Image Agent", "route"),
        step("image-matting", "生成主体抠图", "execute"),
        step("matting-materialize", "投影抠图结果节点", "materialize"),
      ];
    case "image.decompose":
      return [
        step("decompose-source", "确认要拆解的图片", "prepare"),
        step("image-agent", "进入 Image Agent", "route"),
        step("image-decompose", "生成图像拆解内容", "execute"),
        step("decompose-materialize", "投影拆解文档节点", "materialize"),
      ];
    case "image.upscale":
      return [
        step("upscale-source", "确认要高清放大的图片", "prepare"),
        step("image-agent", "进入 Image Agent", "route"),
        step("image-upscale", "生成高清放大图片", "execute"),
        step("upscale-materialize", "投影高清图片结果", "materialize"),
      ];
    case "media.analyze":
      return [
        step("media-source", "确认要理解的图片", "prepare"),
        step("image-agent", "进入 Image Agent", "route"),
        step("media-answer", "回答图片理解问题", "execute"),
      ];
    case "canvas.operation":
      return [
        step("canvas-context", "读取选中画布结构", "prepare"),
        step("canvas-proposal", "生成画布操作提案", "execute"),
        step("canvas-policy", "校验并应用画布操作", "materialize"),
      ];
    case "code.create":
      return [
        step("code-scope", "梳理代码请求和能力边界", "prepare"),
        step("code-plan", "生成实现方案或代码草稿", "execute"),
        step("code-materialize", "写入画布文本结果", "materialize"),
      ];
    case "data.analyze":
      return [
        step("data-scope", "梳理数据来源和分析目标", "prepare"),
        step("data-plan", "生成分析步骤和结论", "execute"),
        step("data-materialize", "写入画布文本结果", "materialize"),
      ];
    case "workflow.plan":
      return [
        step("workflow-goal", "明确目标和约束", "prepare"),
        step("workflow-breakdown", "拆解任务路径和依赖", "execute"),
        step("workflow-output", "输出可执行计划", "materialize"),
      ];
    case "text.answer":
      return [
        step("answer-context", "梳理问题和上游素材", "prepare"),
        step("answer-references", "检索相关 knowledge 或技能", "route"),
        step("answer-compose", "组织回答结构", "execute"),
        step("answer-materialize", "写入画布回复", "materialize"),
      ];
    case "unsupported":
      return [];
    default:
      return [
        step("task-context", "梳理任务上下文", "prepare"),
        step("task-execute", "执行任务", "execute"),
        step("task-materialize", "写入画布结果", "materialize"),
      ];
  }
}

function shouldCreateRunPlan(input: AgentRunInput) {
  if (input.retryFrom) {
    return true;
  }
  if (isCompositeWorkflowTask(input.normalizedInput)) {
    return true;
  }

  const intent = getPlanIntent(input);
  if (intent === "unsupported" || intent === "prompt.edit") {
    return false;
  }
  if (IMAGE_INTENTS.has(intent)) {
    return shouldPlanImageRun(input, intent);
  }
  if (ALWAYS_PLAN_INTENTS.has(intent)) {
    return true;
  }

  return hasComplexitySignal(input);
}

function buildWorkflowPlan(
  normalizedInput: NormalizedAgentInput | undefined
): RuntimeRunPlanItem[] {
  if (!isCompositeWorkflowTask(normalizedInput) || !normalizedInput) {
    return [];
  }

  const stages = normalizedInput.workflow.stages;
  if (!stages.length) {
    return [
      step("workflow-goal", "明确复合任务目标和依赖", "prepare"),
      step("workflow-orchestrate", "进入 Manager 编排必要 Agent", "route"),
      step("workflow-execute", "执行多能力任务链路", "execute"),
      step("workflow-materialize", "投影复合任务产物", "materialize"),
    ];
  }

  return [
    step("workflow-goal", "明确复合任务目标和依赖", "prepare"),
    ...stages.flatMap((stage, index) => {
      const stageIndex = index + 1;
      const id = sanitizeStepId(stage.id || `stage-${stageIndex}`);
      return [
        step(
          `workflow-${stageIndex}-${id}-route`,
          `进入 ${agentLabel(stage.agent)}：${stage.goal}`,
          "route"
        ),
        step(`workflow-${stageIndex}-${id}-execute`, stage.goal, "execute"),
      ];
    }),
    step("workflow-materialize", "投影复合任务产物", "materialize"),
  ];
}

function getPlanIntent(input: AgentRunInput): PlanIntent {
  const normalizedInput = input.normalizedInput;
  if (!normalizedInput) {
    return "text.answer";
  }
  return derivePlanIntent(normalizedInput);
}

function derivePlanIntent(input: NormalizedAgentInput): PlanIntent {
  const intent = input.task.intent.toLowerCase();
  const { domain, action } = input.task;

  if (domain === "image") {
    if (/matting|抠图|去背景|透明底/.test(intent)) {
      return "image.matting";
    }
    if (/decompose|拆解/.test(intent)) {
      return "image.decompose";
    }
    if (/upscale|高清|超清|放大/.test(intent) || action === "upscale") {
      return "image.upscale";
    }
    if (/media\.analyze|media-analysis|理解|识别/.test(intent) || action === "analyze" || action === "extract") {
      return "media.analyze";
    }
    return "image.generate";
  }

  if (domain === "canvas") {
    return "canvas.operation";
  }

  if (domain === "code") {
    return "code.create";
  }

  if (/prompt\.edit/.test(intent) || (domain === "text" && action === "edit")) {
    return "prompt.edit";
  }
  if (/web\.fetch|fetch/.test(intent)) {
    return "web.fetch";
  }
  if (/webpage\.create|html|webpage|h5/.test(intent)) {
    return "webpage.create";
  }
  if (/research/.test(intent)) {
    return "research.answer";
  }
  if (/data\.analyze|dataset|表格/.test(intent)) {
    return "data.analyze";
  }
  if (/workflow|plan|规划|计划/.test(intent)) {
    return "workflow.plan";
  }
  if (/document/.test(intent) || (domain === "text" && (action === "create" || action === "transform"))) {
    return action === "edit" ? "document.edit" : "document.create";
  }
  return "text.answer";
}

function hasComplexitySignal(input: AgentRunInput) {
  const prompt = normalizeText(input.message);
  if (hasLongTaskSignal(prompt)) {
    return true;
  }
  if (hasMultiContext(input)) {
    return true;
  }
  return hasExplicitContextCue(prompt);
}

function shouldPlanImageRun(input: AgentRunInput, intent: PlanIntent) {
  if (intent !== "image.generate") {
    return false;
  }
  return (
    getImageOutputCount(input) > 1 ||
    getReferenceImageCount(input) > 1 ||
    hasImageBatchCue(normalizeText(input.message))
  );
}

function hasLongTaskSignal(prompt: string) {
  if (prompt.length >= 120) {
    return true;
  }
  return /详细说明|详细解释|完整说明|完整规划|长文|长篇|深度分析|深入分析|全面分析|调研分析|研究分析|调研报告|研究报告|分析报告|执行计划|规划方案|方案|路线图|roadmap|report|whitepaper|可复制|复制使用|直接使用|拿去用|复用|套用|模板|template|reusable|copy[-\s]?ready/i.test(prompt);
}

function hasMultiContext(input: AgentRunInput) {
  return (
    input.upstreamContext.length > 1 ||
    input.selectedNodeIds.length > 1 ||
    (input.contextSummary?.selectedNodes.length ?? 0) > 1
  );
}

function hasExplicitContextCue(prompt: string) {
  return /基于|根据|参考|对比|批量|多张|系列|步骤/i.test(prompt);
}

function hasImageBatchCue(prompt: string) {
  return /批量|多张|系列|一组|组图|套图|[2-9二两三四五六七八九十]\s*张/i.test(prompt);
}

function getImageOutputCount(input: AgentRunInput) {
  const constraintCount = readConstraintCount(input.normalizedInput);
  const variantCount = getExplicitConstraints(input.normalizedInput, "dimension").length;
  return (
    constraintCount ??
    (variantCount > 1 ? variantCount : undefined) ??
    input.imageResultCount ??
    1
  );
}

function readConstraintCount(input: NormalizedAgentInput | undefined) {
  const value = getExplicitConstraint(input, "output_count");
  if (!value) {
    return undefined;
  }
  const count = Number.parseInt(value, 10);
  return Number.isInteger(count) && count > 0 ? count : undefined;
}

function getReferenceImageCount(input: AgentRunInput) {
  const upstreamImageIds = input.upstreamContext
    .filter((item) => item.type === "image")
    .map((item) => item.nodeId);
  const referenceImageIds =
    input.contextSummary?.referenceNodes
      .filter((item) => item.kind === "imageResult")
      .map((item) => item.id) ?? [];
  return new Set([...upstreamImageIds, ...referenceImageIds]).size;
}

function retryPlan(input: AgentRunInput): RuntimeRunPlanItem[] {
  const failedLabel = input.retryFrom?.label ?? input.retryFrom?.toolName ?? input.retryFrom?.stepId ?? "失败步骤";
  return [
    step("retry-failure", `定位失败步骤：${failedLabel}`, "prepare"),
    step("retry-context", "保留已完成的上游结果", "prepare"),
    step("retry-execute", `重试：${failedLabel}`, "execute"),
    step("retry-materialize", "写入恢复后的画布结果", "materialize"),
  ];
}

function getImageCountLabel(input: AgentRunInput) {
  const count = getImageOutputCount(input);
  return count > 1 ? ` ${count} 张` : "";
}

function step(id: string, label: string, phase: RunPlanPhase): RuntimeRunPlanItem {
  return { id, label, phase };
}

function agentLabel(agent: NormalizedAgentInput["routing"]["primaryAgent"]) {
  switch (agent) {
    case "document_agent":
      return "Document Agent";
    case "image_agent":
      return "Image Agent";
    case "research_agent":
      return "Research Agent";
    case "web_agent":
      return "Web Agent";
    case "manager_agent":
    default:
      return "Manager";
  }
}

function sanitizeStepId(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "stage"
  );
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}
