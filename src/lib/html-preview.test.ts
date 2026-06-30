import { describe, expect, it } from "vitest";

import {
  getArtifactHtmlBaseUrl,
  prepareHtmlPreviewDocument,
  toHtmlDocumentBaseUrl,
} from "./html-preview";

describe("html preview document preparation", () => {
  it("injects a base URL into complete HTML documents", () => {
    const html =
      '<!doctype html><html><head><title>Demo</title></head><body><img src="/logo.svg"></body></html>';

    expect(
      prepareHtmlPreviewDocument(html, "https://example.com/docs/page?token=secret")
    ).toContain(
      '<head><base href="https://example.com/docs/page?token=secret"><title>Demo</title>'
    );
  });

  it("derives a base URL from canonical metadata in older stored HTML", () => {
    const html =
      '<html><head><link rel="canonical" href="https://platform.example/docs/streaming"></head><body></body></html>';

    expect(prepareHtmlPreviewDocument(html)).toContain(
      '<base href="https://platform.example/docs/streaming">'
    );
  });

  it("keeps existing base elements unchanged", () => {
    const html =
      '<html><head><base href="https://assets.example/"><title>Demo</title></head></html>';

    expect(prepareHtmlPreviewDocument(html, "https://ignored.example/")).toBe(html);
  });

  it("reads artifact source URL metadata for webpage previews", () => {
    expect(
      getArtifactHtmlBaseUrl({
        id: "web-1",
        metadata: { sourceUrl: "https://example.com/docs/page" },
        type: "webpage",
      })
    ).toBe("https://example.com/docs/page");
  });

  it("normalizes fetched page URLs into document base URLs", () => {
    expect(toHtmlDocumentBaseUrl("https://example.com/docs/page?token=secret#intro")).toBe(
      "https://example.com/docs/page"
    );
  });
});
