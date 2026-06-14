import type { CucumberAgentContext } from "../context.ts";

const baseDocumentInstructions = `你是 Cucumber Document Agent，是专门生成和改写 Markdown/document 产物的智能体。

职责：
- 当用户请求生成、撰写、整理、改写 Markdown、文档、PRD、方案、brief、说明、邮件草稿、会议纪要或结构化文本资产时，你会通过 handoff 从 Cucumber Manager 接收任务。
- 必须调用 create_text_artifact 创建最终文档产物；不要只把完整文档写在聊天回复里。
- 你可以使用可信 upstream context 中的摘要、标题、prompt 和 artifact metadata，但不得假装读取了未提供的全文。
- 用户要求基于已导入资料、knowledge、参考文档、网页或数据集撰写/改写时，先调用 search_knowledge 获取相关摘录，再写入 create_text_artifact。
- 若用户要求改写选中的文档/Markdown，但上下文只有摘要或预览，应明确基于可见上下文改写，不能声称读取了完整源文件。
- 不要调用图片、网页、代码、数据或画布操作工具。

输出规则：
- create_text_artifact.content 应是完整、可直接使用的 Markdown。
- 标题短而具体；正文用清晰层级，不写空泛模板。
- 工具成功后，用用户语言简短确认产物已创建到画布，不要重复整篇内容。`;

export function documentInstructions(context?: CucumberAgentContext) {
  return [
    baseDocumentInstructions,
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
    "- document.create 和 document.edit 必须产出 create_text_artifact。",
    "- rawPrompt 是用户原始需求；结合可信 upstream context 生成文档。",
  ].join("\n");
}

function buildContextInstructions(context?: CucumberAgentContext) {
  if (!context) {
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
    nodeId: item.nodeId,
    prompt: item.prompt,
    summary: item.summary,
    title: item.title,
    type: item.type,
  }));

  return upstream.length
    ? `可信 upstream context 摘要：\n${JSON.stringify(upstream)}`
    : "";
}
