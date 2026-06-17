import type {
  AgentCanvasEdge,
  AgentCanvasNode,
  ArtifactMetadata,
  ArtifactRef,
} from "../types/canvas";

export const NODE_JSON_SOFT_LIMIT_BYTES = 16 * 1024;
export const NODE_JSON_HARD_LIMIT_BYTES = 64 * 1024;

const LARGE_DATA_KEYS = new Set([
  "blockNoteBlocks",
  "blocks",
  "bytes",
  "code",
  "content",
  "contentJson",
  "contentText",
  "documentText",
  "fullText",
  "html",
  "markdown",
  "output",
  "providerResponse",
  "rawOutput",
  "result",
  "stderr",
  "stdout",
  "text",
]);

const LARGE_METADATA_KEYS = new Set([
  "base64",
  "blockNoteBlocks",
  "blocks",
  "bytes",
  "code",
  "content",
  "contentJson",
  "contentText",
  "documentText",
  "fullText",
  "html",
  "markdown",
  "output",
  "providerResponse",
  "raw",
  "rawOutput",
  "request",
  "response",
  "result",
  "sources",
  "stderr",
  "stdout",
  "text",
]);

const SMALL_METADATA_KEYS = new Set([
  "aspectRatio",
  "byteSize",
  "createdAt",
  "createdBy",
  "digest",
  "fileName",
  "format",
  "height",
  "language",
  "mimeType",
  "origin",
  "preview",
  "previewKind",
  "projectId",
  "provider",
  "size",
  "sourceArtifactId",
  "sourceNodeId",
  "sourceRunNodeId",
  "sourceToolName",
  "storageBucket",
  "storagePath",
  "summary",
  "title",
  "uploadKind",
  "uploadedAt",
  "width",
]);

export function toPersistableNodes(
  nodes: AgentCanvasNode[]
): AgentCanvasNode[] {
  return nodes.flatMap((node) => {
    if (hasLocalUploadState(node)) {
      return [];
    }

    return [toPersistableNode(node)];
  });
}

export function toPersistableNode(node: AgentCanvasNode): AgentCanvasNode {
  const withoutRuntime = stripRuntimeNodeState(node);
  const withoutUpload = stripUploadState(withoutRuntime);
  const withoutInlineContent = stripInlineLargeContent(withoutUpload);

  assertLeanNodeJson(withoutInlineContent);

  return withoutInlineContent;
}

export function toPersistableEdges(
  edges: AgentCanvasEdge[]
): AgentCanvasEdge[] {
  return edges.map(toPersistableEdge);
}

export function toPersistableEdge(edge: AgentCanvasEdge): AgentCanvasEdge {
  return stripRuntimeEdgeState(edge);
}

export function stripRuntimeNodeState(node: AgentCanvasNode): AgentCanvasNode {
  const rest = {
    ...(node as AgentCanvasNode & {
      dragging?: boolean;
      measured?: unknown;
      positionAbsolute?: unknown;
      resizing?: boolean;
      selected?: boolean;
    }),
  };
  delete rest.dragging;
  delete rest.measured;
  delete rest.positionAbsolute;
  delete rest.resizing;
  delete rest.selected;

  return rest as AgentCanvasNode;
}

export function stripRuntimeEdgeState(edge: AgentCanvasEdge): AgentCanvasEdge {
  const rest = {
    ...(edge as AgentCanvasEdge & {
      selected?: boolean;
    }),
  };
  delete rest.selected;

  return rest as AgentCanvasEdge;
}

export function hasLocalUploadState(node: AgentCanvasNode) {
  return "upload" in node.data && Boolean(node.data.upload);
}

export function toArtifactRefLite(
  artifact: unknown
): ArtifactRef | undefined {
  if (!artifact || typeof artifact !== "object") {
    return undefined;
  }

  const source = artifact as ArtifactRef;
  if (!source.id || !source.type) {
    return undefined;
  }

  const metadata = assertLeanArtifactMetadata(source.metadata);
  return compactRecord({
    contentRef: source.contentRef,
    id: source.id,
    metadata,
    mimeType: source.mimeType ?? metadata?.mimeType,
    preview: source.preview ?? metadata?.preview,
    previewKind: source.previewKind ?? metadata?.previewKind,
    sizeBytes: source.sizeBytes ?? metadata?.byteSize ?? metadata?.size,
    summary: source.summary ?? metadata?.summary,
    title: source.title ?? metadata?.title,
    type: source.type,
    uri: source.uri,
    version: source.version,
  }) as ArtifactRef;
}

export function assertLeanArtifactMetadata(
  metadata: ArtifactRef["metadata"] | undefined
): ArtifactMetadata | undefined {
  if (!metadata) {
    return undefined;
  }

  const lean: ArtifactMetadata = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (LARGE_METADATA_KEYS.has(key)) {
      continue;
    }
    if (!SMALL_METADATA_KEYS.has(key) && getJsonByteLength(value) > 512) {
      continue;
    }
    lean[key] = value as never;
  }

  return Object.keys(lean).length ? lean : undefined;
}

