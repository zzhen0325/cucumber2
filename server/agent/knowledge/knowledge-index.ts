import { createHash } from "node:crypto";

import type { ArtifactType } from "../../../src/types/canvas.ts";
import type {
  AgentArtifactRecord,
  AgentKnowledgeChunkRecord,
  UpsertAgentKnowledgeChunkInput,
} from "../../supabase.ts";
import { replaceAgentKnowledgeChunksForArtifact } from "../../supabase.ts";

const MAX_INDEX_TEXT_CHARS = 80_000;
const CHUNK_SIZE = 1_200;
const CHUNK_OVERLAP = 160;
const MAX_CHUNKS_PER_ARTIFACT = 24;
const MAX_KEYWORDS_PER_CHUNK = 64;

const textualArtifactTypes = new Set<ArtifactType>([
  "code",
  "dataset",
  "doc",
  "memory",
  "tool_result",
  "webpage",
]);

const stopWords = new Set([
  "about",
  "after",
  "also",
  "and",
  "are",
  "but",
  "for",
  "from",
  "has",
  "have",
  "into",
  "not",
  "the",
  "this",
  "that",
  "with",
  "you",
  "your",
]);

export type KnowledgeChunkBuildInput = {
  artifact: Pick<
    AgentArtifactRecord,
    "id" | "metadata" | "mimeType" | "projectId" | "storagePath" | "title" | "type"
  >;
  contentText?: string | null;
  sourceNodeId?: string | null;
};

export type KnowledgeSearchResult = {
  chunkId: string;
  sourceArtifactId: string;
  sourceNodeId: string | null;
  textExcerpt: string;
  textExcerptDigest: string;
  keywordIndex: string[];
  score: number;
  title?: string;
  artifactType?: string;
  createdAt: string;
  updatedAt: string;
};

export async function indexArtifactForKnowledge(input: KnowledgeChunkBuildInput) {
  const chunks = buildKnowledgeChunksForArtifact(input);
  return replaceAgentKnowledgeChunksForArtifact({
    chunks,
    projectId: input.artifact.projectId,
    sourceArtifactId: input.artifact.id,
  });
}

export function buildKnowledgeChunksForArtifact({
  artifact,
  contentText,
  sourceNodeId,
}: KnowledgeChunkBuildInput): UpsertAgentKnowledgeChunkInput[] {
  const knowledgeText = buildKnowledgeText(artifact, contentText);
  if (!knowledgeText) {
    return [];
  }

  const excerpts = splitTextIntoChunks(knowledgeText);
  return excerpts.map((excerpt, index) => {
    const digest = createSha256Digest(excerpt);
    return {
      id: `${artifact.id}:chunk:${index}:${digest.slice(7, 19)}`,
      keywordIndex: extractKeywords(excerpt),
      metadata: {
        artifactType: artifact.type,
        chunkIndex: index,
        mimeType: artifact.mimeType,
        sourceTitle: artifact.title,
      },
      projectId: artifact.projectId,
      sourceArtifactId: artifact.id,
      sourceNodeId: sourceNodeId ?? getDefaultKnowledgeSourceNodeId(artifact),
      textExcerpt: excerpt,
      textExcerptDigest: digest,
    };
  });
}

