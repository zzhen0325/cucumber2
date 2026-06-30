import type { ReactFlowInstance } from "@xyflow/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Dispatch,
  DragEvent,
  SetStateAction,
} from "react";

import { uploadProjectFileAsset } from "@/lib/asset-upload";
import { waitForImageDisplayReady } from "@/lib/image-preload";
import {
  createCanvasNodeFromUploadedFile,
  prepareLocalCanvasUploads,
} from "@/lib/file-upload";
import type { CanvasLocalMutation } from "@/lib/canvas-mutation";
import type { AgentCanvasEdge, AgentCanvasNode } from "@/types/canvas";

type UseCanvasFileDropOptions = {
  canUploadFiles: boolean;
  edges: AgentCanvasEdge[];
  nodes: AgentCanvasNode[];
  projectId: string | null;
  commitCanvasMutation?: (mutation: CanvasLocalMutation) => void;
  setEdges: Dispatch<SetStateAction<AgentCanvasEdge[]>>;
  setNodes: Dispatch<SetStateAction<AgentCanvasNode[]>>;
};

type CanvasScreenPoint = {
  x: number;
  y: number;
};

export function useCanvasFileDrop({
  canUploadFiles,
  commitCanvasMutation,
  edges,
  nodes,
  projectId,
  setEdges,
  setNodes,
}: UseCanvasFileDropOptions) {
  const [uploadDragActive, setUploadDragActive] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const flowInstance = useRef<ReactFlowInstance<
    AgentCanvasNode,
    AgentCanvasEdge
  > | null>(null);
  const fileDragDepth = useRef(0);
  const edgesRef = useRef(edges);

  useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);

  useEffect(() => {
    const clearFileDrag = () => {
      fileDragDepth.current = 0;
      setUploadDragActive(false);
    };

    window.addEventListener("blur", clearFileDrag);
    window.addEventListener("dragend", clearFileDrag);

    return () => {
      window.removeEventListener("blur", clearFileDrag);
      window.removeEventListener("dragend", clearFileDrag);
    };
  }, []);

  const handleCanvasInit = useCallback(
    (instance: ReactFlowInstance<AgentCanvasNode, AgentCanvasEdge>) => {
      flowInstance.current = instance;
    },
    []
  );

  const clearUploadError = useCallback(() => {
    setUploadError(null);
  }, []);

  const showUploadError = useCallback((message: string) => {
    setUploadError(message);
  }, []);

  const handleClipboardFiles = useCallback(
    async (files: readonly File[], screenPoint: CanvasScreenPoint) => {
      if (!files.length) {
        return false;
      }

      if (!canUploadFiles) {
        setUploadError("当前画布不可上传文件");
        return false;
      }
      if (!projectId) {
        setUploadError("项目尚未加载完成");
        return false;
      }

      const instance = flowInstance.current;
      if (!instance) {
        setUploadError("画布尚未就绪，请稍后再试");
        return false;
      }

      try {
        const position = instance.screenToFlowPosition(screenPoint);
        const preparedUploads = await prepareLocalCanvasUploads(
          files,
          position,
          nodes
        );

        setNodes((current) => [
          ...clearSelectedNodes(current),
          ...preparedUploads.map((item) => ({ ...item.localNode, selected: true })),
        ]);
        setUploadError(null);

        for (const item of preparedUploads) {
          let shouldRevokeObjectUrl = false;
          void uploadProjectFileAsset(projectId, item.upload)
            .then(async (artifact) => {
              const finalNode = replaceLocalUploadNode(
                [item.localNode],
                item.localNode.id,
                createCanvasNodeFromUploadedFile(item.upload, artifact)
              )[0];
              await waitForUploadedImageNodeDisplayReady(finalNode);
              const currentEdges = edgesRef.current;
              const replacedEdges = replaceLocalUploadEdges(
                currentEdges,
                item.localNode.id,
                finalNode.id
              );
              const edgeUpserts = replacedEdges.filter(
                (edge, index) => edge !== currentEdges[index]
              );
              if (commitCanvasMutation) {
                commitCanvasMutation({
                  reason: "upload-complete",
                  patch: {
                    edgeUpserts,
                    nodeDeletes: [item.localNode.id],
                    nodeUpserts: [finalNode],
                  },
                  persist: true,
                });
                shouldRevokeObjectUrl = true;
                return;
              }
              setNodes((current) =>
                replaceLocalUploadNode(current, item.localNode.id, finalNode)
              );
              setEdges((current) =>
                replaceLocalUploadEdges(current, item.localNode.id, finalNode.id)
              );
              shouldRevokeObjectUrl = true;
            })
            .catch((nextError: unknown) => {
              const message = getClientError(nextError);
              setNodes((current) =>
                markLocalUploadNodeError(current, item.localNode.id, message)
              );
              setUploadError(message);
            })
            .finally(() => {
              if (item.objectUrl && shouldRevokeObjectUrl) {
                URL.revokeObjectURL(item.objectUrl);
              }
            });
        }

        return true;
      } catch (nextError) {
        setUploadError(getClientError(nextError));
        return false;
      }
    },
    [canUploadFiles, commitCanvasMutation, nodes, projectId, setEdges, setNodes]
  );

  const handleFileDragEnter = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (!isFileDragEvent(event)) {
        return;
      }

      event.preventDefault();
      fileDragDepth.current += 1;
      if (!canUploadFiles) {
        return;
      }

      setUploadError(null);
      setUploadDragActive(true);
    },
    [canUploadFiles]
  );

  const handleFileDragOver = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (!isFileDragEvent(event)) {
        return;
      }

      event.preventDefault();
      event.dataTransfer.dropEffect = canUploadFiles ? "copy" : "none";
      if (canUploadFiles) {
        setUploadDragActive(true);
      }
    },
    [canUploadFiles]
  );

  const handleFileDragLeave = useCallback((event: DragEvent<HTMLElement>) => {
    if (!isFileDragEvent(event)) {
      return;
    }

    event.preventDefault();
    fileDragDepth.current = Math.max(0, fileDragDepth.current - 1);
    if (fileDragDepth.current === 0) {
      setUploadDragActive(false);
    }
  }, []);

  const handleFileDrop = useCallback(
    async (event: DragEvent<HTMLElement>) => {
      if (!isFileDragEvent(event)) {
        return;
      }

      event.preventDefault();
      fileDragDepth.current = 0;
      setUploadDragActive(false);

      if (!canUploadFiles) {
        setUploadError("当前画布不可上传文件");
        return;
      }
      if (!projectId) {
        setUploadError("项目尚未加载完成");
        return;
      }

      const files = Array.from(event.dataTransfer.files);
      if (!files.length) {
        return;
      }

      await handleClipboardFiles(files, {
        x: event.clientX,
        y: event.clientY,
      });
    },
    [canUploadFiles, handleClipboardFiles, projectId]
  );

  return {
    clearUploadError,
    handleClipboardFiles,
    handleCanvasInit,
    handleFileDragEnter,
    handleFileDragLeave,
    handleFileDragOver,
    handleFileDrop,
    uploadDragActive,
    uploadError,
    showUploadError,
  };
}

