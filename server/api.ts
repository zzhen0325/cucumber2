import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { serve } from "@hono/node-server";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateText,
  streamText,
  type UIMessage,
} from "ai";
import { Hono, type Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { cors } from "hono/cors";
import { z } from "zod";

import {
  generateSeedreamImage,
  inferSeedreamResultCount,
  isSeedreamConfigured,
  readSeedreamMaxOutputImagesFromEnv,
} from "../seedream.ts";
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
  createSkill,
  createUser,
  deleteSession,
  getLatestPublicSkillBySlug,
  getProjectForUser,
  getSessionUser,
  getUserByUsername,
  getUserCount,
  isSupabaseConfigured,
  listPublicSkillsForUser,
  listProjects,
  recordRunEvent,
  softDeleteSkillForUser,
  updateSkillForUser,
  softDeleteProject,
  updateProjectForUser,
  type AgentSkill,
  type AppUser,
} from "./supabase.ts";
import { parseSkillZip } from "./skill-parser.ts";

loadServerEnv();

const app = new Hono();
const sessionCookieName = "cucumber_session";

const authInputSchema = z.object({
  username: z.string().trim().min(1).max(80),
  password: z.string().min(1).max(200),
});

const upstreamContextSchema = z.object({
  nodeId: z.string(),
  type: z.enum(["prompt", "image"]),
  prompt: z.string().optional(),
  imageUrl: z.string().optional(),
  summary: z.string().optional(),
});

const canvasContextSchema = z.object({
  prompt: z.string(),
  selectedNodeId: z.string().nullable().optional(),
  upstreamContext: z.array(upstreamContextSchema).default([]),
});

const projectCreateSchema = z.object({
  title: z.string().trim().min(1).max(120).default("Untitled"),
});

const projectPatchSchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    nodes: z.array(z.unknown()).optional(),
    edges: z.array(z.unknown()).optional(),
    selectedNodeId: z.string().nullable().optional(),
    lastRunId: z.string().nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "No project updates provided.",
  });

const skillPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    description: z.string().trim().max(500).optional(),
    instructions: z.string().trim().min(1).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "No skill updates provided.",
  });

app.use("*", cors());

app.onError((error, c) => {
  console.error("[api]", error);
  const apiError = getApiError(error);
  return c.json({ error: apiError.message }, 500);
});

app.get("/api/health", (c) =>
  c.json({
    ok: true,
    deepseekConfigured: Boolean(process.env.DEEPSEEK_API_KEY),
    seedreamConfigured: isSeedreamConfigured(),
    supabaseConfigured: isSupabaseConfigured(),
    model: process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash",
  })
);

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
  const project = await updateProjectForUser({
    projectId,
    userId: user.id,
    title: input.title,
    nodes: input.nodes as Parameters<typeof updateProjectForUser>[0]["nodes"],
    edges: input.edges as Parameters<typeof updateProjectForUser>[0]["edges"],
    selectedNodeId: input.selectedNodeId,
    lastRunId: input.lastRunId,
  });

  if (!project) {
    return notFound(c);
  }

  return c.json({ project });
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

app.get("/api/skills", async (c) => {
  const user = await requireUser(c);
  if (!user) {
    return unauthorized(c);
  }

  const skills = await listPublicSkillsForUser(user.id);
  return c.json({ skills });
});

app.post("/api/skills", async (c) => {
  const user = await requireUser(c);
  if (!user) {
    return unauthorized(c);
  }

  const formData = await c.req.formData();
  const file = formData.get("file");
  if (!isUploadedFile(file)) {
    return c.json({ error: "请上传 skill zip 文件" }, 400);
  }
  if (!file.name.endsWith(".zip")) {
    return c.json({ error: "Skill 文件必须是 .zip" }, 400);
  }

  let parsed: Awaited<ReturnType<typeof parseSkillZip>>;
  try {
    parsed = await parseSkillZip(await file.arrayBuffer());
  } catch (error) {
    return c.json({ error: getErrorMessage(error) }, 400);
  }

  const skill = await createSkill({
    ownerUserId: user.id,
    name: parsed.name,
    slug: parsed.slug,
    description: parsed.description,
    instructions: parsed.instructions,
    config: parsed.config,
    sourceManifest: parsed.sourceManifest,
  });

  return c.json({ skill });
});

