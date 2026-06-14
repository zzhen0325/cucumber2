import type { AgentCanvasNode } from "../../../src/types/canvas.ts";
import { listAgentSkillDefinitions, type AgentSkillDefinitionSummary } from "../../supabase.ts";
import type { AgentRunInput } from "../context.ts";
import type { AgentSkillCard } from "./types.ts";

const MAX_SKILL_CANDIDATES = 6;

const imageIntentPattern =
  /(生成图片|生图|出图|画一张|画个|图片|海报|插画|视觉|参考图|高清|超清|放大|upscale|4k|8k|image|poster|illustration)/i;

export async function retrieveRelevantAgentSkills(
  input: AgentRunInput
): Promise<AgentSkillCard[]> {
  const skills = (await listAgentSkillDefinitions()).filter((skill) => skill.enabled);
  const query = buildSkillRetrievalQuery(input);

  return skills
    .map((skill) => scoreSkill(skill, query))
    .filter((skill) => skill.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.name.localeCompare(right.name);
    })
    .slice(0, MAX_SKILL_CANDIDATES);
}

export function hasBuiltInImageIntent(input: Pick<AgentRunInput, "message" | "upstreamContext">) {
  return (
    imageIntentPattern.test(input.message) ||
    input.upstreamContext.some((item) => item.type === "image")
  );
}

function buildSkillRetrievalQuery(input: AgentRunInput) {
  const selectedNode = input.selectedNodeId
    ? input.canvasSnapshot.nodes.find((node) => node.id === input.selectedNodeId)
    : undefined;
  const canvasKinds = new Set<string>();
  for (const node of input.canvasSnapshot.nodes) {
    canvasKinds.add(node.data.kind);
  }
  for (const item of input.upstreamContext) {
    canvasKinds.add(item.type);
    if (item.artifact?.type) {
      canvasKinds.add(item.artifact.type);
    }
  }
  if (selectedNode) {
    canvasKinds.add(selectedNode.data.kind);
  }

  const text = [
    input.message,
    selectedNode ? nodeText(selectedNode) : "",
    ...input.upstreamContext.flatMap((item) => [
      item.prompt ?? "",
      item.summary ?? "",
      item.title ?? "",
      item.artifact?.title ?? "",
    ]),
  ].join("\n");

  return {
    canvasKinds,
    hasImageIntent: hasBuiltInImageIntent(input),
    text,
    tokens: tokenize(text),
  };
}

function scoreSkill(
  skill: AgentSkillDefinitionSummary,
  query: ReturnType<typeof buildSkillRetrievalQuery>
): AgentSkillCard {
  let score = skill.isDefault ? 3 : 1;
  const reasons: string[] = skill.isDefault ? ["default"] : ["enabled"];
  const lowerText = query.text.toLowerCase();

  for (const keyword of skill.triggers.keywords) {
    if (keyword && lowerText.includes(keyword.toLowerCase())) {
      score += 40;
      reasons.push(`keyword:${keyword}`);
    }
  }

  for (const canvasKind of skill.triggers.canvasKinds) {
    if (query.canvasKinds.has(canvasKind)) {
      score += 30;
      reasons.push(`canvas:${canvasKind}`);
    }
  }

  if (
    query.hasImageIntent &&
    (skill.agentScope === "image" ||
      skill.purpose === "prompt_expansion" ||
      skill.bindings.agents.some((agent) => /image/i.test(agent)) ||
      skill.bindings.tools.some((tool) => /image|prompt/i.test(tool)))
  ) {
    score += 24;
    reasons.push("image-intent");
  }

  if (
    query.hasImageIntent &&
    (skill.name === "visual-prompt-cookbook" ||
      skill.bindings.tools.includes("render_visual_style_prompt") ||
      skill.tags.includes("style-json"))
  ) {
    score += 18;
    reasons.push("visual-style-cookbook");
  }

  const searchable = [
    skill.name,
    skill.description,
    skill.agentScope,
    skill.purpose,
    ...skill.tags,
    ...skill.bindings.tools,
    ...skill.bindings.agents,
  ].join(" ");
  const skillTokens = new Set(tokenize(searchable));
  let overlap = 0;
  for (const token of query.tokens) {
    if (skillTokens.has(token)) {
      overlap += 1;
    }
  }
  if (overlap) {
    score += Math.min(20, overlap * 4);
    reasons.push(`overlap:${overlap}`);
  }

  return {
    ...skill,
    reasons,
    score,
    scripts: skill.scripts.map(({ description, input, name, output, path, runtime }) => ({
      description,
      input,
      name,
      output,
      path,
      runtime,
    })),
  };
}

function tokenize(text: string) {
  return [
    ...new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9_\u4e00-\u9fa5]+/i)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2)
    ),
  ];
}

function nodeText(node: AgentCanvasNode) {
  const data = node.data;
  if ("prompt" in data && typeof data.prompt === "string") {
    return data.prompt;
  }
  if ("title" in data && typeof data.title === "string") {
    return data.title;
  }
  if ("summary" in data && typeof data.summary === "string") {
    return data.summary;
  }
  return "";
}
