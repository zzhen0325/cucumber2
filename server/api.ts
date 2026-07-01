import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { loadEnvFile } from "node:process";
import { serve } from "@hono/node-server";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage,
  type UIMessageStreamWriter,
} from "ai";
import { Hono, type Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { cors } from "hono/cors";
import { z } from "zod";

import {
  isSeedreamConfigured,
  readSeedreamUpscaleConfigFromEnv,
  upscaleSeedreamImage,
} from "../seedream.ts";
import { isCozeImageConfigured } from "../coze.ts";
import { isByteArtistConfigured } from "../byteartist.ts";
import JSZip from "jszip";
import type {
  AgentCanvasEdge,
  AgentCanvasNode,
  ArtifactRef,
  GeneratedImage,
  ImageResultNodeData,
} from "../src/types/canvas.ts";
import { executeAgentRun } from "./agent/index.ts";
import type { ExecuteAgentRunInput } from "./agent/context.ts";
import { scheduleAgentRunPrewarm } from "./agent/prewarm.ts";
import {
  assertImageProviderConfigured,
  getRuntimeProviderConfiguration,
} from "./provider-config.ts";
import { importAgentSkillZip } from "./agent/skills/skill-import.ts";
import {
  listActivatedSkillResources,
  readActivatedSkillResourceBytes,
} from "./agent/skills/skill-resources.ts";
import { parseAgentSkillMarkdown } from "./agent/skills/skill-parser.ts";
import { invalidateAgentSkillRegistryCache } from "./agent/skills/skill-registry.ts";
import {
  createSessionToken,
  hashPassword,
  hashSessionToken,
  normalizeUsername,
  verifyPassword,
} from "./auth.ts";
import {
  claimUnownedProjects,
  createAgentSkillDefinition,
  createSession,
  createUser,
  deleteSession,
  getAgentSkillDefinition,
  getAgentArtifactForUser,
  getSessionUser,
  getUserByUsername,
  getUserCount,
  isSupabaseConfigured,
  listAgentEventsForUser,
  listAgentSkillDefinitions,
  listProjects,
  softDeleteAgentSkillDefinition,
  softDeleteProject,
  updateAgentSkillDefinition,
  upsertAgentSkillDefinitionByName,
  type AgentSkillDefinition,
  type AppUser,
} from "./supabase.ts";
import {
  applyCanvasPatchForUser,
  createProjectForUser,
  getProjectMetaForUser,
  loadCanvasSnapshotForUser,
  updateProjectMetaForUser,
  ProjectVersionConflictError,
  type CanvasProject,
  type ProjectMeta,
} from "./canvas-store.ts";
import {
  ArtifactVersionConflictError,
  createTextArtifactContentForUser,
  getTextArtifactContentForUser,
  upsertTextArtifactContentForUser,
} from "./artifact-content-store.ts";
import {
  createSignedAssetUpload,
  completeSignedAssetUpload,
  downloadAgentSkillPackage,
  isObjectStorageConfigured,
  MAX_AGENT_ASSET_BYTES,
  readArtifactContent,
  getArtifactStorageContentRef,
  resolveStorageBackedImageContext,
  storeGeneratedImageFromBytes,
  storeAgentSkillPackage,
  storeGeneratedImageFromUrl,
} from "./storage.ts";
import {
  createImageMattingArtifactId,
  runImageMatting,
} from "./agent/tools/image/image-matting-provider.ts";

loadServerEnv();

const app = new Hono();
const activeAgentRuns = new Map<string, ActiveAgentRun>();
const sessionCookieName = "cucumber_session";
const SESSION_USER_CACHE_TTL_MS = 60 * 1000;
const UPLOAD_PROJECT_CACHE_TTL_MS = 15 * 1000;

type AgentRunStreamPart = Parameters<UIMessageStreamWriter<UIMessage>["write"]>[0];

type ActiveAgentRun = {
  controller: AbortController;
  promise: Promise<void>;
  streamParts: AgentRunStreamPart[];
  subscribers: Set<UIMessageStreamWriter<UIMessage>>;
};

const sessionUserCache = new Map<
  string,
  {
    expiresAt: number;
    user: AppUser;
  }
>();
const uploadProjectCache = new Map<
  string,
  {
    expiresAt: number;
    project: ProjectMeta;
  }
>();

const authInputSchema = z.object({
  username: z.string().trim().min(1).max(80),
  password: z.string().min(1).max(200),
});

const imageAspectRatioSchema = z.enum(["1:1", "16:9", "9:16", "4:3", "3:4"]);
const imageResultCountSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);

const canvasContextSchema = z.object({
  forcedSkillId: z.string().uuid().optional(),
  forcedSkillName: z.string().trim().min(1).max(120).optional(),
  imageAspectRatio: imageAspectRatioSchema.optional(),
  imageResultCount: imageResultCountSchema.optional(),
  imageProvider: z.enum(["byteartist", "seed5_duotu_zz"]).optional(),
  inputMode: z.enum(["agent", "image"]).optional(),
  prompt: z.string().trim().min(1),
  promptNodeId: z.string().nullable().optional(),
  retryFrom: z
    .object({
      failedRunNodeId: z.string().trim().min(1).max(260),
      stepId: z.string().trim().min(1).max(260).optional(),
    })
    .nullable()
    .optional(),
  selectedNodeId: z.string().nullable().optional(),
  selectedNodeIds: z.array(z.string()).optional(),
});

const projectCreateSchema = z.object({
  title: z.string().trim().min(1).max(120).default("Untitled"),
});

const projectPatchSchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    selectedNodeId: z.string().nullable().optional(),
    lastRunId: z.string().nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "No project updates provided.",
  });

const canvasPatchPayloadSchema = z.object({
  expectedVersion: z.number().int().nonnegative().optional(),
  nodeUpserts: z.array(z.unknown()).optional(),
  nodeDeletes: z.array(z.string()).optional(),
  edgeUpserts: z.array(z.unknown()).optional(),
  edgeDeletes: z.array(z.string()).optional(),
  selectedNodeId: z.string().nullable().optional(),
  lastRunId: z.string().nullable().optional(),
});

const canvasPatchSaveSchema = canvasPatchPayloadSchema
  .refine((value) => Object.keys(value).length > 0, {
    message: "No canvas updates provided.",
  });

const uploadAssetKindSchema = z.enum([
  "image",
  "markdown",
  "code",
  "document",
  "webpage",
  "dataset",
  "file",
]);

const uploadSignSchema = z.object({
  fileName: z.string().trim().min(1).max(260),
  mimeType: z.string().trim().max(160).optional(),
  sizeBytes: z.number().int().nonnegative().max(MAX_AGENT_ASSET_BYTES),
});

const uploadCompleteSchema = z.object({
  bucket: z.string().trim().min(1),
  fileName: z.string().trim().min(1).max(260),
  height: z.number().int().positive().optional(),
  kind: uploadAssetKindSchema,
  mimeType: z.string().trim().max(160).default("application/octet-stream"),
  path: z.string().trim().min(1).max(1024),
  preview: z.string().trim().max(5000).optional(),
  sizeBytes: z.number().int().nonnegative().max(MAX_AGENT_ASSET_BYTES),
  summary: z.string().trim().max(500).optional(),
  title: z.string().trim().min(1).max(260).optional(),
  width: z.number().int().positive().optional(),
});

const imageUpscaleSchema = z.object({
  expectedVersion: z.number().int().nonnegative().optional(),
  resolution: z.enum(["4k", "8k"]).default("4k"),
  scale: z.number().int().min(0).max(100).default(50),
  sourceNodeId: z.string().trim().min(1).max(260),
});

