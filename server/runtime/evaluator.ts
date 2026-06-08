import type { AgentRun, EvaluationResult } from "../../src/types/runtime.ts";

export function evaluateAgentRun(run: AgentRun): EvaluationResult {
  const issues: EvaluationResult["issues"] = [];
  const expectedArtifactCounts = countExpectedArtifacts(run);
  const actualArtifactCounts = countActualArtifacts(run);

  if (run.errors.length) {
    issues.push(
      ...run.errors.map((error) => ({
        code: error.code,
        message: error.message,
        severity: error.severity === "fatal" ? "error" : error.severity,
      }))
    );
  }

  for (const [type, expectedCount] of expectedArtifactCounts) {
    const actualCount = actualArtifactCounts.get(type) ?? 0;
    if (actualCount >= expectedCount) {
      continue;
    }

    issues.push({
      code:
        type === "image"
          ? "IMAGE_ARTIFACT_COUNT_MISMATCH"
          : "ARTIFACT_MISSING",
      message: `Expected ${expectedCount} ${type} artifact(s), but ${actualCount} were created.`,
      severity: "error",
    });
  }

  for (const artifact of run.artifacts.filter((artifact) => artifact.type === "image")) {
    if (!artifact.uri) {
      issues.push({
        code: "IMAGE_ARTIFACT_URL_MISSING",
        message: `Image artifact ${artifact.id} is missing a URL.`,
        severity: "error",
      });
    }
  }

  for (const artifact of run.artifacts.filter((artifact) =>
    ["code", "doc", "webpage"].includes(artifact.type)
  )) {
    if (!hasArtifactContent(artifact)) {
      issues.push({
        code: `${artifact.type.toUpperCase()}_ARTIFACT_CONTENT_MISSING`,
        message: `${artifact.type} artifact ${artifact.id} is missing uri, contentRef, or inline content metadata.`,
        severity: "error",
      });
    }

    const testStatus = readString(artifact.metadata?.testStatus);
    const typecheckStatus = readString(artifact.metadata?.typecheckStatus);
    if (artifact.type === "code" && testStatus === "failed") {
      issues.push({
        code: "CODE_TESTS_FAILED",
        message: `Code artifact ${artifact.id} has failing tests.`,
        severity: "error",
      });
    }
    if (artifact.type === "code" && typecheckStatus === "failed") {
      issues.push({
        code: "CODE_TYPECHECK_FAILED",
        message: `Code artifact ${artifact.id} has failing typecheck.`,
        severity: "error",
      });
    }
  }

  const expectedCreateNodeCount = countExpectedCanvasOperations(run, "createNode");
  if (expectedCreateNodeCount > 0) {
    const visibleNodeCount = countVisibleCreatedNodes(run);
    if (visibleNodeCount < expectedCreateNodeCount) {
      issues.push({
        code: "CANVAS_NODE_VISIBILITY_MISSING",
        message: `Expected ${expectedCreateNodeCount} created canvas node(s), but ${visibleNodeCount} visibility signal(s) were found.`,
        severity: "error",
      });
    }
  }

  for (const event of run.trace.events.filter(
    (candidate) => candidate.type === "canvas.operation.rejected"
  )) {
    const reason =
      typeof event.payload.reason === "string" && event.payload.reason.trim()
        ? event.payload.reason
        : "Canvas operation was rejected by policy.";
    issues.push({
      code: "CANVAS_OPERATION_REJECTED",
      message: reason,
      severity: "error",
    });
  }

  const dedupedIssues = dedupeIssues(issues);
  const failed = dedupedIssues.some((issue) => issue.severity === "error");
  return {
    passed: !failed,
    issues: dedupedIssues,
    recommendedActions: buildRecommendedActions(dedupedIssues),
    needsRegeneration: dedupedIssues.some((issue) =>
      [
        "IMAGE_ARTIFACT_COUNT_MISMATCH",
        "ARTIFACT_MISSING",
        "IMAGE_ARTIFACT_URL_MISSING",
        "WEBPAGE_ARTIFACT_CONTENT_MISSING",
        "DOC_ARTIFACT_CONTENT_MISSING",
        "CODE_ARTIFACT_CONTENT_MISSING",
        "CANVAS_NODE_VISIBILITY_MISSING",
      ].includes(issue.code)
    ),
  };
}

function countExpectedArtifacts(run: AgentRun) {
  const counts = new Map<string, number>();
  for (const step of run.plan ?? []) {
    for (const artifact of step.expectedArtifacts) {
      counts.set(
        artifact.type,
        (counts.get(artifact.type) ?? 0) + Math.max(artifact.count ?? 1, 1)
      );
    }
  }

  return counts;
}

function countActualArtifacts(run: AgentRun) {
  const counts = new Map<string, number>();
  for (const artifact of run.artifacts) {
    counts.set(artifact.type, (counts.get(artifact.type) ?? 0) + 1);
  }

  return counts;
}

function countExpectedCanvasOperations(
  run: AgentRun,
  operationType: AgentRun["canvasOperations"][number]["type"]
) {
  return (run.plan ?? []).reduce(
    (total, step) =>
      total +
      step.expectedCanvasOperations.filter(
        (operation) => operation.type === operationType
      ).length,
    0
  );
}

function countVisibleCreatedNodes(run: AgentRun) {
  const appliedCreateNodes = run.canvasOperations.filter(
    (operation) => operation.type === "createNode"
  ).length;
  const artifactCanvasNodes = run.trace.events.filter(
    (event) =>
      event.type === "artifact.created" &&
      typeof event.payload.canvasNodeId === "string" &&
      event.payload.canvasNodeId.length > 0
  ).length;

  return appliedCreateNodes + artifactCanvasNodes;
}

function hasArtifactContent(artifact: AgentRun["artifacts"][number]) {
  return Boolean(
    artifact.uri ||
      artifact.contentRef ||
      readString(artifact.metadata?.content) ||
      readString(artifact.metadata?.html)
  );
}

function dedupeIssues(issues: EvaluationResult["issues"]) {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.code}:${issue.message}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function buildRecommendedActions(issues: EvaluationResult["issues"]) {
  if (!issues.length) {
    return [];
  }

  if (
    issues.some((issue) =>
      [
        "IMAGE_ARTIFACT_COUNT_MISMATCH",
        "ARTIFACT_MISSING",
        "IMAGE_ARTIFACT_URL_MISSING",
        "WEBPAGE_ARTIFACT_CONTENT_MISSING",
        "DOC_ARTIFACT_CONTENT_MISSING",
        "CODE_ARTIFACT_CONTENT_MISSING",
        "CANVAS_NODE_VISIBILITY_MISSING",
      ].includes(issue.code)
    )
  ) {
    return ["Regenerate from the failed Run node while preserving upstream context."];
  }

  if (issues.some((issue) => issue.code === "CANVAS_OPERATION_REJECTED")) {
    return ["Review rejected canvas operations in Run Trace before retrying."];
  }

  return ["Review the failed step in Run Trace before retrying."];
}

function readString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}
