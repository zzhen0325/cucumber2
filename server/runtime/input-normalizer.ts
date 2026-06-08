import type { UIMessage } from "ai";

import type { ModelProviderId } from "../model-providers.ts";
import type { PromptCanvasContext } from "../prompts.ts";
import type { AgentProject } from "../supabase.ts";
import type { AgentCanvasNode, ArtifactRef } from "../../src/types/canvas.ts";
import type {
  AgentInput,
  ConversationMessageRef,
  InputAttachment,
} from "../../src/types/runtime.ts";
import { agentInputSchema } from "./schemas.ts";
import { throwAgentError } from "./errors.ts";

export type NormalizeAgentInputArgs = {
  userId: string;
  projectId: string;
  runNodeId: string;
  canvasContext: PromptCanvasContext;
  messages: UIMessage[];
  modelProvider: ModelProviderId;
  attachments?: unknown[];
  projectSnapshot?: Pick<AgentProject, "id" | "nodes"> &
    Partial<Pick<AgentProject, "title">>;
  sessionId?: string;
};

export function normalizeAgentInput({
  attachments = [],
  canvasContext,
  messages,
  modelProvider,
  projectId,
  projectSnapshot,
  runNodeId,
  sessionId,
  userId,
}: NormalizeAgentInputArgs): AgentInput {
  if (!canvasContext.prompt.trim()) {
    throwAgentError({
      code: "INPUT_EMPTY",
      message: "User message is empty.",
      retryable: false,
      severity: "error",
    });
  }
  validateCanvasContextAgainstProject({
    canvasContext,
    projectId,
    projectSnapshot,
  });

  return agentInputSchema.parse({
    userMessage: canvasContext.prompt,
    attachments: attachments.map(normalizeAttachment),
    approvalResponses: extractApprovalResponses(messages),
    canvasContext: {
      promptNodeId: canvasContext.promptNodeId ?? null,
      runNodeId,
      selectedNodeId: canvasContext.selectedNodeId ?? null,
      upstreamContext: canvasContext.upstreamContext,
      contextTrace: canvasContext.contextTrace,
    },
    conversationHistory: summarizeConversation(messages),
    projectRefs: projectSnapshot
      ? [
          {
            id: projectSnapshot.id,
            kind: "project",
            title: projectSnapshot.title,
            summary: `${projectSnapshot.nodes.length} canvas nodes`,
          },
        ]
      : [],
    metadata: {
      userId,
      sessionId,
      projectId,
      runNodeId,
      promptNodeId: canvasContext.promptNodeId ?? undefined,
      modelProvider,
    },
  });
}

export function validateCanvasContextAgainstProject({
  canvasContext,
  projectId,
  projectSnapshot,
}: {
  canvasContext: PromptCanvasContext;
  projectId: string;
  projectSnapshot?: Pick<AgentProject, "id" | "nodes"> &
    Partial<Pick<AgentProject, "title">>;
}) {
  if (!projectSnapshot) {
    return;
  }

  if (projectSnapshot.id !== projectId) {
    throwAgentError({
      code: "INPUT_PROJECT_MISMATCH",
      message: "Input project snapshot does not match this run.",
      retryable: false,
      severity: "error",
      details: {
        projectId,
        snapshotProjectId: projectSnapshot.id,
      },
    });
  }

  const nodeById = new Map(projectSnapshot.nodes.map((node) => [node.id, node]));
  if (canvasContext.selectedNodeId && !nodeById.has(canvasContext.selectedNodeId)) {
    throwInputOwnershipError("Selected node is not part of this project.", {
      selectedNodeId: canvasContext.selectedNodeId,
    });
  }

  for (const item of canvasContext.upstreamContext) {
    const node = nodeById.get(item.nodeId);
    if (!node) {
      throwInputOwnershipError("Upstream context node is not part of this project.", {
        nodeId: item.nodeId,
        type: item.type,
      });
    }

    if (item.artifact && !nodeOwnsArtifact(node, item.artifact.id)) {
      throwInputOwnershipError(
        "Upstream context artifact is not attached to its project node.",
        {
          nodeId: item.nodeId,
          artifactId: item.artifact.id,
          type: item.type,
        }
      );
    }
  }
}

