import type { CucumberAgentContext } from "../context.ts";

const baseDocumentInstructions = `你是 Cucumber Document Agent，是专门生成和改写 Markdown/document/html/code 文本产物的智能体。

职责：
- 当用户请求生成、撰写、整理、改写 Markdown、文档、PRD、方案、brief、说明、邮件草稿、会议纪要或结构化文本资产时，你可能由 runtime 直接启动，也可能通过 Cucumber Manager handoff 接收任务。
- 当 normalized_input.artifact.kind 为 diagram 时，你负责创建 Markdown/Mermaid 图表 artifact，不要把它当成图片生成任务。
- 当 normalized_input.artifact.kind 为 webpage 且 artifact.format 为 html 时，你负责创建完整 HTML artifact；HTML 动画、H5 页面和交互 demo 都属于 webpage/html 文本产物，不要把它当成图片生成任务。
- 如果候选技能里有匹配 diagram/sequenceDiagram/mermaid 或流程图的技能，先调用 activate_skill；如果技能说明提到资源，再用 read_skill_resource 读取需要的文本资源。
- 如果候选技能里有匹配 html/webpage/prototype/animation/demo 的技能，先调用 activate_skill；如果技能说明提到 resources/scripts/assets，先用 read_skill_resource 读取当前任务需要的文本资源。
- 必须调用 create_text_artifact 创建最终产物；不要只把完整内容写在聊天回复里。
- 你可以使用可信 upstream context 中的摘要、标题、prompt 和 artifact metadata，但不得假装读取了未提供的全文。
- 用户要求基于已导入资料、knowledge、参考文档、网页或数据集撰写/改写时，先调用 search_knowledge 获取相关摘录，再写入 create_text_artifact。
- 若用户要求改写选中的文档/Markdown，但上下文只有摘要或预览，应明确基于可见上下文改写，不能声称读取了完整源文件。
- 不要调用图片、网页、代码、数据或画布操作工具。

输出规则：
- create_text_artifact.content 应是完整、可直接使用的目标格式内容。
- webpage/html 产物的 create_text_artifact.content 必须是完整 HTML document，包含 <!doctype html>、<html>、<head>、<body>；format 使用 html。
- Mermaid diagram artifact 必须包含 mermaid fenced code block；时序图使用 sequenceDiagram，流程图使用 flowchart。
- 标题短而具体；正文用清晰层级，不写空泛模板。
- 工具成功后，用用户语言简短确认产物已创建到画布，不要重复整篇内容。`;

export function documentInstructions(context?: CucumberAgentContext) {
  return [
    baseDocumentInstructions,
    buildNormalizedInputInstructions(context),
    buildSkillInstructions(context),
    buildContextInstructions(context),
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildSkillInstructions(context?: CucumberAgentContext) {
  if (!context) {
    return "";
  }

  const candidates = context.skillCandidates
    .filter(
      (skill) =>
        skill.agentScope === "document" ||
        skill.bindings.agents.some((agent) => /document/i.test(agent)) ||
        skill.bindings.tools.includes("create_text_artifact") ||
        skill.capabilities.some((capability) =>
          ["code", "diagram", "document", "markdown", "webpage"].includes(
            capability.artifact?.kind ?? ""
          )
        )
    )
    .map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      scope: skill.agentScope,
      purpose: skill.purpose,
      tags: skill.tags,
      capabilities: skill.capabilities,
      produces: skill.produces,
      uses: skill.uses,
      notFor: skill.notFor,
      scripts: skill.scripts.map(({ description, name, path, runtime }) => ({
        description,
        name,
        path,
        runtime,
      })),
    }));
  const activated = context.activatedSkills.map((skill) => ({
    id: skill.id,
    name: skill.name,
    instructions: skill.body,
    resources: skill.sourceManifest.resources ?? null,
    scripts: skill.scripts.map(({ description, input, name, output, path, runtime }) => ({
      description,
      input,
      name,
      output,
      path,
      runtime,
    })),
  }));

  return [
    "可用 Document/Diagram 技能：",
    `skill_cards: ${JSON.stringify(candidates)}`,
    activated.length ? `activated_skills: ${JSON.stringify(activated)}` : "",
    activated.length
      ? "activated_skills 已由运行时激活，必须优先遵循；使用其它候选技能前仍必须先 activate_skill。若技能说明提到 references/scripts/assets，先用 read_skill_resource 查看当前任务需要的文本资源。"
      : "使用技能前必须先 activate_skill；只激活与 normalized_input.artifact 和 requiredCapabilities 匹配的技能。若技能说明提到 references/scripts/assets，先用 read_skill_resource 查看当前任务需要的文本资源。",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildNormalizedInputInstructions(context?: CucumberAgentContext) {
  if (!context?.normalizedInput) {
    return "";
  }

  return [
    "规格化输入：",
    `normalized_input: ${JSON.stringify(context.normalizedInput)}`,
    "- artifact.kind=markdown/document/diagram/code/webpage 必须产出 create_text_artifact。",
    "- diagram/mermaid 产物必须写成 Markdown，并包含 Mermaid fenced block。",
    "- webpage/html 产物必须写成完整 HTML document，并用 create_text_artifact(format=html) 保存。",
    "- requiredCapabilities 描述必须满足的文档/图表能力；negativeCapabilities 描述禁止能力。",
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
    content: item.content,
    contentFormat: item.contentFormat,
    mimeType: item.mimeType,
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
