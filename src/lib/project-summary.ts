export type ProjectSummaryStats = {
  nodeCount: number;
  imageCount: number;
};

export function getProjectSummaryStats(nodes: unknown[]): ProjectSummaryStats {
  let imageCount = 0;

  for (const node of nodes) {
    if (isImageResultNodeLike(node)) {
      imageCount += 1;
    }
  }

  return {
    nodeCount: nodes.length,
    imageCount,
  };
}

function isImageResultNodeLike(node: unknown) {
  if (!node || typeof node !== "object") {
    return false;
  }

  const candidate = node as { data?: { kind?: unknown } };
  return candidate.data?.kind === "imageResult";
}
