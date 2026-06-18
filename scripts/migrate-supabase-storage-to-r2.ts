import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { loadEnvFile } from "node:process";
import { spawnSync } from "node:child_process";

import { createClient } from "@supabase/supabase-js";

import {
  getObject,
  getR2AssetsBucket,
  getR2SkillPackagesBucket,
  headObject,
  putObject,
} from "../server/r2-storage.ts";

const SOURCE_ASSETS_BUCKET = "agent-assets";
const SOURCE_SKILL_PACKAGES_BUCKET = "agent-skill-packages";
const PAGE_SIZE = 1000;

type ArtifactRow = {
  bucket_id: string | null;
  content_ref: string | null;
  deleted_at: string | null;
  id: string;
  metadata: Record<string, unknown> | null;
  mime_type: string | null;
  size_bytes: number | null;
  storage_path: string | null;
};

type SkillRow = {
  deleted_at: string | null;
  id: string;
  name: string;
  package_bucket: string | null;
  package_path: string | null;
  package_sha256: string | null;
  package_size_bytes: number | null;
};

type MigrationObject = {
  contentType: string;
  expectedDigest?: string;
  expectedSizeBytes?: number;
  kind: "artifact" | "skill_package";
  path: string;
  references: string[];
  sourceBucket: string;
  targetBucket: string;
};

type ObjectReport = {
  digest?: string;
  expectedDigest?: string;
  expectedSizeBytes?: number;
  kind: MigrationObject["kind"];
  path: string;
  references: string[];
  sizeBytes?: number;
  sourceBucket: string;
  status: "dry-run-verified" | "uploaded" | "resumed";
  targetBucket: string;
};

type Options = {
  dryRun: boolean;
  reportPath: string;
  resume: boolean;
  rewriteDb: boolean;
};

loadEnvFiles();

const options = parseArgs(process.argv.slice(2));
const supabase = createSupabaseClient();

try {
  const report = await runMigration(options);
  await writeReport(options.reportPath, report);
  console.info(
    `[r2-migration] ${report.failures.length === 0 ? "ok" : "failed"}: ${report.objects.length} objects checked`
  );
  if (report.failures.length > 0) {
    for (const failure of report.failures) {
      console.error(`[r2-migration] ${failure}`);
    }
    process.exitCode = 1;
  }
} catch (error) {
  console.error("[r2-migration]", error);
  process.exitCode = 1;
}

async function runMigration(options: Options) {
  const artifacts = await fetchArtifactRows();
  const skills = await fetchSkillRows();
  const objects = buildObjectManifest(artifacts, skills);
  const objectReports: ObjectReport[] = [];
  const failures: string[] = [];

  for (const object of objects) {
    try {
      objectReports.push(await migrateObject(object, options));
    } catch (error) {
      failures.push(
        `${object.kind} ${object.sourceBucket}/${object.path}: ${getErrorMessage(error)}`
      );
    }
  }

  const dbRewrite =
    !options.dryRun && failures.length === 0 && options.rewriteDb
      ? rewriteDatabaseRefs()
      : null;

  return {
    artifacts: artifacts.length,
    dbRewrite,
    dryRun: options.dryRun,
    failures,
    generatedAt: new Date().toISOString(),
    objects: objectReports,
    resume: options.resume,
    skillPackages: skills.length,
  };
}

async function migrateObject(object: MigrationObject, options: Options) {
  const bytes = await downloadSupabaseObject(object.sourceBucket, object.path);
  const sizeBytes = bytes.byteLength;
  const digest = createSha256Hex(bytes);

  assertExpectedSize(object, sizeBytes);
  assertExpectedDigest(object, digest);

  if (options.dryRun) {
    return toObjectReport(object, {
      digest,
      sizeBytes,
      status: "dry-run-verified",
    });
  }

  if (options.resume && (await targetObjectAlreadyVerified(object, digest, sizeBytes))) {
    return toObjectReport(object, {
      digest,
      sizeBytes,
      status: "resumed",
    });
  }

  await putObject({
    bucket: object.targetBucket,
    bytes,
    cacheControl: "31536000",
    contentType: object.contentType,
    path: object.path,
  });

  await verifyR2Object(object, digest, sizeBytes);

  return toObjectReport(object, {
    digest,
    sizeBytes,
    status: "uploaded",
  });
}

async function targetObjectAlreadyVerified(
  object: MigrationObject,
  digest: string,
  sizeBytes: number
) {
  try {
    await verifyR2Object(object, digest, sizeBytes);
    return true;
  } catch {
    return false;
  }
}