const imageMattingSchema = z.object({
  background: z.enum(["transparent", "white", "neutral"]).default("transparent"),
  expectedVersion: z.number().int().nonnegative().optional(),
  sourceNodeId: z.string().trim().min(1).max(260),
});

const textArtifactTypeSchema = z.enum([
  "doc",
  "code",
  "webpage",
  "tool_result",
  "decision",
  "memory",
]);

const artifactContentFormatSchema = z.enum([
  "markdown-json",
  "markdown",
  "code",
  "html",
  "text",
  "tool-result-json",
]);

const artifactPreviewKindSchema = z.enum([
  "image",
  "markdown",
  "code",
  "document",
  "webpage",
  "dataset",
  "file",
  "decision",
  "memory",
  "toolResult",
]);

const textArtifactCreateSchema = z.object({
  contentFormat: artifactContentFormatSchema,
  contentJson: z.unknown().optional(),
  contentText: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  mimeType: z.string().trim().min(1).max(200),
  plainText: z.string().optional(),
  previewKind: artifactPreviewKindSchema.optional(),
  previewText: z.string().max(5000).optional(),
  summary: z.string().max(1000).optional(),
  title: z.string().trim().min(1).max(260),
  type: textArtifactTypeSchema,
});

const textArtifactUpdateSchema = textArtifactCreateSchema.partial({
  title: true,
  type: true,
}).extend({
  contentFormat: artifactContentFormatSchema,
  expectedVersion: z.number().int().nonnegative().optional(),
  mimeType: z.string().trim().min(1).max(200),
});

const skillDefinitionScopeSchema = z.string().trim().min(1).max(80);
const skillDefinitionPurposeSchema = z.string().trim().min(1).max(80);

const skillCreateSchema = z.object({
  agentScope: skillDefinitionScopeSchema.optional(),
  enabled: z.boolean().default(true),
  purpose: skillDefinitionPurposeSchema.optional(),
  skillMd: z.string().trim().min(1).max(60_000),
});

const skillUpdateSchema = z
  .object({
    agentScope: skillDefinitionScopeSchema.optional(),
    enabled: z.boolean().optional(),
    purpose: skillDefinitionPurposeSchema.optional(),
    skillMd: z.string().trim().min(1).max(60_000).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "No skill updates provided.",
  });

const skillImportSchema = z.object({
  enabled: z.boolean().default(true),
  fileName: z.string().trim().min(1).max(260),
  zipBase64: z.string().trim().min(1),
});

app.use("*", cors());

app.onError((error, c) => {
  console.error("[api]", error);
  const apiError = getApiError(error);
  return c.json({ error: apiError.message }, 500);
});

app.get("/api/health", (c) => {
  const providers = getRuntimeProviderConfiguration();
  return c.json({
    ok: true,
    agentConfigured: providers.agent.configured,
    agentProvider: providers.agent.provider,
    agentModel: providers.agent.model,
    imageConfigured: providers.image.configured,
    imageProvider: providers.image.provider,
    imageModel: providers.image.model,
    imageMattingConfigured: providers.imageMatting.configured,
    imageMattingProvider: providers.imageMatting.provider,
    imageMattingModel: providers.imageMatting.model,
    seedreamConfigured: isSeedreamConfigured(),
    cozeImageConfigured: isCozeImageConfigured(),
    byteArtistConfigured: isByteArtistConfigured(),
    videoConfigured: providers.video.configured,
    videoProvider: providers.video.provider,
    videoModel: providers.video.model,
    objectStorageConfigured: isObjectStorageConfigured(),
    objectStorageProvider: "r2",
    supabaseConfigured: isSupabaseConfigured(),
  });
});

app.post("/api/auth/register", async (c) => {
  const input = authInputSchema.parse(await c.req.json());
  const username = normalizeUsername(input.username);
  const existingUser = await getUserByUsername(username);

  if (existingUser) {
    return c.json({ error: "名称已存在" }, 409);
  }

  const usersBeforeCreate = await getUserCount();
  const user = await createUser({
    username,
    passwordHash: await hashPassword(input.password),
  });

  if (usersBeforeCreate === 0) {
    await claimUnownedProjects(user.id);
  }

  await startSession(c, user);
  return c.json({ user });
});

app.post("/api/auth/login", async (c) => {
  const input = authInputSchema.parse(await c.req.json());
  const username = normalizeUsername(input.username);
  const user = await getUserByUsername(username);

  if (!user || !(await verifyPassword(input.password, user.password_hash))) {
    return c.json({ error: "名称或密码不正确" }, 401);
  }

  const publicUser = {
    id: user.id,
    username: user.username,
    createdAt: user.created_at,
  } satisfies AppUser;

  await startSession(c, publicUser);
  return c.json({ user: publicUser });
});

app.post("/api/auth/logout", async (c) => {
  const token = getCookie(c, sessionCookieName);
  if (token) {
    const tokenHash = hashSessionToken(token);
    await deleteSession(tokenHash);
    sessionUserCache.delete(tokenHash);
  }

  clearSessionCookie(c);
  return c.json({ ok: true });
});

app.get("/api/auth/me", async (c) => {
  const user = await getOptionalUser(c);
  return c.json({ user });
});

app.get("/api/projects", async (c) => {
  const user = await requireUser(c);
  if (!user) {
    return unauthorized(c);
  }

  const projects = await listProjects(user.id);
  return c.json({ projects });
});

app.get("/api/agent-skills", async (c) => {
  const user = await requireUser(c);
  if (!user) {
    return unauthorized(c);
  }

  const skills = await listAgentSkillDefinitions();
  return c.json({ skills });
});

app.get("/api/agent-skills/:skillId/resources/content", async (c) => {
  const user = await requireUser(c);
  if (!user) {
    return unauthorized(c);
  }

  const skillId = z.string().uuid().parse(c.req.param("skillId"));
  const resourcePath = z.string().trim().min(1).max(1024).parse(c.req.query("path"));
  const skill = await getAgentSkillDefinition(skillId);
  if (!skill) {
    return c.json({ error: "Skill 不存在" }, 404);
  }

  const resource = await readActivatedSkillResourceBytes({
    resourcePath,
    skill,
  });
  const headers = new Headers({
    "Cache-Control": "private, max-age=300",
    "Content-Length": String(resource.sizeBytes),
    "Content-Type": resource.mimeType,
  });
  return new Response(resource.bytes, { headers });
});

app.get("/api/agent-skills/:skillId/resources", async (c) => {
  const user = await requireUser(c);
  if (!user) {
    return unauthorized(c);
  }

  const skillId = z.string().uuid().parse(c.req.param("skillId"));
  const skill = await getAgentSkillDefinition(skillId);
  if (!skill) {
    return c.json({ error: "Skill 不存在" }, 404);
  }

  const resources = await listActivatedSkillResources(skill);
  return c.json({ resources });
});

app.get("/api/agent-skills/:skillId/package", async (c) => {
  const user = await requireUser(c);
  if (!user) {
    return unauthorized(c);
  }

  const skillId = z.string().uuid().parse(c.req.param("skillId"));
  const skill = await getAgentSkillDefinition(skillId);
  if (!skill) {
    return c.json({ error: "Skill 不存在" }, 404);
  }

  const bytes = await buildAgentSkillSourcePackage(skill);
  const filename = `${sanitizeDownloadFileName(skill.name || "agent-skill")}.zip`;
  const headers = new Headers({
    "Cache-Control": "private, max-age=300",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Content-Length": String(bytes.byteLength),
    "Content-Type": "application/zip",
  });
  return new Response(bytes, { headers });
});

