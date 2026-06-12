import { describe, expect, it } from "vitest";

import { parseAgentSkillMarkdown } from "./skill-parser.ts";

describe("agent skill parser", () => {
  it("parses Agent Skill frontmatter and body", () => {
    const parsed = parseAgentSkillMarkdown(`---
name: imagegen-prompt-expander
description: Expand compact image prompts.
agent_scope: image
purpose: prompt_expansion
tags:
  - image
triggers:
  keywords:
    - 生图
  canvas_kinds:
    - imageResult
bindings:
  tools:
    - expand_image_prompt
  agents:
    - Cucumber Image Agent
scripts:
  - name: polish
    path: scripts/polish.mjs
    runtime: node
    description: Polish a prompt.
license: internal
---

# Prompt Expander

Return one expanded prompt.
`);

    expect(parsed).toMatchObject({
      body: "# Prompt Expander\n\nReturn one expanded prompt.",
      description: "Expand compact image prompts.",
      name: "imagegen-prompt-expander",
      agentScope: "image",
      purpose: "prompt_expansion",
      scripts: [
        expect.objectContaining({
          name: "polish",
          path: "scripts/polish.mjs",
          runtime: "node",
        }),
      ],
      tags: ["image"],
      triggers: {
        canvasKinds: ["imageResult"],
        keywords: ["生图"],
      },
      frontmatter: {
        agent_scope: "image",
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

  it("rejects duplicate script names and unsafe paths", () => {
    expect(() =>
      parseAgentSkillMarkdown(`---
name: script-skill
description: Script skill.
scripts:
  - name: run
    path: ../run.mjs
    runtime: node
    description: Bad path.
---

Body
`)
    ).toThrow(/Script path/);

    expect(() =>
      parseAgentSkillMarkdown(`---
name: script-skill
description: Script skill.
scripts:
  - name: run
    path: scripts/run.mjs
    runtime: node
    description: First.
  - name: run
    path: scripts/other.mjs
    runtime: node
    description: Duplicate.
---

Body
`)
    ).toThrow(/Duplicate script/);
  });
});
