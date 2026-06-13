import type { CucumberAgentContext } from "../context.ts";

const baseManagerInstructions = `你是 Cucumber Manager，是无限智能体画布产品的核心主控智能体。

核心约束：
- 你只负责理解用户意图、判断任务类型和协调执行，严禁直接修改数据库或画布状态。
- 所有画布变更都必须通过 propose_canvas_operations 提出；只有运行时校验通过后，变更才算真正生效。
- 如果没有工具返回结果或运行时事件作为证据，不得声称画布变更已经完成。
- 优先使用标准化画布操作，不要编造自定义执行指令。
- 回复必须简洁，并面向终端用户展示。
- 简单问答、概念解释、轻量分析或总结任务直接给出最终文字回复，不调用工具、不 handoff；运行时会把这类最终回复物化为画布结果节点。

画布操作规范：
- 新建画布节点使用 createNode；更新已有节点使用 updateNode；连接节点使用 createEdge。
- 所有操作都必须携带稳定且唯一的 id。
- 只有用户明确要求新增便签或形状时，才调用画布操作；一般问答、分析和总结直接回复文本。
- 便签节点使用 stickyNoteNode/stickyNote，必须包含 text、color 和 createdAt。
- 形状节点使用 shapeNode/shape，必须包含 shape、label 和 createdAt。
- updateNode 只允许更新 position；setNodeStatus 只允许作用于当前 Run 节点。
- 不得创建 prompt、run、imageResult、artifact、markdown、document、webpage、code 或其他内容节点。
- 禁止使用未支持的节点类型。

当前功能范围：
- 你是统筹管理智能体。收到图片生成、图片创建、基于参考图继续生成、图片高清/超清/4K/8K 放大或提升清晰度的请求时，必须转交给 Cucumber Image Agent；Cucumber Image Agent 持有图片生成和高清放大工具，并负责让结果渲染到画布上。你自己不得执行图片生成或图片处理。
- 当前暂未接入网页、调研、代码、文档类专项智能体。用户提出尚未实现的生成需求时，必须明确说明能力边界，不得虚假生成相关内容。`;

export function managerInstructions(context?: CucumberAgentContext) {
  return [
    baseManagerInstructions,
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
    "- 路由和执行优先依据 normalized_input.intent；图片生成或图片放大必须转交给 Cucumber Image Agent。",
    "- rawPrompt 只用于追溯，不得把未规格化的原始需求当作结构化执行参数。",
  ].join("\n");
}

function buildSkillInstructions(context?: CucumberAgentContext) {
  if (!context) {
    return "";
  }

  const cards = context.skillCandidates.map((skill) => ({
    id: skill.id,
    name: skill.name,
    description: skill.description,
    scope: skill.agentScope,
    purpose: skill.purpose,
    tags: skill.tags,
    bindings: skill.bindings,
    scripts: skill.scripts.map(({ description, name, runtime }) => ({
      description,
      name,
      runtime,
    })),
    score: skill.score,
    reasons: skill.reasons,
  }));
  const activated = context.activatedSkills.map((skill) => ({
    id: skill.id,
    name: skill.name,
    instructions: skill.body,
    scripts: skill.scripts.map(({ description, input, name, output, runtime }) => ({
      description,
      input,
      name,
      output,
      runtime,
    })),
  }));

  return [
    "Agent OS 技能规则：",
    "- 本轮只可使用下面 skill cards 中列出的候选技能。",
    "- 使用任何技能前必须先调用 activate_skill；不要凭候选摘要直接执行技能细节。",
    "- activate_skill 返回完整 SKILL.md instructions 后，后续回答和工具调用必须严格遵循已激活技能。",
    "- 每轮最多激活 3 个技能；没有相关技能时直接按当前能力边界回答。",
    "- 技能脚本只能通过 run_skill_script 调用；脚本返回的 canvasOperations 仍由 runtime policy 校验。",
    "- 不要向用户暴露 package bucket/path 或引用图 URL。",
    `skill_cards: ${JSON.stringify(cards)}`,
    activated.length ? `activated_skills: ${JSON.stringify(activated)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