app.get("/api/agent-skills/:skillId", async (c) => {
  const user = await requireUser(c);
  if (!user) {
    return unauthorized(c);
  }

  const skillId = z.string().uuid().parse(c.req.param("skillId"));
  const skill = await getAgentSkillDefinition(skillId);
  if (!skill) {
    return c.json({ error: "Skill 不存在" }, 404);
  }

  return c.json({ skill });
});

app.post("/api/agent-skills", async (c) => {
  const user = await requireUser(c);
  if (!user) {
    return unauthorized(c);
  }

  const input = skillCreateSchema.parse(await c.req.json());
  const parsed = parseAgentSkillMarkdown(input.skillMd);
  if (parsed.scripts.length) {
    return c.json({ error: "带脚本的技能必须通过 zip 包导入。" }, 400);
  }
  const skill = await createAgentSkillDefinition({
    agentScope: input.agentScope ?? parsed.agentScope,
    body: parsed.body,
    bindings: parsed.bindings,
    createdBy: user.id,
    description: parsed.description,
    enabled: input.enabled,
    frontmatter: parsed.frontmatter,
    name: parsed.name,
    purpose: input.purpose ?? parsed.purpose,
    scripts: parsed.scripts,
    skillMd: parsed.skillMd,
    sourceManifest: { source: "manual" },
    sourceType: "manual",
    tags: parsed.tags,
    triggers: parsed.triggers,
  });
  invalidateAgentSkillRegistryCache();

  return c.json({ skill });
});

app.post("/api/agent-skills/import", async (c) => {
  const user = await requireUser(c);
  if (!user) {
    return unauthorized(c);
  }

  const input = skillImportSchema.parse(await c.req.json());
  const imported = await importAgentSkillZip(
    Buffer.from(input.zipBase64, "base64"),
    input.fileName
  );
  const packageLocation = await storeAgentSkillPackage({
    bytes: imported.packageBytes,
    packageSha256: imported.packageSha256,
    skillName: imported.name,
  });
  const skill = await upsertAgentSkillDefinitionByName({
    agentScope: imported.agentScope,
    body: imported.body,
    bindings: imported.bindings,
    createdBy: user.id,
    description: imported.description,
    enabled: input.enabled,
    frontmatter: imported.frontmatter,
    name: imported.name,
    packageBucket: packageLocation.bucket,
    packagePath: packageLocation.path,
    packageSha256: imported.packageSha256,
    packageSizeBytes: imported.packageSizeBytes,
    purpose: imported.purpose,
    scripts: imported.scripts,
    skillMd: imported.skillMd,
    sourceManifest: {
      ...imported.sourceManifest,
      packageBucket: packageLocation.bucket,
    },
    sourceType: "zip",
    tags: imported.tags,
    triggers: imported.triggers,
  });
  invalidateAgentSkillRegistryCache();

  return c.json({ skill });
});

app.patch("/api/agent-skills/:skillId", async (c) => {
  const user = await requireUser(c);
  if (!user) {
    return unauthorized(c);
  }

  const skillId = z.string().uuid().parse(c.req.param("skillId"));
  const input = skillUpdateSchema.parse(await c.req.json());
  const parsed = input.skillMd ? parseAgentSkillMarkdown(input.skillMd) : null;
  if (parsed?.scripts.length) {
    return c.json({ error: "带脚本的技能必须通过 zip 包导入。" }, 400);
  }
  const skill = await updateAgentSkillDefinition({
    id: skillId,
    agentScope: input.agentScope ?? parsed?.agentScope,
    body: parsed?.body,
    bindings: parsed?.bindings,
    description: parsed?.description,
    enabled: input.enabled,
    frontmatter: parsed?.frontmatter,
    name: parsed?.name,
    purpose: input.purpose ?? parsed?.purpose,
    scripts: parsed?.scripts,
    skillMd: parsed?.skillMd,
    sourceManifest: parsed ? { source: "manual_edit" } : undefined,
    sourceType: parsed ? "manual" : undefined,
    tags: parsed?.tags,
    triggers: parsed?.triggers,
  });
  if (!skill) {
    return c.json({ error: "Skill 不存在" }, 404);
  }
  invalidateAgentSkillRegistryCache();

  return c.json({ skill });
});

app.delete("/api/agent-skills/:skillId", async (c) => {
  const user = await requireUser(c);
  if (!user) {
    return unauthorized(c);
  }

  const skillId = z.string().uuid().parse(c.req.param("skillId"));
  const deleted = await softDeleteAgentSkillDefinition(skillId);
  if (!deleted) {
    return c.json({ error: "Skill 不存在" }, 404);
  }
  invalidateAgentSkillRegistryCache();

  return c.json({ ok: true });
});

app.post("/api/projects", async (c) => {
  const user = await requireUser(c);
  if (!user) {
    return unauthorized(c);
  }

  const input = projectCreateSchema.parse(await c.req.json());
  const project = await createProjectForUser(user.id, input.title);
  cacheUploadProjectMeta(user.id, project);
  return c.json({ project });
});

app.get("/api/projects/:projectId", async (c) => {
  const user = await requireUser(c);
  if (!user) {
    return unauthorized(c);
  }

  const projectId = z.string().uuid().parse(c.req.param("projectId"));
  const result = await loadCanvasSnapshotForUser(projectId, user.id);
  if (!result) {
    return notFound(c);
  }
  scheduleAgentRunPrewarm();

  const { edges, nodes, ...project } = result;
  cacheUploadProjectMeta(user.id, project);
  return c.json({ edges, nodes, project });
});

app.patch("/api/projects/:projectId", async (c) => {
  const user = await requireUser(c);
  if (!user) {
    return unauthorized(c);
  }

  const projectId = z.string().uuid().parse(c.req.param("projectId"));
  const input = projectPatchSchema.parse(await c.req.json());

  const project = await updateProjectMetaForUser({
    projectId,
    userId: user.id,
    title: input.title,
    selectedNodeId: input.selectedNodeId,
    lastRunId: input.lastRunId,
  });

  if (!project) {
    return notFound(c);
  }

  cacheUploadProjectMeta(user.id, project);
  return c.json({ project });
});

app.patch("/api/projects/:projectId/canvas", async (c) => {
  const user = await requireUser(c);
  if (!user) {
    return unauthorized(c);
  }

  const projectId = z.string().uuid().parse(c.req.param("projectId"));
  const input = canvasPatchSaveSchema.parse(await c.req.json());

  try {
    const project = await applyCanvasPatchForUser({
      projectId,
      userId: user.id,
      expectedVersion: input.expectedVersion,
      nodeUpserts: input.nodeUpserts as AgentCanvasNode[] | undefined,
      nodeDeletes: input.nodeDeletes,
      edgeUpserts: input.edgeUpserts as AgentCanvasEdge[] | undefined,
      edgeDeletes: input.edgeDeletes,
      selectedNodeId: input.selectedNodeId,
      lastRunId: input.lastRunId,
    });

    if (!project) {
      return notFound(c);
    }

    cacheUploadProjectMeta(user.id, project);
    return c.json({ project });
  } catch (error) {
    if (error instanceof ProjectVersionConflictError) {
      return c.json(
        { error: error.message, code: "version_conflict", project: error.project },
        409
      );
    }
    throw error;
  }
});

app.delete("/api/projects/:projectId", async (c) => {
  const user = await requireUser(c);
  if (!user) {
    return unauthorized(c);
  }

  const projectId = z.string().uuid().parse(c.req.param("projectId"));
  const deleted = await softDeleteProject(projectId, user.id);
  if (!deleted) {
    return notFound(c);
  }

  deleteCachedUploadProjectMeta(user.id, projectId);
  return c.json({ ok: true });
});

