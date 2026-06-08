import { describe, expect, it } from "vitest";

import { createDocumentWriteTool } from "./document-tools";
import { toolIds } from "./ids";

describe("document tools", () => {
  it("creates a Markdown doc artifact from model-provided input", async () => {
    const markdown = [
      "# AI SDK Tool Calling",
      "",
      "Main streamText should write the Markdown and pass it to the tool.",
      "",
      "- The tool validates input.",
      "- The tool creates the artifact.",
    ].join("\n");
    const tool = createDocumentWriteTool();

    const result = await tool.execute(
      {
        title: "AI SDK Tool Calling",
        markdown,
        summary: "Explains the artifactizer document.write contract.",
        sourcesUsed: [
          {
            title: "AI SDK Tool Calling",
            url: "https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling",
          },
        ],
      },
      {
        run: {
          input: {
            metadata: {
              runNodeId: "run-1",
            },
          },
        },
      } as never
    );

    expect(tool).toMatchObject({
      id: toolIds.writeDocument,
      toPlannerToolName: "write_document",
      policy: {
        canUseNetwork: false,
        mayExternalCost: false,
      },
    });
    expect(result).toMatchObject({
      ok: true,
      data: {
        title: "AI SDK Tool Calling",
        markdown,
        summary: "Explains the artifactizer document.write contract.",
      },
      artifacts: [
        {
          type: "doc",
          title: "AI SDK Tool Calling",
          metadata: {
            format: "markdown",
            markdown,
            summary: "Explains the artifactizer document.write contract.",
            sourcesUsed: [
              {
                title: "AI SDK Tool Calling",
                url: "https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling",
              },
            ],
          },
        },
      ],
      canvasOperations: [],
      logs: [
        {
          level: "info",
          message: "Created Markdown document artifact.",
        },
      ],
    });
    expect(result.artifacts[0]?.id).toMatch(/^doc-run-1-/);
    expect(result.artifacts[0]?.contentRef).toMatch(/^data:text\/markdown/);
    expect(result.artifacts[0]?.metadata).not.toHaveProperty("modelProvider");
    expect(result.artifacts[0]?.metadata).not.toHaveProperty("promptTrace");
  });
});