function normalizeAttachment(value: unknown): InputAttachment {
  if (!value || typeof value !== "object") {
    throwAgentError({
      code: "ATTACHMENT_INVALID",
      message: "Attachment must be an object.",
      retryable: false,
      severity: "error",
    });
  }

  const candidate = value as Record<string, unknown>;
  const id = readString(candidate.id) ?? `attachment-${crypto.randomUUID()}`;
  const kind = readString(candidate.kind) ?? inferAttachmentKind(candidate);

  if (!isAttachmentKind(kind)) {
    throwAgentError({
      code: "ATTACHMENT_INVALID",
      message: `Unsupported attachment kind: ${kind}`,
      retryable: false,
      severity: "error",
      details: { id, kind },
    });
  }

  return {
    id,
    kind,
    name: readString(candidate.name),
    mimeType: readString(candidate.mimeType),
    sizeBytes: readNumber(candidate.sizeBytes),
    uri: readString(candidate.uri),
    contentRef: readString(candidate.contentRef),
    artifact:
      candidate.artifact && typeof candidate.artifact === "object"
        ? (candidate.artifact as InputAttachment["artifact"])
        : undefined,
    preview: readString(candidate.preview),
  };
}

function throwInputOwnershipError(
  message: string,
  details: Record<string, unknown>
): never {
  throwAgentError({
    code: "INPUT_CONTEXT_FORBIDDEN",
    message,
    retryable: false,
    severity: "error",
    details,
  });
}

function nodeOwnsArtifact(node: AgentCanvasNode, artifactId: string) {
  const refs = getNodeArtifactRefs(node);
  return refs.some((artifact) => artifact.id === artifactId);
}

function getNodeArtifactRefs(node: AgentCanvasNode): ArtifactRef[] {
  if (node.data.kind === "imageResult") {
    return [node.data.artifact, node.data.image.artifact].filter(
      (artifact): artifact is ArtifactRef => Boolean(artifact)
    );
  }

  if ("artifact" in node.data) {
    return [node.data.artifact];
  }

  return [];
}

function summarizeConversation(messages: UIMessage[]): ConversationMessageRef[] {
  return messages.slice(-8).map((message, index) => ({
    id: message.id || `message-${index}`,
    role: message.role,
    summary: summarizeMessage(message),
  }));
}

function extractApprovalResponses(messages: UIMessage[]) {
  const responses = new Map<string, { id: string; approved: boolean; reason?: string }>();

  for (const message of messages) {
    if (message.role !== "assistant") {
      continue;
    }

    for (const part of message.parts) {
      if (!part || typeof part !== "object") {
        continue;
      }

      const approval = (part as { approval?: unknown }).approval;
      if (!approval || typeof approval !== "object") {
        continue;
      }

      const candidate = approval as {
        id?: unknown;
        approved?: unknown;
        reason?: unknown;
      };
      if (typeof candidate.id !== "string" || typeof candidate.approved !== "boolean") {
        continue;
      }

      responses.set(candidate.id, {
        id: candidate.id,
        approved: candidate.approved,
        reason: readString(candidate.reason),
      });
    }
  }

  return [...responses.values()];
}

function summarizeMessage(message: UIMessage) {
  const text = message.parts
    .map((part) => {
      if (part.type === "text") {
        return part.text;
      }
      if (part.type.startsWith("tool-")) {
        return `[${part.type}]`;
      }
      return "";
    })
    .filter(Boolean)
    .join(" ")
    .trim();

  return text.slice(0, 500);
}

function inferAttachmentKind(candidate: Record<string, unknown>) {
  const mimeType = readString(candidate.mimeType)?.toLowerCase() ?? "";
  if (mimeType.startsWith("image/")) {
    return "image";
  }
  if (mimeType.includes("markdown") || mimeType.includes("document")) {
    return "doc";
  }
  if (mimeType.includes("javascript") || mimeType.includes("typescript")) {
    return "code";
  }
  return "file";
}

function isAttachmentKind(kind: string): kind is InputAttachment["kind"] {
  return ["image", "file", "doc", "code", "webpage", "dataset"].includes(kind);
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
