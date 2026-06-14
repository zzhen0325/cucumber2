import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { localDirLazySkillSource, skills, type SkillIndexEntry, type Skills } from "@openai/agents/sandbox/local";
import JSZip from "jszip";

import { getAgentSkillDefinition } from "../../supabase.ts";
import { downloadAgentSkillPackage } from "../../storage.ts";
import type { AgentSkillCard } from "./types.ts";

export type SdkSkillSource = {
  capability: Skills;
  cleanup: () => Promise<void>;
  index: SkillIndexEntry[];
  rootDir: string;
};

export async function prepareSdkSkillSource(
  candidates: AgentSkillCard[]
): Promise<SdkSkillSource | null> {
  if (!candidates.length) {
    return null;
  }

  const rootDir = await mkdtemp(path.join(tmpdir(), "cucumber-sdk-skills-"));
  try {
    const index: SkillIndexEntry[] = [];
    for (const candidate of candidates) {
      const skill = await getAgentSkillDefinition(candidate.id);
      if (!skill?.enabled) {
        continue;
      }

      await materializeSkillPackage(rootDir, skill);
      index.push({
        description: skill.description,
        name: skill.name,
        path: skill.name,
      });
    }

    if (!index.length) {
      await rm(rootDir, { force: true, recursive: true });
      return null;
    }

    return {
      capability: skills({
        index,
        lazyFrom: localDirLazySkillSource(rootDir),
        skillsPath: ".agents",
      }),
      cleanup: () => rm(rootDir, { force: true, recursive: true }),
      index,
      rootDir,
    };
  } catch (error) {
    await rm(rootDir, { force: true, recursive: true }).catch(() => undefined);
    throw error;
  }
}

type FullSkill = NonNullable<Awaited<ReturnType<typeof getAgentSkillDefinition>>>;

async function materializeSkillPackage(rootDir: string, skill: FullSkill) {
  const skillDir = path.join(rootDir, skill.name);
  await mkdir(skillDir, { recursive: true });

  if (skill.packageBucket && skill.packagePath && skill.packageSha256) {
    const packageBytes = await downloadAgentSkillPackage({
      bucket: skill.packageBucket,
      path: skill.packagePath,
    });
    const actualSha256 = createHash("sha256").update(packageBytes).digest("hex");
    if (actualSha256 !== skill.packageSha256) {
      throw new Error(`Skill package hash mismatch for ${skill.name}.`);
    }
    await extractZipSkillPackage({
      packageBytes,
      skillDir,
    });
    return;
  }

  await writeFile(path.join(skillDir, "SKILL.md"), skill.skillMd, "utf8");
}

async function extractZipSkillPackage({
  packageBytes,
  skillDir,
}: {
  packageBytes: Uint8Array;
  skillDir: string;
}) {
  const zip = await JSZip.loadAsync(packageBytes);
  const visibleFiles = Object.values(zip.files).filter(
    (entry) => !entry.dir && !isIgnoredZipPath(entry.name)
  );
  const skillEntries = visibleFiles.filter(
    (entry) => path.posix.basename(normalizeZipPath(entry.name)) === "SKILL.md"
  );
  if (skillEntries.length !== 1) {
    throw new Error("Skill package must contain exactly one SKILL.md file.");
  }

  const rootPrefix = getRootPrefix(skillEntries[0].name);
  for (const entry of visibleFiles) {
    const normalized = normalizeZipPath(entry.name);
    assertSafeRelativePath(normalized);
    if (!normalized.startsWith(rootPrefix)) {
      throw new Error("Skill package files must stay under the SKILL.md package root.");
    }

    const relativePath = normalized.slice(rootPrefix.length);
    assertSafeRelativePath(relativePath);
    const outputPath = path.join(skillDir, relativePath);
    const relativeOutput = path.relative(skillDir, outputPath);
    if (relativeOutput.startsWith("..") || path.isAbsolute(relativeOutput)) {
      throw new Error("Skill package contains an unsafe path.");
    }

    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, await entry.async("uint8array"));
  }
}

function getRootPrefix(skillPath: string) {
  const normalized = normalizeZipPath(skillPath);
  const dirname = path.posix.dirname(normalized);
  return dirname === "." ? "" : `${dirname}/`;
}

function normalizeZipPath(rawPath: string) {
  return rawPath.replace(/\\/g, "/").split("/").filter(Boolean).join("/");
}

function assertSafeRelativePath(relativePath: string) {
  const parts = relativePath.split("/").filter(Boolean);
  if (
    !relativePath ||
    relativePath.startsWith("/") ||
    parts.includes("..") ||
    parts.includes(".")
  ) {
    throw new Error("Skill package contains an unsafe path.");
  }
}

function isIgnoredZipPath(rawPath: string) {
  const parts = rawPath.split("/").filter(Boolean);
  return parts.some(
    (part) => part === "__MACOSX" || part === ".DS_Store" || part.startsWith("._")
  );
}
