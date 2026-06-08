import type { AgentSkill } from "../supabase.ts";
import type {
  AgentInput,
  BuiltContext,
  ContextItem,
  IntentResult,
  OmittedContextItem,
  SkillInstruction,
} from "../../src/types/runtime.ts";
import { builtContextSchema } from "./schemas.ts";
import {
  selectToolsForIntent,
  type ToolRegistry,
} from "./tool-registry.ts";

const defaultContextBudget = 2_400;

export function buildContext({
  input,
  intent,
  publicSkills,
  runId,
  toolRegistry,
}: {
  input: AgentInput;
  intent: IntentResult;
  publicSkills: AgentSkill[];
  runId: string;
  toolRegistry: ToolRegistry;
}): BuiltContext {
  const graphItems = input.canvasContext.upstreamContext
    .map((item, index): ContextItem => {
      const selected = item.nodeId === input.canvasContext.selectedNodeId;
      const relevanceScore = selected
        ? 1
        : Math.max(0.2, 0.85 - index * 0.08 + (item.priority ?? 0) * 0.05);

      return {
        ...item,
        source: selected ? "selected_node" : "upstream_graph",
        relevanceScore,
        tokenEstimate: estimateTokens(
          [item.summary, item.prompt, item.title, item.contentRef, item.imageUrl]
            .filter(Boolean)
            .join("\n")
        ),
        inclusionReason: selected
          ? "selected_node_required"
          : "upstream_graph_context",
      };
    });
  const attachmentItems = input.attachments.map(
    (attachment, index): ContextItem => ({
      nodeId: `attachment:${attachment.id}`,
      type: mapAttachmentKindToContextType(attachment.kind),
      title: attachment.name,
      summary: attachment.preview,
      artifact: attachment.artifact,
      contentRef: attachment.contentRef,
      imageUrl: attachment.kind === "image" ? attachment.uri : undefined,
      source: "attachment",
      relevanceScore: Math.max(0.35, 0.7 - index * 0.05),
      tokenEstimate: estimateTokens(
        [
          attachment.name,
          attachment.mimeType,
          attachment.preview,
          attachment.contentRef,
          attachment.uri,
        ]
          .filter(Boolean)
          .join("\n")
      ),
      inclusionReason: "input_attachment_metadata",
    })
  );
  const historyItems = input.conversationHistory.map(
    (message, index): ContextItem => ({
      nodeId: `history:${message.id}`,
      type: "memory",
      summary: message.summary,
      title: `${message.role} message summary`,
      source: "history",
      relevanceScore: Math.max(0.15, 0.42 - index * 0.03),
      tokenEstimate: estimateTokens(message.summary),
      inclusionReason: "conversation_summary",
    })
  );
  const projectItems = input.projectRefs.map(
    (ref, index): ContextItem => ({
      nodeId: `project:${ref.id}`,
      type: ref.kind === "artifact" ? "artifact" : "memory",
      title: ref.title,
      summary: ref.summary,
      contentRef: ref.contentRef,
      source: "project",
      relevanceScore: Math.max(0.2, 0.5 - index * 0.04),
      tokenEstimate: estimateTokens([ref.title, ref.summary, ref.contentRef].filter(Boolean).join("\n")),
      inclusionReason: "project_reference",
    })
  );
  const rankedItems = [
    ...graphItems,
    ...attachmentItems,
    ...historyItems,
    ...projectItems,
  ].sort((left, right) => {
      if (left.source === "selected_node" && right.source !== "selected_node") {
        return -1;
      }
      if (right.source === "selected_node" && left.source !== "selected_node") {
        return 1;
      }
      return right.relevanceScore - left.relevanceScore;
    });

  const selectedItems: ContextItem[] = [];
  const omittedItems: OmittedContextItem[] = [];
  let usedTokens = estimateTokens(input.userMessage);

  for (const item of rankedItems) {
    if (
      item.source !== "selected_node" &&
      usedTokens + item.tokenEstimate > defaultContextBudget
    ) {
      omittedItems.push({
        ...item,
        omissionReason: "context_budget_exceeded",
      });
      continue;
    }

    selectedItems.push(item);
    usedTokens += item.tokenEstimate;
  }

  const availableTools = selectToolsForIntent(
    toolRegistry,
    intent.requiredTools
  );
  const injectedSkills = selectSkillsForIntent(intent, publicSkills);
  const promptParts = buildRuntimePromptParts({
    availableTools,
    injectedSkills,
    input,
    intent,
    omittedItems,
    selectedItems,
  });

  return builtContextSchema.parse({
    runId,
    taskContext: [
      `intent: ${intent.primaryIntent}`,
      `goals: ${intent.task.goals.join("; ")}`,
      `selectedContextItems: ${selectedItems.length}`,
      `allowedTools: ${availableTools.map((tool) => tool.id).join(", ")}`,
    ].join("\n"),
    selectedItems,
    omittedItems,
    availableTools,
    injectedSkills,
    promptParts,
    tokenEstimate: usedTokens,
    budget: {
      maxTokens: defaultContextBudget,
      usedTokens,
      omittedTokens: omittedItems.reduce(
        (total, item) => total + item.tokenEstimate,
        0
      ),
    },
    trace: {
      selectedCount: selectedItems.length,
      omittedCount: omittedItems.length,
      selectedNodeId: input.canvasContext.selectedNodeId ?? null,
      toolExposureReason:
        "Tools are exposed from intent.requiredTools and registry allowlist.",
      skillInjectionReason:
        "Skills are injected only when their slug or capability matches the routed intent.",
    },
  });
}

