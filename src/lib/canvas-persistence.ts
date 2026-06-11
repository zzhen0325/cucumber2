import type { AgentCanvasNode } from "@/types/canvas";

/**
 * Reduce the persisted payload size before saving a canvas snapshot.
 *
 * Markdown nodes store their BlockNote blocks twice: once on `data.blockNoteBlocks`
 * and again on `data.artifact.metadata.blockNoteBlocks`. Readers always prefer
 * `data.blockNoteBlocks` and fall back to the metadata copy, so we can safely drop
 * the metadata duplicate when persisting. This is lossless (the surviving copy is
 * promoted onto `data.blockNoteBlocks`) and roughly halves the rich-text payload
 * for every edited markdown node, which dominates write size on large canvases.
 */
export function toPersistableNodes(
  nodes: AgentCanvasNode[]
): AgentCanvasNode[] {
  return nodes.map((node) => {
    if (node.data.kind !== "markdown") {
      return node;
    }

    const metadata = node.data.artifact.metadata;
    if (!metadata || !("blockNoteBlocks" in metadata)) {
      return node;
    }

    const { blockNoteBlocks: metadataBlocks, ...restMetadata } = metadata;

    return {
      ...node,
      data: {
        ...node.data,
        blockNoteBlocks:
          node.data.blockNoteBlocks ?? (metadataBlocks as unknown[] | undefined),
        artifact: {
          ...node.data.artifact,
          metadata: restMetadata,
        },
      },
    };
  });
}

/**
 * Cheap reference-equality check for whether any node's content (its `data`)
 * changed between two snapshots, ignoring pure position/selection moves.
 *
 * React Flow keeps the same `data` object reference when only dragging or
 * selecting nodes, so this avoids serializing anything: a differing `data`
 * reference (or a changed node set) signals a real content edit. Used to pick a
 * longer save debounce for content edits vs. a short one for structural moves.
 */
export function hasNodeContentChanged(
  prev: AgentCanvasNode[],
  next: AgentCanvasNode[]
): boolean {
  if (prev.length !== next.length) {
    return true;
  }

  const prevById = new Map(prev.map((node) => [node.id, node]));
  for (const node of next) {
    const previous = prevById.get(node.id);
    if (!previous || previous.data !== node.data) {
      return true;
    }
  }

  return false;
}