app.get("/api/projects/:projectId/runs/:runNodeId/trace", async (c) => {
  const user = await requireUser(c);
  if (!user) {
    return unauthorized(c);
  }

  const projectId = z.string().uuid().parse(c.req.param("projectId"));
  const runNodeId = z.string().min(1).parse(c.req.param("runNodeId"));
  const events = await listAgentEventsForUser({
    projectId,
    runNodeId,
    userId: user.id,
  });

  if (!events) {
    return notFound(c);
  }

  return c.json({ events });
});

app.post("/api/projects/:projectId/uploads/sign", async (c) => {
  const totalStartedAt = performance.now();
  const authStartedAt = performance.now();
  const user = await requireUser(c);
  const authMs = elapsedApiMs(authStartedAt);
  if (!user) {
    return unauthorized(c);
  }

  const projectId = z.string().uuid().parse(c.req.param("projectId"));
  const projectStartedAt = performance.now();
  const { cacheHit: projectCacheHit, project } =
    await getCachedUploadProjectMetaForUser(projectId, user.id);
  const projectMs = elapsedApiMs(projectStartedAt);
  if (!project) {
    return notFound(c);
  }

  const parseStartedAt = performance.now();
  const input = uploadSignSchema.parse(await c.req.json());
  const parseMs = elapsedApiMs(parseStartedAt);
  const signUrlStartedAt = performance.now();
  const upload = await createSignedAssetUpload({
    fileName: input.fileName,
    mimeType: input.mimeType,
    projectId,
    sizeBytes: input.sizeBytes,
  });
  const signUrlMs = elapsedApiMs(signUrlStartedAt);

  console.info("[upload:sign-route]", {
    authMs,
    fileName: input.fileName,
    parseMs,
    projectCacheHit,
    projectMs,
    signUrlMs,
    sizeBytes: input.sizeBytes,
    totalMs: elapsedApiMs(totalStartedAt),
    uploadId: upload.uploadId,
  });

  return c.json({ upload });
});

app.post("/api/projects/:projectId/uploads/:uploadId/complete", async (c) => {
  const totalStartedAt = performance.now();
  const authStartedAt = performance.now();
  const user = await requireUser(c);
  const authMs = elapsedApiMs(authStartedAt);
  if (!user) {
    return unauthorized(c);
  }

  const projectId = z.string().uuid().parse(c.req.param("projectId"));
  const uploadId = z.string().uuid().parse(c.req.param("uploadId"));
  const projectStartedAt = performance.now();
  const { cacheHit: projectCacheHit, project } =
    await getCachedUploadProjectMetaForUser(projectId, user.id);
  const projectMs = elapsedApiMs(projectStartedAt);
  if (!project) {
    return notFound(c);
  }

  const parseStartedAt = performance.now();
  const input = uploadCompleteSchema.parse(await c.req.json());
  const parseMs = elapsedApiMs(parseStartedAt);
  const completeStartedAt = performance.now();
  const artifact = await completeSignedAssetUpload({
    bucket: input.bucket,
    fileName: input.fileName,
    height: input.height,
    kind: input.kind,
    mimeType: input.mimeType,
    path: input.path,
    preview: input.preview,
    projectId,
    sizeBytes: input.sizeBytes,
    summary: input.summary,
    title: input.title,
    uploadId,
    userId: user.id,
    width: input.width,
  });
  const completeCoreMs = elapsedApiMs(completeStartedAt);

  console.info("[upload:complete-route]", {
    artifactId: artifact.id,
    authMs,
    completeCoreMs,
    fileName: input.fileName,
    kind: input.kind,
    parseMs,
    projectCacheHit,
    projectMs,
    sizeBytes: input.sizeBytes,
    totalMs: elapsedApiMs(totalStartedAt),
    uploadId,
  });

  return c.json({
    artifact,
    nodeData: {
      artifact,
      summary: artifact.metadata?.summary,
      title: artifact.title,
    },
  });
});

app.post("/api/projects/:projectId/images/upscale", async (c) => {
  const user = await requireUser(c);
  if (!user) {
    return unauthorized(c);
  }

  const projectId = z.string().uuid().parse(c.req.param("projectId"));
  const input = imageUpscaleSchema.parse(await c.req.json());
  const project = await loadCanvasSnapshotForUser(projectId, user.id);
  if (!project) {
    return notFound(c);
  }

  try {
    assertImageProviderConfigured("upscale");
  } catch (error) {
    return c.json(
      {
        error: getErrorMessage(error),
      },
      503
    );
  }

  const sourceNode = project.nodes.find((node) => node.id === input.sourceNodeId);
  const sourceCheck = getUpscaleSourceImage(sourceNode);
  if (!sourceCheck.ok) {
    return c.json({ error: sourceCheck.error }, 400);
  }

  const sourceNodeId = sourceCheck.node.id;
  const [{ imageUrl }] = await resolveStorageBackedImageContext([
    {
      artifact: sourceCheck.artifact,
      contentRef: sourceCheck.artifact.contentRef,
      imageUrl: sourceCheck.artifact.uri ?? sourceCheck.image.url,
      nodeId: sourceNodeId,
      prompt: sourceCheck.prompt,
      type: "image",
    },
  ]);

  if (!imageUrl) {
    return c.json({ error: "无法为选中图片生成服务端可读 URL。" }, 400);
  }

  const artifacts: ArtifactRef[] = [];
  await upscaleSeedreamImage(
    {
      imageUrl,
      onImage: async (image) => {
        const storedArtifact = await storeGeneratedImageFromUrl({
          artifactId: image.id,
          metadata: {
            ...image.metadata,
            sourceArtifactId: sourceCheck.artifact.id,
            sourceNodeId,
            operation: "upscale",
          },
          projectId,
          signal: c.req.raw.signal,
          sourceToolName: "upscale_image",
          sourceNodeId,
          sourceUrl: image.url,
          title: image.title,
          userId: user.id,
        });
        artifacts.push(storedArtifact);
      },
      resolution: input.resolution,
      scale: input.scale,
      signal: c.req.raw.signal,
    },
    readSeedreamUpscaleConfigFromEnv()
  );

  const artifact = artifacts[0];
  if (!artifact?.uri) {
    throw new Error("Seedream upscale did not produce a stored image artifact.");
  }
  const storedArtifact = { ...artifact, uri: artifact.uri };

  const { node, edge, canvasPatch } = createUpscaleCanvasPatch({
    artifact: storedArtifact,
    resolution: input.resolution,
    scale: input.scale,
    sourceNode: sourceCheck.node,
  });

  try {
    const updatedProject = await applyCanvasPatchForUser({
      edgeUpserts: canvasPatch.edgeUpserts,
      expectedVersion: input.expectedVersion,
      nodeUpserts: canvasPatch.nodeUpserts,
      projectId,
      selectedNodeId: node.id,
      userId: user.id,
    });
    if (!updatedProject) {
      return notFound(c);
    }

    return c.json({
      artifact,
      canvasPatch,
      edge,
      node,
      project: updatedProject,
    });
  } catch (error) {
    if (error instanceof ProjectVersionConflictError) {
      const updatedProject = await applyCanvasPatchForUser({
        edgeUpserts: canvasPatch.edgeUpserts,
        expectedVersion: error.project.version,
        nodeUpserts: canvasPatch.nodeUpserts,
        projectId,
        selectedNodeId: node.id,
        userId: user.id,
      });
      if (!updatedProject) {
        return notFound(c);
      }
      return c.json({
        artifact,
        canvasPatch,
        edge,
        node,
        project: updatedProject,
      });
    }
    throw error;
  }
});

