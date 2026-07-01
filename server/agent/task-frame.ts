import { z } from "zod";

// Task Frame domain/action/capability vocabularies. The frame is classification
// and workflow sketching only. No domain-specific tool parameters live here; the
// Super Agent derives final tool parameters from constraints.
export const taskDomainValues = [
  "image",
  "text",
  "code",
  "canvas",
  "data",
  "figma",
  "mixed",
  "web",
  "unknown",
] as const;

export const taskActionValues = [
  "create",
  "edit",
  "analyze",
  "transform",
  "extract",
  "upscale",
  "unknown",
] as const;

// Legacy field names kept for the Task Frame contract. In the active runtime
// these values are capability hints for the single Super Agent, not start agents.
export const primaryAgentValues = [
  "image_agent",
  "document_agent",
  "web_agent",
  "research_agent",
  "manager_agent",
] as const;

export const imageRoleValues = [
  "target",
  "reference",
  "style_reference",
  "unknown",
] as const;

export const ambiguitySeverityValues = ["low", "medium", "high"] as const;
export const workflowModeValues = [
  "single",
  "hybrid",
  "multi_step",
  "unknown",
] as const;
export const workflowModalityValues = [
  "text",
  "image",
  "code",
  "document",
  "webpage",
  "data",
  "canvas",
  "figma",
  "unknown",
] as const;
export const workflowArtifactValues = [
  "answer",
  "canvas_operation",
  "code",
  "dataset",
  "decision",
  "diagram",
  "doc",
  "file",
  "image",
  "markdown",
  "memory",
  "research",
  "tool_result",
  "webpage",
  "unknown",
] as const;

const taskDomainSchema = z.enum(taskDomainValues);
const taskActionSchema = z.enum(taskActionValues);
const primaryAgentSchema = z.enum(primaryAgentValues);
const imageRoleSchema = z.enum(imageRoleValues);
const ambiguitySeveritySchema = z.enum(ambiguitySeverityValues);
const workflowModeSchema = z.enum(workflowModeValues);
const workflowModalitySchema = z.enum(workflowModalityValues);
const workflowArtifactSchema = z.enum(workflowArtifactValues);

const taskSchema = z.object({
  domain: taskDomainSchema,
  intent: z.string().trim().min(1),
  action: taskActionSchema,
  confidence: z.number().min(0).max(1),
});

const userGoalSchema = z.object({
  original: z.string(),
  normalized: z.string(),
});

const routingSchema = z.object({
  primaryAgent: primaryAgentSchema,
  candidateAgents: z.array(primaryAgentSchema).optional(),
  reason: z.string().trim().min(1).optional(),
});

const inputImageSchema = z.object({
  id: z.string(),
  role: imageRoleSchema.optional(),
});

const inputFileSchema = z.object({
  id: z.string(),
  type: z.string(),
});

const inputsSchema = z.object({
  text: z.string(),
  images: z.array(inputImageSchema).optional(),
  files: z.array(inputFileSchema).optional(),
});

// constraint.value is string-encoded so the structured-output schema stays
// concrete and reliable (e.g. "4", "1080x1440", "3:4"). Sub-agents parse it.
const explicitConstraintSchema = z.object({
  key: z.string().trim().min(1),
  value: z.string(),
  sourceText: z.string(),
});

const inferredConstraintSchema = z.object({
  key: z.string().trim().min(1),
  value: z.string(),
  reason: z.string(),
});

const constraintsSchema = z.object({
  explicit: z.array(explicitConstraintSchema).optional(),
  inferred: z.array(inferredConstraintSchema).optional(),
});

const ambiguitySchema = z.object({
  issue: z.string().trim().min(1),
  options: z.array(z.string()).optional(),
  severity: ambiguitySeveritySchema,
});

const workflowStageSchema = z.object({
  id: z.string().trim().min(1),
  goal: z.string().trim().min(1),
  action: taskActionSchema,
  agent: primaryAgentSchema,
  inputModalities: z.array(workflowModalitySchema).optional(),
  outputArtifacts: z.array(workflowArtifactSchema).optional(),
  dependsOn: z.array(z.string()).optional(),
});

const workflowSchema = z.object({
  mode: workflowModeSchema.optional(),
  inputModalities: z.array(workflowModalitySchema).optional(),
  outputArtifacts: z.array(workflowArtifactSchema).optional(),
  requiredAgents: z.array(primaryAgentSchema).optional(),
  requiredCapabilities: z.array(z.string().trim().min(1)).optional(),
  stages: z.array(workflowStageSchema).optional(),
});

export const normalizedAgentInputSchema = z.object({
  rawInput: z.string().optional(),
  task: taskSchema,
  userGoal: userGoalSchema,
  routing: routingSchema,
  inputs: inputsSchema,
  constraints: constraintsSchema.optional(),
  ambiguities: z.array(ambiguitySchema).optional(),
  workflow: workflowSchema.optional(),
});