async function verifyR2Object(
  object: MigrationObject,
  digest: string,
  sizeBytes: number
) {
  const head = await headObject(object.targetBucket, object.path);
  if (head.sizeBytes !== null && head.sizeBytes !== sizeBytes) {
    throw new Error(
      `R2 object size mismatch: expected ${sizeBytes}, got ${head.sizeBytes}.`
    );
  }

  if (object.expectedDigest) {
    const stored = await getObject(object.targetBucket, object.path);
    const storedDigest = createSha256Hex(stored.bytes);
    if (storedDigest !== digest) {
      throw new Error(
        `R2 object digest mismatch: expected ${digest}, got ${storedDigest}.`
      );
    }
  }
}

async function downloadSupabaseObject(bucket: string, path: string) {
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error) {
    throw error;
  }
  if (!data) {
    throw new Error("Supabase Storage returned no object bytes.");
  }
  return new Uint8Array(await data.arrayBuffer());
}

function buildObjectManifest(artifacts: ArtifactRow[], skills: SkillRow[]) {
  const byObject = new Map<string, MigrationObject>();

  for (const artifact of artifacts) {
    if (!artifact.bucket_id || !artifact.storage_path) {
      continue;
    }
    mergeObject(byObject, {
      contentType:
        artifact.mime_type ??
        readMetadataString(artifact.metadata?.mimeType) ??
        "application/octet-stream",
      expectedDigest: readSha256Digest(artifact.metadata?.digest),
      expectedSizeBytes: artifact.size_bytes ?? undefined,
      kind: "artifact",
      path: artifact.storage_path,
      references: [artifact.id],
      sourceBucket: artifact.bucket_id,
      targetBucket: getTargetBucket(artifact.bucket_id),
    });
  }

  for (const skill of skills) {
    if (!skill.package_bucket || !skill.package_path) {
      continue;
    }
    mergeObject(byObject, {
      contentType: "application/zip",
      expectedDigest: readSha256Digest(skill.package_sha256),
      expectedSizeBytes: skill.package_size_bytes ?? undefined,
      kind: "skill_package",
      path: skill.package_path,
      references: [skill.id],
      sourceBucket: skill.package_bucket,
      targetBucket: getTargetBucket(skill.package_bucket),
    });
  }

  return [...byObject.values()];
}

function mergeObject(
  objects: Map<string, MigrationObject>,
  next: MigrationObject
) {
  const key = `${next.sourceBucket}/${next.path}`;
  const existing = objects.get(key);
  if (!existing) {
    objects.set(key, next);
    return;
  }

  if (
    existing.expectedDigest &&
    next.expectedDigest &&
    existing.expectedDigest !== next.expectedDigest
  ) {
    throw new Error(`Conflicting digest expectations for ${key}.`);
  }
  if (
    existing.expectedSizeBytes !== undefined &&
    next.expectedSizeBytes !== undefined &&
    existing.expectedSizeBytes !== next.expectedSizeBytes
  ) {
    throw new Error(`Conflicting size expectations for ${key}.`);
  }

  existing.references.push(...next.references);
  existing.expectedDigest ??= next.expectedDigest;
  existing.expectedSizeBytes ??= next.expectedSizeBytes;
}

async function fetchArtifactRows() {
  const rows: ArtifactRow[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("agent_artifacts")
      .select(
        "id,bucket_id,storage_path,content_ref,metadata,mime_type,size_bytes,deleted_at"
      )
      .eq("bucket_id", SOURCE_ASSETS_BUCKET)
      .not("storage_path", "is", null)
      .is("deleted_at", null)
      .range(offset, offset + PAGE_SIZE - 1)
      .returns<ArtifactRow[]>();

    if (error) {
      throw error;
    }
    rows.push(...data);
    if (data.length < PAGE_SIZE) {
      return rows;
    }
  }
}

async function fetchSkillRows() {
  const rows: SkillRow[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("agent_skill_definitions")
      .select(
        "id,name,package_bucket,package_path,package_sha256,package_size_bytes,deleted_at"
      )
      .eq("package_bucket", SOURCE_SKILL_PACKAGES_BUCKET)
      .not("package_path", "is", null)
      .is("deleted_at", null)
      .range(offset, offset + PAGE_SIZE - 1)
      .returns<SkillRow[]>();

    if (error) {
      throw error;
    }
    rows.push(...data);
    if (data.length < PAGE_SIZE) {
      return rows;
    }
  }
}

function rewriteDatabaseRefs() {
  const databaseUrl =
    process.env.SUPABASE_DB_URL?.trim() || process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error(
      "DB rewrite requires SUPABASE_DB_URL or DATABASE_URL for a transactional psql session."
    );
  }

  const sql = buildRewriteSql();
  const result = spawnSync("psql", [databaseUrl, "-v", "ON_ERROR_STOP=1"], {
    encoding: "utf8",
    input: sql,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(result.stderr || "psql DB rewrite failed.");
  }

  return {
    applied: true,
    stdout: result.stdout.trim(),
  };
}