app.post("/api/projects/:projectId/images/matting", async (c) => {
  const user = await requireUser(c);
  if (!user) {
    return unauthorized(c);
  }

  const projectId = z.string().uuid().parse(c.req.param("projectId"));
  const input = imageMattingSchema.parse(await c.req.json());
  const project = await loadCanvasSnapshotForUser(projectId, user.id);
  if (!project) {
    return notFound(c);
  }

  try {
    assertImageProviderConfigured("matting");
  } catch (error) {
    return c.json(
      {
        error: getErrorMessage(error),
      },
      503
    );
  }

  const sourceNode = project.nodes.find((node) => node.id === input.sourceNodeId);
  const sourceCheck = getImageProcessingSourceImage(sourceNode, "matting");
  if (!sourceCheck.ok) {
    return c.json({ error: sourceCheck.error }, 400);
  }

  const sourceNodeId = sourceCheck.node.id;
  const [{ imageUrl }] = await resolveStorageBackedImageContext([
    {
      artifact: sourceCheck.artifact,
      contentRef: sourceCheck.artifact.contentRef,
      imageUrl: sourceCheck.artifact.uri ?? sourceCheck.image.url,
      nodeId: sourceNodeId,
      prompt: sourceCheck.prompt,
      type: "image",
    },
  ]);

  if (!imageUrl) {
    return c.json({ error: "无法为选中图片生成服务端可读 URL。" }, 400);
  }

  const mattingResult = await runImageMatting({
    background: input.background,
    signal: c.req.raw.signal,
    sourceUrl: imageUrl,
  });
  const artifact = await storeGeneratedImageFromBytes({
    artifactId: createImageMattingArtifactId(),
    bytes: mattingResult.bytes,
    metadata: {
      ...mattingResult.metadata,
      background: input.background,
      engine: mattingResult.engine,
      operation: "matting",
      provider: mattingResult.provider,
      sourceArtifactId: sourceCheck.artifact.id,
      sourceNodeId,
    },
    mimeType: mattingResult.mimeType,
    projectId,
    signal: c.req.raw.signal,
    sourceNodeId,
    sourceToolName: "image_matting",
    title: input.background === "transparent" ? "透明底抠图" : "抠图结果",
    userId: user.id,
  });
  if (!artifact.uri) {
    throw new Error("Image matting did not produce a stored image artifact.");
  }
  const storedArtifact = { ...artifact, uri: artifact.uri };

  const { node, edge, canvasPatch } = createMattingCanvasPatch({
    artifact: storedArtifact,
    background: input.background,
    sourceNode: sourceCheck.node,
  });

  try {
    const updatedProject = await applyCanvasPatchForUser({
      edgeUpserts: canvasPatch.edgeUpserts,
      expectedVersion: input.expectedVersion,
      nodeUpserts: canvasPatch.nodeUpserts,
      projectId,
      selectedNodeId: node.id,
      userId: user.id,
    });
    if (!updatedProject) {
      return notFound(c);
    }

    return c.json({
      artifact,
      canvasPatch,
      edge,
      node,
      project: updatedProject,
    });
  } catch (error) {
    if (error instanceof ProjectVersionConflictError) {
      const updatedProject = await applyCanvasPatchForUser({
        edgeUpserts: canvasPatch.edgeUpserts,
        expectedVersion: error.project.version,
        nodeUpserts: canvasPatch.nodeUpserts,
        projectId,
        selectedNodeId: node.id,
        userId: user.id,
      });
      if (!updatedProject) {
        return notFound(c);
      }
      return c.json({
        artifact,
        canvasPatch,
        edge,
        node,
        project: updatedProject,
      });
    }
    throw error;
  }
});

app.post("/api/projects/:projectId/artifacts/text", async (c) => {
  const user = await requireUser(c);
  if (!user) {
    return unauthorized(c);
  }

  const projectId = z.string().uuid().parse(c.req.param("projectId"));
  const input = textArtifactCreateSchema.parse(await c.req.json());
  const artifact = await createTextArtifactContentForUser({
    contentFormat: input.contentFormat,
    contentJson: input.contentJson,
    contentText: input.contentText,
    metadata: input.metadata,
    mimeType: input.mimeType,
    plainText: input.plainText,
    previewKind: input.previewKind,
    previewText: input.previewText,
    projectId,
    summary: input.summary,
    title: input.title,
    type: input.type,
    userId: user.id,
  });

  if (!artifact) {
    return notFound(c);
  }

  return c.json({ artifact });
});

app.put("/api/projects/:projectId/artifacts/:artifactId/content", async (c) => {
  const user = await requireUser(c);
  if (!user) {
    return unauthorized(c);
  }

  const projectId = z.string().uuid().parse(c.req.param("projectId"));
  const artifactId = z.string().min(1).max(260).parse(c.req.param("artifactId"));
  const input = textArtifactUpdateSchema.parse(await c.req.json());

  try {
    const artifact = await upsertTextArtifactContentForUser({
      artifactId,
      contentFormat: input.contentFormat,
      contentJson: input.contentJson,
      contentText: input.contentText,
      expectedVersion: input.expectedVersion,
      metadata: input.metadata,
      mimeType: input.mimeType,
      plainText: input.plainText,
      previewKind: input.previewKind,
      previewText: input.previewText,
      projectId,
      summary: input.summary,
      title: input.title,
      type: input.type,
      userId: user.id,
    });

    if (!artifact) {
      return notFound(c);
    }

    return c.json({ artifact });
  } catch (error) {
    if (error instanceof ArtifactVersionConflictError) {
      return c.json(
        {
          artifact: error.artifact,
          code: "artifact_version_conflict",
          error: error.message,
        },
        409
      );
    }
    throw error;
  }
});

app.get("/api/projects/:projectId/artifacts/:artifactId/content", async (c) => {
  const user = await requireUser(c);
  if (!user) {
    return unauthorized(c);
  }

  const projectId = z.string().uuid().parse(c.req.param("projectId"));
  const artifactId = z.string().min(1).max(260).parse(c.req.param("artifactId"));
  const textContent = await getTextArtifactContentForUser({
    artifactId,
    projectId,
    userId: user.id,
  });

  if (textContent) {
    return c.json(textContent);
  }

  const artifact = await getAgentArtifactForUser({
    artifactId,
    projectId,
    userId: user.id,
  });

  if (!artifact) {
    return notFound(c);
  }

  const content = await readArtifactContent(artifact);
  const headers = new Headers({
    "Cache-Control": "private, max-age=300",
    "Content-Length": String(content.sizeBytes),
    "Content-Type": content.mimeType,
  });
  return new Response(content.bytes, { headers });
});

app.delete("/api/agent-run", async (c) => {
  const user = await requireUser(c);
  if (!user) {
    return unauthorized(c);
  }

  const projectId = z.string().uuid().parse(c.req.query("projectId"));
  const runNodeId = z.string().min(1).parse(c.req.query("runNodeId"));
  const project = await getProjectMetaForUser(projectId, user.id);
  if (!project) {
    return notFound(c);
  }

  const controller = activeAgentRuns.get(
    getActiveAgentRunKey(user.id, projectId, runNodeId)
  )?.controller;
  controller?.abort();
  return c.json({ stopped: Boolean(controller) });
});

