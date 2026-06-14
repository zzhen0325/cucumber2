import { describe, expect, it } from "vitest";

import { redactToolTraceValue, redactTraceValue } from "./trace-redaction.ts";

describe("trace redaction", () => {
  it("redacts secrets and URL-bearing fields recursively", () => {
    const result = redactTraceValue({
      prompt: "黄瓜海报",
      nested: {
        apiKey: "secret-key",
        sourceUrl: "https://example.com/private.png?token=abc",
      },
      resourcePath: "references/catalog.md",
    });

    expect(result.value).toEqual({
      prompt: "黄瓜海报",
      nested: {
        apiKey: "[redacted]",
        sourceUrl: "[redacted-url]",
      },
      resourcePath: "references/catalog.md",
    });
    expect(result.summary).toMatchObject({
      redacted: true,
      redactedFields: ["nested.apiKey", "nested.sourceUrl"],
    });
  });

  it("adds tool registry metadata to redacted tool trace values", () => {
    const result = redactToolTraceValue({
      direction: "output",
      toolName: "generate_image",
      value: {
        artifactIds: ["artifact-1"],
        sourceUrl: "https://example.com/private.png",
      },
    });

    expect(result.value).toMatchObject({
      artifactIds: ["artifact-1"],
      sourceUrl: "[redacted-url]",
    });
    expect(result.metadata).toMatchObject({
      redactionApplied: "true",
      toolLabel: "Generate image",
      traceDirection: "output",
    });
  });

  it("redacts upstream image URLs while preserving non-sensitive context", () => {
    const result = redactTraceValue({
      upstreamContext: [
        {
          nodeId: "image-1",
          type: "image",
          imageUrl: "https://example.com/storage/private.png",
          title: "Reference image",
        },
      ],
    });

    expect(result.value).toEqual({
      upstreamContext: [
        {
          nodeId: "image-1",
          type: "image",
          imageUrl: "[redacted-url]",
          title: "Reference image",
        },
      ],
    });
    expect(result.summary.redactedFields).toContain("upstreamContext.0.imageUrl");
  });
});
