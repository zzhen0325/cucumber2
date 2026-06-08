import type { ReactFlowInstance } from "@xyflow/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Dispatch,
  DragEvent,
  SetStateAction,
} from "react";

import { createCanvasNodesFromFiles } from "@/lib/file-upload";
import type { AgentCanvasEdge, AgentCanvasNode } from "@/types/canvas";

type UseCanvasFileDropOptions = {
  canUploadFiles: boolean;
  nodes: AgentCanvasNode[];
  setNodes: Dispatch<SetStateAction<AgentCanvasNode[]>>;
};

export function useCanvasFileDrop({
  canUploadFiles,
  nodes,
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
        const uploadedNodes = await createCanvasNodesFromFiles(
          files,
          position,
          nodes
        );

        setNodes((current) => [
          ...clearSelectedNodes(current),
          ...uploadedNodes.map((node) => ({ ...node, selected: true })),
        ]);
        setUploadError(null);
      } catch (nextError) {
        setUploadError(getClientError(nextError));
      }
    },
    [canUploadFiles, nodes, setNodes]
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

function getClientError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
