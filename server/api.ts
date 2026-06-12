import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { serve } from "@hono/node-server";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage,
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
import type {
  AgentCanvasEdge,
  AgentCanvasNode,
  ArtifactRef,
  GeneratedImage,
  ImageResultNodeData,
} from "../src/types/canvas.ts";
import { executeAgentRun } from "./agent/index.ts";
import { getAgentModelConfiguration } from "./agent/model-config.ts";
import {
  createSessionToken,
  hashPassword,
  hashSessionToken,
  normalizeUsername,
  verifyPassword,
} from "./auth.ts";
import {
  claimUnownedProjects,
  createProject,
  createSession,
  createUser,
  deleteSession,
  getProjectForUser,
  getAgentArtifactForUser,
  getSessionUser,
  getUserByUsername,
  getUserCount,
  isSupabaseConfigured,
  listAgentEventsForUser,
  listProjects,
  softDeleteProject,
  updateProjectForUser,
  ProjectVersionConflictError,
  type AppUser,
} from "./supabase.ts";
import {
  createSignedArtifactReadUrl,
  createSignedAssetUpload,
  completeSignedAssetUpload,
  MAX_AGENT_ASSET_BYTES,
  resolveStorageBackedImageContext,
  storeGeneratedImageFromUrl,
} from "./storage.ts";

loadServerEnv();

const app = new Hono();
const activeAgentRuns = new Map<string, AbortController>();
const sessionCookieName = "cucumber_session";

const authInputSchema = z.object({
  username: z.string().trim().min(1).max(80),
  password: z.string().min(1).max(200),
});

const canvasContextSchema = z.object({
  prompt: z.string().trim().min(1),
  promptNodeId: z.string().nullable().optional(),
  selectedNodeId: z.string().nullable().optional(),
});

const projectCreateSchema = z.object({
  title: z.string().trim().min(1).max(120).default("Untitled"),
});

const projectPatchSchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    nodes: z.array(z.unknown()).optional(),
    edges: z.array(z.unknown()).optional(),
    canvasPatch: z
      .object({
        nodeUpserts: z.array(z.unknown()).optional(),
        nodeDeletes: z.array(z.string()).optional(),
        edgeUpserts: z.array(z.unknown()).optional(),
        edgeDeletes: z.array(z.string()).optional(),
      })
      .optional(),
    selectedNodeId: z.string().nullable().optional(),
    lastRunId: z.string().nullable().optional(),
    expectedVersion: z.number().int().nonnegative().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "No project updates provided.",
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

app.use("*", cors());

app.onError((error, c) => {
  console.error("[api]", error);
  const apiError = getApiError(error);
  return c.json({ error: apiError.message }, 500);
});

