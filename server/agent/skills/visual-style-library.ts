import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";

import { downloadAgentSkillPackage } from "../../storage.ts";
import type { ActivatedAgentSkill } from "./types.ts";

export type VisualStyleJson = {
  avoid?: string[];
  environment_variables?: Record<string, string>;
  negative_prompt?: string;
  prompt_template?: string;
  source_content_to_avoid?: string[];
  style_fidelity_anchors?: string[];
  style_name?: string;
  style_slug?: string;
  style_summary?: string;
};

export type StyleCatalogItem = {
  name: string;
  searchable: string;
  slug: string;
  summary: string;
};

export type VisualStyleLibrary = {
  catalog: StyleCatalogItem[];
  loadStyle: (slug: string) => Promise<VisualStyleJson>;
};

type CachedLibrary = {
  catalog: StyleCatalogItem[];
  styles: Map<string, VisualStyleJson | Promise<VisualStyleJson>>;
};

const packageLibraryCache = new Map<string, Promise<CachedLibrary>>();
const directoryLibraryCache = new Map<string, Promise<CachedLibrary>>();

export async function loadVisualStyleLibrary(
  skill: ActivatedAgentSkill
): Promise<VisualStyleLibrary> {
  const cached = await loadCachedLibrary(skill);
  return {
    catalog: cached.catalog,
    async loadStyle(slug: string) {
      const normalizedSlug = normalizeSlug(slug);
      if (!normalizedSlug) {
        throw new Error("Style slug cannot be empty.");
      }
      const style = cached.styles.get(normalizedSlug);
      if (!style) {
        throw new Error(`Style not found in ${skill.name}: ${normalizedSlug}`);
      }
      return style;
    },
  };
}

async function loadCachedLibrary(skill: ActivatedAgentSkill) {
  if (skill.packageBucket && skill.packagePath && skill.packageSha256) {
    const cacheKey = `${skill.id}:${skill.packageSha256}`;
    let cached = packageLibraryCache.get(cacheKey);
    if (!cached) {
      cached = loadPackageLibrary(skill);
      packageLibraryCache.set(cacheKey, cached);
    }
    return cached;
  }

  const assetRoot = readAssetRoot(skill);
  if (!assetRoot) {
    throw new Error(
      `Skill ${skill.name} does not provide a visual style library package or asset root.`
    );
  }
  let cached = directoryLibraryCache.get(assetRoot);
  if (!cached) {
    cached = loadDirectoryLibrary(assetRoot);
    directoryLibraryCache.set(assetRoot, cached);
  }
  return cached;
}

async function loadPackageLibrary(skill: ActivatedAgentSkill): Promise<CachedLibrary> {
  const packageBytes = await downloadAgentSkillPackage({
    bucket: skill.packageBucket ?? "",
    path: skill.packagePath ?? "",
  });
  const actualSha256 = createHash("sha256").update(packageBytes).digest("hex");
  if (actualSha256 !== skill.packageSha256) {
    throw new Error(`Skill package hash mismatch for ${skill.name}.`);
  }

  const zip = await JSZip.loadAsync(packageBytes);
  const entries = Object.values(zip.files).filter(
    (entry) => !entry.dir && !isIgnoredZipPath(entry.name)
  );
  const styleEntries = new Map<string, JSZip.JSZipObject>();
  let catalogEntry: JSZip.JSZipObject | null = null;

  for (const entry of entries) {
    const normalizedPath = normalizeZipPath(entry.name);
    assertSafeRelativePath(normalizedPath);
    if (/(^|\/)references\/catalog\.md$/i.test(normalizedPath)) {
      catalogEntry = entry;
    }
    const slug = getStyleSlugFromPath(normalizedPath);
    if (slug) {
      styleEntries.set(slug, entry);
    }
  }

  if (!styleEntries.size) {
    throw new Error(
      `Skill ${skill.name} does not contain references/styles/*/style.json or styles/*/style.json.`
    );
  }

  const styles = new Map<string, VisualStyleJson | Promise<VisualStyleJson>>();
  for (const [slug, entry] of styleEntries) {
    styles.set(slug, loadZipStyle(entry));
  }

  const catalog = catalogEntry
    ? parseCatalogMarkdown(await catalogEntry.async("string"))
    : await buildCatalogFromStyles(styles);
  return { catalog: catalog.length ? catalog : await buildCatalogFromStyles(styles), styles };
}

