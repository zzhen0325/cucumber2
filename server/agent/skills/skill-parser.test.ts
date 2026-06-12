import { describe, expect, it } from "vitest";

import { parseAgentSkillMarkdown } from "./skill-parser.ts";

describe("agent skill parser", () => {
  it("parses Agent Skill frontmatter and body", () => {
    const parsed = parseAgentSkillMarkdown(`---
name: imagegen-prompt-expander
description: Expand compact image prompts.
license: internal
---

# Prompt Expander

Return one expanded prompt.
`);

    expect(parsed).toMatchObject({
      body: "# Prompt Expander\n\nReturn one expanded prompt.",
      description: "Expand compact image prompts.",
      name: "imagegen-prompt-expander",
      frontmatter: {
        license: "internal",
        name: "imagegen-prompt-expander",
      },
    });
  });

  it("rejects non-standard skill names", () => {
    expect(() =>
      parseAgentSkillMarkdown(`---
name: Image Prompt Expander
description: Bad name.
---

Body
`)
    ).toThrow(/lowercase/);
  });

  it("rejects missing frontmatter delimiters", () => {
    expect(() => parseAgentSkillMarkdown("# Missing frontmatter")).toThrow(
      /frontmatter/
    );
  });
});
