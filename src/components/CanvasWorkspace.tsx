import {
  Controls,
  MiniMap,
  SelectionMode,
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
  Cpu,
  Database,
  FileText,
  Frame,
  Globe2,
  Image,
  Layers,
  ListTree,
  MousePointer2,
  Palette,
  PenLine,
  Plus,
  Sparkles,
  Type,
  WandSparkles,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";

import { Canvas } from "@/components/ai-elements/canvas";
import { Edge } from "@/components/ai-elements/edge";
import { FileUploadOverlay } from "@/components/FileUploadOverlay";
import { MarkdownPreview } from "@/components/MarkdownPreview";
import { Node, NodeContent } from "@/components/ai-elements/node";
import { ReplayBanner, RunTracePanel } from "@/components/RunTracePanel";
import { SkillPanel } from "@/components/SkillPanel";
import { useCanvasFileDrop } from "@/components/useCanvasFileDrop";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  isModelProviderId,
  loadModelProviders,
  readStoredModelProvider,
  storeModelProvider,
  type ModelProviderId,
  type ModelProviderSummary,
} from "@/lib/model-providers";
import {
  loadProject,
  loadRunTrace,
  updateProject,
} from "@/lib/project-storage";
import {
  createRunDraft,
  extractImagesFromToolOutput,
  shouldCreateMarkdownFromAgentText,
  getRunReferenceNodeId,
  textFromMessageParts,
  toolPartsFromMessageParts,
} from "@/lib/graph";
import {
  projectRunTraceToCanvas,
  projectToolOutputToCanvas,
  type RunStepTraceEvent,
} from "@/lib/graph-projection";
import type {
  AgentCanvasEdge,
  AgentCanvasNode,
  CanvasToolPart,
  GeneratedImage,
  ImageResultNodeData,
  MarkdownNodeData,
  PromptNodeData,
  RunNodeData,
} from "@/types/canvas";

const nodeTypes = {
  artifactNode: memo(ArtifactLikeNode),
  codeNode: memo(ArtifactLikeNode),
  decisionNode: memo(ArtifactLikeNode),
  documentNode: memo(ArtifactLikeNode),
  memoryNode: memo(ArtifactLikeNode),
  promptNode: memo(PromptNode),
  runNode: memo(RunNode),
  imageResultNode: memo(ImageResultNode),
  markdownNode: memo(MarkdownNode),
  toolResultNode: memo(ArtifactLikeNode),
  webpageNode: memo(ArtifactLikeNode),
} as NodeTypes;

const edgeTypes = {
  animated: Edge.Animated,
  temporary: Edge.Temporary,
};