app.patch("/api/skills/:skillId", async (c) => {
  const user = await requireUser(c);
  if (!user) {
    return unauthorized(c);
  }

  const skillId = z.string().uuid().parse(c.req.param("skillId"));
  const input = skillPatchSchema.parse(await c.req.json());
  const skill = await updateSkillForUser({
    skillId,
    userId: user.id,
    name: input.name,
    description: input.description,
    instructions: input.instructions,
  });

  if (!skill) {
    return c.json({ error: "无权编辑此 skill" }, 403);
  }

  return c.json({ skill });
});

app.delete("/api/skills/:skillId", async (c) => {
  const user = await requireUser(c);
  if (!user) {
    return unauthorized(c);
  }

  const skillId = z.string().uuid().parse(c.req.param("skillId"));
  const deleted = await softDeleteSkillForUser(skillId, user.id);
  if (!deleted) {
    return c.json({ error: "无权删除此 skill" }, 403);
  }

  return c.json({ ok: true });
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

  const stream = createUIMessageStream({
    originalMessages: messages,
    execute: async ({ writer }) => {
      const expandToolCallId = `expand_prompt-${crypto.randomUUID()}`;
      const imageToolCallId = `generate_image-${crypto.randomUUID()}`;
      const requestedResultCount = safeInferSeedreamResultCount(canvasContext.prompt);
      const skillInput = {
        prompt: canvasContext.prompt,
        selectedNodeId: canvasContext.selectedNodeId ?? null,
        upstreamContext: canvasContext.upstreamContext,
        skillSlug: "prompt-expand",
      };

      await recordRunEvent({
        projectId,
        runNodeId,
        prompt: canvasContext.prompt,
        selectedNodeId: canvasContext.selectedNodeId ?? null,
        upstreamContext: canvasContext.upstreamContext,
        status: "running",
        skillInput,
      });

      const agentText = streamText({
        model: getDeepSeekModel(),
        system:
          "你是 Cucumber infinite canvas 的图片生成 agent。只输出给用户看的执行文字，使用简短中文。不要说图片已经生成，不要编造工具结果，不要输出 Markdown 标题或列表。",
        prompt: buildAgentRunTextPrompt(canvasContext, requestedResultCount),
      });

      for await (const chunk of agentText.toUIMessageStream()) {
        writer.write(chunk);
      }

      writer.write({
        type: "tool-input-available",
        toolCallId: expandToolCallId,
        toolName: "expand_prompt",
        input: skillInput,
      });

      let promptSkill: AgentSkill;
      let expandedPrompt = "";

      try {
        const latestSkill = await getLatestPublicSkillBySlug("prompt-expand");
        if (!latestSkill) {
          throw new Error("请先在 Skill 面板上传 prompt-expand skill。");
        }

        promptSkill = latestSkill;
        expandedPrompt = await expandPromptWithSkill(promptSkill, canvasContext);

        const skillOutput = {
          originalPrompt: canvasContext.prompt,
          expandedPrompt,
          skill: getSkillToolSummary(promptSkill),
        };

        writer.write({
          type: "tool-output-available",
          toolCallId: expandToolCallId,
          output: skillOutput,
        });

        const toolInput = {
          prompt: expandedPrompt,
          originalPrompt: canvasContext.prompt,
          selectedNodeId: canvasContext.selectedNodeId ?? null,
          upstreamContext: canvasContext.upstreamContext,
          resultCount: inferSeedreamResultCount(
            canvasContext.prompt,
            readSeedreamMaxOutputImagesFromEnv()
          ),
          promptSkill: getSkillToolSummary(promptSkill),
        };

        writer.write({
          type: "tool-input-available",
          toolCallId: imageToolCallId,
          toolName: "generate_image",
          input: toolInput,
        });

        const output = await generateSeedreamImage(toolInput);

        await recordRunEvent({
          projectId,
          runNodeId,
          prompt: canvasContext.prompt,
          selectedNodeId: canvasContext.selectedNodeId ?? null,
          upstreamContext: canvasContext.upstreamContext,
          status: "success",
          skillInput,
          skillOutput,
          toolInput,
          toolOutput: output,
        });

        writer.write({
          type: "tool-output-available",
          toolCallId: imageToolCallId,
          output,
        });
      } catch (error) {
        const errorText = getErrorMessage(error);
        console.error("[agent-run]", error);

        await recordRunEvent({
          projectId,
          runNodeId,
          prompt: canvasContext.prompt,
          selectedNodeId: canvasContext.selectedNodeId ?? null,
          upstreamContext: canvasContext.upstreamContext,
          status: "error",
          skillInput,
          errorText,
        });

        writer.write({
          type: "tool-output-error",
          toolCallId: expandedPrompt ? imageToolCallId : expandToolCallId,
          errorText,
        });
      }
    },
    onError: getErrorMessage,
  });

  return createUIMessageStreamResponse({ stream });
});

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