export function searchKnowledgeChunks({
  chunks,
  limit = 6,
  query,
  visibleSourceArtifactIds,
  visibleSourceNodeIds,
}: {
  chunks: AgentKnowledgeChunkRecord[];
  limit?: number;
  query: string;
  visibleSourceArtifactIds?: Set<string>;
  visibleSourceNodeIds?: Set<string>;
}): KnowledgeSearchResult[] {
  const queryKeywords = extractKeywords(query);
  if (!queryKeywords.length) {
    return [];
  }
  const querySet = new Set(queryKeywords);

  return chunks
    .filter((chunk) =>
      isKnowledgeChunkVisible(chunk, visibleSourceNodeIds, visibleSourceArtifactIds)
    )
    .map((chunk) => {
      const keywordMatches = chunk.keywordIndex.filter((keyword) =>
        querySet.has(keyword)
      );
      const excerpt = chunk.textExcerpt.toLowerCase();
      const phraseBonus = queryKeywords.some((keyword) => excerpt.includes(keyword))
        ? 2
        : 0;
      return {
        chunk,
        score: keywordMatches.length * 3 + phraseBonus,
      };
    })
    .filter(({ score }) => score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return right.chunk.updatedAt.localeCompare(left.chunk.updatedAt);
    })
    .slice(0, Math.max(1, Math.min(limit, 12)))
    .map(({ chunk, score }) => ({
      artifactType: readString(chunk.metadata.artifactType),
      chunkId: chunk.id,
      createdAt: chunk.createdAt,
      keywordIndex: chunk.keywordIndex,
      score,
      sourceArtifactId: chunk.sourceArtifactId,
      sourceNodeId: chunk.sourceNodeId,
      textExcerpt: chunk.textExcerpt,
      textExcerptDigest: chunk.textExcerptDigest,
      title: readString(chunk.metadata.sourceTitle),
      updatedAt: chunk.updatedAt,
    }));
}

export function readKnowledgeTextFromBytes({
  bytes,
  mimeType,
  path,
}: {
  bytes: Uint8Array;
  mimeType?: string | null;
  path?: string | null;
}) {
  if (!isLikelyTextualAsset(mimeType, path)) {
    return "";
  }
  const decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  return decoded.includes("\u0000") ? "" : decoded;
}

export function getDefaultKnowledgeSourceNodeId(
  artifact: Pick<AgentArtifactRecord, "id" | "metadata" | "type">
) {
  if (artifact.type === "image") {
    return `image-${artifact.id}`;
  }
  if (artifact.type === "doc") {
    return isMarkdownArtifactMetadata(artifact.metadata)
      ? `markdown-${artifact.id}`
      : `document-${artifact.id}`;
  }
  if (artifact.type === "tool_result") {
    return `tool-result-${artifact.id}`;
  }
  if (artifact.type === "webpage") {
    return `webpage-${artifact.id}`;
  }
  if (artifact.type === "code") {
    return `code-${artifact.id}`;
  }
  if (artifact.type === "decision") {
    return `decision-${artifact.id}`;
  }
  if (artifact.type === "memory") {
    return `memory-${artifact.id}`;
  }
  return `artifact-${artifact.id}`;
}

function buildKnowledgeText(
  artifact: KnowledgeChunkBuildInput["artifact"],
  contentText: string | null | undefined
) {
  const metadataText = [
    artifact.title,
    readString(artifact.metadata.summary),
    readString(artifact.metadata.preview),
    readString(artifact.metadata.prompt),
    readString(artifact.metadata.fileName),
  ]
    .filter(Boolean)
    .join("\n\n");

  const bodyText =
    contentText && shouldIndexBodyText(artifact)
      ? normalizeExtractedText(contentText, artifact.mimeType)
      : "";
  const text = [metadataText, bodyText].filter(Boolean).join("\n\n");
  return normalizeWhitespace(text).slice(0, MAX_INDEX_TEXT_CHARS).trim();
}

function shouldIndexBodyText(artifact: KnowledgeChunkBuildInput["artifact"]) {
  if (textualArtifactTypes.has(artifact.type)) {
    return true;
  }
  return isLikelyTextualAsset(artifact.mimeType, artifact.storagePath);
}

function normalizeExtractedText(text: string, mimeType?: string | null) {
  const normalizedMimeType = mimeType?.toLowerCase() ?? "";
  if (normalizedMimeType.includes("html")) {
    return stripHtml(text);
  }
  return text;
}

