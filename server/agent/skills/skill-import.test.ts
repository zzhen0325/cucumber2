import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { importAgentSkillZip } from "./skill-import.ts";

const promptExpanderSkillMd = `---
name: imagegen-prompt-expander
description: Expand short visual ideas into production-ready image prompts.
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

  it("rejects executable script packages for the first version", async () => {
    await expect(
      importAgentSkillZip(
        await zipBytes({
          "imagegen-prompt-expander/SKILL.md": promptExpanderSkillMd,
          "imagegen-prompt-expander/scripts/run.sh": "echo no",
        }),
        "with-scripts.zip"
      )
    ).rejects.toThrow(/scripts/);
  });
});

async function zipBytes(files: Record<string, string>) {
  const zip = new JSZip();
  for (const [fileName, content] of Object.entries(files)) {
    zip.file(fileName, content);
  }
  return zip.generateAsync({ type: "uint8array" });
}
