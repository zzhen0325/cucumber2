import { tool } from "@openai/agents";
import { z } from "zod";

import type { CucumberAgentContext } from "../../context.ts";
import {
  loadVisualStyleLibrary,
  type StyleCatalogItem,
  type VisualStyleJson,
} from "../../skills/visual-style-library.ts";

const renderVisualStylePromptInputSchema = z.object({
  aspectRatio: z.string().trim().min(1).optional(),
  prompt: z.string().trim().min(1),
  reason: z.string().trim().max(1000).optional(),
  styleSlug: z.string().trim().min(1).optional(),
  values: z.record(z.string(), z.string()).optional(),
});

const renderVisualStylePromptJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    aspectRatio: {
      type: "string",
      description: "Preferred aspect ratio such as 16:9, 9:16, 1:1, or 4:5.",
    },
    prompt: {
      type: "string",
      description: "The user's original or normalized image prompt.",
    },
    reason: {
      type: "string",
      description: "Brief reason for selecting or rendering this visual style.",
    },
    styleSlug: {
      type: "string",
      description:
        "Optional visual style slug. Omit to let the tool choose from the activated style library.",
    },
    values: {
      type: "object",
      additionalProperties: { type: "string" },
      description:
        "Known style variable values such as SUBJECT, MAIN_TEXT, LOCATION, and ASPECT_RATIO.",
    },
  },
  required: ["prompt"],
} as const;

export const renderVisualStylePromptTool = tool({
  name: "render_visual_style_prompt",
  description:
    "Render an activated visual style-library skill's style.json into one final image prompt. Use after activating a skill bound to render_visual_style_prompt and before generate_image when a reusable visual style system is preferred over generic prompt expansion.",
  parameters: renderVisualStylePromptJsonSchema as never,
  strict: false,
  errorFunction: null,
  isEnabled: async ({ runContext }) => {
    const context = requireCucumberContext(runContext.context);
    return Boolean(getActivatedVisualStyleLibrarySkill(context));
  },
  async execute(rawArgs, runContext) {
    const context = requireCucumberContext(runContext?.context);
    const parsed = renderVisualStylePromptInputSchema.safeParse(rawArgs);
    if (!parsed.success) {
      return {
        error: `invalid_visual_style_prompt_input: ${parsed.error.issues
          .map((issue) => `${issue.path.join(".")} ${issue.message}`)
          .join("; ")}`,
      };
    }

    const skill = getActivatedVisualStyleLibrarySkill(context);
    if (!skill) {
      return {
        error:
          "visual_style_library_skill_missing: call activate_skill for a skill bound to render_visual_style_prompt before using this tool.",
      };
    }

    const library = await loadVisualStyleLibrary(skill);
    const requestedSlug = normalizeSlug(parsed.data.styleSlug);
    const selectedSlug =
      requestedSlug || chooseStyleSlug(library.catalog, parsed.data.prompt);
    const selectedStyle = await library.loadStyle(selectedSlug);
    const values = buildStyleValues({
      aspectRatio: parsed.data.aspectRatio,
      prompt: parsed.data.prompt,
      style: selectedStyle,
      values: parsed.data.values ?? {},
    });
    const finalPrompt = renderTemplate(selectedStyle.prompt_template ?? "", values);

    return {
      negativePrompt: selectedStyle.negative_prompt ?? "",
      prompt: finalPrompt,
      selectedStyle: {
        name: selectedStyle.style_name ?? values.STYLE_NAME,
        slug: selectedStyle.style_slug ?? selectedSlug,
        summary: selectedStyle.style_summary ?? "",
      },
      skillId: skill.id,
      skillName: skill.name,
      values,
    };
  },
});

function chooseStyleSlug(catalog: StyleCatalogItem[], prompt: string) {
  const normalizedPrompt = normalizeSearchText(prompt);
  const scored = catalog
    .map((item) => ({ item, score: scoreStyle(item, normalizedPrompt) }))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.item.slug.localeCompare(right.item.slug);
    });

  return scored[0]?.item.slug ?? "playful-mascot-doodle-snapshot-style";
}