function splitTextIntoChunks(text: string) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return [];
  }

  const chunks: string[] = [];
  let offset = 0;
  while (offset < normalized.length && chunks.length < MAX_CHUNKS_PER_ARTIFACT) {
    const hardEnd = Math.min(offset + CHUNK_SIZE, normalized.length);
    const softEnd = findSoftChunkEnd(normalized, offset, hardEnd);
    const excerpt = normalized.slice(offset, softEnd).trim();
    if (excerpt) {
      chunks.push(excerpt);
    }
    if (softEnd >= normalized.length) {
      break;
    }
    offset = Math.max(softEnd - CHUNK_OVERLAP, offset + 1);
  }
  return chunks;
}

function findSoftChunkEnd(text: string, offset: number, hardEnd: number) {
  if (hardEnd >= text.length) {
    return hardEnd;
  }
  const window = text.slice(offset, hardEnd);
  const lastBreak = Math.max(
    window.lastIndexOf("\n"),
    window.lastIndexOf(". "),
    window.lastIndexOf("。"),
    window.lastIndexOf("; "),
    window.lastIndexOf("；")
  );
  if (lastBreak > CHUNK_SIZE * 0.55) {
    return offset + lastBreak + 1;
  }
  return hardEnd;
}

function extractKeywords(text: string) {
  const counts = new Map<string, number>();
  const normalized = normalizeWhitespace(text).toLowerCase();
  for (const match of normalized.matchAll(/[\p{L}\p{N}][\p{L}\p{N}_-]*/gu)) {
    const token = match[0].replace(/^[_-]+|[_-]+$/g, "");
    if (token.length < 2 || stopWords.has(token)) {
      continue;
    }
    counts.set(token, (counts.get(token) ?? 0) + 1);
    if (/[\u3400-\u9fff]/u.test(token) && token.length > 2) {
      for (const bigram of toCjkBigrams(token)) {
        counts.set(bigram, (counts.get(bigram) ?? 0) + 1);
      }
    }
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, MAX_KEYWORDS_PER_CHUNK)
    .map(([keyword]) => keyword);
}

function toCjkBigrams(token: string) {
  const chars = [...token].filter((char) => /[\u3400-\u9fff]/u.test(char));
  const bigrams: string[] = [];
  for (let index = 0; index < chars.length - 1; index += 1) {
    bigrams.push(`${chars[index]}${chars[index + 1]}`);
  }
  return bigrams;
}

function isKnowledgeChunkVisible(
  chunk: AgentKnowledgeChunkRecord,
  visibleSourceNodeIds?: Set<string>,
  visibleSourceArtifactIds?: Set<string>
) {
  if (!visibleSourceNodeIds && !visibleSourceArtifactIds) {
    return true;
  }
  if (chunk.sourceNodeId && visibleSourceNodeIds?.has(chunk.sourceNodeId)) {
    return true;
  }
  return visibleSourceArtifactIds?.has(chunk.sourceArtifactId) ?? false;
}

function isLikelyTextualAsset(mimeType?: string | null, path?: string | null) {
  const normalizedMimeType = mimeType?.toLowerCase() ?? "";
  if (
    normalizedMimeType.startsWith("text/") ||
    normalizedMimeType.includes("json") ||
    normalizedMimeType.includes("xml") ||
    normalizedMimeType.includes("yaml") ||
    normalizedMimeType.includes("csv") ||
    normalizedMimeType.includes("javascript") ||
    normalizedMimeType.includes("typescript")
  ) {
    return true;
  }

  const extension = path?.split("?")[0]?.split(".").at(-1)?.toLowerCase() ?? "";
  return [
    "csv",
    "html",
    "htm",
    "json",
    "jsonl",
    "md",
    "mdx",
    "ndjson",
    "sql",
    "tsv",
    "txt",
    "xml",
    "yaml",
    "yml",
  ].includes(extension);
}

function isMarkdownArtifactMetadata(metadata: Record<string, unknown>) {
  const format = readString(metadata.format)?.toLowerCase();
  const mimeType = readString(metadata.mimeType)?.toLowerCase();
  return (
    format === "markdown" ||
    format === "md" ||
    mimeType === "text/markdown" ||
    mimeType === "text/x-markdown"
  );
}

function stripHtml(html: string) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}

function normalizeWhitespace(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function createSha256Digest(text: string) {
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
