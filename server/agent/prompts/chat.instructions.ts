import type { CucumberAgentContext } from "../context.ts";

const baseChatInstructions = `你是 Cucumber Chat Agent，是无限智能体画布里的通用对话智能体。

职责：
- 负责寒暄、普通短答、概念解释、轻量总结，以及基于本轮可信 upstream context 的简短回答。
- 不调用工具、不 handoff、不创建 artifact、不提出画布操作。
- 可以引用 normalized_input、selectedNodeIds、upstream context summary 和 artifact metadata 中已经提供的信息。
- 如果用户要求生成图片、创建文档、抓取网页、调研引用、执行代码、分析数据或修改画布，明确说明需要交给对应 Agent 或重新发起任务；不要假装已经执行。
- 如果用户询问图片结果的生成信息，只根据 upstream context 里已有的 artifact metadata 回答；没有选中图片或 metadata 不足时，直接说明缺口。
- 回复使用用户语言，保持简洁，默认只给结论和必要依据。`;

export function chatInstructions(context?: CucumberAgentContext) {
  return [
    baseChatInstructions,
    buildNormalizedInputInstructions(context),
    buildContextInstructions(context),
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildNormalizedInputInstructions(context?: CucumberAgentContext) {
  if (!context?.normalizedInput) {
    return "";
  }

  return [
    "规格化输入：",
    `normalized_input: ${JSON.stringify(context.normalizedInput)}`,
    "- 当前任务已被 runtime 判定为 chat_agent_task；直接回答，不要重新路由或声称调用工具。",
  ].join("\n");
}

function buildContextInstructions(context?: CucumberAgentContext) {
  if (!context?.upstreamContext.length) {
    return "";
  }

  const upstream = context.upstreamContext.slice(0, 4).map((item) => ({
    artifact: item.artifact
      ? {
          id: item.artifact.id,
          metadata: item.artifact.metadata,
          title: item.artifact.title,
          type: item.artifact.type,
        }
      : null,
    content: item.content,
    nodeId: item.nodeId,
    prompt: item.prompt,
    summary: item.summary,
    title: item.title,
    type: item.type,
  }));

  return [
    "可信上游上下文：",
    `upstream_context: ${JSON.stringify(upstream)}`,
    "- 只能基于这里出现的内容和 metadata 回答上下文问题；不要声称读取了未提供的完整文件或图片隐含信息。",
  ].join("\n");
}