function getDeepSeekModel() {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error("DEEPSEEK_API_KEY is required.");
  }

  return createOpenAICompatible({
    name: "deepseek",
    baseURL: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
    apiKey,
  }).chatModel(process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash");
}

function buildAgentRunTextPrompt(
  canvasContext: z.infer<typeof canvasContextSchema>,
  resultCount: number
) {
  const upstreamSummary = canvasContext.upstreamContext.length
    ? canvasContext.upstreamContext
        .map((item, index) => {
          const summary =
            item.summary ?? item.prompt ?? (item.type === "image" ? "图片结果" : "提示词");
          return `${index + 1}. ${item.type}: ${summary}`;
        })
        .join("\n")
    : "无";

  return [
    `当前需求: ${canvasContext.prompt}`,
    `选中节点: ${canvasContext.selectedNodeId ?? "无"}`,
    `上游上下文:\n${upstreamSummary}`,
    `目标输出: ${resultCount} 张图片`,
    "请输出 1 到 3 句执行说明，说明你会如何理解需求并使用上游上下文。",
  ].join("\n\n");
}

async function expandPromptWithSkill(
  skill: AgentSkill,
  canvasContext: z.infer<typeof canvasContextSchema>
) {
  const result = await generateText({
    model: getDeepSeekModel(),
    system: [
      "你是 Cucumber 的图像 prompt 扩写器。",
      "严格遵循用户上传 skill 的说明，把输入扩写成可直接用于图像生成的自然语言 prompt。",
      "只输出扩写后的 prompt，不输出 JSON、标题、列表、解释或中间过程。",
    ].join("\n"),
    prompt: buildSkillPrompt(skill, canvasContext),
  });
  const expandedPrompt = result.text.trim();
  if (!expandedPrompt) {
    throw new Error("prompt-expand skill returned an empty prompt.");
  }

  return expandedPrompt;
}

function buildSkillPrompt(
  skill: AgentSkill,
  canvasContext: z.infer<typeof canvasContextSchema>
) {
  const upstreamSummary = canvasContext.upstreamContext.length
    ? canvasContext.upstreamContext
        .map((item, index) => {
          const summary =
            item.summary ?? item.prompt ?? (item.type === "image" ? "图片结果" : "提示词");
          return `${index + 1}. ${item.type}: ${summary}`;
        })
        .join("\n")
    : "无";
  const configText = JSON.stringify(skill.config).slice(0, 6_000);

  return [
    `Skill 名称: ${skill.name}`,
    `Skill 描述: ${skill.description || "无"}`,
    `Skill 说明:\n${skill.instructions}`,
    `Skill 配置摘要:\n${configText || "{}"}`,
    `当前用户 prompt:\n${canvasContext.prompt}`,
    `选中节点: ${canvasContext.selectedNodeId ?? "无"}`,
    `上游上下文:\n${upstreamSummary}`,
    "请根据 skill 说明输出扩写后的图像生成 prompt。",
  ].join("\n\n");
}

function getSkillToolSummary(skill: AgentSkill) {
  return {
    id: skill.id,
    name: skill.name,
    slug: skill.slug,
  };
}

type UploadedFileLike = {
  name: string;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

function isUploadedFile(value: unknown): value is UploadedFileLike {
  return Boolean(
    value &&
      typeof value === "object" &&
      "arrayBuffer" in value &&
      "name" in value &&
      typeof value.name === "string"
  );
}

function safeInferSeedreamResultCount(prompt: string) {
  try {
    return inferSeedreamResultCount(prompt, readSeedreamMaxOutputImagesFromEnv());
  } catch {
    return 1;
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
    combined.includes("agent_skills") &&
    (combined.includes("Could not find the table") ||
      combined.includes("schema cache") ||
      combined.includes("relation") ||
      combined.includes("does not exist"))
  ) {
    return {
      message:
        "Skill 存储表未创建，请先应用 supabase/migrations/20260607002000_agent_skills.sql。",
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