function buildRewriteSql() {
  const mappings = [
    {
      sourceBucket: SOURCE_ASSETS_BUCKET,
      targetBucket: getR2AssetsBucket(),
    },
    {
      sourceBucket: SOURCE_SKILL_PACKAGES_BUCKET,
      targetBucket: getR2SkillPackagesBucket(),
    },
  ];
  const replaceText = (expression: string) =>
    mappings.reduce(
      (current, mapping) =>
        `replace(${current}, ${sqlLiteral(
          `supabase://${mapping.sourceBucket}/`
        )}, ${sqlLiteral(`r2://${mapping.targetBucket}/`)})`,
      expression
    );

  return `
begin;

update public.agent_artifacts
set
  content_ref = ${replaceText("content_ref")},
  metadata = (${replaceText("coalesce(metadata, '{}'::jsonb)::text")})::jsonb
    || jsonb_build_object('storageProvider', 'r2')
where content_ref like 'supabase://%' or metadata::text like '%supabase://%';

update public.agent_canvas_nodes
set node_json = (${replaceText("node_json::text")})::jsonb
where node_json::text like '%supabase://%';

update public.agent_canvas_edges
set edge_json = (${replaceText("edge_json::text")})::jsonb
where edge_json::text like '%supabase://%';

update public.agent_run_events
set payload = (${replaceText("payload::text")})::jsonb
where payload::text like '%supabase://%';

commit;
`;
}

function getTargetBucket(sourceBucket: string) {
  if (sourceBucket === SOURCE_ASSETS_BUCKET) {
    return getR2AssetsBucket();
  }
  if (sourceBucket === SOURCE_SKILL_PACKAGES_BUCKET) {
    return getR2SkillPackagesBucket();
  }
  throw new Error(`Unexpected Supabase Storage bucket: ${sourceBucket}.`);
}

function assertExpectedSize(object: MigrationObject, sizeBytes: number) {
  if (
    object.expectedSizeBytes !== undefined &&
    object.expectedSizeBytes !== sizeBytes
  ) {
    throw new Error(
      `Source object size mismatch: expected ${object.expectedSizeBytes}, got ${sizeBytes}.`
    );
  }
}

function assertExpectedDigest(object: MigrationObject, digest: string) {
  if (object.expectedDigest && object.expectedDigest !== digest) {
    throw new Error(
      `Source object digest mismatch: expected ${object.expectedDigest}, got ${digest}.`
    );
  }
}

function toObjectReport(
  object: MigrationObject,
  values: Pick<ObjectReport, "digest" | "sizeBytes" | "status">
): ObjectReport {
  return {
    ...values,
    expectedDigest: object.expectedDigest,
    expectedSizeBytes: object.expectedSizeBytes,
    kind: object.kind,
    path: object.path,
    references: object.references,
    sourceBucket: object.sourceBucket,
    targetBucket: object.targetBucket,
  };
}

async function writeReport(path: string, report: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`);
}

function createSupabaseClient() {
  const url = process.env.SUPABASE_URL?.trim();
  const secret =
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !secret) {
    throw new Error(
      "Supabase is not configured. Set SUPABASE_URL and SUPABASE_SECRET_KEY."
    );
  }

  return createClient(url, secret, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function parseArgs(args: string[]): Options {
  const options: Options = {
    dryRun: false,
    reportPath: "out/r2-migration-report.json",
    resume: false,
    rewriteDb: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      continue;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--resume") {
      options.resume = true;
    } else if (arg === "--rewrite-db") {
      options.rewriteDb = true;
    } else if (arg === "--report") {
      options.reportPath = readRequiredArg(args, (index += 1), "--report");
    } else if (arg.startsWith("--report=")) {
      options.reportPath = arg.slice("--report=".length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (options.dryRun && options.rewriteDb) {
    throw new Error("--dry-run cannot be combined with --rewrite-db.");
  }

  return options;
}

function readRequiredArg(args: string[], index: number, flag: string) {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function loadEnvFiles() {
  for (const file of [".env.local", ".env"]) {
    if (existsSync(file)) {
      loadEnvFile(file);
    }
  }
}

function readMetadataString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readSha256Digest(value: unknown) {
  const raw = readMetadataString(value);
  if (!raw) {
    return undefined;
  }
  const digest = raw.startsWith("sha256:") ? raw.slice("sha256:".length) : raw;
  return /^[a-f0-9]{64}$/i.test(digest) ? digest.toLowerCase() : undefined;
}

function createSha256Hex(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sqlLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
