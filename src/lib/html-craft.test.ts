/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";

import {
  CRAFT_HTML_FORMAT,
  createCraftHtmlStateFromHtml,
  createCraftHtmlContentJson,
  readCraftHtmlState,
  renderCraftHtml,
  summarizeHtmlForCanvas,
  toEditableHtmlFragment,
} from "./html-craft";

describe("html craft artifact helpers", () => {
  it("stores and reads craft html state from artifact content json", () => {
    const json = createCraftHtmlContentJson('{"ROOT":{"nodes":[]}}');

    expect(json).toMatchObject({
      format: CRAFT_HTML_FORMAT,
      rendererVersion: 1,
    });
    expect(readCraftHtmlState(json)).toBe('{"ROOT":{"nodes":[]}}');
    expect(readCraftHtmlState({ format: "html", craftState: "{}" })).toBeUndefined();
  });

  it("renders serialized craft nodes into a complete HTML document", () => {
    const craftState = JSON.stringify({
      ROOT: {
        type: { resolvedName: "CraftPage" },
        props: { background: "#f7f8f2", maxWidth: "960px" },
        nodes: ["section"],
      },
      section: {
        type: { resolvedName: "CraftSection" },
        props: { padding: "32px", align: "center" },
        nodes: ["headline", "button"],
      },
      headline: {
        type: { resolvedName: "CraftText" },
        props: {
          tag: "h1",
          text: "Hello <Cucumber>",
          size: "48px",
          weight: "700",
        },
        nodes: [],
      },
      button: {
        type: { resolvedName: "CraftButton" },
        props: { href: "https://example.com", label: "Open" },
        nodes: [],
      },
    });

    const html = renderCraftHtml({ craftState, title: "Demo" });

    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<title>Demo</title>");
    expect(html).toContain("Hello &lt;Cucumber&gt;");
    expect(html).toContain('href="https://example.com"');
  });

  it("summarizes html without scripts, styles, or tags", () => {
    expect(
      summarizeHtmlForCanvas(
        "<style>.x{}</style><h1>Title</h1><script>alert(1)</script><p>Body</p>",
        "Fallback"
      )
    ).toBe("Title Body");
  });

  it("extracts editable body content while keeping document styles", () => {
    expect(
      toEditableHtmlFragment(
        "<!doctype html><html><head><style>.hero{color:red}</style></head><body><main class=\"hero\">Hi</main></body></html>"
      )
    ).toBe("<style>.hero{color:red}</style>\n<main class=\"hero\">Hi</main>");
  });

  it("imports generated html into craft nodes instead of a single raw embed", () => {
    const craftState = createCraftHtmlStateFromHtml(
      "<main><h1>Aside AI</h1><p>Browser page</p><a href=\"/download\">Download</a><img src=\"/hero.png\" alt=\"Hero\"></main>",
      "Aside"
    );
    const nodes = JSON.parse(craftState) as Record<
      string,
      { nodes?: string[]; type?: { resolvedName?: string } }
    >;
    const nodeNames = Object.values(nodes).map((node) => node.type?.resolvedName);
    const sectionNode = Object.values(nodes).find(
      (node) => node.type?.resolvedName === "CraftSection"
    );

    expect(sectionNode?.nodes?.length).toBeGreaterThan(1);
    expect(nodeNames).toContain("CraftSection");
    expect(nodeNames).toContain("CraftText");
    expect(nodeNames).toContain("CraftButton");
    expect(nodeNames).toContain("CraftImage");
    expect(nodeNames).not.toContain("RawHtmlBlock");
  });
});
