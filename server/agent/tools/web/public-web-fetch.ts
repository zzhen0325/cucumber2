import { lookup } from "node:dns/promises";
import net from "node:net";

const MAX_READABLE_WEBPAGE_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;

export const publicWebFetchTestHooks = {
  fetch: (url: URL, init: RequestInit) => fetch(url, init),
  lookup: (hostname: string) =>
    lookup(hostname, { all: true, verbatim: true }) as Promise<
      Array<{ address: string; family: number }>
    >,
};

export async function fetchPublicReadableWebpage(
  inputUrl: string,
  signal?: AbortSignal
) {
  let url = new URL(inputUrl);
  let redirects = 0;

  while (true) {
    await assertPublicHttpUrl(url);
    const response = await publicWebFetchTestHooks.fetch(url, {
      redirect: "manual",
      signal,
      headers: {
        accept: "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.1",
        "user-agent": "CucumberAgent/1.0 (+https://cucumber.local)",
      },
    });

    if (isRedirect(response.status)) {
      if (redirects >= MAX_REDIRECTS) {
        throw new Error("Too many redirects while fetching webpage.");
      }
      const location = response.headers.get("location");
      if (!location) {
        throw new Error("Webpage redirect did not include a location.");
      }
      url = new URL(location, url);
      redirects += 1;
      continue;
    }

    if (!response.ok) {
      throw new Error(
        `Failed to fetch webpage (${response.status} ${response.statusText}).`
      );
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (
      contentType &&
      !/text\/html|application\/xhtml\+xml|text\/plain/i.test(contentType)
    ) {
      throw new Error(`Fetched URL is not a readable webpage (${contentType}).`);
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_READABLE_WEBPAGE_BYTES) {
      throw new Error("Fetched webpage exceeds the 2MB limit.");
    }

    return {
      html: new TextDecoder("utf-8", { fatal: false }).decode(bytes),
      url,
    };
  }
}

export async function assertPublicHttpUrl(url: URL) {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only public http(s) URLs can be fetched.");
  }

  const hostname = url.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "0.0.0.0"
  ) {
    throw new Error("Localhost URLs cannot be fetched.");
  }

  if (isBlockedIpAddress(hostname)) {
    throw new Error("Private network URLs cannot be fetched.");
  }

  const addresses = await publicWebFetchTestHooks.lookup(hostname);
  if (!addresses.length) {
    throw new Error("Could not resolve webpage host.");
  }
  if (addresses.some((address) => isBlockedIpAddress(address.address))) {
    throw new Error("Private network URLs cannot be fetched.");
  }
}

export function extractHtmlTitle(html: string) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeHtmlEntities(stripTags(match[1])).trim().slice(0, 160) : null;
}

export function extractReadableText(html: string, limit: number) {
  const text = decodeHtmlEntities(
    stripTags(
      html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    )
  )
    .replace(/\s+/g, " ")
    .trim();

  return text.length <= limit ? text : `${text.slice(0, limit - 1)}...`;
}

function isRedirect(status: number) {
  return [301, 302, 303, 307, 308].includes(status);
}

function isBlockedIpAddress(value: string) {
  const version = net.isIP(value);
  if (version === 4) {
    const parts = value.split(".").map(Number);
    return (
      parts[0] === 10 ||
      parts[0] === 127 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) ||
      parts[0] === 0 ||
      parts[0] >= 224
    );
  }

  if (version === 6) {
    const normalized = value.toLowerCase();
    return (
      normalized === "::1" ||
      normalized === "::" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe80:")
    );
  }

  return false;
}

function stripTags(value: string) {
  return value.replace(/<[^>]*>/g, " ");
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}