app.post("/api/agent-run", async (c) => {
  const user = await requireUser(c);
  if (!user) {
    return unauthorized(c);
  }

  const body = await c.req.json();
  const messages = (body.messages ?? []) as UIMessage[];
  const parsedCanvasContext = canvasContextSchema.parse(body.canvasContext ?? {});
  const parsedCanvasPatchInput = body.canvasPatch
    ? canvasPatchPayloadSchema.parse(body.canvasPatch)
    : null;
  const parsedCanvasPatch =
    parsedCanvasPatchInput && hasCanvasPatchPayloadUpdates(parsedCanvasPatchInput)
      ? parsedCanvasPatchInput
      : null;
  const projectId = z.string().uuid().parse(body.projectId);
  const runNodeId = z.string().min(1).parse(body.runNodeId);
  const activeRunKey = getActiveAgentRunKey(user.id, projectId, runNodeId);
  const existingRun = activeAgentRuns.get(activeRunKey);
  if (existingRun) {
    return createAgentRunStreamResponse(existingRun, messages);
  }

  const selectedNodeIds = normalizeSelectedNodeIdsForRun(
    parsedCanvasContext.selectedNodeIds,
    parsedCanvasContext.selectedNodeId ?? null
  );
  const project = parsedCanvasPatch
    ? await applyAgentRunCanvasPatchAndLoadSnapshot({
        canvasPatch: parsedCanvasPatch,
        projectId,
        userId: user.id,
      })
    : await waitForProjectSnapshotForRun({
        projectId,
        promptNodeId: parsedCanvasContext.promptNodeId ?? null,
        runNodeId,
        selectedNodeIds,
        signal: c.req.raw.signal,
        userId: user.id,
      });

  if (!project) {
    return notFound(c);
  }
  if (
    !hasAgentRunSnapshot(project, {
      promptNodeId: parsedCanvasContext.promptNodeId ?? null,
      runNodeId,
      selectedNodeIds,
    })
  ) {
    return c.json({ error: "项目快照尚未保存完成，请稍后重试。" }, 409);
  }
  const retryFrom = await resolveRetryContext({
    project,
    retryFrom: parsedCanvasContext.retryFrom,
    userId: user.id,
  });
  const canvasContext = {
    ...parsedCanvasContext,
    retryFrom,
  };

  if (project.lastRunId !== runNodeId) {
    void updateProjectMetaForUser({
      projectId,
      userId: user.id,
      lastRunId: runNodeId,
    }).catch((error: unknown) => {
      console.error("[agent-run:last-run]", error);
    });
  }

  const activeRun = startActiveAgentRun({
    activeRunKey,
    input: {
      canvasContext,
      projectId,
      projectSnapshot: project,
      runNodeId,
      canvasPatchApplied: Boolean(parsedCanvasPatch),
      userId: user.id,
    },
  });
  return createAgentRunStreamResponse(activeRun, messages);
});

function startActiveAgentRun({
  activeRunKey,
  input,
}: {
  activeRunKey: string;
  input: Omit<ExecuteAgentRunInput, "signal" | "writer">;
}) {
  const controller = new AbortController();
  const activeRun: ActiveAgentRun = {
    controller,
    promise: Promise.resolve(),
    streamParts: [],
    subscribers: new Set(),
  };
  const writer = createActiveAgentRunWriter(activeRun);

  activeAgentRuns.set(activeRunKey, activeRun);
  activeRun.promise = executeAgentRun({
    ...input,
    signal: controller.signal,
    writer,
  })
    .catch((error: unknown) => {
      console.error("[agent-run:background]", error);
      throw error;
    })
    .finally(() => {
      if (activeAgentRuns.get(activeRunKey) === activeRun) {
        activeAgentRuns.delete(activeRunKey);
      }
    });
  void activeRun.promise.catch(() => undefined);
  return activeRun;
}

function createActiveAgentRunWriter(activeRun: ActiveAgentRun) {
  return {
    write(part: AgentRunStreamPart) {
      activeRun.streamParts.push(part);
      for (const subscriber of activeRun.subscribers) {
        if (!safeWriteAgentRunStreamPart(subscriber, part)) {
          activeRun.subscribers.delete(subscriber);
        }
      }
    },
  } as UIMessageStreamWriter<UIMessage>;
}

function createAgentRunStreamResponse(
  activeRun: ActiveAgentRun,
  messages: UIMessage[]
) {
  const stream = createUIMessageStream({
    originalMessages: messages,
    execute: async ({ writer }) => {
      const unsubscribe = subscribeToActiveAgentRun(activeRun, writer);
      try {
        await activeRun.promise;
      } finally {
        unsubscribe();
      }
    },
    onError: getErrorMessage,
  });

  return createUIMessageStreamResponse({ stream });
}

function subscribeToActiveAgentRun(
  activeRun: ActiveAgentRun,
  writer: UIMessageStreamWriter<UIMessage>
) {
  activeRun.subscribers.add(writer);
  for (const part of activeRun.streamParts) {
    safeWriteAgentRunStreamPart(writer, part);
  }

  return () => {
    activeRun.subscribers.delete(writer);
  };
}

function safeWriteAgentRunStreamPart(
  writer: UIMessageStreamWriter<UIMessage>,
  part: AgentRunStreamPart
) {
  try {
    writer.write(part);
    return true;
  } catch {
    // The browser may refresh or leave while the in-process run continues.
    return false;
  }
}

async function waitForProjectSnapshotForRun({
  projectId,
  promptNodeId,
  runNodeId,
  selectedNodeIds,
  signal,
  userId,
}: {
  projectId: string;
  promptNodeId: string | null;
  runNodeId: string;
  selectedNodeIds: string[];
  signal?: AbortSignal;
  userId: string;
}) {
  const deadline = Date.now() + 8_000;
  let latestProject: CanvasProject | null = null;

  while (!signal?.aborted) {
    const project = await loadCanvasSnapshotForUser(projectId, userId);
    if (!project) {
      return null;
    }
    latestProject = project;
    if (hasAgentRunSnapshot(project, { promptNodeId, runNodeId, selectedNodeIds })) {
      return project;
    }
    if (Date.now() >= deadline) {
      return latestProject;
    }
    await waitForSnapshotPoll(signal);
  }

  return latestProject;
}

async function applyAgentRunCanvasPatchAndLoadSnapshot({
  canvasPatch,
  projectId,
  userId,
}: {
  canvasPatch: z.infer<typeof canvasPatchPayloadSchema>;
  projectId: string;
  userId: string;
}) {
  const maxConflictRetries = 3;
  let expectedVersion = canvasPatch.expectedVersion;

  for (let attempt = 0; ; attempt += 1) {
    try {
      const project = await applyCanvasPatchForUser({
        projectId,
        userId,
        expectedVersion,
        nodeUpserts: canvasPatch.nodeUpserts as AgentCanvasNode[] | undefined,
        nodeDeletes: canvasPatch.nodeDeletes,
        edgeUpserts: canvasPatch.edgeUpserts as AgentCanvasEdge[] | undefined,
        edgeDeletes: canvasPatch.edgeDeletes,
        selectedNodeId: canvasPatch.selectedNodeId,
        lastRunId: canvasPatch.lastRunId,
      });
      if (!project) {
        return null;
      }
      return loadCanvasSnapshotForUser(projectId, userId);
    } catch (error) {
      if (
        error instanceof ProjectVersionConflictError &&
        attempt < maxConflictRetries
      ) {
        expectedVersion = error.project.version;
        continue;
      }
      throw error;
    }
  }
}

