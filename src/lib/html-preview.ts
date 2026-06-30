import type { ArtifactRef } from "../types/canvas";

const HTTP_URL_PATTERN = /^https?:\/\//i;

export function prepareHtmlPreviewDocument(
  html: string,
  explicitBaseUrl?: string
) {
  const baseUrl = getHtmlPreviewBaseUrl(html, explicitBaseUrl);
  if (!baseUrl || hasBaseElement(html)) {
    return html;
  }

  const baseElement = `<base href="${escapeHtmlAttribute(baseUrl)}">`;
  const headMatch = html.match(/<head\b[^>]*>/i);
  if (headMatch?.index !== undefined) {
    const insertAt = headMatch.index + headMatch[0].length;
    return `${html.slice(0, insertAt)}${baseElement}${html.slice(insertAt)}`;
  }

  const htmlMatch = html.match(/<html\b[^>]*>/i);
  if (htmlMatch?.index !== undefined) {
    const insertAt = htmlMatch.index + htmlMatch[0].length;
    return `${html.slice(0, insertAt)}<head>${baseElement}</head>${html.slice(insertAt)}`;
  }

  return `${baseElement}${html}`;
}

export function getHtmlPreviewBaseUrl(
  html: string,
  explicitBaseUrl?: string
) {
  return (
    normalizeHttpUrl(explicitBaseUrl) ??
    readExistingBaseUrl(html) ??
    readLinkedDocumentUrl(html)
  );
}

export function getArtifactHtmlBaseUrl(artifact?: ArtifactRef) {
  if (!artifact?.metadata) {
    return undefined;
  }

  return (
    readMetadataUrl(artifact.metadata.sourceUrl) ??
    readMetadataUrl(artifact.metadata.finalUrl) ??
    readMetadataUrl(artifact.metadata.canonicalUrl) ??
    readMetadataUrl(artifact.metadata.url)
  );
}

export function toHtmlDocumentBaseUrl(url: URL | string) {
  const parsed = typeof url === "string" ? new URL(url) : new URL(url.toString());
  parsed.hash = "";
  parsed.search = "";
  return parsed.toString();
}

function hasBaseElement(html: string) {
  return /<base\b/i.test(html);
}

function readExistingBaseUrl(html: string) {
  return readFirstHtmlAttribute(html, /<base\b[^>]*\bhref\s*=\s*(["'])(.*?)\1/i);
}

function readLinkedDocumentUrl(html: string) {
  return (
    readFirstHtmlAttribute(
      html,
      /<link\b(?=[^>]*\brel\s*=\s*(["'])canonical\1)[^>]*\bhref\s*=\s*(["'])(.*?)\2/i,
      3
    ) ??
    readFirstHtmlAttribute(
      html,
      /<meta\b(?=[^>]*\bproperty\s*=\s*(["'])og:url\1)[^>]*\bcontent\s*=\s*(["'])(.*?)\2/i,
      3
    ) ??
    readFirstHtmlAttribute(
      html,
      /<meta\b(?=[^>]*\bname\s*=\s*(["'])twitter:url\1)[^>]*\bcontent\s*=\s*(["'])(.*?)\2/i,
      3
    )
  );
}

function readFirstHtmlAttribute(html: string, pattern: RegExp, valueIndex = 2) {
  return normalizeHttpUrl(decodeHtmlAttribute(html.match(pattern)?.[valueIndex]));
}

function readMetadataUrl(value: unknown) {
  return normalizeHttpUrl(typeof value === "string" ? value : undefined);
}

function normalizeHttpUrl(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed || !HTTP_URL_PATTERN.test(trimmed)) {
    return undefined;
  }

  try {
    return new URL(trimmed).toString();
  } catch {
    return undefined;
  }
}

function escapeHtmlAttribute(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function decodeHtmlAttribute(value: string | undefined) {
  return value
    ?.replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}
