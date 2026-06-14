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

  it("imports SDK skill references and assets without script declarations", async () => {
    const imported = await importAgentSkillZip(
      await zipBytes({
        "sdk-skill/SKILL.md": promptExpanderSkillMd.replace(
          "imagegen-prompt-expander",
          "sdk-skill"
        ),
        "sdk-skill/assets/template.txt": "asset",
        "sdk-skill/references/guide.md": "# Guide",
      }),
      "sdk-skill.zip"
    );

    expect(imported.sourceManifest.packageFiles).toEqual([
      "assets/template.txt",
      "references/guide.md",
    ]);
  });

  it("rejects traversal, unsupported files, and undeclared scripts", async () => {
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
          "script-skill/README.md": "no",
        }),
        "unsupported.zip"
      )
    ).rejects.toThrow(/scripts.*references.*assets/);

    await expect(
      importAgentSkillZip(
        await zipBytes({
          "script-skill/SKILL.md": promptExpanderSkillMd,
          "script-skill/scripts/run.mjs": "console.log('{}')",
        }),
        "undeclared.zip"
      )
    ).rejects.toThrow(/declared/);
  });
});

async function zipBytes(files: Record<string, string>) {
  const zip = new JSZip();
  for (const [fileName, content] of Object.entries(files)) {
    zip.file(fileName, content);
  }
  return zip.generateAsync({ type: "uint8array" });
}
