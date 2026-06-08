import type { AgentCanvasNode, ArtifactRef } from "@/types/canvas";

type CanvasPosition = {
  x: number;
  y: number;
};

export type UploadedFilePreviewKind =
  | "image"
  | "markdown"
  | "code"
  | "document"
  | "webpage"
  | "dataset"
  | "file";

const NODE_WIDTH = 240;
const IMAGE_NODE_HEIGHT = 240;
const MARKDOWN_NODE_WIDTH = 420;
const MARKDOWN_NODE_HEIGHT = 360;
const ARTIFACT_NODE_HEIGHT = 132;
const UPLOAD_NODE_GAP = 18;
const UPLOAD_NODE_CLEARANCE = 24;
const MARKDOWN_CONTENT_LIMIT = 12_000;
const TEXT_PREVIEW_LIMIT = 900;

const MARKDOWN_EXTENSIONS = new Set(["md", "markdown", "mdown", "mdx"]);
const WEBPAGE_EXTENSIONS = new Set(["html", "htm"]);
const DATASET_EXTENSIONS = new Set([
  "csv",
  "tsv",
  "jsonl",
  "ndjson",
  "xlsx",
  "xls",
  "parquet",
]);
const DOCUMENT_EXTENSIONS = new Set([
  "txt",
  "pdf",
  "doc",
  "docx",
  "rtf",
  "odt",
]);
const CODE_EXTENSIONS = new Set([
  "c",
  "cc",
  "cpp",
  "cs",
  "css",
  "go",
  "java",
  "js",
  "jsx",
  "json",
  "kt",
  "lua",
  "php",
  "py",
  "rb",
  "rs",
  "scss",
  "sh",
  "sql",
  "swift",
  "toml",
  "ts",
  "tsx",
  "vue",
  "xml",
  "yaml",
  "yml",
]);
const TEXT_READABLE_EXTENSIONS = new Set([
  ...MARKDOWN_EXTENSIONS,
  ...WEBPAGE_EXTENSIONS,
  ...CODE_EXTENSIONS,
  "csv",
  "tsv",
  "jsonl",
  "ndjson",
  "txt",
]);
const DATASET_MIME_TYPES = new Set([
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "text/tab-separated-values",
]);
const DOCUMENT_MIME_TYPES = new Set([
  "application/msword",
  "application/pdf",
  "application/rtf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
]);
const CODE_MIME_TYPES = new Set([
  "application/json",
  "application/typescript",
  "application/x-javascript",
  "application/x-sh",
  "application/xml",
  "text/css",
  "text/javascript",
  "text/x-python",
  "text/xml",
]);

export async function createCanvasNodesFromFiles(
  files: readonly File[],
  origin: CanvasPosition,
  existingNodes: readonly AgentCanvasNode[],
  uploadedAt = new Date().toISOString()
) {
  const resultNodes: AgentCanvasNode[] = [];
  let cursorX = origin.x;

  for (const file of files) {
    const node = await createCanvasNodeFromFile(file, uploadedAt);
    const size = getNodeSize(node);
    const position = resolveNonOverlappingPosition(
      { x: cursorX, y: origin.y, width: size.width, height: size.height },
      [...existingNodes, ...resultNodes]
    );

    resultNodes.push({ ...node, position });
    cursorX = position.x + size.width + UPLOAD_NODE_GAP;
  }

  return resultNodes;
}

export function classifyUploadedFile(
  file: Pick<File, "name" | "type">
): UploadedFilePreviewKind {
  const extension = getFileExtension(file.name);
  const mimeType = file.type.toLowerCase();

  if (mimeType.startsWith("image/")) {
    return "image";
  }
  if (
    MARKDOWN_EXTENSIONS.has(extension) ||
    mimeType === "text/markdown" ||
    mimeType === "text/x-markdown"
  ) {
    return "markdown";
  }
  if (WEBPAGE_EXTENSIONS.has(extension) || mimeType === "text/html") {
    return "webpage";
  }
  if (
    CODE_EXTENSIONS.has(extension) ||
    CODE_MIME_TYPES.has(mimeType) ||
    mimeType.endsWith("+json") ||
    mimeType.includes("javascript")
  ) {
    return "code";
  }
  if (DATASET_EXTENSIONS.has(extension) || DATASET_MIME_TYPES.has(mimeType)) {
    return "dataset";
  }
  if (
    DOCUMENT_EXTENSIONS.has(extension) ||
    DOCUMENT_MIME_TYPES.has(mimeType) ||
    mimeType.startsWith("text/")
  ) {
    return "document";
  }

  return "file";
}

