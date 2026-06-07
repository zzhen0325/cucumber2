import {
  Controls,
  MiniMap,
  useReactFlow,
  useEdgesState,
  useNodesState,
  type Node as FlowNode,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import {
  ArrowLeft,
  ArrowUpRight,
  Box,
  Check,
  ChevronDown,
  CircleAlert,
  CircleDot,
  Database,
  Frame,
  Image,
  Layers,
  MousePointer2,
  Palette,
  PenLine,
  Plus,
  Sparkles,
  Type,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";

import { Canvas } from "@/components/ai-elements/canvas";
import { Edge } from "@/components/ai-elements/edge";
import { Node, NodeContent } from "@/components/ai-elements/node";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import { loadProject, updateProject } from "@/lib/project-storage";
import {
  createImageResultNodes,
  createRunDraft,
  extractImagesFromToolOutput,
  getRunReferenceNodeId,
  toolPartFromMessagePart,
} from "@/lib/graph";
import type {
  AgentCanvasEdge,
  AgentCanvasNode,
  CanvasToolPart,
  GeneratedImage,
  ImageResultNodeData,
  PromptNodeData,
  RunNodeData,
} from "@/types/canvas";

const nodeTypes = {
  promptNode: memo(PromptNode),
  runNode: memo(RunNode),
  imageResultNode: memo(ImageResultNode),
} as NodeTypes;

const edgeTypes = {
  animated: Edge.Animated,
  temporary: Edge.Temporary,
};

const initialNodes: AgentCanvasNode[] = [];
const initialEdges: AgentCanvasEdge[] = [];
type StorageStatus = "loading" | "saving" | "saved" | "error";

type CanvasWorkspaceProps = {
  projectId: string;
  onBack: () => void;
};

export function CanvasWorkspace({ projectId, onBack }: CanvasWorkspaceProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<AgentCanvasNode>(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<AgentCanvasEdge>(initialEdges);
  const [loadedProjectId, setLoadedProjectId] = useState<string | null>(null);
  const [projectTitle, setProjectTitle] = useState("Untitled");
  const [prompt, setPrompt] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [contextCount, setContextCount] = useState(0);
  const [storageStatus, setStorageStatus] = useState<StorageStatus>("loading");
  const [storageError, setStorageError] = useState<string | null>(null);
  const activeRunId = useRef<string | null>(null);
  const hasLoadedProject = useRef(false);
  const saveTimer = useRef<ReturnType<typeof window.setTimeout> | null>(null);

  const markRunError = useCallback(
    (runId: string | null, message: string) => {
      if (!runId) {
        return;
      }
      setNodes((current) =>
        current.map((node) => {
          if (node.id !== runId || node.data.kind !== "run") {
            return node;
          }

          return {
            ...node,
            data: {
              ...node.data,
              status: "error",
              error: message,
              toolPart: {
                ...(node.data.toolPart ?? {
                  type: "tool-generate_image",
                  input: { prompt: node.data.prompt },
                }),
                state: "output-error",
                errorText: message,
              } satisfies CanvasToolPart,
            },
          };
        })
      );
    },
    [setNodes]
  );

  const updateRun = useCallback(
    (
      runId: string,
      patch: Partial<Extract<AgentCanvasNode["data"], { kind: "run" }>>
    ) => {
      setNodes((current) =>
        current.map((node) => {
          if (node.id !== runId || node.data.kind !== "run") {
            return node;
          }

          return {
            ...node,
            data: {
              ...node.data,
              ...patch,
            },
          };
        })
      );
    },
    [setNodes]
  );

  const addResultsForRun = useCallback(
    (runId: string, images: GeneratedImage[]) => {
      setNodes((currentNodes) => {
        const runNode = currentNodes.find((node) => node.id === runId);
        if (!runNode) {
          return currentNodes;
        }

        const { resultNodes, resultEdges } = createImageResultNodes(
          runNode,
          images,
          currentNodes
        );

        if (!resultNodes.length) {
          return currentNodes;
        }

        setEdges((currentEdges) => [...currentEdges, ...resultEdges]);
        return [...currentNodes, ...resultNodes];
      });
    },
    [setEdges, setNodes]
  );

  const { messages, sendMessage, status, error, stop } = useChat({
    transport: new DefaultChatTransport({ api: "/api/agent-run" }),
    onError: (nextError) => {
      markRunError(activeRunId.current, nextError.message);
    },
  });

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId),
    [nodes, selectedNodeId]
  );
  const referenceNodeId = getRunReferenceNodeId(selectedNode);
  const referenceNode = referenceNodeId ? selectedNode : undefined;
  const isBusy = status === "submitted" || status === "streaming";
  const canSubmit =
    Boolean(loadedProjectId) && storageStatus !== "loading" && !storageError;

  useEffect(() => {
    let ignore = false;

    hasLoadedProject.current = false;
    activeRunId.current = null;

    loadProject(projectId)
      .then(({ project }) => {
        if (ignore) {
          return;
        }

        setLoadedProjectId(project.id);
        setProjectTitle(project.title);
        setNodes(project.nodes);
        setEdges(project.edges);
        setSelectedNodeId(project.selectedNodeId);
        activeRunId.current = project.lastRunId;
        hasLoadedProject.current = true;
        setStorageStatus("saved");
        setStorageError(null);
      })
      .catch((nextError: unknown) => {
        if (ignore) {
          return;
        }

        setStorageStatus("error");
        setStorageError(getClientError(nextError));
      });

    return () => {
      ignore = true;
    };
  }, [projectId, setEdges, setNodes]);

  useEffect(() => {
    if (!hasLoadedProject.current || !loadedProjectId) {
      return;
    }

    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
    }

    setStorageStatus("saving");
    saveTimer.current = window.setTimeout(() => {
      updateProject({
        projectId: loadedProjectId,
        title: projectTitle,
        nodes,
        edges,
        selectedNodeId,
        lastRunId: activeRunId.current,
      })
        .then(({ project }) => {
          setLoadedProjectId(project.id);
          setStorageStatus("saved");
          setStorageError(null);
        })
        .catch((nextError: unknown) => {
          setStorageStatus("error");
          setStorageError(getClientError(nextError));
        });
    }, 420);

    return () => {
      if (saveTimer.current) {
        window.clearTimeout(saveTimer.current);
      }
    };
  }, [edges, loadedProjectId, nodes, projectTitle, selectedNodeId]);

  useEffect(() => {
    if (error) {
      markRunError(activeRunId.current, error.message);
    }
  }, [error, markRunError]);

  useEffect(() => {
    const runId = activeRunId.current;
    if (!runId) {
      return;
    }

    const assistantMessage = [...messages]
      .reverse()
      .find((message) => message.role === "assistant");
    const toolPart = assistantMessage?.parts
      .map((part) => toolPartFromMessagePart(part))
      .find(Boolean);

    if (!toolPart) {
      if (status === "submitted" || status === "streaming") {
        updateRun(runId, { status: "running" });
      }
      return;
    }

    updateRun(runId, {
      status:
        toolPart.state === "output-error"
          ? "error"
          : toolPart.state === "output-available"
            ? "success"
            : "running",
      toolPart,
      error: toolPart.errorText,
    });

    if (toolPart.state === "output-available") {
      const images = extractImagesFromToolOutput(toolPart.output);
      if (images.length) {
        addResultsForRun(runId, images);
      }
    }
  }, [addResultsForRun, messages, status, updateRun]);

  const handleSubmit = useCallback(
    async (event?: FormEvent<HTMLFormElement>) => {
      event?.preventDefault();
      const value = prompt.trim();
      if (!value || isBusy) {
        return;
      }
      if (!loadedProjectId) {
        setStorageStatus("error");
        setStorageError("项目尚未加载完成");
        return;
      }
      if (storageError) {
        return;
      }

      const anchorId = referenceNodeId;
      const draft = createRunDraft(value, anchorId, nodes, edges);
      activeRunId.current = draft.runNode.id;
      setContextCount(draft.upstreamContext.length);

      setNodes((current) => [...current, draft.promptNode, draft.runNode]);
      setEdges((current) => [...current, ...draft.edges]);
      setPrompt("");
      setSelectedNodeId(null);

      await sendMessage(
        { text: value },
        {
          body: {
            projectId: loadedProjectId,
            runNodeId: draft.runNode.id,
            canvasContext: {
              prompt: value,
              selectedNodeId: anchorId,
              upstreamContext: draft.upstreamContext,
            },
          },
        }
      );
    },
    [
      edges,
      isBusy,
      loadedProjectId,
      nodes,
      prompt,
      referenceNodeId,
      sendMessage,
      setEdges,
      setNodes,
      storageError,
    ]
  );

  return (
    <main className="app-shell">
      <Canvas<AgentCanvasNode, AgentCanvasEdge>
        className="agent-canvas"
        colorMode="light"
        edgeTypes={edgeTypes}
        fitViewOptions={{ maxZoom: 1, padding: 0.32 }}
        maxZoom={1.5}
        minZoom={0.28}
        nodeTypes={nodeTypes}
        nodes={nodes}
        edges={edges}
        onEdgesChange={onEdgesChange}
        onNodesChange={onNodesChange}
        onNodeClick={(_, node) => setSelectedNodeId(node.id)}
        onPaneClick={() => setSelectedNodeId(null)}
        nodesDraggable
        nodesConnectable={false}
        panOnDrag
        proOptions={{ hideAttribution: true }}
      >
        <CanvasAutoFit nodeCount={nodes.length} />
        <Controls position="bottom-right" showInteractive={false} />
        <MiniMap
          pannable
          zoomable
          position="top-right"
          className="canvas-minimap"
        />
      </Canvas>

      <TopBar
        storageError={storageError}
        storageStatus={storageStatus}
        title={projectTitle}
        onBack={onBack}
      />
      <ToolRail />
      <ViewportControls />
      <EmptyState visible={!nodes.length} />

      <Composer
        busy={isBusy}
        canSubmit={canSubmit}
        contextCount={contextCount}
        prompt={prompt}
        referenceNode={referenceNode}
        setPrompt={setPrompt}
        stop={stop}
        onSubmit={handleSubmit}
      />
    </main>
  );
}