function hasAgentRunSnapshot(
  project: CanvasProject,
  {
    promptNodeId,
    runNodeId,
    selectedNodeIds,
  }: {
    promptNodeId: string | null;
    runNodeId: string;
    selectedNodeIds: string[];
  }
) {
  const nodeIds = new Set(project.nodes.map((node) => node.id));
  return (
    nodeIds.has(runNodeId) &&
    (!promptNodeId || nodeIds.has(promptNodeId)) &&
    selectedNodeIds.every((nodeId) => nodeIds.has(nodeId))
  );
}

function normalizeSelectedNodeIdsForRun(
  selectedNodeIds: string[] | undefined,
  selectedNodeId: string | null
) {
  const ids = new Set<string>();
  if (selectedNodeId) {
    ids.add(selectedNodeId);
  }
  for (const nodeId of selectedNodeIds ?? []) {
    if (nodeId) {
      ids.add(nodeId);
    }
  }
  return [...ids];
}

function hasCanvasPatchPayloadUpdates(
  patch: z.infer<typeof canvasPatchPayloadSchema>
) {
  return (
    (patch.nodeUpserts?.length ?? 0) > 0 ||
    (patch.nodeDeletes?.length ?? 0) > 0 ||
    (patch.edgeUpserts?.length ?? 0) > 0 ||
    (patch.edgeDeletes?.length ?? 0) > 0 ||
    "selectedNodeId" in patch ||
    "lastRunId" in patch
  );
}

function waitForSnapshotPoll(signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timeout = setTimeout(resolve, 100);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true }
    );
  });
}

async function resolveRetryContext({
  project,
  retryFrom,
  userId,
}: {
  project: CanvasProject;
  retryFrom?: { failedRunNodeId: string; stepId?: string } | null;
  userId: string;
}) {
  if (!retryFrom) {
    return null;
  }

  const failedRun = project.nodes.find(
    (node) => node.id === retryFrom.failedRunNodeId && node.data.kind === "run"
  );
  if (!failedRun || failedRun.data.kind !== "run") {
    return null;
  }

  const events = await listAgentEventsForUser({
    projectId: project.id,
    runNodeId: retryFrom.failedRunNodeId,
    userId,
  });
  const failedEvent = events
    ?.filter(
      (event) =>
        event.type === "tool.error" ||
        event.type === "skill.script.failed" ||
        event.type === "run.failed"
    )
    .findLast((event) => !retryFrom.stepId || event.stepId === retryFrom.stepId);
  if (!failedEvent) {
    return {
      failedRunNodeId: retryFrom.failedRunNodeId,
      stepId: retryFrom.stepId ?? "run",
      label: "失败步骤",
      errorText: failedRun.data.error,
    };
  }

  const toolName =
    typeof failedEvent.payload.toolName === "string"
      ? failedEvent.payload.toolName
      : undefined;
  const scriptName =
    typeof failedEvent.payload.scriptName === "string"
      ? failedEvent.payload.scriptName
      : undefined;
  const errorText =
    failedEvent.errorText ??
    (typeof failedEvent.payload.errorText === "string"
      ? failedEvent.payload.errorText
      : failedRun.data.error);

  return {
    failedRunNodeId: retryFrom.failedRunNodeId,
    stepId: failedEvent.stepId,
    label: toolName ?? scriptName ?? "失败步骤",
    toolName,
    errorText,
  };
}

function getActiveAgentRunKey(
  userId: string,
  projectId: string,
  runNodeId: string
) {
  return `${userId}:${projectId}:${runNodeId}`;
}

type ImageProcessingOperation = "matting" | "upscale";

function getImageProcessingSourceImage(
  node: AgentCanvasNode | undefined,
  operation: ImageProcessingOperation
):
  | {
      ok: true;
      artifact: ArtifactRef;
      image: GeneratedImage;
      node: AgentCanvasNode & { data: ImageResultNodeData };
      prompt: string;
    }
  | { ok: false; error: string } {
  if (!node) {
    return { ok: false, error: "图片节点不存在。" };
  }
  const operationLabel = operation === "upscale" ? "高清放大" : "抠图";
  if (node.data.kind !== "imageResult") {
    return { ok: false, error: `只能对图片节点执行${operationLabel}。` };
  }
  if ((node.data.status ?? "ready") !== "ready" || !node.data.image.url) {
    return { ok: false, error: `图片尚未准备完成，无法${operationLabel}。` };
  }

  const artifact = node.data.artifact ?? node.data.image.artifact;
  const contentRef =
    artifact && artifact.type === "image"
      ? getArtifactStorageContentRef(artifact)
      : null;
  if (!artifact || artifact.type !== "image" || !contentRef) {
    return {
      ok: false,
      error: `图片未保存到对象存储，无法由服务端安全${operationLabel}。`,
    };
  }
  const storageBackedArtifact = {
    ...artifact,
    contentRef,
  };

  return {
    ok: true,
    artifact: storageBackedArtifact,
    image: node.data.image,
    node: node as AgentCanvasNode & { data: ImageResultNodeData },
    prompt: node.data.prompt,
  };
}

function getUpscaleSourceImage(node: AgentCanvasNode | undefined) {
  return getImageProcessingSourceImage(node, "upscale");
}

function createUpscaleCanvasPatch({
  artifact,
  resolution,
  scale,
  sourceNode,
}: {
  artifact: ArtifactRef & { uri: string };
  resolution: "4k" | "8k";
  scale: number;
  sourceNode: AgentCanvasNode & { data: ImageResultNodeData };
}) {
  const resultNodeId = `image-${artifact.id}`;
  const outgoingIndex = 0;
  const width = getNodeNumericDimension(sourceNode, "width") ?? 240;
  const height = getNodeNumericDimension(sourceNode, "height") ?? 240;
  const image: GeneratedImage = {
    artifact,
    id: artifact.id,
    metadata: artifact.metadata,
    title: artifact.title ?? `Seedream ${resolution.toUpperCase()} upscale`,
    url: artifact.uri,
  };
  const node: AgentCanvasNode = {
    height,
    id: resultNodeId,
    position: {
      x: sourceNode.position.x + outgoingIndex * 262,
      y: sourceNode.position.y + 310,
    },
    selected: true,
    style: {
      width,
      height,
    },
    type: "imageResultNode",
    width,
    data: {
      artifact,
      image,
      kind: "imageResult",
      operation: "upscale",
      prompt: sourceNode.data.prompt,
      request: {
        aspectRatio: getImageAspectRatioLabel(sourceNode),
      },
      sourceNodeId: sourceNode.id,
      status: "ready",
    },
  };
  const edge: AgentCanvasEdge = {
    id: `edge-${sourceNode.id}-${resultNodeId}`,
    source: sourceNode.id,
    target: resultNodeId,
    type: "animated",
  };
  const canvasPatch = {
    edgeUpserts: [edge],
    nodeUpserts: [node],
  };

  return { canvasPatch, edge, node, scale };
}

