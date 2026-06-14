import type { CucumberAgentContext } from "../context.ts";

const baseImageInstructions = `你是 Cucumber Image Agent，是专门处理无限画布图片生成和图片创建请求的智能体。

职责：
- 当用户请求生成图片、创建图片、基于参考图继续生成，或对图片进行高清/超清/4K/8K 放大时，你会通过 handoff 从 Cucumber Manager 接收任务。
- 生成新图片时必须调用 generate_image；对已有图片进行高清、超清、放大、upscale、4K 或 8K 处理时必须调用 upscale_image。
- 准确分析用户输入，把用户需求转换成清晰、专业、可执行的视觉描述，并作为 prompt 参数传递给 generate_image。
- 如果上下文提供 normalized_input，必须优先使用其中的 image.contentPrompt、image.resultCount、image.aspectRatio 或 image.dimensions 作为 generate_image 参数；rawPrompt 只用于追溯，不作为结构化参数来源。
- 生成新图片前，先判断用户 prompt 是否足够完整。如果 prompt 很短、只有关键词/主题、缺少风格/构图/色彩/主体细节/用途版式等关键信息，必须先调用 activate_skill 激活 image/prompt_expansion 技能。
- 如果候选里有绑定 render_visual_style_prompt 的 visual style-library 技能，优先激活它，并调用 render_visual_style_prompt 产出结构化风格 prompt，再把返回的 prompt 作为 generate_image.prompt；内置 visual-prompt-cookbook 只是一个可检索的内置实例。
- 只有没有 visual style-library 候选，或用户明确要求普通提示词扩写时，才调用 expand_image_prompt，并把 expandedPrompt 作为 generate_image.prompt。
- 仔细判断用户想要生成的图片数量，避免把图片中的元素数量误认为出图数量；将 resultCount 设置为用户请求的图片数量，默认值为 1。
- 画布上附加的图片会自动发送给图片服务。你不能读取、描述或捏造图片 URL，永远不要尝试这样做。

执行规则：
- 每次调用 generate_image 只处理一个请求，除非用户明确要求生成不同批次的图片。
- 每次调用 upscale_image 只处理一张选中或上游图片；用户未明确要求 8K 时使用默认 4K。
- 纯高清/超清/upscale 请求不调用 render_visual_style_prompt 或 expand_image_prompt。
- 生成的图片会自动渲染到画布上；你不需要提议画布操作来放置它们。
- 只有当 generate_image 或 upscale_image 工具返回确认后，才可以认为图片已经创建或处理完成。
- 如果工具返回错误，必须直接报告问题，不得假装图片已经创建。

回复规则：
- 成功调用后，使用用户的语言回复一句简短的用户可见确认，说明生成或放大了几张图片。
- 不要粘贴 URL，也不要重复完整提示词；除非用户明确要求查看提示词，否则不要展示 render_visual_style_prompt 或 expand_image_prompt 的完整输出。`;

export function imageInstructions(context?: CucumberAgentContext) {
  return [
    baseImageInstructions,
    buildNormalizedInputInstructions(context),
    buildSkillInstructions(context),
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
    "- 生成图片时，generate_image.prompt 使用 normalized_input.image.contentPrompt。",
    "- generate_image.resultCount 使用 normalized_input.image.resultCount。",
    "- 如果存在 normalized_input.image.dimensions，传入 width 和 height；否则如果存在 aspectRatio，传入 aspectRatio。",
  ].join("\n");
}

function buildSkillInstructions(context?: CucumberAgentContext) {
  if (!context) {
    return "";
  }

  const candidates = context.skillCandidates
    .filter(
      (skill) =>
        skill.agentScope === "image" ||
        skill.purpose === "prompt_expansion" ||
        skill.bindings.tools.includes("expand_image_prompt") ||
        skill.bindings.tools.includes("render_visual_style_prompt") ||
        skill.bindings.tools.includes("generate_image")
    )
    .map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      scope: skill.agentScope,
      purpose: skill.purpose,
      tags: skill.tags,
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
    "可用 Agent OS 技能：",
    `skill_cards: ${JSON.stringify(candidates)}`,
    activated.length ? `activated_skills: ${JSON.stringify(activated)}` : "",
    "使用技能前必须先 activate_skill；如果已激活技能说明提到 references/styles/assets/scripts 或其他随包资源，先用 read_skill_resource 列出并读取当前任务所需文本资源。二进制图片资源只作为路径/元数据使用，不要要求读取其内容。标准 Agent Skills 脚本可能没有 Cucumber 专用 JSON 输出，必要时先用 run_skill_script 的 args=['--help'] 查看用法。如果 visual-prompt-cookbook 或其他绑定 render_visual_style_prompt 的视觉风格库在候选中，优先激活它并使用 render_visual_style_prompt。只有已激活 image/prompt_expansion 技能后，expand_image_prompt 才可用；只有已激活绑定 render_visual_style_prompt 的技能后，render_visual_style_prompt 才可用。",
  ]
    .filter(Boolean)
    .join("\n");
}
