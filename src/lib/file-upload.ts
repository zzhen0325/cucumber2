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

export type UploadedFileForStorage = {
  content?: string;
  dimensions?: { width: number; height: number } | null;
  file: File;
  kind: UploadedFilePreviewKind;
  metadata: Record<string, unknown>;
  preview: string;
  summary: string;
  title: string;
  uploadedAt: string;
};

export type ResolveUploadedFileArtifact = (
  upload: UploadedFileForStorage
) => Promise<ArtifactRef>;

export type PreparedCanvasUpload = {
  localNode: AgentCanvasNode;
  objectUrl?: string;
  upload: UploadedFileForStorage;
};

type CreateCanvasNodesFromFilesOptions = {
  resolveUploadedFile: ResolveUploadedFileArtifact;
  uploadedAt?: string;
};

const NODE_WIDTH = 240;
const IMAGE_NODE_HEIGHT = 240;
const IMAGE_NODE_MIN_SIDE = 24;
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
  options: CreateCanvasNodesFromFilesOptions
) {
  const resultNodes: AgentCanvasNode[] = [];
  let cursorX = origin.x;
  const uploadedAt = options.uploadedAt ?? new Date().toISOString();

  for (const file of files) {
    const upload = await prepareUploadedFile(file, uploadedAt);
    const artifact = await options.resolveUploadedFile(upload);
    const node = createCanvasNodeFromUploadedFile(upload, artifact);
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

export async function prepareLocalCanvasUploads(
  files: readonly File[],
  origin: CanvasPosition,
  existingNodes: readonly AgentCanvasNode[],
  options: { createLocalId?: () => string; uploadedAt?: string } = {}
): Promise<PreparedCanvasUpload[]> {
  const result: PreparedCanvasUpload[] = [];
  let cursorX = origin.x;
  const uploadedAt = options.uploadedAt ?? new Date().toISOString();
  const createLocalId =
    options.createLocalId ??
    (() =>
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

  for (const file of files) {
    const upload = await prepareUploadedFile(file, uploadedAt);
    const objectUrl =
      upload.kind === "image" ? URL.createObjectURL(upload.file) : undefined;
    const node = createLocalCanvasNodeFromUploadedFile(
      upload,
      `local-upload-${createLocalId()}`,
      objectUrl
    );
    const size = getNodeSize(node);
    const position = resolveNonOverlappingPosition(
      { x: cursorX, y: origin.y, width: size.width, height: size.height },
      [...existingNodes, ...result.map((item) => item.localNode)]
    );

    result.push({ localNode: { ...node, position }, objectUrl, upload });
    cursorX = position.x + size.width + UPLOAD_NODE_GAP;
  }

  return result;
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

export async function prepareUploadedFile(
  file: File,
  uploadedAt: string
): Promise<UploadedFileForStorage> {
  const kind = classifyUploadedFile(file);
  const title = file.name.trim() || "Untitled file";
  const baseMetadata = getBaseUploadMetadata(file, uploadedAt);
  const dimensions =
    kind === "image" ? readImageDimensions(await file.arrayBuffer(), file.type) : null;
  const metadata = {
    ...baseMetadata,
    ...(dimensions
      ? {
          height: dimensions.height,
          width: dimensions.width,
        }
      : {}),
  };
  const text = shouldReadText(file, kind) ? await file.text() : "";
  const preview = text ? trimText(text, TEXT_PREVIEW_LIMIT) : "";
  const summary = getUploadSummary(file, kind, preview);

  return {
    content: kind === "markdown" ? text : undefined,
    dimensions,
    file,
    kind,
    metadata,
    preview,
    summary,
    title,
    uploadedAt,
  };
}

export function createCanvasNodeFromUploadedFile(
  upload: UploadedFileForStorage,
  artifact: ArtifactRef
): AgentCanvasNode {
  if (upload.kind === "image") {
    const nodeDimensions = getImageNodeDimensions(upload.dimensions ?? null);
    const imageUrl = artifact.uri ?? artifact.contentRef ?? "";
    return {
      id: `image-${artifact.id}`,
      type: "imageResultNode",
      position: { x: 0, y: 0 },
      ...nodeDimensions,
      data: {
        kind: "imageResult",
        artifact,
        image: {
          id: artifact.id,
          url: imageUrl,
          title: artifact.title ?? upload.title,
          metadata: artifact.metadata,
          artifact,
        },
        prompt: `上传文件: ${upload.title}`,
        runId: "local-upload",
      },
    };
  }

  if (upload.kind === "markdown") {
    const markdown = upload.content ?? upload.preview;
    const content = markdown.trim()
      ? trimText(markdown, MARKDOWN_CONTENT_LIMIT)
      : `${upload.title}\n\n${upload.summary}`;

    return {
      id: `markdown-${artifact.id}`,
      type: "markdownNode",
      position: { x: 0, y: 0 },
      data: {
        kind: "markdown",
        artifact,
        content,
        createdAt: upload.uploadedAt,
        summary: summarizeInlineText(content),
        title: artifact.title ?? upload.title,
      },
    };
  }

  const baseData = {
    artifact,
    createdAt: upload.uploadedAt,
    summary: upload.summary,
    title: artifact.title ?? upload.title,
  };

  if (upload.kind === "code") {
    return {
      id: `code-${artifact.id}`,
      type: "codeNode",
      position: { x: 0, y: 0 },
      data: {
        ...baseData,
        kind: "code",
        language: getFileExtension(upload.file.name) || undefined,
      },
    };
  }

  if (upload.kind === "webpage") {
    return {
      id: `webpage-${artifact.id}`,
      type: "webpageNode",
      position: { x: 0, y: 0 },
      data: {
        ...baseData,
        kind: "webpage",
      },
    };
  }

  if (upload.kind === "document") {
    return {
      id: `document-${artifact.id}`,
      type: "documentNode",
      position: { x: 0, y: 0 },
      data: {
        ...baseData,
        kind: "document",
      },
    };
  }

  return {
    id: `artifact-${artifact.id}`,
    type: "artifactNode",
    position: { x: 0, y: 0 },
    data: {
      ...baseData,
      kind: "artifact",
    },
  };
}

export function createLocalCanvasNodeFromUploadedFile(
  upload: UploadedFileForStorage,
  localId: string,
  localPreviewUrl?: string
): AgentCanvasNode {
  const typeByKind = {
    code: "code",
    dataset: "dataset",
    document: "doc",
    file: "file",
    image: "image",
    markdown: "doc",
    webpage: "webpage",
  } satisfies Record<UploadedFilePreviewKind, ArtifactRef["type"]>;
  const localArtifact: ArtifactRef = {
    contentRef: `local-upload://${localId}`,
    id: localId,
    metadata: {
      ...upload.metadata,
      localOnly: true,
      preview: upload.preview,
      summary: upload.summary,
    },
    title: upload.title,
    type: typeByKind[upload.kind],
    uri: localPreviewUrl,
  };
  const node = createCanvasNodeFromUploadedFile(upload, localArtifact);

  return {
    ...node,
    id: node.id.replace(localId, localId),
    data: {
      ...node.data,
      upload: {
        localPreviewUrl,
        status: "uploading",
      },
    },
  } as AgentCanvasNode;
}

function getBaseUploadMetadata(file: File, uploadedAt: string) {
  return {
    byteSize: file.size,
    fileName: file.name,
    mimeType: file.type || "application/octet-stream",
    previewKind: classifyUploadedFile(file),
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

function getImageNodeDimensions(
  dimensions: { width: number; height: number } | null
) {
  if (!dimensions) {
    return { width: NODE_WIDTH, height: IMAGE_NODE_HEIGHT };
  }

  const ratio = dimensions.width / dimensions.height;
  return {
    width: NODE_WIDTH,
    height: Math.max(IMAGE_NODE_MIN_SIDE, Math.round(NODE_WIDTH / ratio)),
  };
}

function readImageDimensions(
  buffer: ArrayBuffer,
  mimeType: string
): { width: number; height: number } | null {
  const bytes = new Uint8Array(buffer);

  if (mimeType === "image/png") {
    return readPngDimensions(bytes);
  }
  if (mimeType === "image/gif") {
    return readGifDimensions(bytes);
  }
  if (mimeType === "image/webp") {
    return readWebpDimensions(bytes);
  }
  if (mimeType === "image/jpeg" || mimeType === "image/jpg") {
    return readJpegDimensions(bytes);
  }

  return (
    readPngDimensions(bytes) ??
    readGifDimensions(bytes) ??
    readWebpDimensions(bytes) ??
    readJpegDimensions(bytes)
  );
}

function readPngDimensions(bytes: Uint8Array) {
  const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 24 || !pngSignature.every((value, index) => bytes[index] === value)) {
    return null;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);

  return width > 0 && height > 0 ? { width, height } : null;
}

function readGifDimensions(bytes: Uint8Array) {
  const isGif =
    bytes.length >= 10 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38;
  if (!isGif) {
    return null;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint16(6, true);
  const height = view.getUint16(8, true);

  return width > 0 && height > 0 ? { width, height } : null;
}

function readWebpDimensions(bytes: Uint8Array) {
  if (
    bytes.length < 30 ||
    readAscii(bytes, 0, 4) !== "RIFF" ||
    readAscii(bytes, 8, 4) !== "WEBP"
  ) {
    return null;
  }

  const chunkType = readAscii(bytes, 12, 4);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (chunkType === "VP8X" && bytes.length >= 30) {
    const width = 1 + readUint24(view, 24);
    const height = 1 + readUint24(view, 27);
    return width > 0 && height > 0 ? { width, height } : null;
  }

  if (chunkType === "VP8 " && bytes.length >= 30) {
    const width = view.getUint16(26, true) & 0x3fff;
    const height = view.getUint16(28, true) & 0x3fff;
    return width > 0 && height > 0 ? { width, height } : null;
  }

  if (chunkType === "VP8L" && bytes.length >= 25) {
    const bits =
      bytes[21] |
      (bytes[22] << 8) |
      (bytes[23] << 16) |
      (bytes[24] << 24);
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >> 14) & 0x3fff) + 1;
    return width > 0 && height > 0 ? { width, height } : null;
  }

  return null;
}

function readJpegDimensions(bytes: Uint8Array) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }

  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = bytes[offset + 1];
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2 || offset + length + 2 > bytes.length) {
      return null;
    }

    const isStartOfFrame =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (isStartOfFrame) {
      const height = (bytes[offset + 5] << 8) | bytes[offset + 6];
      const width = (bytes[offset + 7] << 8) | bytes[offset + 8];
      return width > 0 && height > 0 ? { width, height } : null;
    }

    offset += 2 + length;
  }

  return null;
}

function readAscii(bytes: Uint8Array, offset: number, length: number) {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

function readUint24(view: DataView, offset: number) {
  return view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getUint8(offset + 2) << 16);
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