function createMattingCanvasPatch({
  artifact,
  background,
  sourceNode,
}: {
  artifact: ArtifactRef & { uri: string };
  background: "transparent" | "white" | "neutral";
  sourceNode: AgentCanvasNode & { data: ImageResultNodeData };
}) {
  const resultNodeId = `image-${artifact.id}`;
  const outgoingIndex = 0;
  const width = getNodeNumericDimension(sourceNode, "width") ?? 240;
  const height = getNodeNumericDimension(sourceNode, "height") ?? 240;
  const title = background === "transparent" ? "透明底抠图" : "抠图结果";
  const image: GeneratedImage = {
    artifact,
    id: artifact.id,
    metadata: artifact.metadata,
    title: artifact.title ?? title,
    url: artifact.uri,
  };
  const node: AgentCanvasNode = {
    height,
    id: resultNodeId,
    position: {
      x: sourceNode.position.x + outgoingIndex * 262,
      y: sourceNode.position.y + 310,
    },
    selected: true,
    style: {
      width,
      height,
    },
    type: "imageResultNode",
    width,
    data: {
      artifact,
      image,
      kind: "imageResult",
      operation: "matting",
      prompt: sourceNode.data.prompt,
      request: {
        aspectRatio: getImageAspectRatioLabel(sourceNode),
      },
      sourceNodeId: sourceNode.id,
      status: "ready",
    },
  };
  const edge: AgentCanvasEdge = {
    id: `edge-${sourceNode.id}-${resultNodeId}`,
    source: sourceNode.id,
    target: resultNodeId,
    type: "animated",
  };
  const canvasPatch = {
    edgeUpserts: [edge],
    nodeUpserts: [node],
  };

  return { canvasPatch, edge, node };
}

function getNodeNumericDimension(
  node: AgentCanvasNode,
  dimension: "height" | "width"
) {
  const styleValue =
    node.style && typeof node.style === "object" ? node.style[dimension] : null;
  const value = node[dimension] ?? styleValue ?? node.measured?.[dimension];
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function getImageAspectRatioLabel(node: AgentCanvasNode & { data: ImageResultNodeData }) {
  const width = readPositiveNumber(node.data.image.metadata?.width);
  const height = readPositiveNumber(node.data.image.metadata?.height);
  if (width && height) {
    return `${width}:${height}`;
  }

  const nodeWidth = getNodeNumericDimension(node, "width");
  const nodeHeight = getNodeNumericDimension(node, "height");
  return nodeWidth && nodeHeight ? `${nodeWidth}:${nodeHeight}` : undefined;
}

function readPositiveNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

const port = Number(process.env.API_PORT ?? 8787);

serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, (info) => {
  console.log(`Cucumber Agent API listening on http://${info.address}:${info.port}`);
  scheduleAgentRunPrewarm();
});

async function startSession(c: Context, user: AppUser) {
  const session = createSessionToken();

  await createSession({
    userId: user.id,
    tokenHash: session.tokenHash,
    expiresAt: session.expiresAt.toISOString(),
  });

  setCookie(c, sessionCookieName, session.token, {
    expires: session.expiresAt,
    httpOnly: true,
    path: "/",
    sameSite: "Lax",
    secure: process.env.NODE_ENV === "production",
  });
  cacheSessionUser(session.tokenHash, user);
}

async function getOptionalUser(c: Context) {
  const token = getCookie(c, sessionCookieName);
  if (!token) {
    return null;
  }

  const tokenHash = hashSessionToken(token);
  const cached = getCachedSessionUser(tokenHash);
  if (cached) {
    return cached;
  }

  const user = await getSessionUser(tokenHash);
  if (!user) {
    sessionUserCache.delete(tokenHash);
    clearSessionCookie(c);
    return null;
  }

  cacheSessionUser(tokenHash, user);
  return user;
}

async function requireUser(c: Context) {
  return getOptionalUser(c);
}

function clearSessionCookie(c: Context) {
  deleteCookie(c, sessionCookieName, { path: "/" });
}

function cacheSessionUser(tokenHash: string, user: AppUser) {
  sessionUserCache.set(tokenHash, {
    expiresAt: Date.now() + SESSION_USER_CACHE_TTL_MS,
    user,
  });
}

function getCachedSessionUser(tokenHash: string) {
  const cached = sessionUserCache.get(tokenHash);
  if (!cached) {
    return null;
  }
  if (cached.expiresAt <= Date.now()) {
    sessionUserCache.delete(tokenHash);
    return null;
  }
  return cached.user;
}

async function getCachedUploadProjectMetaForUser(
  projectId: string,
  userId: string
) {
  const key = `${userId}:${projectId}`;
  const cached = uploadProjectCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return { cacheHit: true, project: cached.project };
  }
  if (cached) {
    uploadProjectCache.delete(key);
  }

  const project = await getProjectMetaForUser(projectId, userId);
  if (project) {
    cacheUploadProjectMeta(userId, project);
  }

  return { cacheHit: false, project };
}

function cacheUploadProjectMeta(userId: string, project: ProjectMeta) {
  uploadProjectCache.set(`${userId}:${project.id}`, {
    expiresAt: Date.now() + UPLOAD_PROJECT_CACHE_TTL_MS,
    project,
  });
}

function deleteCachedUploadProjectMeta(userId: string, projectId: string) {
  uploadProjectCache.delete(`${userId}:${projectId}`);
}

function elapsedApiMs(startedAt: number) {
  return Math.round(performance.now() - startedAt);
}

function unauthorized(c: Context) {
  clearSessionCookie(c);
  return c.json({ error: "请先登录" }, 401);
}

function notFound(c: Context) {
  return c.json({ error: "项目不存在" }, 404);
}

async function buildAgentSkillSourcePackage(skill: AgentSkillDefinition) {
  if (skill.packageBucket && skill.packagePath && skill.packageSha256) {
    const bytes = await downloadAgentSkillPackage({
      bucket: skill.packageBucket,
      path: skill.packagePath,
    });
    const actualSha256 = createHash("sha256").update(bytes).digest("hex");
    if (actualSha256 !== skill.packageSha256) {
      throw new Error(`Skill package hash mismatch for ${skill.name}.`);
    }
    return bytes;
  }

  const zip = new JSZip();
  zip.file("SKILL.md", skill.skillMd);
  const resources = await listActivatedSkillResources(skill);
  for (const resource of resources) {
    const content = await readActivatedSkillResourceBytes({
      resourcePath: resource.path,
      skill,
    });
    zip.file(resource.path, content.bytes);
  }

  return zip.generateAsync({
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
    type: "uint8array",
  });
}

function sanitizeDownloadFileName(value: string) {
  const normalized = value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return normalized || "agent-skill";
}

function loadServerEnv() {
  for (const file of [".env.local", ".env"]) {
    if (existsSync(file)) {
      loadEnvFile(file);
    }
  }
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function getApiError(error: unknown) {
  const message = getErrorMessage(error);
  const details = getErrorDetails(error);
  const combined = `${message}\n${details}`;

  if (
    combined.includes("agent_run_events") &&
    (combined.includes("Could not find the table") ||
      combined.includes("schema cache") ||
      combined.includes("relation") ||
      combined.includes("does not exist"))
  ) {
    return {
      message:
        "Agent event 存储表未创建，请应用最新 Supabase migrations。",
    };
  }

  if (
    combined.includes("agent_skill_definitions") &&
    (combined.includes("Could not find the table") ||
      combined.includes("schema cache") ||
      combined.includes("relation") ||
      combined.includes("does not exist"))
  ) {
    return {
      message:
        "Agent Skill 存储表未创建，请应用最新 Supabase migrations。",
    };
  }

  if (
    combined.includes("UNABLE_TO_GET_ISSUER_CERT_LOCALLY") ||
    combined.includes("SELF_SIGNED_CERT_IN_CHAIN") ||
    combined.includes("unable to get local issuer certificate")
  ) {
    return {
      message:
        "Supabase 证书校验失败，请用 pnpm dev:api 启动，或设置 NODE_EXTRA_CA_CERTS=/etc/ssl/cert.pem 后重启 API。",
    };
  }

  return { message };
}

function getErrorDetails(error: unknown) {
  if (!error || typeof error !== "object") {
    return "";
  }

  const details = "details" in error ? error.details : null;
  return typeof details === "string" ? details : "";
}
