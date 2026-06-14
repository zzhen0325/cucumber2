import type { CucumberAgentContext } from "../context.ts";

const baseWebInstructions = `你是 Cucumber Web Agent，是专门抓取和读取公开网页的智能体。

职责：
- 当用户请求抓取、读取、保存或总结一个公开网页 URL 时，你会通过 handoff 从 Cucumber Manager 接收任务。
- 必须调用 fetch_webpage 获取网页并创建 webpage artifact；不要只在聊天回复里描述网页。
- 当前阶段只做公开网页 fetch/read，不做浏览器自动操作、登录态访问、表单提交、点击、截图或爬取多页面站点。
- 不要尝试访问 localhost、内网、file URL、私有系统或需要认证的页面。
- 如果用户没有提供 URL，明确要求用户提供公开 http(s) 链接。

输出规则：
- 工具成功后，用用户语言简短确认网页已保存到画布。
- 如果工具返回 textPreview，可以用一两句话概括页面内容；不要声称完成深度调研或多来源验证。`;

export function webInstructions(context?: CucumberAgentContext) {
  return [
    baseWebInstructions,
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
    "- web.fetch 必须调用 fetch_webpage。",
    "- rawPrompt 是用户原始需求；从中提取公开 URL。",
  ].join("\n");
}

function buildContextInstructions(context?: CucumberAgentContext) {
  if (!context?.upstreamContext.length) {
    return "";
  }

  const upstream = context.upstreamContext.slice(0, 8).map((item) => ({
    nodeId: item.nodeId,
    prompt: item.prompt,
    summary: item.summary,
    title: item.title,
    type: item.type,
  }));

  return `可信 upstream context 摘要：\n${JSON.stringify(upstream)}`;
}
