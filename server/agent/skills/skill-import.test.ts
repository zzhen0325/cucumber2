import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { importAgentSkillZip } from "./skill-import.ts";

const promptExpanderSkillMd = `---
name: imagegen-prompt-expander
description: Expand short visual ideas into production-ready image prompts.
agent_scope: image
purpose: prompt_expansion
---

# Imagegen Prompt Expander

Expand one short visual idea into one complete image prompt.
`;

describe("agent skill zip import", () => {
  it("imports a prompt-expander package while ignoring macOS metadata", async () => {
    const zip = new JSZip();
    zip.file("imagegen-prompt-expander/SKILL.md", promptExpanderSkillMd);
    zip.file("__MACOSX/imagegen-prompt-expander/._SKILL.md", "");
    zip.file("imagegen-prompt-expander/.DS_Store", "");
    const bytes = await zip.generateAsync({ type: "uint8array" });

    const imported = await importAgentSkillZip(bytes, "imagegen-prompt-expander.zip");

    expect(imported.name).toBe("imagegen-prompt-expander");
    expect(imported.description).toContain("Expand short visual ideas");
    expect(imported.sourceManifest).toMatchObject({
      fileName: "imagegen-prompt-expander.zip",
      skillPath: "imagegen-prompt-expander/SKILL.md",
      source: "zip",
    });
  });

  it("rejects missing or multiple visible SKILL.md files", async () => {
    await expect(importAgentSkillZip(await zipBytes({}), "empty.zip")).rejects.toThrow(
      /does not contain/
    );

    await expect(
      importAgentSkillZip(
        await zipBytes({
          "one/SKILL.md": promptExpanderSkillMd,
          "two/SKILL.md": promptExpanderSkillMd.replace(
            "imagegen-prompt-expander",
            "second-expander"
          ),
        }),
        "multiple.zip"
      )
    ).rejects.toThrow(/exactly one/);
  });

  it("imports declared Node and Python scripts", async () => {
    const skillMd = `---
name: script-skill
description: Run local scripts through the constrained skill runner.
agent_scope: general
purpose: canvas
scripts:
  - name: node-run
    path: scripts/node-run.mjs
    runtime: node
    description: Run node script.
  - name: py-run
    path: scripts/py-run.py
    runtime: python
    description: Run python script.
---

# Script Skill

Run scripts.
`;

    const imported = await importAgentSkillZip(
      await zipBytes({
        "script-skill/SKILL.md": skillMd,
        "script-skill/scripts/node-run.mjs": "console.log('{}')",
        "script-skill/scripts/py-run.py": "print('{}')",
      }),
      "script-skill.zip"
    );

    expect(imported.scripts.map((script) => script.name)).toEqual([
      "node-run",
      "py-run",
    ]);
    expect(imported.packageSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(imported.sourceManifest).toMatchObject({
      scripts: [
        expect.objectContaining({ name: "node-run", runtime: "node" }),
        expect.objectContaining({ name: "py-run", runtime: "python" }),
      ],
    });
  });

  it("imports standard Agent Skills packages with extra files and discovered scripts", async () => {
    const skillMd = `---
name: standard-skill
description: Standard Agent Skill package with references, assets, and scripts.
license: Apache-2.0
compatibility: Requires bash and python.
metadata:
  version: "1.0"
allowed-tools: Bash(*) Read
---

# Standard Skill

Read references/guide.md. Run scripts/check.sh or scripts/report.py when needed.
`;

    const imported = await importAgentSkillZip(
      await zipBytes({
        "standard-skill/SKILL.md": skillMd,
        "standard-skill/README.md": "extra docs are allowed by the open format",
        "standard-skill/references/guide.md": "# Guide",
        "standard-skill/assets/template.txt": "template",
        "standard-skill/scripts/check.sh": "#!/usr/bin/env bash\necho ok",
        "standard-skill/scripts/report.py": "print('ok')",
      }),
      "standard-skill.zip"
    );

    expect(imported.scripts).toEqual([
      expect.objectContaining({
        name: "check",
        path: "scripts/check.sh",
        runtime: "bash",
      }),
      expect.objectContaining({
        name: "report",
        path: "scripts/report.py",
        runtime: "python",
      }),
    ]);
    expect(imported.sourceManifest.resources).toMatchObject({
      additionalFiles: 1,
      assetFiles: 1,
      referenceFiles: 1,
      resourceFiles: 5,
      scriptFiles: 2,
    });
  });

  it("imports visual style library resources without requiring scripts", async () => {
    const skillMd = `---
name: custom-style-cookbook
description: Custom reusable style.json systems for generated image prompts.
agent_scope: image
purpose: prompt_expansion
tags:
  - style-json
bindings:
  tools:
    - render_visual_style_prompt
    - generate_image
  agents:
    - Cucumber Image Agent
---

# Custom Style Cookbook

Use bundled style.json systems.
`;
    const imported = await importAgentSkillZip(
      await zipBytes({
        "custom-style-cookbook/SKILL.md": skillMd,
        "custom-style-cookbook/references/catalog.md":
          "| Style | Slug | Summary |\n| --- | --- | --- |\n| Clean Test Style | `clean-test-style` | Clean test visuals. |\n",
        "custom-style-cookbook/references/styles/clean-test-style/style.json":
          JSON.stringify({
            style_name: "Clean Test Style",
            style_slug: "clean-test-style",
            style_summary: "Clean test visuals.",
            environment_variables: { SUBJECT: "subject", ASPECT_RATIO: "ratio" },
            prompt_template: "Create {ASPECT_RATIO} image of {SUBJECT}.",
            negative_prompt: "watermark",
          }),
        "custom-style-cookbook/references/styles/clean-test-style/preview-16x9.jpg":
          "fake image bytes",
        "custom-style-cookbook/references/styles/clean-test-style/preview-9x16.jpg":
          "fake image bytes",
      }),
      "custom-style-cookbook.zip"
    );

    expect(imported.name).toBe("custom-style-cookbook");
    expect(imported.scripts).toEqual([]);
    expect(imported.sourceManifest.resources).toMatchObject({
      previewImages: 2,
      referenceFiles: 4,
      resourceFiles: 4,
      styleJsonFiles: 1,
      stylePreviewImages: 2,
    });
  });

  it("rejects traversal and missing declared scripts without rejecting standard extras", async () => {
    await expect(
      importAgentSkillZip(
        await zipBytes({
          "script-skill/SKILL.md": promptExpanderSkillMd,
          "../evil.mjs": "no",
        }),
        "traversal.zip"
      )
    ).rejects.toThrow(/package root|unsafe path/);

    await expect(
      importAgentSkillZip(
        await zipBytes({
          "script-skill/SKILL.md": promptExpanderSkillMd,
          "script-skill/README.md": "standard extras are ok",
          "script-skill/custom/data.bin": "opaque asset",
        }),
        "extras.zip"
      )
    ).resolves.toMatchObject({ name: "imagegen-prompt-expander" });

    await expect(
      importAgentSkillZip(
        await zipBytes({
          "script-skill/SKILL.md": `---
name: script-skill
description: Declares a missing script.
scripts:
  - name: missing
    path: scripts/missing.mjs
    runtime: node
    description: Missing script.
---

# Script Skill

Run scripts.
`,
        }),
        "missing-declared.zip"
      )
    ).rejects.toThrow(/missing/);
  });
});

async function zipBytes(files: Record<string, string>) {
  const zip = new JSZip();
  for (const [fileName, content] of Object.entries(files)) {
    zip.file(fileName, content);
  }
  return zip.generateAsync({ type: "uint8array" });
}