async function loadDirectoryLibrary(assetRoot: string): Promise<CachedLibrary> {
  const referencesRoot = path.join(assetRoot, "references");
  const catalogPath = path.join(referencesRoot, "catalog.md");
  const styleRoot = path.join(referencesRoot, "styles");
  const catalogText = await readOptionalText(catalogPath);
  const catalog = catalogText ? parseCatalogMarkdown(catalogText) : [];
  const styles = new Map<string, VisualStyleJson | Promise<VisualStyleJson>>();

  for (const item of catalog) {
    styles.set(item.slug, loadFileStyle(path.join(styleRoot, item.slug, "style.json")));
  }

  if (!styles.size) {
    throw new Error(`Visual style library at ${assetRoot} does not contain a catalog.`);
  }
  return { catalog, styles };
}

async function buildCatalogFromStyles(
  styles: Map<string, VisualStyleJson | Promise<VisualStyleJson>>
) {
  const catalog: StyleCatalogItem[] = [];
  for (const [slug, style] of styles) {
    const resolved = await style;
    const name = resolved.style_name ?? slug;
    const summary = resolved.style_summary ?? "";
    catalog.push({
      name,
      searchable: normalizeSearchText(`${name} ${slug} ${summary}`),
      slug,
      summary,
    });
  }
  return catalog.sort((left, right) => left.slug.localeCompare(right.slug));
}

function parseCatalogMarkdown(markdown: string): StyleCatalogItem[] {
  return markdown
    .split(/\r?\n/)
    .filter((line) => line.startsWith("| ") && !line.includes("| ---"))
    .map(parseCatalogRow)
    .filter((item): item is StyleCatalogItem => Boolean(item));
}

function parseCatalogRow(line: string): StyleCatalogItem | null {
  const cells = line
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim().replace(/^`|`$/g, ""));
  const [name, slug, summary] = cells;
  if (!name || !slug || slug === "Slug") {
    return null;
  }
  return {
    name,
    searchable: normalizeSearchText(`${name} ${slug} ${summary ?? ""}`),
    slug,
    summary: summary ?? "",
  };
}

async function loadZipStyle(entry: JSZip.JSZipObject) {
  return JSON.parse(await entry.async("string")) as VisualStyleJson;
}

async function loadFileStyle(stylePath: string) {
  return JSON.parse(await readFile(stylePath, "utf8")) as VisualStyleJson;
}

async function readOptionalText(filePath: string) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function getStyleSlugFromPath(filePath: string) {
  const match =
    filePath.match(/(?:^|\/)references\/styles\/([^/]+)\/style\.json$/i) ??
    filePath.match(/(?:^|\/)styles\/([^/]+)\/style\.json$/i);
  return normalizeSlug(match?.[1]);
}

function readAssetRoot(skill: ActivatedAgentSkill) {
  const raw = skill.sourceManifest.assetRoot;
  return typeof raw === "string" && raw.trim() ? path.resolve(raw.trim()) : null;
}

function normalizeSearchText(text: string) {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeSlug(slug?: string) {
  return slug?.trim().toLowerCase().replace(/[^a-z0-9-]/g, "") ?? "";
}

function normalizeZipPath(rawPath: string) {
  return rawPath.replace(/\\/g, "/").split("/").filter(Boolean).join("/");
}

function assertSafeRelativePath(relativePath: string) {
  const parts = relativePath.split("/").filter(Boolean);
  if (relativePath.startsWith("/") || parts.includes("..") || parts.includes(".")) {
    throw new Error("Skill package contains an unsafe path.");
  }
}

function isIgnoredZipPath(rawPath: string) {
  const parts = rawPath.split("/").filter(Boolean);
  return parts.some(
    (part) => part === "__MACOSX" || part === ".DS_Store" || part.startsWith("._")
  );
}
