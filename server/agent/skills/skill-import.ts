import path from "node:path";
import JSZip from "jszip";

import { parseAgentSkillMarkdown, type ParsedAgentSkill } from "./skill-parser.ts";

export type ImportedAgentSkill = ParsedAgentSkill & {
  sourceManifest: Record<string, unknown>;
};

export async function importAgentSkillZip(
  bytes: Buffer | Uint8Array,
  fileName: string
): Promise<ImportedAgentSkill> {
  const zip = await JSZip.loadAsync(bytes);
  const entries = Object.values(zip.files);
  const visibleFiles = entries.filter(
    (entry) => !entry.dir && !isIgnoredZipPath(entry.name)
  );
  const scriptFiles = visibleFiles.filter((entry) =>
    entry.name.split("/").includes("scripts")
  );
  if (scriptFiles.length) {
    throw new Error(
      "Skill packages with scripts are not supported yet. Remove scripts/ before importing."
    );
  }

  const skillFiles = visibleFiles.filter(
    (entry) => path.posix.basename(entry.name) === "SKILL.md"
  );
  if (skillFiles.length !== 1) {
    throw new Error(
      skillFiles.length
        ? "Skill zip must contain exactly one visible SKILL.md file."
        : "Skill zip does not contain a visible SKILL.md file."
    );
  }

  const skillEntry = skillFiles[0];
  const markdown = await skillEntry.async("string");
  const parsed = parseAgentSkillMarkdown(markdown);

  return {
    ...parsed,
    sourceManifest: {
      fileCount: visibleFiles.length,
      fileName,
      skillPath: skillEntry.name,
      source: "zip",
    },
  };
}

function isIgnoredZipPath(rawPath: string) {
  const parts = rawPath.split("/").filter(Boolean);
  return parts.some(
    (part) => part === "__MACOSX" || part === ".DS_Store" || part.startsWith("._")
  );
}