export function assertLeanNodeJson(node: AgentCanvasNode) {
  const bytes = getJsonByteLength(node);

  if (bytes > NODE_JSON_HARD_LIMIT_BYTES) {
    throw new Error(
      `Node ${node.id} is too large for node_json (${bytes} bytes). Store content as an artifact.`
    );
  }

  if (node.data.kind === "markdown") {
    assertMarkdownNodeHasNoInlineContent(node);
  }
  if (node.data.kind === "code") {
    assertCodeNodeHasNoInlineContent(node);
  }
  if (
    node.data.kind === "document" ||
    node.data.kind === "toolResult" ||
    node.data.kind === "webpage"
  ) {
    assertArtifactNodeHasNoInlineContent(node);
  }
}

/**
 * Cheap reference-equality check for whether any node's content (its `data`)
 * changed between two snapshots, ignoring pure position/selection moves.
 */
export function hasNodeContentChanged(
  prev: AgentCanvasNode[],
  next: AgentCanvasNode[]
): boolean {
  if (prev.length !== next.length) {
    return true;
  }

  const prevById = new Map(prev.map((node) => [node.id, node]));
  for (const node of next) {
    const previous = prevById.get(node.id);
    if (!previous || previous.data !== node.data) {
      return true;
    }
  }

  return false;
}

function stripUploadState(node: AgentCanvasNode): AgentCanvasNode {
  if (!("upload" in node.data) || !node.data.upload) {
    return node;
  }

  return {
    ...node,
    data: {
      ...node.data,
      upload: undefined,
    },
  } as AgentCanvasNode;
}

function stripInlineLargeContent(node: AgentCanvasNode): AgentCanvasNode {
  if (node.data.kind === "markdown") {
    const data = node.data as Record<string, unknown>;
    return {
      ...node,
      data: compactRecord({
        ...omitKeys(data, LARGE_DATA_KEYS),
        artifact: toArtifactRefLite(data.artifact),
        contentStatus: data.contentStatus ?? "stored",
        preview: data.preview ?? data.summary,
      }),
    } as AgentCanvasNode;
  }

  if (
    node.data.kind === "code" ||
    node.data.kind === "document" ||
    node.data.kind === "toolResult" ||
    node.data.kind === "webpage"
  ) {
    const data = node.data as Record<string, unknown>;
    return {
      ...node,
      data: compactRecord({
        ...omitKeys(data, LARGE_DATA_KEYS),
        artifact: toArtifactRefLite(data.artifact),
        contentStatus: data.contentStatus ?? "stored",
        preview: data.preview ?? data.summary,
      }),
    } as AgentCanvasNode;
  }

  if ("artifact" in node.data) {
    const data = node.data as Record<string, unknown>;
    return {
      ...node,
      data: compactRecord({
        ...data,
        artifact: toArtifactRefLite(data.artifact),
      }),
    } as AgentCanvasNode;
  }

  if (node.data.kind === "imageResult") {
    return {
      ...node,
      data: compactRecord({
        ...node.data,
        artifact: toArtifactRefLite(node.data.artifact),
        image: compactRecord({
          ...node.data.image,
          artifact: toArtifactRefLite(node.data.image.artifact),
          metadata: assertLeanArtifactMetadata(node.data.image.metadata),
        }),
      }),
    } as AgentCanvasNode;
  }

  return node;
}

function assertMarkdownNodeHasNoInlineContent(node: AgentCanvasNode) {
  if (node.data.kind !== "markdown") {
    return;
  }

  const data = node.data as Record<string, unknown>;
  for (const key of ["blockNoteBlocks", "markdown", "content"]) {
    if (key in data) {
      throw new Error(`Markdown node_json must not contain ${key}.`);
    }
  }

  assertArtifactMetadataHasNoLargeContent(data.artifact, "Markdown artifact");
}

function assertCodeNodeHasNoInlineContent(node: AgentCanvasNode) {
  const data = node.data as Record<string, unknown>;
  for (const key of ["code", "content", "rawOutput", "stdout", "stderr"]) {
    if (key in data) {
      throw new Error(`Code node_json must not contain ${key}.`);
    }
  }

  assertArtifactMetadataHasNoLargeContent(data.artifact, "Code artifact");
}

function assertArtifactNodeHasNoInlineContent(node: AgentCanvasNode) {
  const data = node.data as Record<string, unknown>;
  for (const key of ["content", "fullText", "html", "rawOutput", "text"]) {
    if (key in data) {
      throw new Error(`${node.data.kind} node_json must not contain ${key}.`);
    }
  }

  assertArtifactMetadataHasNoLargeContent(
    data.artifact,
    `${node.data.kind} artifact`
  );
}

function assertArtifactMetadataHasNoLargeContent(
  artifact: unknown,
  label: string
) {
  const metadata =
    artifact && typeof artifact === "object"
      ? (artifact as ArtifactRef).metadata
      : undefined;
  if (!metadata) {
    return;
  }

  for (const key of LARGE_METADATA_KEYS) {
    if (key in metadata) {
      throw new Error(`${label} metadata must not contain ${key}.`);
    }
  }
}

function omitKeys(
  record: Record<string, unknown>,
  keys: Set<string>
): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (!keys.has(key)) {
      next[key] = value;
    }
  }
  return next;
}

function compactRecord(record: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined)
  );
}

function getJsonByteLength(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