function CanvasAutoFit({ nodeCount }: { nodeCount: number }) {
  const { fitView } = useReactFlow<AgentCanvasNode, AgentCanvasEdge>();

  useEffect(() => {
    if (!nodeCount) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      fitView({ duration: 180, maxZoom: 1, padding: 0.32 });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [fitView, nodeCount]);

  return null;
}

function TopBar({
  storageError,
  storageStatus,
  title,
  onBack,
}: {
  storageError: string | null;
  storageStatus: StorageStatus;
  title: string;
  onBack: () => void;
}) {
  return (
    <div className="top-bar">
      <button
        aria-label="返回项目列表"
        className="top-back-button"
        onClick={onBack}
        title="返回项目列表"
        type="button"
      >
        <ArrowLeft size={15} />
      </button>
      <div className="brand-mark">
        <Sparkles size={17} />
      </div>
      <span>{title}</span>
      <span
        className={`storage-chip ${storageStatus}`}
        title={storageError ?? getStorageStatusLabel(storageStatus)}
      >
        <Database size={13} />
        {getStorageStatusLabel(storageStatus)}
      </span>
    </div>
  );
}

function ToolRail() {
  const tools = [
    { icon: MousePointer2, label: "Select", active: true },
    { icon: PenLine, label: "Draw" },
    { icon: Type, label: "Text" },
    { icon: Frame, label: "Frame" },
    { icon: Plus, label: "Insert" },
    { icon: Image, label: "Image" },
    { icon: Box, label: "Container" },
    { icon: ArrowUpRight, label: "Connector" },
  ];

  return (
    <aside className="tool-rail" aria-label="Canvas tools">
      {tools.map(({ icon: Icon, label, active }) => (
        <button
          aria-label={label}
          className={active ? "active" : ""}
          key={label}
          type="button"
          title={label}
        >
          <Icon size={16} />
        </button>
      ))}
    </aside>
  );
}

function ViewportControls() {
  return (
    <div className="viewport-controls">
      <button aria-label="Background color" type="button">
        <Palette size={14} />
      </button>
      <button aria-label="Layers" type="button">
        <Layers size={14} />
      </button>
      <button aria-label="Generated files" type="button">
        <Image size={14} />
      </button>
      <span className="divider" />
      <button aria-label="Zoom out" type="button">
        <ZoomOut size={14} />
      </button>
      <span className="zoom-label">100%</span>
      <button aria-label="Zoom in" type="button">
        <ZoomIn size={14} />
      </button>
    </div>
  );
}

function EmptyState({ visible }: { visible: boolean }) {
  if (!visible) {
    return null;
  }

  return (
    <div className="empty-state">
      <CircleDot size={18} />
      <span>输入需求，生成第一个 Agent Run</span>
    </div>
  );
}

function Composer({
  busy,
  canSubmit,
  contextCount,
  prompt,
  referenceNode,
  setPrompt,
  stop,
  onSubmit,
}: {
  busy: boolean;
  canSubmit: boolean;
  contextCount: number;
  prompt: string;
  referenceNode?: AgentCanvasNode;
  setPrompt: (value: string) => void;
  stop: () => void;
  onSubmit: (event?: FormEvent<HTMLFormElement>) => void;
}) {
  const hasReference = Boolean(referenceNode);

  return (
    <div className="composer-wrap">
      <div className="context-pill" data-active={hasReference}>
        {hasReference
          ? `引用节点: ${getReferenceNodeLabel(referenceNode)}`
          : "未引用节点"}
      </div>
      <PromptInput
        className="composer"
        onSubmit={(_, event) => onSubmit(event)}
      >
        <PromptInputBody>
          <PromptInputTextarea
            disabled={!canSubmit && !busy}
            placeholder={
              !canSubmit
                ? "项目连接失败，无法提交..."
                : hasReference
                  ? "基于引用节点继续生成..."
                  : "输入需求，让 Agent 生成图片..."
            }
            value={prompt}
            onChange={(event) => setPrompt(event.currentTarget.value)}
          />
        </PromptInputBody>
        <PromptInputFooter className="composer-footer">
          <span>
            {hasReference
              ? "继续基于引用节点生成分支"
              : `${contextCount} upstream items`}
          </span>
          <PromptInputSubmit
            disabled={!prompt.trim() || !canSubmit}
            onStop={stop}
            status={busy ? "streaming" : "ready"}
          />
        </PromptInputFooter>
      </PromptInput>
    </div>
  );
}

function getReferenceNodeLabel(node?: AgentCanvasNode) {
  if (!node) {
    return "";
  }

  if (node.data.kind === "prompt") {
    return node.data.prompt;
  }

  if (node.data.kind === "imageResult") {
    return node.data.image.title ?? "Generated image";
  }

  return "";
}

function getStorageStatusLabel(status: StorageStatus) {
  const labels: Record<StorageStatus, string> = {
    error: "数据库错误",
    loading: "连接中",
    saved: "已存储",
    saving: "保存中",
  };

  return labels[status];
}

function getClientError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function PromptNode({
  data,
  selected,
}: NodeProps<FlowNode<PromptNodeData, "promptNode">>) {
  return (
    <Node
      className={
        selected ? "canvas-node selected prompt-card" : "canvas-node prompt-card"
      }
      handles={{ source: true, target: true }}
    >
      <NodeContent className="prompt-content">
        <p title={data.contextLabel}>{data.prompt}</p>
      </NodeContent>
    </Node>
  );
}

function RunNode({
  data,
  selected,
}: NodeProps<FlowNode<RunNodeData, "runNode">>) {
  const [expanded, setExpanded] = useState(true);
  const toolPart = data.toolPart ?? {
    type: "tool-generate_image",
    state: "input-streaming",
    input: { prompt: data.prompt },
  } satisfies CanvasToolPart;

  const statusIcon =
    data.status === "success" ? (
      <Check size={14} />
    ) : data.status === "error" ? (
      <CircleAlert size={14} />
    ) : (
      <Sparkles size={14} />
    );

  const hasToolDetail =
    data.status !== "queued" || toolPart.state !== "input-streaming";
  const title = getRunTitle(data.status, toolPart.state);
  const toggleLabel = expanded ? "收起工具调用" : "展开工具调用";

  return (
    <Node
      className={selected ? "canvas-node selected run-card" : "canvas-node run-card"}
      handles={{ source: true, target: true }}
    >
      <NodeContent className="run-content">
        <div className="run-heading">
          <span className={`run-status-dot ${data.status}`}>{statusIcon}</span>
          <span className="run-title">{title}</span>
          <button
            aria-expanded={expanded}
            aria-label={toggleLabel}
            className="run-toggle nodrag nopan"
            data-expanded={expanded}
            disabled={!hasToolDetail}
            onClick={(event) => {
              event.stopPropagation();
              setExpanded((current) => !current);
            }}
            title={toggleLabel}
            type="button"
          >
            <ChevronDown size={12} />
          </button>
        </div>
        {hasToolDetail && expanded && (
          <div className="tool-stream">
            <ToolCallRow error={data.error} toolPart={toolPart} />
          </div>
        )}
      </NodeContent>
    </Node>
  );
}

function ToolCallRow({
  error,
  toolPart,
}: {
  error?: string;
  toolPart: CanvasToolPart;
}) {
  const toolName = getToolName(toolPart);
  const stateLabel = getToolStateLabel(toolPart.state);
  const detailLines = getToolDetailLines(toolPart, error);
  const isError = toolPart.state === "output-error";

  return (
    <div className={isError ? "tool-call-row error" : "tool-call-row"}>
      <div className="tool-call-main">
        <span className="tool-call-action">
          {toolPart.state === "output-available" ? "完成" : "调用"}
        </span>
        <strong title={toolName}>{toolName}</strong>
        <span className={`tool-state ${toolPart.state}`}>
          {getToolStateIcon(toolPart.state)}
          {stateLabel}
        </span>
      </div>
      <div className="tool-call-detail">
        {detailLines.map((line) => (
          <small className="tool-detail-line" key={line} title={line}>
            {line}
          </small>
        ))}
      </div>
    </div>
  );
}

function getRunTitle(status: RunNodeData["status"], state: CanvasToolPart["state"]) {
  if (status === "error" || state === "output-error") {
    return "生成失败";
  }

  if (status === "success" || state === "output-available") {
    return "生成完成";
  }

  if (state === "input-available") {
    return "调用工具";
  }

  if (state === "approval-requested") {
    return "等待确认";
  }

  return "Thinking...";
}

function getToolName(toolPart: CanvasToolPart) {
  return toolPart.type.slice("tool-".length);
}

function getToolStateIcon(state: CanvasToolPart["state"]) {
  if (state === "output-available" || state === "approval-responded") {
    return <Check size={11} />;
  }

  if (state === "output-error" || state === "output-denied") {
    return <CircleAlert size={11} />;
  }

  return <Sparkles size={11} />;
}

function getToolStateLabel(state: CanvasToolPart["state"]) {
  const labels: Record<CanvasToolPart["state"], string> = {
    "approval-requested": "等待确认",
    "approval-responded": "已确认",
    "input-available": "运行中",
    "input-streaming": "准备参数",
    "output-available": "输出完成",
    "output-denied": "已拒绝",
    "output-error": "失败",
  };

  return labels[state];
}

function getToolDetailLines(toolPart: CanvasToolPart, error?: string) {
  if (toolPart.state === "output-error") {
    return [error ?? toolPart.errorText ?? "工具调用失败"];
  }

  if (toolPart.state === "output-available") {
    const images = extractImagesFromToolOutput(toolPart.output);
    return [
      images.length ? `输出 ${images.length} 张图片` : "输出已返回",
      ...getToolInputLines(toolPart.input),
    ].slice(0, 3);
  }

  if (toolPart.state === "output-denied") {
    return ["工具调用被拒绝"];
  }

  return getToolInputLines(toolPart.input);
}

function getToolInputLines(input: unknown) {
  if (!input || typeof input !== "object") {
    return ["等待工具参数"];
  }

  const candidate = input as {
    prompt?: unknown;
    upstreamContext?: unknown;
  };
  const lines: string[] = [];

  if (typeof candidate.prompt === "string" && candidate.prompt.trim()) {
    lines.push(`输入: ${candidate.prompt.trim()}`);
  }

  if (Array.isArray(candidate.upstreamContext)) {
    lines.push(`上游上下文: ${candidate.upstreamContext.length} 项`);
  }

  return lines.length ? lines : ["工具参数已就绪"];
}

function ImageResultNode({
  data,
  selected,
}: NodeProps<FlowNode<ImageResultNodeData, "imageResultNode">>) {
  return (
    <Node
      className={
        selected ? "canvas-node selected result-card" : "canvas-node result-card"
      }
      handles={{ source: true, target: true }}
    >
      <div className="result-image-frame">
        <img src={data.image.url} alt={data.image.title ?? "Generated result"} />
      </div>
      {selected && <NodeFooterLike image={data.image} />}
    </Node>
  );
}

function NodeFooterLike({ image }: { image: GeneratedImage }) {
  return (
    <div className="result-footer">
      <span>{image.title ?? "Generated image"}</span>
      <span>Follow up</span>
    </div>
  );
}
