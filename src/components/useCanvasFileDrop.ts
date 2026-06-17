import type { ReactFlowInstance } from "@xyflow/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Dispatch,
  DragEvent,
  SetStateAction,
} from "react";

import { uploadProjectFileAsset } from "@/lib/asset-upload";
import {
  createCanvasNodeFromUploadedFile,
  prepareLocalCanvasUploads,
} from "@/lib/file-upload";
import type { CanvasLocalMutation } from "@/lib/canvas-mutation";
import type { AgentCanvasEdge, AgentCanvasNode } from "@/types/canvas";

type UseCanvasFileDropOptions = {
  canUploadFiles: boolean;
  nodes: AgentCanvasNode[];
  projectId: string | null;
  commitCanvasMutation?: (mutation: CanvasLocalMutation) => void;
  setEdges: Dispatch<SetStateAction<AgentCanvasEdge[]>>;
  setNodes: Dispatch<SetStateAction<AgentCanvasNode[]>>;
};

export function useCanvasFileDrop({
  canUploadFiles,
  commitCanvasMutation,
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

      const instance = flowInstance.current;
      if (!instance) {
        setUploadError("画布尚未就绪，请稍后再试");
        return;
      }

      try {
        const position = instance.screenToFlowPosition({
          x: event.clientX,
          y: event.clientY,
        });
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
          void uploadProjectFileAsset(projectId, item.upload)
            .then((artifact) => {
              const finalNode = replaceLocalUploadNode(
                [item.localNode],
                item.localNode.id,
                createCanvasNodeFromUploadedFile(item.upload, artifact)
              )[0];
              if (commitCanvasMutation) {
                commitCanvasMutation({
                  reason: "upload-complete",
                  patch: {
                    nodeDeletes: [item.localNode.id],
                    nodeUpserts: [finalNode],
                  },
                  persist: true,
                });
                return;
              }
              setNodes((current) =>
                replaceLocalUploadNode(current, item.localNode.id, finalNode)
              );
              setEdges((current) =>
                replaceLocalUploadEdges(current, item.localNode.id, finalNode.id)
              );
            })
            .catch((nextError: unknown) => {
              const message = getClientError(nextError);
              setNodes((current) =>
                markLocalUploadNodeError(current, item.localNode.id, message)
              );
              setUploadError(message);
            })
            .finally(() => {
              if (item.objectUrl) {
                URL.revokeObjectURL(item.objectUrl);
              }
            });
        }
      } catch (nextError) {
        setUploadError(getClientError(nextError));
      }
    },
    [canUploadFiles, commitCanvasMutation, nodes, projectId, setEdges, setNodes]
  );

  return {
    clearUploadError,
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

function getClientError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
