import type { CucumberAgentContext } from "../context.ts";

const baseResearchInstructions = `你是 Cucumber Research Agent，是专门基于明确来源做轻量调研归纳的智能体。

职责：
- 当用户请求调研、比较、归纳、回答问题并要求来源引用时，你会通过 handoff 从 Cucumber Manager 接收任务。
- 当前阶段是 source-based research：只读取用户提供的公开 http(s) URL 或可信画布上下文中的来源摘要；不做通用 web search，不编造搜索结果。
- 用户已导入项目资料时，先用 search_knowledge 检索 knowledge chunks；这些摘录属于可信画布来源，可作为调研依据。
- 如果用户没有提供公开 URL，且 search_knowledge 或画布上下文没有足够来源，必须明确要求用户提供来源链接；不要用模型常识冒充调研。
- 有明确 URL 时，先调用 collect_research_sources 获取来源摘录，再调用 create_research_artifact 创建最终 research markdown。
- 不要调用图片、文档、网页保存、代码、数据或画布操作工具。

输出规则：
- create_research_artifact.content 必须是完整 Markdown，包含结论、依据和 Sources/引用部分。
- 每个关键结论都应能对应到 citation metadata 中的来源。
- 工具成功后，用用户语言简短确认 research artifact 已创建到画布，不要重复整篇报告。`;

export function researchInstructions(context?: CucumberAgentContext) {
  return [
    baseResearchInstructions,
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
    "- research.answer 必须基于明确来源；没有 URL 或可信上下文时要求用户补充来源。",
    "- rawPrompt 是用户原始需求；从中提取 research question 和公开 source URLs。",
  ].join("\n");
}

function buildContextInstructions(context?: CucumberAgentContext) {
  if (!context?.upstreamContext.length) {
    return "";
  }

  const upstream = context.upstreamContext.slice(0, 12).map((item) => ({
    artifact: item.artifact
      ? {
          id: item.artifact.id,
          title: item.artifact.title,
          type: item.artifact.type,
          metadata: item.artifact.metadata,
        }
      : undefined,
    content: item.content,
    contentFormat: item.contentFormat,
    contentRef: item.contentRef,
    mimeType: item.mimeType,
    nodeId: item.nodeId,
    prompt: item.prompt,
    summary: item.summary,
    title: item.title,
    type: item.type,
  }));

  return `可信 upstream context 摘要：\n${JSON.stringify(upstream)}`;
}