export type NormalizedAgentInput = {
  rawInput: string;
  task: z.infer<typeof taskSchema>;
  userGoal: z.infer<typeof userGoalSchema>;
  routing: {
    primaryAgent: PrimaryAgent;
    candidateAgents: PrimaryAgent[];
    reason?: string;
  };
  inputs: {
    text: string;
    images: Array<z.infer<typeof inputImageSchema>>;
    files: Array<z.infer<typeof inputFileSchema>>;
  };
  constraints: {
    explicit: Array<z.infer<typeof explicitConstraintSchema>>;
    inferred: Array<z.infer<typeof inferredConstraintSchema>>;
  };
  ambiguities: Array<z.infer<typeof ambiguitySchema>>;
  workflow: {
    mode: WorkflowMode;
    inputModalities: WorkflowModality[];
    outputArtifacts: WorkflowArtifact[];
    requiredAgents: PrimaryAgent[];
    requiredCapabilities: string[];
    stages: WorkflowStage[];
  };
};

export type TaskDomain = z.infer<typeof taskDomainSchema>;
export type TaskAction = z.infer<typeof taskActionSchema>;
export type PrimaryAgent = z.infer<typeof primaryAgentSchema>;
export type ImageRole = z.infer<typeof imageRoleSchema>;
export type ExplicitConstraint = z.infer<typeof explicitConstraintSchema>;
export type InferredConstraint = z.infer<typeof inferredConstraintSchema>;
export type WorkflowMode = z.infer<typeof workflowModeSchema>;
export type WorkflowModality = z.infer<typeof workflowModalitySchema>;
export type WorkflowArtifact = z.infer<typeof workflowArtifactSchema>;
export type WorkflowStage = z.infer<typeof workflowStageSchema>;

// Zero-fallback finalize: validate the model output and normalize text only.
// No rule-based intent/artifact correction. The Task Frame is what the model said.
export function finalizeNormalizedAgentInput(
  candidate: unknown,
  rawInput: string
): NormalizedAgentInput {
  const parsed = normalizedAgentInputSchema.parse(candidate);
  const raw = normalizeText(rawInput);

  return {
    rawInput: raw,
    task: {
      domain: parsed.task.domain,
      intent: normalizeText(parsed.task.intent) || parsed.task.intent,
      action: parsed.task.action,
      confidence: parsed.task.confidence,
    },
    userGoal: {
      original: normalizeNullableText(parsed.userGoal.original) ?? raw,
      normalized: normalizeNullableText(parsed.userGoal.normalized) ?? raw,
    },
    routing: {
      primaryAgent: parsed.routing.primaryAgent,
      candidateAgents: uniqueAgents(parsed.routing.candidateAgents ?? []),
      reason: normalizeNullableText(parsed.routing.reason) ?? undefined,
    },
    inputs: {
      text: normalizeNullableText(parsed.inputs.text) ?? raw,
      images: parsed.inputs.images ?? [],
      files: parsed.inputs.files ?? [],
    },
    constraints: {
      explicit: parsed.constraints?.explicit ?? [],
      inferred: parsed.constraints?.inferred ?? [],
    },
    ambiguities: (parsed.ambiguities ?? []).map((ambiguity) => ({
      issue: ambiguity.issue,
      options: ambiguity.options ?? [],
      severity: ambiguity.severity,
    })),
    workflow: normalizeWorkflow(parsed.workflow),
  };
}

export function getExplicitConstraint(
  input: NormalizedAgentInput | null | undefined,
  key: string
): string | undefined {
  return input?.constraints.explicit.find((entry) => entry.key === key)?.value;
}

export function getExplicitConstraints(
  input: NormalizedAgentInput | null | undefined,
  key: string
): string[] {
  return (input?.constraints.explicit ?? [])
    .filter((entry) => entry.key === key)
    .map((entry) => entry.value);
}

function uniqueAgents(agents: PrimaryAgent[]): PrimaryAgent[] {
  return [...new Set(agents)];
}

function normalizeWorkflow(
  workflow: z.infer<typeof workflowSchema> | undefined
): NormalizedAgentInput["workflow"] {
  return {
    mode: workflow?.mode ?? "single",
    inputModalities: uniqueValues(workflow?.inputModalities ?? []),
    outputArtifacts: uniqueValues(workflow?.outputArtifacts ?? []),
    requiredAgents: uniqueAgents(workflow?.requiredAgents ?? []),
    requiredCapabilities: uniqueStrings(workflow?.requiredCapabilities ?? []),
    stages: (workflow?.stages ?? []).map((stage) => ({
      id: stage.id,
      goal: stage.goal,
      action: stage.action,
      agent: stage.agent,
      inputModalities: uniqueValues(stage.inputModalities ?? []),
      outputArtifacts: uniqueValues(stage.outputArtifacts ?? []),
      dependsOn: uniqueStrings(stage.dependsOn ?? []),
    })),
  };
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => normalizeText(value)).filter(Boolean))];
}

function uniqueValues<T extends string>(values: T[]): T[] {
  return [...new Set(values)];
}

function normalizeNullableText(value: string | null | undefined) {
  if (value === null || value === undefined) {
    return null;
  }
  return normalizeText(value) || null;
}

export function normalizeText(value: string) {
  return Array.from(value, (char) => {
    const code = char.charCodeAt(0);
    return code < 32 || code === 127 ? " " : char;
  })
    .join("")
    .replace(/([\u4e00-\u9fff])([A-Za-z][A-Za-z0-9]*)/g, "$1 $2")
    .replace(/([A-Za-z0-9])([\u4e00-\u9fff])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}