function scoreStyle(item: StyleCatalogItem, normalizedPrompt: string) {
  let score = 0;
  if (normalizedPrompt.includes(item.slug)) {
    score += 1000;
  }
  for (const token of tokenize(normalizedPrompt)) {
    if (item.searchable.includes(token)) {
      score += token.length > 3 ? 8 : 4;
    }
  }

  const boosts: Array<[RegExp, RegExp, number]> = [
    [/(旅行|旅游|城市|街头|地铁|vlog|travel|city|tokyo|transit)/i, /(travel|triptych|tokyo|city|transit|diary)/i, 80],
    [/(涂鸦|贴纸|手绘|可爱|doodle|sticker|mascot)/i, /(doodle|sticker|mascot|marker|scribble)/i, 80],
    [/(拼贴|杂志|剪贴|zine|collage|ransom)/i, /(zine|collage|cutout|ransom)/i, 80],
    [/(字体|标题|字效|typography|type|headline)/i, /(type|typographic|poster|shockwave|kinetic)/i, 80],
    [/(产品|广告|饮料|食物|发布|product|ad|launch|food|beverage)/i, /(product|ad|launch|food|beverage|hud|furniture)/i, 80],
    [/(时装|高级|奢华|editorial|fashion|luxury)/i, /(editorial|fashion|luxury|nameplate|architectural)/i, 80],
  ];
  for (const [promptPattern, stylePattern, boost] of boosts) {
    if (promptPattern.test(normalizedPrompt) && stylePattern.test(item.searchable)) {
      score += boost;
    }
  }

  return score;
}

function buildStyleValues({
  aspectRatio,
  prompt,
  style,
  values,
}: {
  aspectRatio?: string;
  prompt: string;
  style: VisualStyleJson;
  values: Record<string, string>;
}) {
  const environmentVariables = style.environment_variables ?? {};
  const result: Record<string, string> = {};
  for (const key of Object.keys(environmentVariables)) {
    const explicit = values[key];
    result[key] = explicit?.trim() || deriveVariableValue(key, prompt, aspectRatio);
  }
  if (aspectRatio?.trim()) {
    result.ASPECT_RATIO = aspectRatio.trim();
  }
  result.STYLE_FIDELITY_ANCHORS =
    values.STYLE_FIDELITY_ANCHORS?.trim() ||
    (style.style_fidelity_anchors ?? []).join("; ");
  result.SOURCE_CONTENT_TO_AVOID =
    values.SOURCE_CONTENT_TO_AVOID?.trim() ||
    (style.source_content_to_avoid ?? []).join("; ");
  result.STYLE_NAME = style.style_name ?? "";
  return result;
}

function deriveVariableValue(key: string, prompt: string, aspectRatio?: string) {
  const textHint = extractQuotedText(prompt);
  const defaults: Record<string, string> = {
    ACCENT_SYMBOL: "subtle graphic marks that support the composition without adding logos",
    ASPECT_RATIO: aspectRatio?.trim() || inferAspectRatio(prompt),
    BACKGROUND_ELEMENTS:
      "supporting environmental details, texture, depth, and visual rhythm implied by the brief",
    LOCATION: "a setting implied by the brief, made specific and visually coherent",
    MAIN_TEXT:
      textHint ||
      "no readable headline; use abstract non-readable graphic marks only",
    PRODUCT_OR_PROP:
      "the product, object, or prop implied by the brief; no extra branded marks",
    SECONDARY_TEXT: "no readable secondary text",
    SUBJECT: prompt,
    SUBJECT_ACTION: "presented in the main pose, action, or mood implied by the brief",
    WARDROBE_STYLE:
      "styling implied by the subject and scene; use clean coherent visual styling",
  };
  return defaults[key] ?? `Use the user's brief as the source for ${key}: ${prompt}`;
}

function inferAspectRatio(prompt: string) {
  if (/9\s*[:：]\s*16|竖|vertical|portrait/i.test(prompt)) {
    return "9:16";
  }
  if (/1\s*[:：]\s*1|方|square/i.test(prompt)) {
    return "1:1";
  }
  return "16:9";
}

function extractQuotedText(prompt: string) {
  const match = prompt.match(/[“"「『](.{1,80}?)[”"」』]/);
  return match?.[1]?.trim() ?? "";
}

function renderTemplate(template: string, values: Record<string, string>) {
  return template.replace(/\{([A-Z0-9_]+)\}/g, (_match, key: string) => {
    return values[key] ?? "";
  });
}

function tokenize(text: string) {
  return [
    ...new Set(
      text
        .split(/[^a-z0-9_\u4e00-\u9fa5]+/i)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2)
    ),
  ];
}

function normalizeSearchText(text: string) {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeSlug(slug?: string) {
  return slug?.trim().toLowerCase().replace(/[^a-z0-9-]/g, "") ?? "";
}

function getActivatedVisualStyleLibrarySkill(context: CucumberAgentContext) {
  return context.activatedSkills.find(
    (skill) =>
      skill.bindings.tools.includes("render_visual_style_prompt") ||
      skill.tags.includes("style-json") ||
      skill.tags.includes("visual-style")
  );
}

function requireCucumberContext(context: unknown): CucumberAgentContext {
  if (!context || typeof context !== "object") {
    throw new Error("Cucumber agent context is missing.");
  }
  return context as CucumberAgentContext;
}