async function createCanvasNodeFromFile(
  file: File,
  uploadedAt: string
): Promise<AgentCanvasNode> {
  const kind = classifyUploadedFile(file);
  const title = file.name.trim() || "Untitled file";
  const artifactId = createUploadId(kind, title);
  const metadata = getBaseUploadMetadata(file, uploadedAt);

  if (kind === "image") {
    const dataUrl = await readFileAsDataUrl(file);
    const artifact: ArtifactRef = {
      id: artifactId,
      type: "image",
      uri: dataUrl,
      title,
      metadata,
    };

    return {
      id: `image-${artifactId}`,
      type: "imageResultNode",
      position: { x: 0, y: 0 },
      data: {
        kind: "imageResult",
        artifact,
        image: {
          id: artifactId,
          url: dataUrl,
          title,
          metadata,
          artifact,
        },
        prompt: `上传文件: ${title}`,
        runId: "local-upload",
      },
    };
  }

  const text = shouldReadText(file, kind) ? await file.text() : "";
  const preview = text ? trimText(text, TEXT_PREVIEW_LIMIT) : "";
  const summary = getUploadSummary(file, kind, preview);

  if (kind === "markdown") {
    const content = text.trim()
      ? trimText(text, MARKDOWN_CONTENT_LIMIT)
      : `${title}\n\n${summary}`;
    const artifact: ArtifactRef = {
      id: artifactId,
      type: "doc",
      title,
      metadata: {
        ...metadata,
        format: "markdown",
        markdown: content,
        preview: summarizeInlineText(content),
      },
    };

    return {
      id: `markdown-${artifactId}`,
      type: "markdownNode",
      position: { x: 0, y: 0 },
      data: {
        kind: "markdown",
        artifact,
        content,
        createdAt: uploadedAt,
        summary: summarizeInlineText(content),
        title,
      },
    };
  }

  const artifact = getArtifactForUpload({
    artifactId,
    file,
    kind,
    metadata: {
      ...metadata,
      preview,
    },
    title,
  });
  const baseData = {
    artifact,
    createdAt: uploadedAt,
    summary,
    title,
  };

  if (kind === "code") {
    return {
      id: `code-${artifactId}`,
      type: "codeNode",
      position: { x: 0, y: 0 },
      data: {
        ...baseData,
        kind: "code",
        language: getFileExtension(file.name) || undefined,
      },
    };
  }

  if (kind === "webpage") {
    return {
      id: `webpage-${artifactId}`,
      type: "webpageNode",
      position: { x: 0, y: 0 },
      data: {
        ...baseData,
        kind: "webpage",
      },
    };
  }

  if (kind === "document") {
    return {
      id: `document-${artifactId}`,
      type: "documentNode",
      position: { x: 0, y: 0 },
      data: {
        ...baseData,
        kind: "document",
      },
    };
  }

  return {
    id: `artifact-${artifactId}`,
    type: "artifactNode",
    position: { x: 0, y: 0 },
    data: {
      ...baseData,
      kind: "artifact",
    },
  };
}

function getArtifactForUpload({
  artifactId,
  file,
  kind,
  metadata,
  title,
}: {
  artifactId: string;
  file: File;
  kind: Exclude<UploadedFilePreviewKind, "image" | "markdown">;
  metadata: Record<string, unknown>;
  title: string;
}): ArtifactRef {
  const typeByKind = {
    code: "code",
    dataset: "dataset",
    document: "doc",
    file: "file",
    webpage: "webpage",
  } satisfies Record<
    Exclude<UploadedFilePreviewKind, "image" | "markdown">,
    ArtifactRef["type"]
  >;

  return {
    id: artifactId,
    type: typeByKind[kind],
    title,
    contentRef: `local-upload://${encodeURIComponent(file.name)}`,
    metadata,
  };
}

function getBaseUploadMetadata(file: File, uploadedAt: string) {
  return {
    fileName: file.name,
    mimeType: file.type || "application/octet-stream",
    size: file.size,
    source: "local_upload",
    uploadedAt,
  };
}

function shouldReadText(file: File, kind: UploadedFilePreviewKind) {
  if (kind === "image" || kind === "file") {
    return false;
  }

  const extension = getFileExtension(file.name);
  const mimeType = file.type.toLowerCase();

  return (
    TEXT_READABLE_EXTENSIONS.has(extension) ||
    mimeType.startsWith("text/") ||
    mimeType === "application/json" ||
    mimeType.endsWith("+json")
  );
}

