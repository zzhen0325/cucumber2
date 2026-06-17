import type { AgentCanvasNode } from "../../../src/types/canvas.ts";
import type { AgentSkillDefinitionSummary } from "../../supabase.ts";
import type { AgentRunInput } from "../context.ts";
import {
  hasNegativeCapability,
  isImageArtifactTask,
} from "../input-normalizer.ts";
import type { AgentSkillCard } from "./types.ts";
import { listCachedAgentSkillDefinitions } from "./skill-registry.ts";

const MAX_SKILL_CANDIDATES = 6;

const imageIntentPattern =
  /(生成图片|生图|出图|画一张|画个|图片|海报|插画|参考图|高清|超清|放大|upscale|4k|8k|image|poster|illustration)/i;

export async function retrieveRelevantAgentSkills(
  input: AgentRunInput
): Promise<AgentSkillCard[]> {
  if (shouldSkipSkillRetrieval(input)) {
    return [];
  }

  const skills = (await listCachedAgentSkillDefinitions()).filter((skill) => skill.enabled);
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

function shouldSkipSkillRetrieval(input: AgentRunInput) {
  const normalizedInput = input.normalizedInput;
  return Boolean(
    normalizedInput &&
      !normalizedInput.artifact &&
      normalizedInput.operation === "answer" &&
      !(normalizedInput.requiredCapabilities ?? []).length &&
      !(normalizedInput.negativeCapabilities ?? []).length &&
      !input.selectedNodeIds.length &&
      !input.upstreamContext.length &&
      input.message.trim().length <= 160 &&
      !hasComplexSkillSignal(input.message)
  );
}

function hasComplexSkillSignal(message: string) {
  return /https?:\/\/|调研|研究|报告|文档|方案|规划|引用|来源|citation|sources?|markdown|流程图|时序图|diagram/i.test(
    message
  );
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
    hasImageIntent:
      isImageArtifactTask(input.normalizedInput) ||
      (!hasNegativeCapability(input.normalizedInput, "image-generation") &&
        hasBuiltInImageIntent(input)),
    normalizedInput: input.normalizedInput,
    text,
    tokens: tokenize(text),
  };
}

function scoreSkill(
  skill: AgentSkillDefinitionSummary,
  query: ReturnType<typeof buildSkillRetrievalQuery>
): AgentSkillCard {
  let score = 0;
  const reasons: string[] = [];
  const lowerText = query.text.toLowerCase();
  const suppressImage = hasNegativeCapability(query.normalizedInput, "image-generation");
  const skillIsImage = isImageSkill(skill);

  if (suppressImage && skillIsImage) {
    return toSkillCard(skill, {
      reasons: ["negative-capability:image-generation"],
      score: 0,
    });
  }

  const capabilityScore = scoreCapabilityMatch(skill, query);
  if (capabilityScore.score > 0) {
    score += capabilityScore.score;
    reasons.push(...capabilityScore.reasons);
  }

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
    skillIsImage
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

  return toSkillCard(skill, {
    reasons,
    score,
  });
}

function scoreCapabilityMatch(
  skill: AgentSkillDefinitionSummary,
  query: ReturnType<typeof buildSkillRetrievalQuery>
) {
  const normalizedInput = query.normalizedInput;
  if (!normalizedInput) {
    return { reasons: [] as string[], score: 0 };
  }

  let score = 0;
  const reasons: string[] = [];
  const artifact = normalizedInput.artifact;
  const requiredCapabilities = new Set(normalizedInput.requiredCapabilities ?? []);

  for (const capability of skill.capabilities) {
    if (capability.operation && capability.operation === normalizedInput.operation) {
      score += 12;
      reasons.push(`operation:${capability.operation}`);
    }
    if (artifact && capability.artifact?.kind === artifact.kind) {
      score += 42;
      reasons.push(`artifact.kind:${artifact.kind}`);
    }
    if (
      artifact?.subtype &&
      capability.artifact?.subtype === artifact.subtype
    ) {
      score += 34;
      reasons.push(`artifact.subtype:${artifact.subtype}`);
    }
    if (
      artifact?.format &&
      capability.artifact?.format === artifact.format
    ) {
      score += 24;
      reasons.push(`artifact.format:${artifact.format}`);
    }
    if (normalizedInput.domain && capability.domain === normalizedInput.domain) {
      score += 8;
      reasons.push(`domain:${normalizedInput.domain}`);
    }
    for (const required of capability.requiredCapabilities) {
      if (requiredCapabilities.has(required)) {
        score += 20;
        reasons.push(`capability:${required}`);
      }
    }
  }

  for (const produced of skill.produces) {
    if (
      (artifact?.kind === "diagram" && produced === "markdown") ||
      produced === artifact?.kind ||
      produced === artifact?.format
    ) {
      score += 18;
      reasons.push(`produces:${produced}`);
    }
  }

  for (const used of skill.uses) {
    if (
      requiredCapabilities.has(used) ||
      (artifact?.kind === "diagram" && used === "create_text_artifact")
    ) {
      score += 12;
      reasons.push(`uses:${used}`);
    }
  }

  for (const negative of normalizedInput.negativeCapabilities ?? []) {
    if (skill.notFor.includes(negative)) {
      score -= 10;
      reasons.push(`not-for:${negative}`);
    }
  }

  return { reasons, score: Math.max(0, score) };
}

function isImageSkill(skill: AgentSkillDefinitionSummary) {
  return (
    skill.agentScope === "image" ||
    skill.purpose === "prompt_expansion" ||
    skill.bindings.agents.some((agent) => /image/i.test(agent)) ||
    skill.bindings.tools.some((tool) => /image|prompt/i.test(tool)) ||
    skill.capabilities.some((capability) => capability.artifact?.kind === "image")
  );
}

function toSkillCard(
  skill: AgentSkillDefinitionSummary,
  scored: { reasons: string[]; score: number }
): AgentSkillCard {
  return {
    ...skill,
    reasons: scored.reasons,
    score: scored.score,
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
