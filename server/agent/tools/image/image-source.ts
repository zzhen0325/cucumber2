import type { ArtifactRef, UpstreamContextItem } from "../../../../src/types/canvas.ts";
import {
  getArtifactStorageContentRef,
  parseStorageContentRef,
  readArtifactContent,
  resolveStorageBackedImageContext,
  storeGeneratedImageFromBytes,
  storeGeneratedImageFromUrl,
} from "../../../storage.ts";
import type { CucumberAgentContext } from "../../context.ts";

export type ResolvedImageSource = {
  artifact?: ArtifactRef;
  imageUrl: string;
  nodeId: string;
  prompt?: string;
  summary?: string;
  title?: string;
};

export async function readImageArtifactBytes(artifact: ArtifactRef | undefined) {
  if (!artifact || artifact.type !== "image") {
    throw new Error("Selected source artifact is not an image.");
  }
  const contentRef = getArtifactStorageContentRef(artifact);
  const parsed = contentRef ? parseStorageContentRef(contentRef) : null;
  if (!parsed) {
    throw new Error("Selected image is not backed by object storage.");
  }
  const content = await readArtifactContent({
    bucketId: parsed.bucket,
    mimeType: artifact.mimeType ?? readString(artifact.metadata?.mimeType) ?? null,
    sizeBytes:
      artifact.sizeBytes ??
      readNumber(artifact.metadata?.byteSize) ??
      readNumber(artifact.metadata?.size) ??
      null,
    storagePath: parsed.path,
  });
  if (!content.mimeType.startsWith("image/")) {
    throw new Error(`Selected source artifact is not an image (${content.mimeType}).`);
  }
  return content;
}

export async function resolveSingleSourceImage(
  context: CucumberAgentContext,
  emptyMessage: string
): Promise<ResolvedImageSource> {
  const imageItems = context.upstreamContext.filter(
    (item): item is UpstreamContextItem & { type: "image" } =>
      item.type === "image"
  );
  const selectedImage = imageItems.find(
    (item) => item.nodeId === context.selectedNodeId
  );
  const source = selectedImage ?? (imageItems.length === 1 ? imageItems[0] : null);
  if (!source) {
    throw new Error(emptyMessage);
  }

  const [resolved] = await resolveStorageBackedImageContext([source]);
  if (resolved.type !== "image" || !resolved.imageUrl) {
    throw new Error("Selected image cannot be resolved for image processing.");
  }

  return {
    artifact: resolved.artifact,
    imageUrl: resolved.imageUrl,
    nodeId: resolved.nodeId,
    prompt: resolved.prompt,
    summary: resolved.summary,
    title: resolved.title,
  };
}

export async function storeImageToolArtifact({
  context,
  image,
  metadata,
  signal,
  sourceNodeId,
  toolName,
}: {
  context: CucumberAgentContext;
  image: {
    id: string;
    url: string;
    title?: string;
    metadata?: Record<string, unknown>;
  };
  metadata?: Record<string, unknown>;
  signal?: AbortSignal;
  sourceNodeId?: string | null;
  toolName: string;
}) {
  const artifact = await storeGeneratedImageFromUrl({
    artifactId: image.id,
    metadata: {
      ...image.metadata,
      ...metadata,
    },
    projectId: context.projectId,
    runNodeId: context.runNodeId,
    signal: signal ?? context.signal,
    sourceNodeId,
    sourceToolName: toolName,
    sourceUrl: image.url,
    title: image.title,
    userId: context.userId,
  });
  context.producedArtifacts.push(artifact);
  const event = {
    type: "artifact_created" as const,
    artifact,
    toolName,
  };
  if (context.pushLiveEvent) {
    context.pushLiveEvent(event);
  } else {
    context.pendingEvents.push(event);
  }
  return artifact;
}

export async function storeImageToolArtifactFromBytes({
  bytes,
  context,
  image,
  metadata,
  mimeType,
  sourceNodeId,
  toolName,
}: {
  bytes: Uint8Array;
  context: CucumberAgentContext;
  image: {
    id: string;
    title?: string;
    metadata?: Record<string, unknown>;
  };
  metadata?: Record<string, unknown>;
  mimeType: string;
  sourceNodeId?: string | null;
  toolName: string;
}) {
  const artifact = await storeGeneratedImageFromBytes({
    artifactId: image.id,
    bytes,
    metadata: {
      ...image.metadata,
      ...metadata,
    },
    mimeType,
    projectId: context.projectId,
    runNodeId: context.runNodeId,
    sourceNodeId,
    sourceToolName: toolName,
    title: image.title,
    userId: context.userId,
  });
  context.producedArtifacts.push(artifact);
  const event = {
    type: "artifact_created" as const,
    artifact,
    toolName,
  };
  if (context.pushLiveEvent) {
    context.pushLiveEvent(event);
  } else {
    context.pendingEvents.push(event);
  }
  return artifact;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
