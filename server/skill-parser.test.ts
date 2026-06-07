import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { parseSkillZip } from "./skill-parser";

describe("skill zip parser", () => {
  it("extracts SKILL.md frontmatter, instructions, and config JSON", async () => {
    const zip = new JSZip();
    zip.file(
      "prompt-expand/SKILL.md",
      [
        "---",
        "name: prompt-expand",
        "description: 扩写图片 prompt",
        "---",
        "",
        "# Prompt 扩写",
        "只输出 expanded prompt。",
      ].join("\n")
    );
    zip.file(
      "prompt-expand/config/text_expand_cfg.json",
      JSON.stringify({ mode: "text" })
    );
    zip.file("prompt-expand/src/main.py", "print('not executed')");

    const parsed = await parseSkillZip(await zip.generateAsync({ type: "uint8array" }));

    expect(parsed.name).toBe("prompt-expand");
    expect(parsed.slug).toBe("prompt-expand");
    expect(parsed.description).toBe("扩写图片 prompt");
    expect(parsed.instructions).toContain("只输出 expanded prompt");
    expect(parsed.config).toEqual({
      "config/text_expand_cfg.json": { mode: "text" },
    });
    expect(parsed.sourceManifest.skillPath).toBe("prompt-expand/SKILL.md");
    expect(parsed.sourceManifest.files.map((file) => file.path)).toContain(
      "prompt-expand/src/main.py"
    );
  });

  it("throws when SKILL.md is missing", async () => {
    const zip = new JSZip();
    zip.file("prompt-expand/README.md", "missing skill file");

    await expect(
      parseSkillZip(await zip.generateAsync({ type: "uint8array" }))
    ).rejects.toThrow("SKILL.md");
  });
});