app.get("/api/health", (c) => {
  const agent = getAgentModelConfiguration();
  return c.json({
    ok: true,
    agentConfigured: agent.configured,
    agentProvider: agent.provider,
    agentModel: agent.model,
    seedreamConfigured: isSeedreamConfigured(),
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
    await deleteSession(hashSessionToken(token));
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

app.post("/api/projects", async (c) => {
  const user = await requireUser(c);
  if (!user) {
    return unauthorized(c);
  }

  const input = projectCreateSchema.parse(await c.req.json());
  const project = await createProject(user.id, input.title);
  return c.json({ project });
});

app.get("/api/projects/:projectId", async (c) => {
  const user = await requireUser(c);
  if (!user) {
    return unauthorized(c);
  }

  const projectId = z.string().uuid().parse(c.req.param("projectId"));
  const project = await getProjectForUser(projectId, user.id);
  if (!project) {
    return notFound(c);
  }

  return c.json({ project });
});

app.patch("/api/projects/:projectId", async (c) => {
  const user = await requireUser(c);
  if (!user) {
    return unauthorized(c);
  }

  const projectId = z.string().uuid().parse(c.req.param("projectId"));
  const input = projectPatchSchema.parse(await c.req.json());

  try {
    const project = await updateProjectForUser({
      projectId,
      userId: user.id,
      title: input.title,
      nodes: input.nodes as Parameters<typeof updateProjectForUser>[0]["nodes"],
      edges: input.edges as Parameters<typeof updateProjectForUser>[0]["edges"],
      canvasPatch:
        input.canvasPatch as Parameters<typeof updateProjectForUser>[0]["canvasPatch"],
      selectedNodeId: input.selectedNodeId,
      lastRunId: input.lastRunId,
      expectedVersion: input.expectedVersion,
    });

    if (!project) {
      return notFound(c);
    }

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
  const user = await requireUser(c);
  if (!user) {
    return unauthorized(c);
  }

  const projectId = z.string().uuid().parse(c.req.param("projectId"));
  const project = await getProjectForUser(projectId, user.id);
  if (!project) {
    return notFound(c);
  }

  const input = uploadSignSchema.parse(await c.req.json());
  const upload = await createSignedAssetUpload({
    fileName: input.fileName,
    projectId,
    sizeBytes: input.sizeBytes,
  });

  return c.json({ upload });
});

app.post("/api/projects/:projectId/uploads/:uploadId/complete", async (c) => {
  const user = await requireUser(c);
  if (!user) {
    return unauthorized(c);
  }

  const projectId = z.string().uuid().parse(c.req.param("projectId"));
  const uploadId = z.string().uuid().parse(c.req.param("uploadId"));
  const project = await getProjectForUser(projectId, user.id);
  if (!project) {
    return notFound(c);
  }

  const input = uploadCompleteSchema.parse(await c.req.json());
  const artifact = await completeSignedAssetUpload({
    bucket: input.bucket,
    fileName: input.fileName,
    height: input.height,
    kind: input.kind,
    mimeType: input.mimeType,
    path: input.path,
    projectId,
    sizeBytes: input.sizeBytes,
    summary: input.summary,
    title: input.title,
    uploadId,
    userId: user.id,
    width: input.width,
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
  const project = await getProjectForUser(projectId, user.id);
  if (!project) {
    return notFound(c);
  }

  if (!isSeedreamConfigured()) {
    return c.json(
      {
        error:
          "Seedream image upscale is not configured. Set SEEDREAM_ACCESS_KEY_ID and SEEDREAM_SECRET_ACCESS_KEY.",
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
    const updatedProject = await updateProjectForUser({
      canvasPatch,
      expectedVersion: input.expectedVersion,
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
      const updatedProject = await updateProjectForUser({
        canvasPatch,
        expectedVersion: error.project.version,
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

app.get("/api/projects/:projectId/artifacts/:artifactId/content", async (c) => {
  const user = await requireUser(c);
  if (!user) {
    return unauthorized(c);
  }

  const projectId = z.string().uuid().parse(c.req.param("projectId"));
  const artifactId = z.string().min(1).max(260).parse(c.req.param("artifactId"));
  const artifact = await getAgentArtifactForUser({
    artifactId,
    projectId,
    userId: user.id,
  });

  if (!artifact) {
    return notFound(c);
  }

  const signedUrl = await createSignedArtifactReadUrl(artifact);
  return c.redirect(signedUrl, 302);
});

app.delete("/api/agent-run", async (c) => {
  const user = await requireUser(c);
  if (!user) {
    return unauthorized(c);
  }

  const projectId = z.string().uuid().parse(c.req.query("projectId"));
  const runNodeId = z.string().min(1).parse(c.req.query("runNodeId"));
  const project = await getProjectForUser(projectId, user.id);
  if (!project) {
    return notFound(c);
  }

  const controller = activeAgentRuns.get(
    getActiveAgentRunKey(user.id, projectId, runNodeId)
  );
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
  const canvasContext = canvasContextSchema.parse(body.canvasContext ?? {});
  const projectId = z.string().uuid().parse(body.projectId);
  const runNodeId = z.string().min(1).parse(body.runNodeId);
  const project = await getProjectForUser(projectId, user.id);

  if (!project) {
    return notFound(c);
  }

  const updatedProject = await updateProjectForUser({
    projectId,
    userId: user.id,
    lastRunId: runNodeId,
  });
  if (!updatedProject) {
    return notFound(c);
  }

  const activeRunKey = getActiveAgentRunKey(user.id, projectId, runNodeId);
  const controller = new AbortController();
  activeAgentRuns.set(activeRunKey, controller);
  const abortFromRequest = () => controller.abort(c.req.raw.signal.reason);
  c.req.raw.signal.addEventListener("abort", abortFromRequest, { once: true });

  const stream = createUIMessageStream({
    originalMessages: messages,
    execute: async ({ writer }) => {
      try {
        await executeAgentRun({
          canvasContext,
          projectId,
          projectSnapshot: updatedProject,
          runNodeId,
          signal: controller.signal,
          userId: user.id,
          writer,
        });
      } finally {
        c.req.raw.signal.removeEventListener("abort", abortFromRequest);
        if (activeAgentRuns.get(activeRunKey) === controller) {
          activeAgentRuns.delete(activeRunKey);
        }
      }
    },
    onError: getErrorMessage,
  });

  return createUIMessageStreamResponse({ stream });
});

function getActiveAgentRunKey(
  userId: string,
  projectId: string,
  runNodeId: string
) {
  return `${userId}:${projectId}:${runNodeId}`;
}

function getUpscaleSourceImage(node: AgentCanvasNode | undefined):
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
  if (node.data.kind !== "imageResult") {
    return { ok: false, error: "只能对图片节点执行高清放大。" };
  }
  if ((node.data.status ?? "ready") !== "ready" || !node.data.image.url) {
    return { ok: false, error: "图片尚未准备完成，无法高清放大。" };
  }

  const artifact = node.data.artifact ?? node.data.image.artifact;
  if (!artifact || artifact.type !== "image" || !artifact.contentRef) {
    return {
      ok: false,
      error: "图片未保存到对象存储，无法由服务端安全放大。",
    };
  }

  return {
    ok: true,
    artifact,
    image: node.data.image,
    node: node as AgentCanvasNode & { data: ImageResultNodeData },
    prompt: node.data.prompt,
  };
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

function getNodeNumericDimension(
  node: AgentCanvasNode,
  dimension: "height" | "width"
) {
  const value = node[dimension] ?? node.measured?.[dimension];
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
}

async function getOptionalUser(c: Context) {
  const token = getCookie(c, sessionCookieName);
  if (!token) {
    return null;
  }

  const user = await getSessionUser(hashSessionToken(token));
  if (!user) {
    clearSessionCookie(c);
  }

  return user;
}

async function requireUser(c: Context) {
  return getOptionalUser(c);
}

function clearSessionCookie(c: Context) {
  deleteCookie(c, sessionCookieName, { path: "/" });
}

function unauthorized(c: Context) {
  clearSessionCookie(c);
  return c.json({ error: "请先登录" }, 401);
}

function notFound(c: Context) {
  return c.json({ error: "项目不存在" }, 404);
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
