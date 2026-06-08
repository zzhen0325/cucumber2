import { z } from "zod";

export const PROMPT_EXPAND_CAPABILITY_ID = "prompt.expand";
export const IMAGE_GENERATE_CAPABILITY_ID = "image.generate";
export const defaultCapabilityPolicy = {
  canUseNetwork: false,
  canWriteFiles: false,
  canModifyProject: false,
  requiresApproval: false,
  mayExternalCost: false,
};

const jsonObjectSchema = z.record(z.string(), z.unknown());
const stringListSchema = z.preprocess(
  (value) => {
    if (typeof value === "string") {
      return value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    }

    return value;
  },
  z.array(z.string().trim().min(1)).default([])
);

export const capabilityPolicySchema = z
  .object({
    canUseNetwork: z.boolean().default(false),
    canWriteFiles: z.boolean().default(false),
    canModifyProject: z.boolean().default(false),
    requiresApproval: z.boolean().default(false),
    mayExternalCost: z.boolean().default(false),
  })
  .default(defaultCapabilityPolicy);

export const capabilityManifestSchema = z
  .object({
    capabilityId: z.string().trim().min(1),
    version: z.string().trim().min(1).default("1.0.0"),
    description: z.string().trim().default(""),
    triggers: stringListSchema,
    inputSchema: jsonObjectSchema.default({ type: "object" }),
    outputSchema: jsonObjectSchema.default({ type: "object" }),
    toolIds: stringListSchema,
    tokenBudget: z.number().int().positive().optional(),
    requiresApproval: z.boolean().default(false),
    policy: capabilityPolicySchema,
  })
  .transform((manifest) => ({
    ...manifest,
    policy: {
      ...manifest.policy,
      requiresApproval:
        manifest.requiresApproval || manifest.policy.requiresApproval,
    },
  }));

export const capabilityRuntimeErrorCodeSchema = z.enum([
  "capability.route_missing",
  "capability.unavailable",
  "env.missing",
  "permission.denied",
  "approval.required",
  "quota.exceeded",
  "tool.error",
]);

export type CapabilityManifest = z.infer<typeof capabilityManifestSchema>;
export type CapabilityPolicy = z.infer<typeof capabilityPolicySchema>;
export type CapabilityRuntimeErrorCode = z.infer<
  typeof capabilityRuntimeErrorCodeSchema
>;

export type SkillLike = {
  id: string;
  name: string;
  slug: string;
  description: string;
  instructions: string;
  config: Record<string, unknown>;
  sourceManifest: Record<string, unknown>;
  updatedAt?: string;
};

export type RegisteredCapability = {
  manifest: CapabilityManifest;
  source: "built-in" | "skill-manifest" | "skill-compat";
  skill?: SkillLike;
};

export class CapabilityRuntimeError extends Error {
  readonly code: CapabilityRuntimeErrorCode;
  readonly details: Record<string, unknown>;

  constructor(
    code: CapabilityRuntimeErrorCode,
    message: string,
    details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "CapabilityRuntimeError";
    this.code = code;
    this.details = details;
  }
}

export const builtinPromptExpandCapability = capabilityManifestSchema.parse({
  capabilityId: PROMPT_EXPAND_CAPABILITY_ID,
  version: "1.0.0",
  description: "Expand a user image prompt with the uploaded prompt-expand skill.",
  triggers: ["prompt", "expand", "图片", "图像", "海报", "生成"],
  inputSchema: {
    type: "object",
    required: ["prompt", "upstreamContext"],
  },
  outputSchema: {
    type: "object",
    required: ["expandedPrompt"],
  },
  toolIds: ["expand_prompt"],
  tokenBudget: 1200,
  requiresApproval: false,
  policy: {
    canUseNetwork: true,
    canWriteFiles: false,
    canModifyProject: false,
    requiresApproval: false,
    mayExternalCost: false,
  },
});

export const builtinImageGenerateCapability = capabilityManifestSchema.parse({
  capabilityId: IMAGE_GENERATE_CAPABILITY_ID,
  version: "1.0.0",
  description: "Generate image artifacts from an expanded prompt.",
  triggers: [
    "image",
    "picture",
    "poster",
    "generate",
    "图片",
    "图像",
    "海报",
    "生成",
    "设计",
  ],
  inputSchema: {
    type: "object",
    required: ["prompt"],
  },
  outputSchema: {
    type: "object",
    required: ["images", "artifacts"],
  },
  toolIds: ["generate_image"],
  requiresApproval: false,
  policy: {
    canUseNetwork: true,
    canWriteFiles: false,
    canModifyProject: false,
    requiresApproval: false,
    mayExternalCost: true,
  },
});

export function parseCapabilityManifest(value: unknown): CapabilityManifest {
  return capabilityManifestSchema.parse(value);
}

export function maybeParseCapabilityManifest(value: unknown) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  if (!candidate.capabilityId) {
    return null;
  }

  return parseCapabilityManifest(candidate);
}

