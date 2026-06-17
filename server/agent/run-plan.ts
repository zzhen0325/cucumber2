import type { AgentRunInput } from "./context.ts";
import {
  isPromptTextEditRequest,
  type NormalizedIntent,
} from "./input-normalizer.ts";

export type RunPlanPhase = "prepare" | "route" | "execute" | "materialize";

export type RuntimeRunPlanItem = {
  id: string;
  label: string;
  phase: RunPlanPhase;
};

const ALWAYS_PLAN_INTENTS = new Set<NormalizedIntent>([
  "code.create",
  "data.analyze",
  "document.create",
  "document.edit",
  "research.answer",
  "web.fetch",
  "webpage.create",
  "workflow.plan",
]);

export function buildRunPlan(input: AgentRunInput): RuntimeRunPlanItem[] {
  if (!shouldCreateRunPlan(input)) {
    return [];
  }

  const intent = input.normalizedInput?.intent ?? "text.answer";
  if (input.retryFrom) {
    return retryPlan(input);
  }

  switch (intent) {
    case "document.create":
      return [
        step("document-brief", "梳理文档目标和上游素材", "prepare"),
        step("document-agent", "委派 Document Agent", "route"),
        step("document-create", "创建文档 artifact", "execute"),
        step("document-materialize", "投影为画布文档节点", "materialize"),
      ];
    case "document.edit":
      return [
        step("document-source", "读取上游文档和改写要求", "prepare"),
        step("document-agent", "委派 Document Agent", "route"),
        step("document-rewrite", "生成改写后的文档 artifact", "execute"),
        step("document-materialize", "投影为画布文档节点", "materialize"),
      ];
    case "web.fetch":
      return [
        step("web-boundary", "确认公开 URL 和访问边界", "prepare"),
        step("web-agent", "委派 Web Agent", "route"),
        step("web-fetch", "抓取网页并保存 webpage artifact", "execute"),
        step("web-materialize", "投影网页摘要节点", "materialize"),
      ];
    case "webpage.create":
      return [
        step("html-brief", "梳理 HTML 产物目标和交互要求", "prepare"),
        step("document-agent", "委派 Document Agent", "route"),
        step("html-create", "创建 HTML webpage artifact", "execute"),
        step("html-materialize", "投影为网页预览节点", "materialize"),
      ];
    case "research.answer":
      return [
        step("research-sources", "梳理用户提供的来源", "prepare"),
        step("research-agent", "委派 Research Agent", "route"),
        step("research-collect", "收集来源摘录和 citation", "execute"),
        step("research-artifact", "生成调研 artifact", "execute"),
        step("research-materialize", "投影调研结果节点", "materialize"),
      ];
    case "image.generate":
      return [
        step("image-brief", "整理画面要求和引用图", "prepare"),
        step("image-agent", "委派 Image Agent", "route"),
        step("image-generate", `生成${getImageCountLabel(input)}图片 artifact`, "execute"),
        step("image-materialize", "投影图片结果节点", "materialize"),
      ];
    case "image.upscale":
      return [
        step("upscale-source", "确认要高清放大的图片", "prepare"),
        step("image-agent", "委派 Image Agent", "route"),
        step("image-upscale", "生成高清放大 artifact", "execute"),
        step("upscale-materialize", "投影高清图片结果", "materialize"),
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

  if (isPromptTextEditRun(input)) {
    return false;
  }

  const intent = input.normalizedInput?.intent ?? "text.answer";
  if (ALWAYS_PLAN_INTENTS.has(intent)) {
    return true;
  }
  if (intent === "unsupported") {
    return false;
  }

  return hasComplexitySignal(input);
}

function isPromptTextEditRun(input: AgentRunInput) {
  return (
    input.normalizedInput?.operation === "edit" &&
    !input.normalizedInput.artifact &&
    isPromptTextEditRequest(input.message)
  );
}

function hasComplexitySignal(input: AgentRunInput) {
  const prompt = normalizeText(input.message);
  const imageCount = input.normalizedInput?.image?.resultCount ?? 1;
  if (imageCount > 1) {
    return true;
  }
  if (input.upstreamContext.length > 0 || input.selectedNodeIds.length > 0) {
    return true;
  }
  if ((input.contextSummary?.selectedNodes.length ?? 0) > 1) {
    return true;
  }
  if (prompt.length >= 80) {
    return true;
  }
  return /计划|拆解|步骤|方案|对比|分析|总结|批量|多张|系列|参考|基于|根据|然后|同时|并且|以及|修改|改写|优化|扩写/i.test(prompt);
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
  const count = input.normalizedInput?.image?.resultCount ?? 1;
  return count > 1 ? ` ${count} 张` : "";
}

function step(id: string, label: string, phase: RunPlanPhase): RuntimeRunPlanItem {
  return { id, label, phase };
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}
