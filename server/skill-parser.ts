import JSZip from "jszip";

export type SkillSourceManifest = {
  packageRoot: string;
  skillPath: string;
  files: Array<{
    path: string;
    size: number | null;
  }>;
};

export type ParsedSkillPackage = {
  name: string;
  slug: string;
  description: string;
  instructions: string;
  config: Record<string, unknown>;
  sourceManifest: SkillSourceManifest;
};

type Frontmatter = {
  name?: string;
  description?: string;
};

export async function parseSkillZip(
  input: ArrayBuffer | Uint8Array | Buffer
): Promise<ParsedSkillPackage> {
  const zip = await JSZip.loadAsync(input);
  const files = Object.values(zip.files).filter((file) => !file.dir);
  const skillFile = files
    .filter((file) => file.name.split("/").at(-1) === "SKILL.md")
    .sort((a, b) => a.name.split("/").length - b.name.split("/").length)[0];

  if (!skillFile) {
    throw new Error("Skill zip must include SKILL.md.");
  }

  const skillPath = skillFile.name;
  const packageRoot = skillPath.slice(0, -"/SKILL.md".length);
  const rootPrefix = packageRoot ? `${packageRoot}/` : "";
  const markdown = await skillFile.async("string");
  const { frontmatter, body } = parseMarkdownFrontmatter(markdown);
  const name = (frontmatter.name ?? packageRoot.split("/").filter(Boolean).at(-1) ?? "")
    .trim()
    .slice(0, 80);

  if (!name) {
    throw new Error("Skill name is required.");
  }

  const config = await parseConfigFiles(zip, rootPrefix);

  return {
    name,
    slug: slugify(name),
    description: (frontmatter.description ?? "").trim().slice(0, 500),
    instructions: body.trim(),
    config,
    sourceManifest: {
      packageRoot,
      skillPath,
      files: files.map((file) => ({
        path: file.name,
        size: getZipFileSize(file),
      })),
    },
  };
}

export function parseMarkdownFrontmatter(markdown: string) {
  if (!markdown.startsWith("---")) {
    return { frontmatter: {}, body: markdown } satisfies {
      frontmatter: Frontmatter;
      body: string;
    };
  }

  const normalized = markdown.replace(/\r\n/g, "\n");
  const endIndex = normalized.indexOf("\n---", 3);
  if (endIndex === -1) {
    return { frontmatter: {}, body: markdown } satisfies {
      frontmatter: Frontmatter;
      body: string;
    };
  }

  const frontmatterText = normalized.slice(3, endIndex).trim();
  const bodyStart = normalized.indexOf("\n", endIndex + 4);
  const body = bodyStart === -1 ? "" : normalized.slice(bodyStart + 1);

  return {
    frontmatter: parseYamlLikeFrontmatter(frontmatterText),
    body,
  };
}

export function slugify(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return slug || "skill";
}

async function parseConfigFiles(zip: JSZip, rootPrefix: string) {
  const config: Record<string, unknown> = {};
  const configPrefix = `${rootPrefix}config/`;
  const configFiles = Object.values(zip.files)
    .filter((file) => !file.dir && file.name.startsWith(configPrefix))
    .filter((file) => file.name.endsWith(".json"))
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const file of configFiles) {
    const raw = await file.async("string");
    const relativePath = file.name.slice(rootPrefix.length);
    try {
      config[relativePath] = JSON.parse(raw) as unknown;
    } catch (error) {
      throw new Error(`Invalid JSON config: ${relativePath}. ${getErrorMessage(error)}`, {
        cause: error,
      });
    }
  }

  return config;
}

function parseYamlLikeFrontmatter(text: string): Frontmatter {
  const frontmatter: Frontmatter = {};

  for (const line of text.split("\n")) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) {
      continue;
    }

    const key = match[1];
    const value = stripYamlScalar(match[2]);
    if (key === "name") {
      frontmatter.name = value;
    }
    if (key === "description") {
      frontmatter.description = value;
    }
  }

  return frontmatter;
}

function stripYamlScalar(value: string) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function getZipFileSize(file: JSZip.JSZipObject) {
  const data = file as JSZip.JSZipObject & {
    _data?: { uncompressedSize?: number };
  };

  return typeof data._data?.uncompressedSize === "number"
    ? data._data.uncompressedSize
    : null;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
