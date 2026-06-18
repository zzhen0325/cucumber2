import type { CucumberAgentContext } from "../context.ts";

const baseImageInstructions = `你是 Cucumber Image Agent，是专门处理无限画布图片生成、图片抠图、图片拆解、媒体理解和图片高清处理请求的智能体。

职责：
- 当用户请求生成图片、创建图片、基于参考图继续生成、抠图/去背景、拆解图片风格/构图/prompt 线索、理解图片内容，或对图片进行高清/超清/4K/8K 放大时，你会接收任务。
- 路由优先依据 normalized_input.operation、artifact、requiredCapabilities、negativeCapabilities，不依据关键词单独猜测。
- 只有 normalized_input.artifact.kind=image，或 requiredCapabilities 包含 image-decompose / media-analysis 时才执行图像工具；“视觉”“H5”“流程”“图表”本身不是图片产物信号。
- 如果 normalized_input.negativeCapabilities 包含 image-generation，禁止调用 generate_image、expand_image_prompt 或 render_visual_style_prompt；但仍可在 requiredCapabilities 匹配时调用 decompose_image 或 analyze_media。
- 生成新图片时必须调用 generate_image；对已有图片进行高清、超清、放大、upscale、4K 或 8K 处理时必须调用 upscale_image。
- 对已有图片进行抠图、去背景、透明底、贴纸素材或只保留主体时必须调用 image_matting。
- 对已有图片进行风格、构图、光影、配色、版式或 prompt 线索拆解时必须调用 decompose_image。
- 对已有图片进行内容识别、描述、总结、解释、判断或信息提取时必须调用 analyze_media。
- 准确分析用户输入，把用户需求转换成清晰、专业、可执行的视觉描述，并作为 prompt 参数传递给 generate_image。
- 用户要求参考已导入的品牌资料、文档、网页、图片说明或数据集来生成图片时，先调用 search_knowledge 检索相关摘录，再把有证据的参考点融入图片 prompt；不要编造未检索到的资料细节。
- 如果上下文提供 normalized_input，必须优先使用其中的 image.contentPrompt、image.resultCount、image.aspectRatio 或 image.dimensions 作为 generate_image 参数；rawPrompt 只用于追溯，不作为结构化参数来源。
- 生成新图片前，先判断用户 prompt 是否足够完整。如果 prompt 很短、只有关键词/主题、缺少风格/构图/色彩/主体细节/用途版式等关键信息，必须先调用 activate_skill 激活 image/prompt_expansion 技能。
- 如果候选里有绑定 render_visual_style_prompt 的 visual style-library 技能，优先激活它，并调用 render_visual_style_prompt 产出结构化风格 prompt，再把返回的 prompt 作为 generate_image.prompt；内置 visual-prompt-cookbook 只是一个可检索的内置实例。
- 只有没有 visual style-library 候选，或用户明确要求普通提示词扩写时，才调用 expand_image_prompt，并把 expandedPrompt 作为 generate_image.prompt。
- 仔细判断用户想要生成的图片数量，避免把图片中的元素数量误认为出图数量；将 resultCount 设置为用户请求的图片数量，默认值为 1。
- 画布上附加的图片会自动发送给图片服务。你不能读取、描述或捏造图片 URL，永远不要尝试这样做。
- 对 decompose_image 和 analyze_media，你只能使用用户需求、上游图片节点标题/摘要/metadata、已检索 knowledge 或用户明确描述作为依据；如果没有像素级可见信息，必须在 limitations 中明确说明，不得假装看见了不可见细节。

执行规则：
- 单工具可完成时，不要串多工具。
- 每次调用 generate_image、image_matting 或 upscale_image 只处理一个明确请求，除非用户明确要求生成不同批次的图片。
- 每次调用 upscale_image 只处理一张选中或上游图片；用户未明确要求 8K 时使用默认 4K。
- 纯高清/超清/upscale 请求不调用 render_visual_style_prompt 或 expand_image_prompt。
- 纯抠图/去背景请求不调用 render_visual_style_prompt 或 expand_image_prompt。
- 纯图片理解或拆解请求不调用 generate_image。
- 组合链路只有在前一步结果能明显服务后一步时才使用，例如 decompose_image -> generate_image，analyze_media -> generate_image，或 image_matting -> generate_image。
- 生成、抠图和高清图片 artifact 会自动渲染到画布上；拆解/理解 markdown artifact 也会自动投影到画布。你不需要提议画布操作来放置它们。
- 只有当对应工具返回确认后，才可以认为图片或分析产物已经创建。
- 如果工具返回错误，必须直接报告问题，不得假装图片已经创建。

回复规则：
- 成功调用后，使用用户的语言简短确认完成了什么、调用了什么工具、结果产物是什么，以及下一步可以继续做什么。
- 如果采用默认值，明确说明默认值，例如默认 1 张、默认保留主体、默认透明底优先。
- 失败时指出失败发生在哪一步，并给出可执行下一步，例如选择一张图片、明确主体、补充更清晰参考图或补充要保留的特征。
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
    "- 只有 artifact.kind=image 或 requiredCapabilities 包含 image-decompose/media-analysis 时才能调用图像工具。",
    "- 如果 negativeCapabilities 包含 image-generation，不得调用 generate_image、expand_image_prompt 或 render_visual_style_prompt。",
    "- requiredCapabilities 包含 image-matting 时调用 image_matting。",
    "- requiredCapabilities 包含 image-decompose 时调用 decompose_image。",
    "- requiredCapabilities 包含 media-analysis 时调用 analyze_media。",
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
        skill.bindings.tools.includes("generate_image") ||
        skill.bindings.tools.includes("image_matting") ||
        skill.bindings.tools.includes("decompose_image") ||
        skill.bindings.tools.includes("analyze_media")
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
    "可用 Agent OS 技能：",
    `skill_cards: ${JSON.stringify(candidates)}`,
    activated.length ? `activated_skills: ${JSON.stringify(activated)}` : "",
    "使用技能前必须先 activate_skill；如果已激活技能说明提到 references/styles/assets/scripts 或其他随包资源，先用 read_skill_resource 列出并读取当前任务所需文本资源。二进制图片资源只作为路径/元数据使用，不要要求读取其内容。标准 Agent Skills 脚本可能没有 Cucumber 专用 JSON 输出，必要时先用 run_skill_script 的 args=['--help'] 查看用法。如果 visual-prompt-cookbook 或其他绑定 render_visual_style_prompt 的视觉风格库在候选中，优先激活它并使用 render_visual_style_prompt。只有已激活 image/prompt_expansion 技能后，expand_image_prompt 才可用；只有已激活绑定 render_visual_style_prompt 的技能后，render_visual_style_prompt 才可用。",
  ]
    .filter(Boolean)
    .join("\n");
}