export function buildCapabilityRegistry(
  skills: SkillLike[]
): RegisteredCapability[] {
  const capabilities: RegisteredCapability[] = [
    {
      manifest: builtinImageGenerateCapability,
      source: "built-in",
    },
  ];

  for (const skill of skills) {
    const manifest = getSkillCapabilityManifest(skill);
    if (!manifest) {
      continue;
    }

    capabilities.push({
      manifest,
      source: "skill-manifest",
      skill,
    });
  }

  const promptExpandSkill = skills.find((skill) => skill.slug === "prompt-expand");
  if (
    promptExpandSkill &&
    !capabilities.some(
      (capability) =>
        capability.manifest.capabilityId === PROMPT_EXPAND_CAPABILITY_ID
    )
  ) {
    capabilities.push({
      manifest: builtinPromptExpandCapability,
      source: "skill-compat",
      skill: promptExpandSkill,
    });
  }

  return dedupeCapabilities(capabilities);
}

export function getCapability(
  registry: RegisteredCapability[],
  capabilityId: string
) {
  return registry.find(
    (capability) => capability.manifest.capabilityId === capabilityId
  );
}

export function requireCapability(
  registry: RegisteredCapability[],
  capabilityId: string
) {
  const capability = getCapability(registry, capabilityId);
  if (!capability) {
    throw new CapabilityRuntimeError(
      "capability.unavailable",
      `缺少可用能力：${capabilityId}`,
      { capabilityId }
    );
  }

  return capability;
}

export function assertCapabilityMayExecute(capability: RegisteredCapability) {
  if (
    capability.manifest.requiresApproval ||
    capability.manifest.policy.requiresApproval
  ) {
    throw new CapabilityRuntimeError(
      "approval.required",
      `能力 ${capability.manifest.capabilityId} 需要用户确认后才能执行。`,
      {
        capabilityId: capability.manifest.capabilityId,
        policy: capability.manifest.policy,
      }
    );
  }
}

export function getSkillCapabilityManifest(skill: SkillLike) {
  const sourceManifest = skill.sourceManifest;
  const manifestFromSource = maybeParseCapabilityManifest(
    sourceManifest.capabilityManifest
  );
  if (manifestFromSource) {
    return manifestFromSource;
  }

  for (const path of [
    "manifest.json",
    "capability.json",
    "config/manifest.json",
    "config/capability.json",
  ]) {
    const manifest = maybeParseCapabilityManifest(skill.config[path]);
    if (manifest) {
      return manifest;
    }
  }

  return null;
}

export function getCapabilitySummary(capability: RegisteredCapability) {
  return {
    capabilityId: capability.manifest.capabilityId,
    version: capability.manifest.version,
    description: capability.manifest.description,
    source: capability.source,
    skillId: capability.skill?.id,
    skillSlug: capability.skill?.slug,
    toolIds: capability.manifest.toolIds,
    tokenBudget: capability.manifest.tokenBudget,
    requiresApproval:
      capability.manifest.requiresApproval ||
      capability.manifest.policy.requiresApproval,
    policy: capability.manifest.policy,
  };
}

export function toTypedCapabilityError(error: unknown): CapabilityRuntimeError {
  if (error instanceof CapabilityRuntimeError) {
    return error;
  }

  const message = getReadableErrorMessage(error);

  if (
    /\b(API_KEY|SECRET|TOKEN|SUPABASE_|SEEDREAM_|ARK_|DEEPSEEK_)/.test(
      message
    ) &&
    /(required|configured|not configured|is required)/i.test(message)
  ) {
    return new CapabilityRuntimeError("env.missing", message);
  }

  if (message.includes("一次最多生成") || /quota|limit/i.test(message)) {
    return new CapabilityRuntimeError("quota.exceeded", message);
  }

  return new CapabilityRuntimeError("tool.error", message);
}

function getReadableErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (error && typeof error === "object") {
    const candidate = error as { message?: unknown; error?: unknown };
    if (typeof candidate.message === "string" && candidate.message.trim()) {
      return candidate.message;
    }
    if (candidate.message !== undefined) {
      return safeStringify(candidate.message);
    }
    if (candidate.error !== undefined) {
      return safeStringify(candidate.error);
    }
  }

  return safeStringify(error);
}

function safeStringify(value: unknown) {
  if (typeof value === "string") {
    return value;
  }
  if (value === undefined) {
    return "Unknown error.";
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function dedupeCapabilities(capabilities: RegisteredCapability[]) {
  const byId = new Map<string, RegisteredCapability>();

  for (const capability of capabilities) {
    const existing = byId.get(capability.manifest.capabilityId);
    if (
      !existing ||
      (existing.source === "built-in" &&
        capability.source !== "built-in" &&
        capability.manifest.capabilityId !== IMAGE_GENERATE_CAPABILITY_ID)
    ) {
      byId.set(capability.manifest.capabilityId, capability);
    }
  }

  return Array.from(byId.values());
}
