import { tool } from "@openai/agents";
import { z } from "zod";

import type { CucumberAgentContext } from "../../context.ts";
import {
  extractHtmlTitle,
  extractReadableText,
  fetchPublicReadableWebpage,
} from "../web/public-web-fetch.ts";

const MAX_RESEARCH_SOURCES = 5;
const SOURCE_EXCERPT_LIMIT = 4_000;

const researchSourceSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  url: z.string().trim().url(),
});

const collectResearchSourcesInputSchema = z.object({
  question: z.string().trim().min(1),
  sources: z.array(researchSourceSchema).min(1).max(MAX_RESEARCH_SOURCES),
});

const collectResearchSourcesJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    question: {
      type: "string",
      description: "The research question to answer from the provided sources.",
    },
    sources: {
      type: "array",
      maxItems: MAX_RESEARCH_SOURCES,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          url: { type: "string" },
        },
        required: ["url"],
      },
      description:
        "Public http(s) source URLs supplied by the user or trusted canvas context.",
    },
  },
  required: ["question", "sources"],
} as const;

export const collectResearchSourcesTool = tool({
  name: "collect_research_sources",
  description:
    "Fetch up to five user-provided public http(s) source URLs and return citation records with readable text excerpts. This does not search the web; it only reads explicit sources. Do not use for localhost, private network URLs, logged-in pages, or browser automation.",
  parameters: collectResearchSourcesJsonSchema as never,
  strict: false,
  errorFunction: null,
  async execute(rawArgs, runContext, details) {
    requireCucumberContext(runContext?.context);
    const parsed = collectResearchSourcesInputSchema.safeParse(rawArgs);
    if (!parsed.success) {
      return {
        error: `invalid_research_sources_input: ${parsed.error.issues
          .map((issue) => `${issue.path.join(".")} ${issue.message}`)
          .join("; ")}`,
      };
    }

    const sources = [];
    for (let index = 0; index < parsed.data.sources.length; index += 1) {
      const source = parsed.data.sources[index];
      const fetched = await fetchPublicReadableWebpage(source.url, details?.signal);
      const title = source.title ?? extractHtmlTitle(fetched.html) ?? fetched.url.hostname;
      sources.push({
        excerpt: extractReadableText(fetched.html, SOURCE_EXCERPT_LIMIT),
        finalUrl: fetched.url.toString(),
        index: index + 1,
        title,
      });
    }

    return {
      question: parsed.data.question,
      sources,
    };
  },
});

function requireCucumberContext(context: unknown): CucumberAgentContext {
  if (!context || typeof context !== "object") {
    throw new Error("Cucumber agent context is missing.");
  }
  return context as CucumberAgentContext;
}