function getUploadSummary(
  file: File,
  kind: UploadedFilePreviewKind,
  preview: string
) {
  if (preview.trim()) {
    return summarizeInlineText(preview);
  }

  const labels: Record<UploadedFilePreviewKind, string> = {
    code: "代码文件",
    dataset: "数据文件",
    document: "文档文件",
    file: "文件",
    image: "图片文件",
    markdown: "Markdown 文档",
    webpage: "网页文件",
  };
  const mimeType = file.type || "未知类型";

  return `${labels[kind]} · ${mimeType} · ${formatBytes(file.size)}`;
}

function summarizeInlineText(text: string) {
  return trimText(text.replace(/\s+/g, " ").trim(), 180);
}

function getNodeSize(node: AgentCanvasNode) {
  const width = getStoredNodeDimension(node, "width");
  const height = getStoredNodeDimension(node, "height");
  if (width && height) {
    return { width, height };
  }

  if (node.data.kind === "markdown") {
    return {
      width: width ?? MARKDOWN_NODE_WIDTH,
      height: height ?? MARKDOWN_NODE_HEIGHT,
    };
  }
  if (node.data.kind === "imageResult") {
    return {
      width: width ?? NODE_WIDTH,
      height: height ?? IMAGE_NODE_HEIGHT,
    };
  }

  return { width: width ?? NODE_WIDTH, height: height ?? ARTIFACT_NODE_HEIGHT };
}

function getStoredNodeDimension(
  node: AgentCanvasNode,
  dimension: "height" | "width"
) {
  const value = node[dimension] ?? node.measured?.[dimension];
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function resolveNonOverlappingPosition(
  preferredRect: CanvasRect,
  existingNodes: readonly AgentCanvasNode[]
): CanvasPosition {
  const existingRects = existingNodes.map((node) => ({
    x: node.position.x,
    y: node.position.y,
    ...getNodeSize(node),
  }));

  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      const candidate = {
        ...preferredRect,
        x: preferredRect.x + column * (preferredRect.width + UPLOAD_NODE_GAP),
        y: preferredRect.y + row * (preferredRect.height + UPLOAD_NODE_GAP),
      };

      if (!hasCollision(candidate, existingRects)) {
        return { x: candidate.x, y: candidate.y };
      }
    }
  }

  return {
    x: preferredRect.x,
    y: preferredRect.y + preferredRect.height + UPLOAD_NODE_CLEARANCE,
  };
}

type CanvasRect = CanvasPosition & {
  width: number;
  height: number;
};

function hasCollision(rect: CanvasRect, existingRects: CanvasRect[]) {
  return existingRects.some((existingRect) =>
    rectsOverlap(rect, expandRect(existingRect, UPLOAD_NODE_CLEARANCE))
  );
}

function expandRect(rect: CanvasRect, padding: number): CanvasRect {
  return {
    x: rect.x - padding,
    y: rect.y - padding,
    width: rect.width + padding * 2,
    height: rect.height + padding * 2,
  };
}

function rectsOverlap(a: CanvasRect, b: CanvasRect) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

async function readFileAsDataUrl(file: File) {
  const mimeType = file.type || "application/octet-stream";
  const buffer = await file.arrayBuffer();

  return `data:${mimeType};base64,${arrayBufferToBase64(buffer)}`;
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let output = "";

  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = bytes[index + 1];
    const third = bytes[index + 2];

    output += alphabet[first >> 2];
    output += alphabet[((first & 3) << 4) | ((second ?? 0) >> 4)];
    output +=
      index + 1 < bytes.length
        ? alphabet[((second & 15) << 2) | ((third ?? 0) >> 6)]
        : "=";
    output += index + 2 < bytes.length ? alphabet[(third ?? 0) & 63] : "=";
  }

  return output;
}

function trimText(text: string, limit: number) {
  if (text.length <= limit) {
    return text;
  }

  return `${text.slice(0, limit).trimEnd()}\n\n...内容已截断`;
}

function formatBytes(size: number) {
  if (size < 1024) {
    return `${size} B`;
  }

  const units = ["KB", "MB", "GB"];
  let value = size / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function getFileExtension(name: string) {
  const filename = name.trim().split(/[\\/]/).at(-1) ?? "";
  const dotIndex = filename.lastIndexOf(".");

  if (dotIndex <= 0 || dotIndex === filename.length - 1) {
    return "";
  }

  return filename.slice(dotIndex + 1).toLowerCase();
}

function createUploadId(kind: UploadedFilePreviewKind, title: string) {
  const safeTitle = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);

  return `upload-${kind}-${safeTitle || "file"}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}