function buildRuntimePromptParts({
  availableTools,
  injectedSkills,
  input,
  intent,
  omittedItems,
  selectedItems,
}: Pick<BuiltContext, "availableTools" | "injectedSkills"> & {
  input: AgentInput;
  intent: IntentResult;
  omittedItems: OmittedContextItem[];
  selectedItems: ContextItem[];
}): BuiltContext["promptParts"] {
  const intentContent = [
    `primaryIntent: ${intent.primaryIntent}`,
    `taskKind: ${intent.task.kind}`,
    `goals: ${intent.task.goals.join("; ") || "None"}`,
    `requiredCapabilities: ${intent.requiredCapabilities.join(", ") || "None"}`,
    `requiredTools: ${intent.requiredTools.join(", ") || "None"}`,
    `routingReason: ${intent.routingReason}`,
  ].join("\n");
  const selectedContextContent =
    selectedItems.map(renderContextItem).join("\n\n") || "None";
  const omittedContextContent =
    omittedItems
      .map((item) =>
        [
          `nodeId: ${item.nodeId}`,
          `type: ${item.type}`,
          `source: ${item.source}`,
          `reason: ${item.omissionReason}`,
        ].join("\n")
      )
      .join("\n\n") || "None";
  const toolContent =
    availableTools.map((tool) => `${tool.id}: ${tool.description}`).join("\n") ||
    "None";
  const skillContent =
    injectedSkills
      .map((skill) => `${skill.slug}: ${skill.summary}`)
      .join("\n") || "None";

  return [
    promptPart("runtime.intent", "intent", intentContent),
    promptPart("runtime.user-message", "user_prompt", input.userMessage),
    promptPart("runtime.selected-context", "upstream_context", selectedContextContent),
    promptPart("runtime.omitted-context", "omitted_context", omittedContextContent),
    promptPart("runtime.allowed-tools", "tool_exposure", toolContent),
    promptPart("runtime.injected-skills", "skill_injection", skillContent),
  ];
}

function promptPart(id: string, category: string, content: string) {
  return {
    id,
    category,
    content,
    tokenEstimate: estimateTokens(content),
  };
}

export function selectSkillsForIntent(
  intent: IntentResult,
  publicSkills: AgentSkill[]
): SkillInstruction[] {
  const required = new Set(intent.requiredCapabilities);
  return publicSkills
    .filter(
      (skill) =>
        skill.slug === "prompt-expand" ||
        required.has(readCapabilityId(skill.sourceManifest))
    )
    .map((skill) => ({
      id: skill.id,
      name: skill.name,
      slug: skill.slug,
      summary: skill.description || skill.instructions.slice(0, 160),
    }));
}

function readCapabilityId(sourceManifest: Record<string, unknown>) {
  const capabilityManifest = sourceManifest.capabilityManifest;
  if (!capabilityManifest || typeof capabilityManifest !== "object") {
    return "";
  }
  const capabilityId = (capabilityManifest as Record<string, unknown>).capabilityId;
  return typeof capabilityId === "string" ? capabilityId : "";
}

function renderContextItem(item: ContextItem) {
  return [
    `nodeId: ${item.nodeId}`,
    `type: ${item.type}`,
    `reason: ${item.inclusionReason}`,
    item.title ? `title: ${item.title}` : "",
    item.summary ? `summary: ${item.summary}` : "",
    item.prompt ? `prompt: ${item.prompt}` : "",
    item.imageUrl ? `imageUrl: ${item.imageUrl}` : "",
    item.contentRef ? `contentRef: ${item.contentRef}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function mapAttachmentKindToContextType(
  kind: AgentInput["attachments"][number]["kind"]
): ContextItem["type"] {
  if (kind === "doc") {
    return "doc";
  }
  if (kind === "code") {
    return "code";
  }
  if (kind === "webpage") {
    return "webpage";
  }
  if (kind === "dataset") {
    return "dataset";
  }
  if (kind === "image") {
    return "image";
  }
  return "artifact";
}

function estimateTokens(text: string) {
  return Math.max(1, Math.ceil(Array.from(text.trim() || "None").length / 4));
}