function clearSelectedNodes(nodes: AgentCanvasNode[]) {
  return nodes.map((node) =>
    node.selected ? { ...node, selected: false } : node
  );
}

function isFileDragEvent(event: DragEvent<HTMLElement>) {
  return Array.from(event.dataTransfer.types).includes("Files");
}

function replaceLocalUploadNode(
  nodes: AgentCanvasNode[],
  localNodeId: string,
  finalNode: AgentCanvasNode
) {
  return nodes.map((node) => {
    if (node.id !== localNodeId) {
      return node;
    }

    return {
      ...finalNode,
      height: node.height ?? finalNode.height,
      measured: node.measured ?? finalNode.measured,
      position: node.position,
      selected: node.selected,
      width: node.width ?? finalNode.width,
    };
  });
}

function markLocalUploadNodeError(
  nodes: AgentCanvasNode[],
  localNodeId: string,
  message: string
) {
  return nodes.map((node) => {
    if (node.id !== localNodeId || !("upload" in node.data)) {
      return node;
    }

    return {
      ...node,
      data: {
        ...node.data,
        status: node.data.kind === "imageResult" ? "error" : undefined,
        upload: {
          ...node.data.upload,
          error: message,
          status: "error" as const,
        },
      },
    } as AgentCanvasNode;
  });
}

function replaceLocalUploadEdges(
  edges: AgentCanvasEdge[],
  localNodeId: string,
  finalNodeId: string
) {
  return edges.map((edge) => {
    if (edge.source !== localNodeId && edge.target !== localNodeId) {
      return edge;
    }

    return {
      ...edge,
      source: edge.source === localNodeId ? finalNodeId : edge.source,
      target: edge.target === localNodeId ? finalNodeId : edge.target,
    };
  });
}

async function waitForUploadedImageNodeDisplayReady(node: AgentCanvasNode) {
  if (node.data.kind !== "imageResult" || !node.data.image.url) {
    return;
  }

  await waitForImageDisplayReady(node.data.image.url);
}

function getClientError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