const initialNodes: AgentCanvasNode[] = [];
const initialEdges: AgentCanvasEdge[] = [];
type StorageStatus = "loading" | "saving" | "saved" | "error";
type AgentRunRequestBody = {
  projectId: string;
  runNodeId: string;
  modelProvider: ModelProviderId;
  canvasContext: {
    prompt: string;
    promptNodeId: string;
    selectedNodeId: string | null;
    upstreamContext: ReturnType<typeof createRunDraft>["upstreamContext"];
    contextTrace: ReturnType<typeof createRunDraft>["contextTrace"];
  };
};

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
  const [contextCount, setContextCount] = useState(0);
  const [storageStatus, setStorageStatus] = useState<StorageStatus>("loading");
  const [storageError, setStorageError] = useState<string | null>(null);
  const [skillPanelOpen, setSkillPanelOpen] = useState(false);
  const [traceRunId, setTraceRunId] = useState<string | null>(null);
  const [traceEvents, setTraceEvents] = useState<RunStepTraceEvent[]>([]);
  const [traceLoading, setTraceLoading] = useState(false);
  const [traceError, setTraceError] = useState<string | null>(null);
  const [replaySnapshot, setReplaySnapshot] = useState<{
    runNodeId: string;
    nodes: AgentCanvasNode[];
    edges: AgentCanvasEdge[];
  } | null>(null);
  const [modelProvider, setModelProvider] = useState<ModelProviderId>(
    () => readStoredModelProvider() ?? "deepseek"
  );
  const [modelProviders, setModelProviders] = useState<ModelProviderSummary[]>([]);
  const [modelProviderError, setModelProviderError] = useState<string | null>(null);
  const activeRunId = useRef<string | null>(null);
  const activeRunRequest = useRef<AgentRunRequestBody | null>(null);
  const hasLoadedProject = useRef(false);
  const saveTimer = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const isReplayMode = Boolean(replaySnapshot);
  const canvasNodes = replaySnapshot?.nodes ?? nodes;
  const canvasEdges = replaySnapshot?.edges ?? edges;

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
                  type: "tool-expand_prompt",
                  input: { prompt: node.data.prompt },
                }),
                state: "output-error",
                errorText: message,
              } satisfies CanvasToolPart,
              toolParts: [
                ...(node.data.toolParts ?? []),
                {
                  type: "tool-expand_prompt",
                  state: "output-error",
                  input: { prompt: node.data.prompt },
                  errorText: message,
                },
              ],
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
    (runId: string, output: unknown) => {
      setNodes((currentNodes) => {
        const runNode = currentNodes.find((node) => node.id === runId);
        if (!runNode) {
          return currentNodes;
        }

        const { resultNodes, resultEdges } = projectToolOutputToCanvas(
          runNode,
          output,
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

  const addMarkdownForRun = useCallback(
    (runId: string, content: string) => {
      setNodes((currentNodes) => {
        const runNode = currentNodes.find((node) => node.id === runId);
        if (!runNode || runNode.data.kind !== "run") {
          return currentNodes;
        }

        const { resultNodes, resultEdges } = projectToolOutputToCanvas(
          runNode,
          {
            markdown: content,
            id: `${runId}-agent-text`,
            title: "分析文档",
          },
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

  const {
    addToolApprovalResponse,
    messages,
    sendMessage,
    status,
    error,
    stop,
  } = useChat({
    transport: new DefaultChatTransport({ api: "/api/agent-run" }),
    onError: (nextError) => {
      markRunError(activeRunId.current, nextError.message);
    },
  });

  const selectedNodeIds = useMemo(
    () => nodes.filter((node) => node.selected).map((node) => node.id),
    [nodes]
  );
  const selectedNode = useMemo(() => {
    if (selectedNodeIds.length !== 1) {
      return undefined;
    }

    return nodes.find((node) => node.id === selectedNodeIds[0]);
  }, [nodes, selectedNodeIds]);
  const referenceNodeId = getRunReferenceNodeId(selectedNode);
  const referenceNode = referenceNodeId ? selectedNode : undefined;
  const persistedSelectedNodeId = referenceNodeId ?? null;
  const isBusy = status === "submitted" || status === "streaming";
  const hasPendingApproval = useMemo(
    () =>
      nodes.some(
        (node) =>
          node.data.kind === "run" &&
          (node.data.toolParts ?? [node.data.toolPart]).some(
            (part) =>
              part?.state === "approval-requested" &&
              part.approval?.approved === undefined
          )
      ),
    [nodes]
  );
  const canSubmit =
    Boolean(loadedProjectId) &&
    storageStatus !== "loading" &&
    !storageError &&
    !hasPendingApproval &&
    !isReplayMode;
  const canUploadFiles =
    Boolean(loadedProjectId) &&
    storageStatus !== "loading" &&
    !storageError &&
    !isReplayMode;
  const fileDrop = useCanvasFileDrop({
    canUploadFiles,
    nodes,
    setNodes,
  });

  useEffect(() => {
    let ignore = false;

    loadModelProviders()
      .then(({ defaultProvider, providers }) => {
        if (ignore) {
          return;
        }

        setModelProviders(providers);
        setModelProviderError(null);
        if (!readStoredModelProvider()) {
          setModelProvider(defaultProvider);
        }
      })
      .catch((nextError: unknown) => {
        if (!ignore) {
          setModelProviderError(getClientError(nextError));
        }
      });

    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    const handleOpenTrace = (event: Event) => {
      const detail = (event as CustomEvent<{ runNodeId?: unknown }>).detail;
      if (typeof detail?.runNodeId === "string") {
        setTraceEvents([]);
        setTraceError(null);
        setTraceLoading(true);
        setTraceRunId(detail.runNodeId);
      }
    };

    window.addEventListener("cucumber:open-run-trace", handleOpenTrace);

    return () => {
      window.removeEventListener("cucumber:open-run-trace", handleOpenTrace);
    };
  }, []);

  useEffect(() => {
    let ignore = false;

    hasLoadedProject.current = false;
    activeRunId.current = null;
    activeRunRequest.current = null;

    loadProject(projectId)
      .then(({ project }) => {
        if (ignore) {
          return;
        }

        setLoadedProjectId(project.id);
        setProjectTitle(project.title);
        setTraceRunId(null);
        setTraceEvents([]);
        setTraceError(null);
        setTraceLoading(false);
        setReplaySnapshot(null);
        const nextSelectedNodeIds = getInitialSelectedNodeIds(
          project.nodes,
          project.selectedNodeId
        );
        setNodes(applySelectedNodeIds(project.nodes, nextSelectedNodeIds));
        setEdges(project.edges);
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
    if (!traceRunId || !loadedProjectId) {
      return;
    }

    let ignore = false;

    loadRunTrace(loadedProjectId, traceRunId)
      .then(({ events }) => {
        if (!ignore) {
          setTraceEvents(events);
        }
      })
      .catch((nextError: unknown) => {
        if (!ignore) {
          setTraceError(getClientError(nextError));
          setTraceEvents([]);
        }
      })
      .finally(() => {
        if (!ignore) {
          setTraceLoading(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [loadedProjectId, traceRunId]);

  useEffect(() => {
    if (!hasLoadedProject.current || !loadedProjectId || isReplayMode) {
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
        selectedNodeId: persistedSelectedNodeId,
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
  }, [
    edges,
    isReplayMode,
    loadedProjectId,
    nodes,
    persistedSelectedNodeId,
    projectTitle,
  ]);

  useEffect(() => {
    if (error) {
      markRunError(activeRunId.current, error.message);
    }
  }, [error, markRunError]);

  useEffect(() => {
    const handleApprovalResponse = (event: Event) => {
      const detail = (
        event as CustomEvent<{ approvalId?: unknown; approved?: unknown }>
      ).detail;
      if (
        typeof detail?.approvalId !== "string" ||
        typeof detail.approved !== "boolean"
      ) {
        return;
      }

      const requestBody = activeRunRequest.current;
      const approvalId = detail.approvalId;
      const approved = detail.approved;
      if (!requestBody) {
        markRunError(activeRunId.current, "审批上下文已失效，请重新提交。");
        return;
      }

      void (async () => {
        try {
          await addToolApprovalResponse({
            id: approvalId,
            approved,
            reason: approved ? "用户确认执行" : "用户拒绝执行",
          });
          await sendMessage(undefined, {
            body: requestBody,
          });
        } catch (nextError) {
          markRunError(activeRunId.current, getClientError(nextError));
        }
      })();
    };

    window.addEventListener(
      "cucumber:respond-tool-approval",
      handleApprovalResponse
    );

    return () => {
      window.removeEventListener(
        "cucumber:respond-tool-approval",
        handleApprovalResponse
      );
    };
  }, [addToolApprovalResponse, markRunError, sendMessage]);

  useEffect(() => {
    const runId = activeRunId.current;
    if (!runId) {
      return;
    }

    const assistantMessage = [...messages]
      .reverse()
      .find((message) => message.role === "assistant");
    const toolParts = toolPartsFromMessageParts(assistantMessage?.parts);
    const toolPart = toolParts.find((part) => part.type === "tool-generate_image")
      ?? toolParts.at(-1);
    const agentText = textFromMessageParts(assistantMessage?.parts);

    if (!toolPart) {
      if (status === "submitted" || status === "streaming") {
        updateRun(runId, { status: "running", agentText });
      } else if (
        shouldCreateMarkdownFromAgentText(
          activeRunRequest.current?.canvasContext.prompt ?? "",
          agentText
        )
      ) {
        updateRun(runId, { status: "success", agentText });
        addMarkdownForRun(runId, agentText);
      }
      return;
    }

    updateRun(runId, {
      status:
        toolParts.some(
          (part) => part.state === "output-error" || part.state === "output-denied"
        )
          ? "error"
          : toolParts.some(
                (part) =>
                  part.type === "tool-generate_image" &&
                  part.state === "output-available"
              )
            ? "success"
            : "running",
      agentText,
      toolPart,
      toolParts,
      error: toolPart.errorText,
    });

    for (const outputToolPart of toolParts.filter(
      (part) => part.state === "output-available"
    )) {
      addResultsForRun(runId, outputToolPart.output);
    }
  }, [addMarkdownForRun, addResultsForRun, messages, status, updateRun]);

  const handleSubmit = useCallback(
    async (event?: FormEvent<HTMLFormElement>) => {
      event?.preventDefault();
      const value = prompt.trim();
      if (!value || isBusy || hasPendingApproval) {
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
      const requestBody: AgentRunRequestBody = {
        projectId: loadedProjectId,
        runNodeId: draft.runNode.id,
        modelProvider,
        canvasContext: {
          prompt: value,
          promptNodeId: draft.promptNode.id,
          selectedNodeId: anchorId,
          upstreamContext: draft.upstreamContext,
          contextTrace: draft.contextTrace,
        },
      };
      activeRunRequest.current = requestBody;

      setNodes((current) => [
        ...applySelectedNodeIds(current, []),
        draft.promptNode,
        draft.runNode,
      ]);
      setEdges((current) => [...current, ...draft.edges]);
      setPrompt("");

      await sendMessage(
        { text: value },
        {
          body: requestBody,
        }
      );
    },
    [
      edges,
      hasPendingApproval,
      isBusy,
      loadedProjectId,
      modelProvider,
      nodes,
      prompt,
      referenceNodeId,
      sendMessage,
      setEdges,
      setNodes,
      storageError,
    ]
  );

  const handleModelProviderChange = useCallback((nextProvider: string) => {
    if (!isModelProviderId(nextProvider)) {
      return;
    }

    setModelProvider(nextProvider);
    storeModelProvider(nextProvider);
  }, []);

  const handleReplayTrace = useCallback(() => {
    if (!traceRunId || !loadedProjectId || !traceEvents.length) {
      return;
    }

    const projection = projectRunTraceToCanvas({
      projectId: loadedProjectId,
      runNodeId: traceRunId,
      events: traceEvents,
      existingNodes: nodes,
      existingEdges: edges,
    });

    setReplaySnapshot({
      runNodeId: traceRunId,
      nodes: projection.nodes,
      edges: projection.edges,
    });
  }, [edges, loadedProjectId, nodes, traceEvents, traceRunId]);

  const handleExitReplay = useCallback(() => {
    setReplaySnapshot(null);
  }, []);

  const handleCloseTrace = useCallback(() => {
    setTraceRunId(null);
    setTraceEvents([]);
    setTraceError(null);
  }, []);

  return (
    <main
      className="app-shell"
      onDragEnter={fileDrop.handleFileDragEnter}
      onDragLeave={fileDrop.handleFileDragLeave}
      onDragOver={fileDrop.handleFileDragOver}
      onDrop={fileDrop.handleFileDrop}
    >
      <Canvas<AgentCanvasNode, AgentCanvasEdge>
        className="agent-canvas"
        colorMode="light"
        edgeTypes={edgeTypes}
        fitViewOptions={{ maxZoom: 1, padding: 0.32 }}
        maxZoom={1.5}
        minZoom={0.28}
        nodeTypes={nodeTypes}
        nodes={canvasNodes}
        edges={canvasEdges}
        onInit={fileDrop.handleCanvasInit}
        onEdgesChange={isReplayMode ? undefined : onEdgesChange}
        onNodesChange={isReplayMode ? undefined : onNodesChange}
        onPaneClick={() => {
          if (!isReplayMode) {
            setNodes((current) => applySelectedNodeIds(current, []));
          }
        }}
        selectionMode={SelectionMode.Partial}
        nodesDraggable={!isReplayMode}
        nodesConnectable={false}
        panOnDrag={false}
        proOptions={{ hideAttribution: true }}
      >
        <CanvasAutoFit nodeCount={canvasNodes.length} />
        <Controls position="bottom-right" showInteractive={false} />
        <MiniMap
          pannable
          zoomable
          position="top-right"
          className="canvas-minimap"
        />
      </Canvas>

      <TopBar
        modelProvider={modelProvider}
        modelProviderError={modelProviderError}
        modelProviders={modelProviders}
        storageError={storageError}
        storageStatus={storageStatus}
        title={projectTitle}
        onBack={onBack}
        onModelProviderChange={handleModelProviderChange}
      />
      <ToolRail />
      <ViewportControls
        skillPanelOpen={skillPanelOpen}
        onToggleSkills={() => setSkillPanelOpen((current) => !current)}
      />
      <SkillPanel
        open={skillPanelOpen}
        onClose={() => setSkillPanelOpen(false)}
      />
      <RunTracePanel
        error={traceError}
        events={traceEvents}
        loading={traceLoading}
        open={Boolean(traceRunId)}
        replayActive={isReplayMode}
        runNodeId={traceRunId}
        onClose={handleCloseTrace}
        onExitReplay={handleExitReplay}
        onReplay={handleReplayTrace}
      />
      <ReplayBanner
        activeRunId={replaySnapshot?.runNodeId ?? null}
        onExit={handleExitReplay}
      />
      <FileUploadOverlay
        active={fileDrop.uploadDragActive && canUploadFiles}
        error={fileDrop.uploadError}
        onDismiss={fileDrop.clearUploadError}
      />
      <EmptyState visible={!nodes.length && !isReplayMode} />

      <Composer
        busy={isBusy}
        canSubmit={canSubmit}
        approvalPending={hasPendingApproval}
        contextCount={contextCount}
        prompt={prompt}
        referenceNode={referenceNode}
        replayActive={isReplayMode}
        selectionCount={selectedNodeIds.length}
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

function getInitialSelectedNodeIds(
  nodes: AgentCanvasNode[],
  selectedNodeId: string | null
) {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const selectedNodeIds = nodes
    .filter((node) => node.selected)
    .map((node) => node.id);

  if (selectedNodeIds.length) {
    return selectedNodeIds;
  }

  return selectedNodeId && nodeIds.has(selectedNodeId) ? [selectedNodeId] : [];
}

function applySelectedNodeIds(
  nodes: AgentCanvasNode[],
  selectedNodeIds: string[]
) {
  const selectedNodeIdSet = new Set(selectedNodeIds);

  return nodes.map((node) => {
    const selected = selectedNodeIdSet.has(node.id);
    return node.selected === selected ? node : { ...node, selected };
  });
}

function TopBar({
  modelProvider,
  modelProviderError,
  modelProviders,
  storageError,
  storageStatus,
  title,
  onBack,
  onModelProviderChange,
}: {
  modelProvider: ModelProviderId;
  modelProviderError: string | null;
  modelProviders: ModelProviderSummary[];
  storageError: string | null;
  storageStatus: StorageStatus;
  title: string;
  onBack: () => void;
  onModelProviderChange: (provider: string) => void;
}) {
  const selectedProvider = modelProviders.find(
    (provider) => provider.id === modelProvider
  );
  const providerTitle = modelProviderError
    ? modelProviderError
    : selectedProvider
      ? `${selectedProvider.label} · ${selectedProvider.model} · ${
          selectedProvider.configured ? "已配置" : "未配置"
        }`
      : "AI provider";

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
      <Select value={modelProvider} onValueChange={onModelProviderChange}>
        <SelectTrigger
          aria-label="AI model provider"
          className="provider-select-trigger"
          size="sm"
          title={providerTitle}
        >
          <Cpu size={13} />
          <SelectValue placeholder="Model" />
        </SelectTrigger>
        <SelectContent align="start" className="provider-select-content">
          {(modelProviders.length
            ? modelProviders
            : [
                {
                  id: modelProvider,
                  label: modelProvider,
                  configured: false,
                  model: "loading",
                  capabilities: { text: true, vision: false },
                } satisfies ModelProviderSummary,
              ]
          ).map((provider) => (
            <SelectItem key={provider.id} value={provider.id}>
              <span>{provider.label}</span>
              <span className={provider.configured ? "configured" : "unconfigured"}>
                {provider.configured ? "已配置" : "未配置"}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function ToolRail() {
  const tools = [
    { icon: MousePointer2, label: "Select", active: true },
    { icon: PenLine, label: "Draw", disabled: true },
    { icon: Type, label: "Text", disabled: true },
    { icon: Frame, label: "Frame", disabled: true },
    { icon: Plus, label: "Insert", disabled: true },
    { icon: Image, label: "Image", disabled: true },
    { icon: Box, label: "Container", disabled: true },
    { icon: ArrowUpRight, label: "Connector", disabled: true },
  ];

  return (
    <aside className="tool-rail" aria-label="Canvas tools">
      {tools.map(({ icon: Icon, label, active, disabled }) => (
        <button
          aria-label={label}
          className={active ? "active" : ""}
          disabled={disabled}
          key={label}
          type="button"
          title={disabled ? "暂未开放" : label}
        >
          <Icon size={16} />
        </button>
      ))}
    </aside>
  );
}

function ViewportControls({
  skillPanelOpen,
  onToggleSkills,
}: {
  skillPanelOpen: boolean;
  onToggleSkills: () => void;
}) {
  return (
    <div className="viewport-controls">
      <button aria-label="Background color" disabled title="暂未开放" type="button">
        <Palette size={14} />
      </button>
      <button aria-label="Layers" disabled title="暂未开放" type="button">
        <Layers size={14} />
      </button>
      <button aria-label="Generated files" disabled title="暂未开放" type="button">
        <Image size={14} />
      </button>
      <button
        aria-label="Skills"
        className={skillPanelOpen ? "active" : ""}
        onClick={onToggleSkills}
        title="Skills"
        type="button"
      >
        <WandSparkles size={14} />
      </button>
      <span className="divider" />
      <button aria-label="Zoom out" disabled title="暂未开放" type="button">
        <ZoomOut size={14} />
      </button>
      <span className="zoom-label">100%</span>
      <button aria-label="Zoom in" disabled title="暂未开放" type="button">
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
  approvalPending,
  contextCount,
  prompt,
  referenceNode,
  replayActive,
  selectionCount,
  setPrompt,
  stop,
  onSubmit,
}: {
  busy: boolean;
  canSubmit: boolean;
  approvalPending: boolean;
  contextCount: number;
  prompt: string;
  referenceNode?: AgentCanvasNode;
  replayActive: boolean;
  selectionCount: number;
  setPrompt: (value: string) => void;
  stop: () => void;
  onSubmit: (event?: FormEvent<HTMLFormElement>) => void;
}) {
  const hasReference = Boolean(referenceNode);
  const hasMultiSelection = selectionCount > 1;

  return (
    <div className="composer-wrap">
      <div className="context-pill" data-active={hasReference}>
        {hasReference
          ? `引用节点: ${getReferenceNodeLabel(referenceNode)}`
          : hasMultiSelection
            ? `已选中 ${selectionCount} 个节点`
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
              replayActive
                ? "Run 回放模式为只读..."
                : approvalPending
                ? "请先处理 Run 节点中的确认..."
                : !canSubmit
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

  if ("artifact" in node.data) {
    return node.data.title;
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

type ArtifactLikeNodeData = Extract<
  AgentCanvasNode["data"],
  {
    kind:
      | "artifact"
      | "markdown"
      | "decision"
      | "memory"
      | "toolResult"
      | "document"
      | "code"
      | "webpage";
  }
>;
type ArtifactLikeNodeProps = NodeProps<FlowNode<ArtifactLikeNodeData, string>>;

function ArtifactLikeNode({ data, selected }: ArtifactLikeNodeProps) {
  const label = getArtifactNodeLabel(data);
  const summary = getArtifactNodeSummary(data);

  return (
    <Node
      className={
        selected
          ? `canvas-node selected artifact-card ${data.kind}`
          : `canvas-node artifact-card ${data.kind}`
      }
      handles={{ source: true, target: true }}
    >
      <NodeContent className="artifact-content">
        <div className="artifact-heading">
          <span className="artifact-icon">
            <ArtifactNodeIcon kind={data.kind} />
          </span>
          <span>{label}</span>
        </div>
        <strong title={data.title}>{data.title}</strong>
        {summary && <p title={summary}>{summary}</p>}
      </NodeContent>
    </Node>
  );
}

function RunNode({
  id,
  data,
  selected,
}: NodeProps<FlowNode<RunNodeData, "runNode">>) {
  const [expanded, setExpanded] = useState(true);
  const toolParts = data.toolParts?.length
    ? data.toolParts
    : [
        data.toolPart ?? {
          type: "tool-expand_prompt",
          state: "input-streaming",
          input: { prompt: data.prompt },
        } satisfies CanvasToolPart,
      ];
  const latestToolPart = toolParts.at(-1) ?? toolParts[0];

  const statusIcon =
    data.status === "success" ? (
      <Check size={14} />
    ) : data.status === "error" ? (
      <CircleAlert size={14} />
    ) : (
      <Sparkles size={14} />
    );

  const hasToolDetail =
    data.status !== "queued" ||
    toolParts.some((part) => part.state !== "input-streaming");
  const agentText = data.agentText?.trim() ?? "";
  const hasRunOutput = Boolean(agentText) || hasToolDetail;
  const title = getRunTitle(data.status, latestToolPart.state);
  const toggleLabel = expanded ? "收起输出" : "展开输出";
  const stepTimeline = data.stepTimeline?.length
    ? data.stepTimeline
    : toolParts.map((part, index) => ({
        id: `${part.type}-${index}`,
        label: getToolName(part),
        status:
          part.state === "output-error" || part.state === "output-denied"
            ? "error"
            : part.state === "output-available"
              ? "success"
              : "running",
        toolName: getToolName(part),
        errorText: part.errorText,
      }));
  const openTrace = () => {
    window.dispatchEvent(
      new CustomEvent("cucumber:open-run-trace", {
        detail: { runNodeId: id },
      })
    );
  };

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
            aria-label="查看 Run Trace"
            className="run-trace-button nodrag nopan"
            onClick={(event) => {
              event.stopPropagation();
              openTrace();
            }}
            title="查看 Trace"
            type="button"
          >
            <ListTree size={12} />
          </button>
          <button
            aria-expanded={expanded}
            aria-label={toggleLabel}
            className="run-toggle nodrag nopan"
            data-expanded={expanded}
            disabled={!hasRunOutput}
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
        {hasRunOutput && expanded && (
          <div className="run-stream">
            {agentText && (
              <p className="agent-text-output" title={agentText}>
                {agentText}
              </p>
            )}
            {stepTimeline.length > 0 && (
              <div className="run-step-timeline" aria-label="Run step timeline">
                {stepTimeline.map((step) => (
                  <span
                    className={`run-step-chip ${step.status}`}
                    key={step.id}
                    title={step.errorText ?? step.label}
                  >
                    {step.label}
                  </span>
                ))}
              </div>
            )}
            {hasToolDetail &&
              toolParts.map((part, index) => (
                <ToolCallRow
                  error={data.error}
                  key={`${part.type}-${index}`}
                  toolPart={part}
                />
              ))}
          </div>
        )}
      </NodeContent>
    </Node>
  );
}

function ArtifactNodeIcon({ kind }: { kind: ArtifactLikeNodeProps["data"]["kind"] }) {
  if (kind === "markdown") {
    return <FileText size={14} />;
  }
  if (kind === "webpage") {
    return <Globe2 size={14} />;
  }
  if (kind === "code") {
    return <Type size={14} />;
  }
  if (kind === "memory") {
    return <Database size={14} />;
  }
  if (kind === "decision") {
    return <Check size={14} />;
  }

  return <FileText size={14} />;
}

function getArtifactNodeLabel(data: ArtifactLikeNodeProps["data"]) {
  const labels: Record<ArtifactLikeNodeProps["data"]["kind"], string> = {
    artifact: "Artifact",
    code: "Code",
    decision: "Decision",
    document: "Document",
    markdown: "Markdown",
    memory: "Memory",
    toolResult: "Tool Result",
    webpage: "Webpage",
  };

  if (data.kind === "artifact" && data.artifact.type === "dataset") {
    return "Dataset";
  }
  if (data.kind === "artifact" && data.artifact.type === "file") {
    return "File";
  }

  return labels[data.kind];
}

function getArtifactNodeSummary(data: ArtifactLikeNodeProps["data"]) {
  if (data.kind === "markdown") {
    return data.summary ?? data.content;
  }
  if (data.kind === "decision") {
    return data.decision;
  }
  if (data.kind === "memory") {
    return data.memory;
  }

  return data.summary ?? data.artifact.contentRef ?? data.artifact.uri;
}

function MarkdownNode({
  data,
  selected,
}: NodeProps<FlowNode<MarkdownNodeData, "markdownNode">>) {
  return (
    <Node
      className={
        selected
          ? "canvas-node selected markdown-card"
          : "canvas-node markdown-card"
      }
      handles={{ source: true, target: true }}
    >
      <NodeContent className="markdown-content">
        <div className="markdown-heading">
          <span className="artifact-icon">
            <FileText size={14} />
          </span>
          <div>
            <span>Markdown</span>
            <strong title={data.title}>{data.title}</strong>
          </div>
        </div>
        <div className="markdown-body nodrag nopan">
          <MarkdownPreview content={data.content} />
        </div>
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
  const approvalId =
    toolPart.state === "approval-requested" ? toolPart.approval?.id : undefined;

  return (
    <div className={isError ? "tool-call-row error" : "tool-call-row"}>
      <div className="tool-call-main">
        <span className="tool-call-action">
          {toolPart.state === "output-available"
            ? "完成"
            : toolPart.state === "output-denied"
              ? "拒绝"
              : "调用"}
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
      {approvalId && (
        <div className="tool-approval-actions">
          <button
            className="nodrag nopan"
            onClick={(event) => {
              event.stopPropagation();
              dispatchToolApprovalResponse(approvalId, true);
            }}
            type="button"
          >
            <Check size={11} />
            确认
          </button>
          <button
            className="nodrag nopan secondary"
            onClick={(event) => {
              event.stopPropagation();
              dispatchToolApprovalResponse(approvalId, false);
            }}
            type="button"
          >
            <X size={11} />
            拒绝
          </button>
        </div>
      )}
    </div>
  );
}

function dispatchToolApprovalResponse(approvalId: string, approved: boolean) {
  window.dispatchEvent(
    new CustomEvent("cucumber:respond-tool-approval", {
      detail: { approvalId, approved },
    })
  );
}

function getRunTitle(status: RunNodeData["status"], state: CanvasToolPart["state"]) {
  if (status === "error" || state === "output-error") {
    return "生成失败";
  }

  if (status === "success") {
    return "生成完成";
  }

  if (state === "input-available" || state === "output-available") {
    return "调用工具";
  }

  if (state === "approval-requested") {
    return "等待确认";
  }

  if (state === "approval-responded") {
    return "继续执行";
  }

  return "Thinking...";
}

function getToolName(toolPart: CanvasToolPart) {
  const names: Record<CanvasToolPart["type"], string> = {
    "tool-analyze_reference_images": "参考图分析",
    "tool-expand_prompt": "提示词扩写",
    "tool-generate_image": "生成图片",
  };

  return names[toolPart.type];
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
    return [...getToolOutputLines(toolPart), ...getToolInputLines(toolPart.input)];
  }

  if (toolPart.state === "output-denied") {
    return ["工具调用被拒绝"];
  }

  if (toolPart.state === "approval-requested") {
    return ["需要确认后继续执行"];
  }

  if (toolPart.state === "approval-responded") {
    return [
      toolPart.approval?.approved === false ? "已拒绝执行" : "已确认执行",
    ];
  }

  return getToolInputLines(toolPart.input);
}

function getToolOutputLines(toolPart: CanvasToolPart) {
  if (toolPart.type === "tool-analyze_reference_images") {
    const output = toolPart.output as {
      analysis?: unknown;
      imageCount?: unknown;
    };
    const lines = [
      typeof output?.imageCount === "number"
        ? `参考图: ${output.imageCount} 张`
        : "参考图分析完成",
    ];

    if (typeof output?.analysis === "string" && output.analysis.trim()) {
      lines.push(`视觉摘要: ${output.analysis.trim()}`);
    }

    return lines;
  }

  if (toolPart.type === "tool-expand_prompt") {
    const output = toolPart.output as { expandedPrompt?: unknown };
    if (typeof output?.expandedPrompt === "string" && output.expandedPrompt.trim()) {
      return [`扩写: ${output.expandedPrompt.trim()}`];
    }

    return ["扩写完成"];
  }

  const images = extractImagesFromToolOutput(toolPart.output);
  return [images.length ? `输出 ${images.length} 张图片` : "输出已返回"];
}

function getToolInputLines(input: unknown) {
  if (!input || typeof input !== "object") {
    return ["等待工具参数"];
  }

  const candidate = input as {
    prompt?: unknown;
    imageCount?: unknown;
    modelProvider?: unknown;
    skillSlug?: unknown;
    resultCount?: unknown;
    upstreamContext?: unknown;
  };
  const lines: string[] = [];

  if (typeof candidate.prompt === "string" && candidate.prompt.trim()) {
    lines.push(`输入: ${candidate.prompt.trim()}`);
  }

  if (typeof candidate.modelProvider === "string" && candidate.modelProvider.trim()) {
    lines.push(`模型: ${candidate.modelProvider.trim()}`);
  }

  if (typeof candidate.skillSlug === "string" && candidate.skillSlug.trim()) {
    lines.push(`Skill: ${candidate.skillSlug.trim()}`);
  }

  if (
    typeof candidate.resultCount === "number" &&
    Number.isInteger(candidate.resultCount)
  ) {
    lines.push(`目标: ${candidate.resultCount} 张图片`);
  }

  if (
    typeof candidate.imageCount === "number" &&
    Number.isInteger(candidate.imageCount)
  ) {
    lines.push(`参考图: ${candidate.imageCount} 张`);
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
