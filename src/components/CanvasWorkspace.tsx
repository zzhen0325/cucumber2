import {
  applyNodeChanges,
  Controls,
  MiniMap,
  NodeToolbar,
  Position,
  SelectionMode,
  useReactFlow,
  useEdgesState,
  useNodesState,
  type Node as FlowNode,
  type NodeChange,
  type NodeProps,
  type NodeTypes,
  type ReactFlowInstance,
} from "@xyflow/react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { BundledLanguage } from "shiki";
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  Circle,
  CircleDot,
  Copy,
  Database,
  Diamond,
  Download,
  FileText,
  Frame,
  Workflow,
  Globe2,
  Hand,
  Image,
  Layers,
  Maximize2,
  MousePointer2,
  Palette,
  Sparkles,
  Square,
  StickyNote,
  Type,
  Triangle,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from "lucide-react";
import {
  createContext,
  lazy,
  memo,
  type PointerEvent as ReactPointerEvent,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties, FormEvent, MouseEvent as ReactMouseEvent } from "react";

import { Canvas } from "@/components/ai-elements/canvas";
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockCopyButton,
  CodeBlockFilename,
  CodeBlockHeader,
  CodeBlockTitle,
} from "@/components/ai-elements/code-block";
import { Edge } from "@/components/ai-elements/edge";
import { FileUploadOverlay } from "@/components/FileUploadOverlay";
import { Node, NodeContent } from "@/components/ai-elements/node";
import { ReplayBanner, RunTracePanel } from "@/components/RunTracePanel";
import { RunNodeView } from "@/components/RunNodeView";
import { useCanvasFileDrop } from "@/components/useCanvasFileDrop";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getCanvasLayoutSignature,
  layoutAgentCanvasGraph,
} from "@/lib/canvas-layout";
import {
  loadProject,
  loadRunTrace,
  upscaleProjectImage,
  updateProject,
  ProjectVersionConflictError,
  type PersistedProject,
} from "@/lib/project-storage";
import {
  hasNodeContentChanged,
  toPersistableNodes,
} from "@/lib/canvas-persistence";
import {
  collectUpstreamContext,
  createRunDraft,
  getRunReferenceNodeId,
  getRunReferenceNodeIds,
} from "@/lib/graph";
import {
  diffCanvasPatch,
  hasCanvasPatchChanges,
  mergeCanvasUpserts,
} from "@/lib/canvas-patch";
import type { RunStepTraceEvent } from "@/lib/graph-projection";
import {
  agentTextFromMessages,
  projectRuntimeEventsToCanvas,
  runtimeEventsFromMessageParts,
  runtimeEventsFromMessages,
} from "@/lib/runtime-event-renderer";
import type {
  AgentCanvasEdge,
  AgentCanvasNode,
  CodeNodeData,
  GeneratedImage,
  ImageResultNodeData,
  MarkdownNodeData,
  PromptNodeData,
  ShapeNodeData,
  ShapeVariant,
  StickyNoteNodeData,
  WebpageNodeData,
} from "@/types/canvas";

const nodeTypes = {
  artifactNode: memo(ArtifactLikeNode),
  codeNode: memo(CodeNode),
  decisionNode: memo(ArtifactLikeNode),
  documentNode: memo(ArtifactLikeNode),
  memoryNode: memo(ArtifactLikeNode),
  promptNode: memo(PromptNode),
  runNode: memo(RunNodeView),
  imageResultNode: memo(ImageResultNode),
  markdownNode: memo(MarkdownNode),
  shapeNode: memo(ShapeNode),
  stickyNoteNode: memo(StickyNoteNode),
  toolResultNode: memo(ArtifactLikeNode),
  webpageNode: memo(HtmlPageNode),
} as NodeTypes;

const edgeTypes = {
  animated: Edge.Animated,
  temporary: Edge.Temporary,
};

const initialNodes: AgentCanvasNode[] = [];
const initialEdges: AgentCanvasEdge[] = [];
const BlockNoteMarkdownEditor = lazy(() =>
  import("@/components/BlockNoteMarkdownEditor").then((module) => ({
    default: module.BlockNoteMarkdownEditor,
  }))
);
const MarkdownNodeEditingContext = createContext<{
  readOnly: boolean;
  onChange: (nodeId: string, content: string, blocks: unknown[]) => void;
}>({
  readOnly: true,
  onChange: () => undefined,
});
const ManualNodeEditingContext = createContext<{
  readOnly: boolean;
  onShapeLabelChange: (nodeId: string, label: string) => void;
  onStickyTextChange: (nodeId: string, text: string) => void;
}>({
  readOnly: true,
  onShapeLabelChange: () => undefined,
  onStickyTextChange: () => undefined,
});
const ImageNodeActionContext = createContext<{
  onUpscale: (nodeId: string) => void;
}>({
  onUpscale: () => undefined,
});

type StorageStatus = "loading" | "saving" | "saved" | "error";
type StreamedRuntimeEvents = ReturnType<typeof runtimeEventsFromMessages>;
type AgentRunRequestBody = {
  projectId: string;
  runNodeId: string;
  canvasContext: {
    prompt: string;
    promptNodeId: string;
    selectedNodeId: string | null;
    selectedNodeIds: string[];
  };
};

type CanvasWorkspaceProps = {
  projectId: string;
  onBack: () => void;
};

type ManualCanvasTool = "stickyNote" | ShapeVariant;
type CanvasTool = "select" | "hand" | ManualCanvasTool;
type ManualNodeTemplate =
  | {
      icon: LucideIcon;
      kind: "stickyNote";
      label: string;
      tool: "stickyNote";
      color: StickyNoteNodeData["color"];
      text: string;
    }
  | {
      icon: LucideIcon;
      kind: "shape";
      label: string;
      tool: ShapeVariant;
      shape: ShapeVariant;
    };
type ToolRailItem = {
  icon: LucideIcon;
  label: string;
  tool: CanvasTool;
};
type CanvasPoint = { x: number; y: number };
type CreationDraft = {
  startFlow: CanvasPoint;
  startScreen: CanvasPoint;
  template: ManualNodeTemplate;
};
type CreationPreview = {
  label: string;
  rect: {
    height: number;
    left: number;
    top: number;
    width: number;
  };
};

const manualNodeTemplates: ManualNodeTemplate[] = [
  {
    color: "yellow",
    icon: StickyNote,
    kind: "stickyNote",
    label: "便签",
    text: "写下想法...",
    tool: "stickyNote",
  },
  { icon: Square, kind: "shape", label: "矩形", shape: "rectangle", tool: "rectangle" },
  { icon: Circle, kind: "shape", label: "圆形", shape: "ellipse", tool: "ellipse" },
  { icon: Diamond, kind: "shape", label: "菱形", shape: "diamond", tool: "diamond" },
  { icon: Triangle, kind: "shape", label: "三角形", shape: "triangle", tool: "triangle" },
  { icon: CircleDot, kind: "shape", label: "胶囊", shape: "pill", tool: "pill" },
  { icon: Frame, kind: "shape", label: "框架", shape: "frame", tool: "frame" },
];

export function CanvasWorkspace({ projectId, onBack }: CanvasWorkspaceProps) {
  const [nodes, setNodes] = useNodesState<AgentCanvasNode>(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<AgentCanvasEdge>(initialEdges);
  const [loadedProjectId, setLoadedProjectId] = useState<string | null>(null);
  const [projectTitle, setProjectTitle] = useState("Untitled");
  const [prompt, setPrompt] = useState("");
  const [contextCount, setContextCount] = useState(0);
  const [storageStatus, setStorageStatus] = useState<StorageStatus>("loading");
  const [storageError, setStorageError] = useState<string | null>(null);
  const [traceRunId, setTraceRunId] = useState<string | null>(null);
  const [traceEvents, setTraceEvents] = useState<RunStepTraceEvent[]>([]);
  const [traceLoading, setTraceLoading] = useState(false);
  const [traceError, setTraceError] = useState<string | null>(null);
  const [canvasTool, setCanvasTool] = useState<CanvasTool>("select");
  const [layoutFitRequest, setLayoutFitRequest] = useState(0);
  const [replaySnapshot, setReplaySnapshot] = useState<{
    runNodeId: string;
    nodes: AgentCanvasNode[];
    edges: AgentCanvasEdge[];
  } | null>(null);
  const activeRunId = useRef<string | null>(null);
  const stoppedRunIds = useRef(new Set<string>());
  const activeRunMessageStartIndex = useRef(0);
  const loadedProjectIdRef = useRef<string | null>(null);
  const streamedRuntimeEvents = useRef<StreamedRuntimeEvents>([]);
  const streamedAgentTextByRunId = useRef(new Map<string, string>());
  const hasLoadedProject = useRef(false);
  const messagesRef = useRef<ReturnType<typeof useChat>["messages"]>([]);
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const projectTitleRef = useRef(projectTitle);
  const persistedSelectedNodeIdRef = useRef<string | null>(null);
  const isReplayModeRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const projectVersionRef = useRef(0);
  const isSavingRef = useRef(false);
  const pendingSaveRef = useRef(false);
  const saveWaitersRef = useRef<Array<(saved: boolean) => void>>([]);
  const lastSavedSnapshotDigestRef = useRef<string | null>(null);
  const lastSavedSnapshotRef = useRef<PersistableProjectSnapshot | null>(null);
  const prevSaveClassifyNodesRef = useRef<AgentCanvasNode[]>([]);
  const prevSaveClassifyTitleRef = useRef(projectTitle);
  const autoLayoutFrame = useRef<number | null>(null);
  const autoLayoutSignatureRef = useRef<string | null>(null);
  const flowInstance = useRef<ReactFlowInstance<
    AgentCanvasNode,
    AgentCanvasEdge
  > | null>(null);
  const creationDraftRef = useRef<CreationDraft | null>(null);
  const [creationPreview, setCreationPreview] = useState<CreationPreview | null>(null);
  const isReplayMode = Boolean(replaySnapshot);
  const isHandTool = canvasTool === "hand";
  const activeManualTemplate = getManualNodeTemplateForTool(canvasTool);
  const isCreateTool = Boolean(activeManualTemplate);
  const canvasNodes = replaySnapshot?.nodes ?? nodes;
  const canvasEdges = replaySnapshot?.edges ?? edges;

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);

  useEffect(() => {
    projectTitleRef.current = projectTitle;
  }, [projectTitle]);

  useEffect(() => {
    isReplayModeRef.current = isReplayMode;
  }, [isReplayMode]);

  const handleAutoLayout = useCallback(() => {
    if (isReplayModeRef.current || !nodesRef.current.length) {
      return;
    }

    setNodes((current) => {
      const layoutedNodes = layoutAgentCanvasGraph(current, edgesRef.current);
      autoLayoutSignatureRef.current = getCanvasLayoutSignature(
        layoutedNodes,
        edgesRef.current
      );
      return layoutedNodes;
    });
    setLayoutFitRequest((current) => current + 1);
  }, [setNodes]);

  useEffect(() => {
    loadedProjectIdRef.current = loadedProjectId;
  }, [loadedProjectId]);

  const projectStreamedRuntimeEvents = useCallback(
    (
      events: StreamedRuntimeEvents,
      options: { replace?: boolean } = {}
    ) => {
      const runId = activeRunId.current;
      if (!runId) {
        return;
      }

      const nextEvents = events.filter((event) => event.runNodeId === runId);
      const streamedAgentText = streamedAgentTextByRunId.current.get(runId);
      if (!nextEvents.length && !streamedAgentText) {
        return;
      }
      const previousEvents = options.replace
        ? []
        : streamedRuntimeEvents.current.filter((event) => event.runNodeId === runId);
      const runtimeEvents = dedupeRuntimeEvents([
        ...previousEvents,
        ...nextEvents,
      ]).sort((left, right) => left.createdAt.localeCompare(right.createdAt));
      streamedRuntimeEvents.current = [
        ...streamedRuntimeEvents.current.filter((event) => event.runNodeId !== runId),
        ...runtimeEvents,
      ];

      const projectId = loadedProjectIdRef.current ?? undefined;
      const projection = projectRuntimeEventsToCanvas({
        projectId,
        runNodeId: runId,
        events: runtimeEvents,
        existingSnapshot: {
          nodes: nodesRef.current,
          edges: edgesRef.current,
        },
        streamedAgentTextByRunId: streamedAgentTextByRunId.current,
      });

      const runWasStopped = stoppedRunIds.current.has(runId);
      const stoppedPendingResultNodeIds = new Set(
        [...nodesRef.current, ...projection.nodes].flatMap((node) =>
          runWasStopped &&
          node.data.kind === "imageResult" &&
          node.data.runId === runId &&
          (node.data.status ?? "loading") === "loading"
            ? [node.id]
            : []
        )
      );

      setNodes((current) => {
        const merged = mergeCanvasUpserts(
          { edges: edgesRef.current, nodes: current },
          { edges: projection.edges, nodes: projection.nodes }
        ).nodes;
        if (!runWasStopped) {
          return merged;
        }
        return merged
          .filter((node) => !stoppedPendingResultNodeIds.has(node.id))
          .map((node) =>
            node.id === runId && node.data.kind === "run"
              ? {
                  ...node,
                  data: {
                    ...node.data,
                    status: "error" as const,
                    error: "运行已停止。",
                  },
                }
              : node
          );
      });
      setEdges((current) =>
        mergeCanvasUpserts(
          { edges: current, nodes: nodesRef.current },
          { edges: projection.edges, nodes: projection.nodes }
        ).edges
          .filter(
            (edge) =>
              !stoppedPendingResultNodeIds.has(edge.source) &&
              !stoppedPendingResultNodeIds.has(edge.target)
          )
          .map((edge) =>
            runWasStopped && edge.target === runId && edge.data?.active
              ? { ...edge, data: { ...edge.data, active: false } }
              : edge
          )
      );
    },
    [setEdges, setNodes]
  );

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
          const existingToolParts =
            node.data.toolParts ?? (node.data.toolPart ? [node.data.toolPart] : []);
          const latestToolPart = existingToolParts.at(-1);
          const erroredToolParts = latestToolPart
            ? [
                ...existingToolParts.slice(0, -1),
                {
                  ...latestToolPart,
                  state: "output-error" as const,
                  errorText: message,
                },
              ]
            : undefined;

          return {
            ...node,
            data: {
              ...node.data,
              status: "error",
              error: message,
              toolPart: erroredToolParts?.at(-1),
              toolParts: erroredToolParts,
            },
          };
        })
      );
    },
    [setNodes]
  );

  const settleRunIfOutputReady = useCallback(
    (runId: string | null) => {
      if (!runId) {
        return;
      }

      setNodes((current) => {
        if (!hasReadyRunOutput(current, runId)) {
          return current;
        }

        return current.map((node) => {
          if (
            node.id !== runId ||
            node.data.kind !== "run" ||
            node.data.status === "success" ||
            node.data.status === "error"
          ) {
            return node;
          }

          return {
            ...node,
            data: {
              ...node.data,
              status: "success",
              error: undefined,
            },
          };
        });
      });

      setEdges((current) =>
        current.map((edge) =>
          edge.target === runId && edge.data?.active
            ? { ...edge, data: { ...edge.data, active: false } }
            : edge
        )
      );
    },
    [setEdges, setNodes]
  );

  const markRunStopped = useCallback(
    (runId: string | null) => {
      if (!runId) {
        return;
      }

      stoppedRunIds.current.add(runId);

      const pendingResultNodeIds = new Set(
        nodesRef.current.flatMap((node) =>
          node.data.kind === "imageResult" &&
          node.data.runId === runId &&
          (node.data.status ?? "loading") === "loading"
            ? [node.id]
            : []
        )
      );

      setNodes((current) =>
        current
          .filter((node) => !pendingResultNodeIds.has(node.id))
          .map((node) =>
            node.id === runId && node.data.kind === "run"
              ? {
                  ...node,
                  data: {
                    ...node.data,
                    status: "error" as const,
                    error: "运行已停止。",
                  },
                }
              : node
          )
      );
      setEdges((current) =>
        current
          .filter(
            (edge) =>
              !pendingResultNodeIds.has(edge.source) &&
              !pendingResultNodeIds.has(edge.target)
          )
          .map((edge) =>
            edge.target === runId && edge.data?.active
              ? { ...edge, data: { ...edge.data, active: false } }
              : edge
          )
      );
    },
    [setEdges, setNodes]
  );

  const { messages, sendMessage, status, error, stop } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/agent-run",
      credentials: "same-origin",
    }),
    onData: (dataPart) => {
      projectStreamedRuntimeEvents(runtimeEventsFromMessageParts([dataPart]));
    },
    onFinish: ({ messages: finalMessages, isAbort, isDisconnect, isError }) => {
      const runId = activeRunId.current;
      if (!runId) {
        return;
      }

      projectStreamedRuntimeEvents(
        runtimeEventsFromMessages(finalMessages, {
          runNodeId: runId,
          messageStartIndex: activeRunMessageStartIndex.current,
        }),
        { replace: true }
      );

      if (isAbort) {
        markRunStopped(runId);
      } else if (isDisconnect) {
        markRunError(runId, "Agent 连接已中断。");
      } else if (!isError) {
        settleRunIfOutputReady(runId);
        window.requestAnimationFrame(() => {
          settleRunIfOutputReady(runId);
        });
      }
    },
    onError: (nextError) => {
      markRunError(activeRunId.current, nextError.message);
    },
  });

  const handleStop = useCallback(() => {
    const runId = activeRunId.current;
    void stop();
    markRunStopped(runId);

    const projectId = loadedProjectIdRef.current;
    if (!projectId || !runId) {
      return;
    }

    const query = new URLSearchParams({ projectId, runNodeId: runId });
    void fetch(`/api/agent-run?${query}`, {
      method: "DELETE",
      credentials: "same-origin",
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
      })
      .catch((stopError: unknown) => {
        markRunError(runId, `停止 Agent 失败：${getClientError(stopError)}`);
      });
  }, [markRunError, markRunStopped, stop]);

  const selectedNodeIds = useMemo(
    () => nodes.filter((node) => node.selected).map((node) => node.id),
    [nodes]
  );

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const selectedNodes = useMemo(() => {
    const selectedNodeIdSet = new Set(selectedNodeIds);
    return nodes.filter((node) => selectedNodeIdSet.has(node.id));
  }, [nodes, selectedNodeIds]);
  const referenceNodeIds = useMemo(
    () => getRunReferenceNodeIds(selectedNodes),
    [selectedNodes]
  );
  const referenceNodeId = referenceNodeIds[0] ?? null;
  const referenceNode = referenceNodeId
    ? nodes.find((node) => node.id === referenceNodeId)
    : undefined;
  const referenceContextCount = useMemo(
    () =>
      referenceNodeIds.length
        ? collectUpstreamContext(referenceNodeIds, nodes, edges).length
        : 0,
    [edges, nodes, referenceNodeIds]
  );
  const hasLocalUploadNodes = useMemo(
    () => nodes.some(hasLocalUploadState),
    [nodes]
  );
  const persistedSelectedNodeId = referenceNodeId ?? null;
  useEffect(() => {
    persistedSelectedNodeIdRef.current = persistedSelectedNodeId;
  }, [persistedSelectedNodeId]);

  const isBusy = status === "submitted" || status === "streaming";
  const canSubmit =
    Boolean(loadedProjectId) &&
    storageStatus !== "loading" &&
    !storageError &&
    !isReplayMode &&
    !hasLocalUploadNodes;
  const canUploadFiles =
    Boolean(loadedProjectId) &&
    storageStatus !== "loading" &&
    !storageError &&
    !isReplayMode;
  const fileDrop = useCanvasFileDrop({
    canUploadFiles,
    nodes,
    projectId: loadedProjectId,
    setEdges,
    setNodes,
  });
  const { showUploadError } = fileDrop;

  const handleCanvasInit = useCallback(
    (instance: ReactFlowInstance<AgentCanvasNode, AgentCanvasEdge>) => {
      flowInstance.current = instance;
      fileDrop.handleCanvasInit(instance);
    },
    [fileDrop]
  );

  const handleNodesChange = useCallback(
    (changes: NodeChange<AgentCanvasNode>[]) => {
      setNodes((current) =>
        applyLinkedNodeDragChanges(changes, current, edgesRef.current)
      );
    },
    [setNodes]
  );

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
    activeRunMessageStartIndex.current = 0;
    streamedRuntimeEvents.current = [];
    streamedAgentTextByRunId.current.clear();
    lastSavedSnapshotDigestRef.current = null;
    lastSavedSnapshotRef.current = null;

    const loadStartedAt = performance.now();

    loadProject(projectId)
      .then(({ project }) => {
        if (ignore) {
          return;
        }

        const projectLoadedAt = performance.now();
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
        autoLayoutSignatureRef.current = getCanvasLayoutSignature(
          project.nodes,
          project.edges
        );
        setNodes(applySelectedNodeIds(project.nodes, nextSelectedNodeIds));
        setEdges(project.edges);
        activeRunId.current = project.lastRunId;
        projectVersionRef.current = project.version;
        const loadedSnapshot = getCurrentPersistableProjectSnapshot({
          edges: project.edges,
          lastRunId: project.lastRunId,
          nodes: project.nodes,
          selectedNodeId: project.selectedNodeId,
          title: project.title,
        });
        lastSavedSnapshotDigestRef.current = loadedSnapshot.digest;
        lastSavedSnapshotRef.current = loadedSnapshot;
        hasLoadedProject.current = true;
        setStorageStatus("saved");
        setStorageError(null);

        if (import.meta.env.DEV) {
          // Diagnostics for the slow-load investigation (DEV only, never ships).
          console.info("[canvas-load]", {
            projectId: project.id,
            nodeCount: project.nodes.length,
            edgeCount: project.edges.length,
            payloadBytes: JSON.stringify(project).length,
            fetchMs: Math.round(projectLoadedAt - loadStartedAt),
            totalMs: Math.round(performance.now() - loadStartedAt),
          });
        }

        hydrateProjectSnapshotFromLastRun(project).then((hydratedSnapshot) => {
          if (ignore || !hydratedSnapshot) {
            return;
          }

          setNodes((current) =>
            mergeCanvasUpserts(
              { edges: edgesRef.current, nodes: current },
              hydratedSnapshot
            ).nodes
          );
          setEdges((current) =>
            mergeCanvasUpserts(
              { edges: current, nodes: nodesRef.current },
              hydratedSnapshot
            ).edges
          );
        });
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
      if (autoLayoutFrame.current) {
        window.cancelAnimationFrame(autoLayoutFrame.current);
        autoLayoutFrame.current = null;
      }
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

  const saveProjectSnapshot = useCallback(
    async (
      options: { keepalive?: boolean; reportStatus?: boolean } = {}
    ) => {
      const currentProjectId = loadedProjectIdRef.current;
      const shouldReportStatus = options.reportStatus ?? true;

      if (
        !hasLoadedProject.current ||
        !currentProjectId ||
        isReplayModeRef.current
      ) {
        return false;
      }

      const initialSnapshot = getCurrentPersistableProjectSnapshot({
        edges: edgesRef.current,
        lastRunId: activeRunId.current,
        nodes: nodesRef.current,
        selectedNodeId: persistedSelectedNodeIdRef.current,
        title: projectTitleRef.current,
      });
      if (initialSnapshot.digest === lastSavedSnapshotDigestRef.current) {
        if (shouldReportStatus) {
          setStorageStatus("saved");
          setStorageError(null);
        }
        return true;
      }

      // Single-flight: never run two saves concurrently. A change arriving while a
      // save is in flight is coalesced into one trailing re-run so writes stay
      // strictly ordered and the latest snapshot always wins.
      if (isSavingRef.current) {
        pendingSaveRef.current = true;
        return new Promise<boolean>((resolve) => {
          saveWaitersRef.current.push(resolve);
        });
      }

      isSavingRef.current = true;
      if (shouldReportStatus) {
        setStorageStatus("saving");
      }

      const maxConflictRetries = 3;
      let saved = true;

      try {
        do {
          pendingSaveRef.current = false;
          const snapshot = getCurrentPersistableProjectSnapshot({
            edges: edgesRef.current,
            lastRunId: activeRunId.current,
            nodes: nodesRef.current,
            selectedNodeId: persistedSelectedNodeIdRef.current,
            title: projectTitleRef.current,
          });
          if (snapshot.digest === lastSavedSnapshotDigestRef.current) {
            if (shouldReportStatus) {
              setStorageStatus("saved");
              setStorageError(null);
            }
            break;
          }

          for (let attempt = 0; ; attempt += 1) {
            try {
              const previousSnapshot = lastSavedSnapshotRef.current ?? {
                edges: [],
                lastRunId: null,
                nodes: [],
                selectedNodeId: null,
                title: "",
              };
              const canvasPatch = diffCanvasPatch(previousSnapshot, snapshot);
              const { project } = await updateProject(
                {
                  projectId: currentProjectId,
                  title:
                    snapshot.title === previousSnapshot.title
                      ? undefined
                      : snapshot.title,
                  canvasPatch: hasCanvasPatchChanges(canvasPatch)
                    ? canvasPatch
                    : undefined,
                  selectedNodeId:
                    snapshot.selectedNodeId === previousSnapshot.selectedNodeId
                      ? undefined
                      : snapshot.selectedNodeId,
                  lastRunId:
                    snapshot.lastRunId === previousSnapshot.lastRunId
                      ? undefined
                      : snapshot.lastRunId,
                  expectedVersion: projectVersionRef.current,
                },
                options.keepalive ? { keepalive: true } : undefined
              );

              projectVersionRef.current = project.version;
              lastSavedSnapshotDigestRef.current = snapshot.digest;
              lastSavedSnapshotRef.current = snapshot;
              if (shouldReportStatus) {
                setLoadedProjectId(project.id);
                setStorageStatus("saved");
                setStorageError(null);
              }
              break;
            } catch (nextError: unknown) {
              if (
                nextError instanceof ProjectVersionConflictError &&
                attempt < maxConflictRetries
              ) {
                // Re-align to the server version and retry with our latest local
                // state (last-write-wins, but with an ordered version handshake).
                projectVersionRef.current = nextError.project.version;
                continue;
              }
              throw nextError;
            }
          }
        } while (pendingSaveRef.current);
      } catch (nextError: unknown) {
        saved = false;
        if (shouldReportStatus) {
          setStorageStatus("error");
          setStorageError(getClientError(nextError));
        }
      } finally {
        isSavingRef.current = false;
        for (const resolve of saveWaitersRef.current.splice(0)) {
          resolve(saved);
        }
      }
      return saved;
    },
    []
  );

  const startAgentRun = useCallback(
    async ({
      clearComposer = false,
      promptText,
      selectedNodeId,
      selectedNodeIds = selectedNodeId ? [selectedNodeId] : [],
    }: {
      clearComposer?: boolean;
      promptText: string;
      selectedNodeId: string | null;
      selectedNodeIds?: string[];
    }) => {
      const value = promptText.trim();
      if (!value || isBusy) {
        return;
      }
      const projectId = loadedProjectIdRef.current;
      if (!projectId) {
        setStorageStatus("error");
        setStorageError("项目尚未加载完成");
        return;
      }
      if (hasLocalUploadNodes) {
        showUploadError("请等待文件上传完成后再启动 Agent。");
        return;
      }
      if (storageError) {
        return;
      }

      const currentNodes = nodesRef.current;
      const currentEdges = edgesRef.current;
      const draft = createRunDraft(value, selectedNodeIds, currentNodes, currentEdges);
      activeRunId.current = draft.runNode.id;
      activeRunMessageStartIndex.current = messagesRef.current.length;
      streamedRuntimeEvents.current = streamedRuntimeEvents.current.filter(
        (event) => event.runNodeId !== draft.runNode.id
      );
      streamedAgentTextByRunId.current.delete(draft.runNode.id);
      setContextCount(draft.upstreamContext.length);
      const requestBody: AgentRunRequestBody = {
        projectId,
        runNodeId: draft.runNode.id,
        canvasContext: {
          prompt: value,
          promptNodeId: draft.promptNode.id,
          selectedNodeId,
          selectedNodeIds,
        },
      };
      const nextNodes = [
        ...applySelectedNodeIds(currentNodes, []),
        draft.promptNode,
        draft.runNode,
      ];
      const nextEdges = [...currentEdges, ...draft.edges];
      nodesRef.current = nextNodes;
      edgesRef.current = nextEdges;
      setNodes(nextNodes);
      setEdges(nextEdges);

      const saved = await saveProjectSnapshot();
      if (!saved) {
        markRunError(draft.runNode.id, "项目快照保存失败，Agent 未启动。");
        return;
      }

      if (clearComposer) {
        setPrompt("");
      }

      await sendMessage(
        { text: value },
        {
          body: requestBody,
        }
      );
    },
    [
      hasLocalUploadNodes,
      isBusy,
      markRunError,
      saveProjectSnapshot,
      sendMessage,
      setEdges,
      setNodes,
      showUploadError,
      storageError,
    ]
  );

  const handleRetryRun = useCallback(
    (runNodeId: string) => {
      if (isReplayModeRef.current) {
        setStorageStatus("error");
        setStorageError("Run 回放模式为只读，退出回放后再重试。");
        return;
      }
      if (isBusy) {
        setStorageStatus("error");
        setStorageError("Agent 正在运行，请稍后重试。");
        return;
      }

      const runNode = nodesRef.current.find(
        (node) => node.id === runNodeId && node.data.kind === "run"
      );
      if (!runNode || runNode.data.kind !== "run") {
        return;
      }
      if (runNode.data.status !== "error") {
        return;
      }

      const retryPrompt = runNode.data.prompt.trim();
      if (!retryPrompt) {
        setStorageStatus("error");
        setStorageError("原 Run 没有可重试的 prompt。");
        return;
      }

      void startAgentRun({
        promptText: retryPrompt,
        selectedNodeId: getRetryAnchorNodeId(
          runNodeId,
          nodesRef.current,
          edgesRef.current
        ),
      });
    },
    [isBusy, startAgentRun]
  );

  useEffect(() => {
    const handleRetryRunEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ runNodeId?: unknown }>).detail;
      if (typeof detail?.runNodeId === "string") {
        handleRetryRun(detail.runNodeId);
      }
    };

    window.addEventListener("cucumber:retry-run", handleRetryRunEvent);

    return () => {
      window.removeEventListener("cucumber:retry-run", handleRetryRunEvent);
    };
  }, [handleRetryRun]);

  useEffect(() => {
    const flushPendingSave = () => {
      if (saveTimer.current) {
        window.clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }

      void saveProjectSnapshot({ reportStatus: false });
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        flushPendingSave();
      }
    };

    window.addEventListener("pagehide", flushPendingSave);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("pagehide", flushPendingSave);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      flushPendingSave();
    };
  }, [saveProjectSnapshot]);

  useEffect(() => {
    if (!hasLoadedProject.current || !loadedProjectId || isReplayMode) {
      return;
    }

    // Classify the change to pick a debounce window. Rapid content edits (typing
    // in a markdown node, renaming the project) create fresh `data` objects, so we
    // wait longer to avoid saving mid-keystroke. Position/selection changes only
    // mutate structural fields (React Flow keeps the `data` reference), so a short
    // window keeps drags responsive. Both still funnel through the single-flight
    // save channel, so concurrency stays safe regardless of timing.
    const prevNodes = prevSaveClassifyNodesRef.current;
    const prevTitle = prevSaveClassifyTitleRef.current;
    prevSaveClassifyNodesRef.current = nodes;
    prevSaveClassifyTitleRef.current = projectTitle;

    const isContentChange =
      prevTitle !== projectTitle || hasNodeContentChanged(prevNodes, nodes);
    const delay = isContentChange ? 800 : 250;

    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
    }

    setStorageStatus("saving");
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      void saveProjectSnapshot();
    }, delay);

    return () => {
      if (saveTimer.current) {
        window.clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
    };
  }, [
    edges,
    isReplayMode,
    loadedProjectId,
    nodes,
    persistedSelectedNodeId,
    projectTitle,
    saveProjectSnapshot,
  ]);

  useEffect(() => {
    if (!hasLoadedProject.current || isReplayMode || !nodes.length) {
      return;
    }

    const signature = getCanvasLayoutSignature(nodes, edges);
    if (autoLayoutSignatureRef.current === signature) {
      return;
    }

    autoLayoutSignatureRef.current = signature;
    if (autoLayoutFrame.current) {
      window.cancelAnimationFrame(autoLayoutFrame.current);
    }

    autoLayoutFrame.current = window.requestAnimationFrame(() => {
      autoLayoutFrame.current = null;
      handleAutoLayout();
    });

    return () => {
      if (autoLayoutFrame.current) {
        window.cancelAnimationFrame(autoLayoutFrame.current);
        autoLayoutFrame.current = null;
      }
    };
  }, [edges, handleAutoLayout, isReplayMode, nodes]);

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

    const runtimeEvents = runtimeEventsFromMessages(messages, {
      runNodeId: runId,
      messageStartIndex: activeRunMessageStartIndex.current,
    });
    const streamedAgentText = agentTextFromMessages(messages, {
      messageStartIndex: activeRunMessageStartIndex.current,
    });
    if (streamedAgentText) {
      streamedAgentTextByRunId.current.set(runId, streamedAgentText);
    }
    projectStreamedRuntimeEvents(runtimeEvents, { replace: true });
  }, [
    loadedProjectId,
    messages,
    projectStreamedRuntimeEvents,
    status,
  ]);

  const handleCreationMouseDown = useCallback(
    (event: ReactMouseEvent) => {
      const template = activeManualTemplate;
      const instance = flowInstance.current;
      if (isReplayMode || !template || !instance || event.button !== 0) {
        return;
      }
      if (!isCanvasPaneEventTarget(event.target)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      const startScreen = { x: event.clientX, y: event.clientY };
      creationDraftRef.current = {
        startFlow: instance.screenToFlowPosition(startScreen),
        startScreen,
        template,
      };
      setCreationPreview({
        label: template.label,
        rect: screenRectFromPoints(startScreen, startScreen),
      });
      setNodes((current) => applySelectedNodeIds(current, []));
    },
    [activeManualTemplate, isReplayMode, setNodes]
  );

  useEffect(() => {
    if (!creationPreview) {
      return;
    }

    const handleMove = (event: MouseEvent) => {
      const draft = creationDraftRef.current;
      if (!draft) {
        return;
      }
      setCreationPreview({
        label: draft.template.label,
        rect: screenRectFromPoints(draft.startScreen, {
          x: event.clientX,
          y: event.clientY,
        }),
      });
    };

    const handleUp = (event: MouseEvent) => {
      const draft = creationDraftRef.current;
      const instance = flowInstance.current;
      creationDraftRef.current = null;
      setCreationPreview(null);
      if (!draft || !instance) {
        return;
      }

      const node = createManualCanvasNodeFromDrag(
        draft,
        {
          x: event.clientX,
          y: event.clientY,
        },
        instance
      );
      setNodes((current) => [
        ...applySelectedNodeIds(current, []),
        { ...node, selected: true },
      ]);
      setCanvasTool("select");
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp, { once: true });

    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [creationPreview, setNodes]);

  const handleUpscaleImageNode = useCallback(
    async (sourceNodeId: string) => {
      if (isReplayModeRef.current) {
        return;
      }
      if (!loadedProjectId) {
        setStorageStatus("error");
        setStorageError("项目尚未加载完成");
        return;
      }

      const sourceNode = nodesRef.current.find(
        (node) => node.id === sourceNodeId
      );
      if (!sourceNode || sourceNode.data.kind !== "imageResult") {
        setStorageStatus("error");
        setStorageError("只能对图片节点执行高清放大。");
        return;
      }
      if ((sourceNode.data.status ?? "ready") !== "ready" || !sourceNode.data.image.url) {
        setStorageStatus("error");
        setStorageError("图片尚未准备完成，无法高清放大。");
        return;
      }

      const saved = await saveProjectSnapshot();
      if (!saved) {
        setStorageStatus("error");
        setStorageError("项目快照保存失败，无法高清放大。");
        return;
      }

      const pendingId = `image-upscale-pending-${Date.now().toString(36)}`;
      const pendingEdgeId = `edge-${sourceNodeId}-${pendingId}`;
      const pendingNode = createPendingUpscaleImageNode(sourceNode, pendingId);
      const pendingEdge: AgentCanvasEdge = {
        id: pendingEdgeId,
        source: sourceNodeId,
        target: pendingId,
        type: "animated",
      };
      const withPendingNodes = [
        ...applySelectedNodeIds(nodesRef.current, []),
        { ...pendingNode, selected: true },
      ];
      const withPendingEdges = [...edgesRef.current, pendingEdge];
      nodesRef.current = withPendingNodes;
      edgesRef.current = withPendingEdges;
      setNodes(withPendingNodes);
      setEdges(withPendingEdges);
      setStorageStatus("saving");
      setStorageError(null);

      try {
        const result = await upscaleProjectImage({
          expectedVersion: projectVersionRef.current,
          projectId: loadedProjectId,
          sourceNodeId,
        });
        projectVersionRef.current = result.project.version;
        persistedSelectedNodeIdRef.current = result.node.id;

        const savedSnapshot = getCurrentPersistableProjectSnapshot({
          edges: result.project.edges,
          lastRunId: result.project.lastRunId,
          nodes: result.project.nodes,
          selectedNodeId: result.project.selectedNodeId,
          title: result.project.title,
        });
        lastSavedSnapshotDigestRef.current = savedSnapshot.digest;
        lastSavedSnapshotRef.current = savedSnapshot;

        setNodes((current) => {
          const withoutPending = current.filter((node) => node.id !== pendingId);
          const merged = mergeCanvasUpserts(
            { edges: edgesRef.current, nodes: withoutPending },
            { edges: [result.edge], nodes: [result.node] }
          ).nodes;
          const next = applySelectedNodeIds(merged, [result.node.id]);
          nodesRef.current = next;
          return next;
        });
        setEdges((current) => {
          const withoutPending = current.filter((edge) => edge.id !== pendingEdgeId);
          const next = mergeCanvasUpserts(
            { edges: withoutPending, nodes: nodesRef.current },
            { edges: [result.edge], nodes: [result.node] }
          ).edges;
          edgesRef.current = next;
          return next;
        });
        setStorageStatus("saved");
        setStorageError(null);
      } catch (nextError: unknown) {
        if (nextError instanceof ProjectVersionConflictError) {
          projectVersionRef.current = nextError.project.version;
        }
        setNodes((current) => {
          const next = current.map((node) =>
            node.id === pendingId && node.data.kind === "imageResult"
              ? {
                  ...node,
                  data: {
                    ...node.data,
                    image: {
                      ...node.data.image,
                      title: "高清放大失败",
                    },
                    status: "error" as const,
                    upload: {
                      status: "error" as const,
                      error: getClientError(nextError),
                    },
                  },
                }
              : node
          );
          nodesRef.current = next;
          return next;
        });
        setStorageStatus("error");
        setStorageError(`高清放大失败：${getClientError(nextError)}`);
      }
    },
    [loadedProjectId, saveProjectSnapshot, setEdges, setNodes]
  );
  const imageNodeActions = useMemo(
    () => ({
      onUpscale: handleUpscaleImageNode,
    }),
    [handleUpscaleImageNode]
  );

  const handleSubmit = useCallback(
    async (
      message: PromptInputMessage = { files: [], text: prompt },
      event?: FormEvent<HTMLFormElement>
    ) => {
      event?.preventDefault();
      const value = (message.text || prompt).trim();
      await startAgentRun({
        clearComposer: true,
        promptText: value,
        selectedNodeId: referenceNodeId,
        selectedNodeIds: referenceNodeIds,
      });
    },
    [prompt, referenceNodeId, referenceNodeIds, startAgentRun]
  );

  const handleReplayTrace = useCallback(() => {
    if (!traceRunId || !loadedProjectId || !traceEvents.length) {
      return;
    }

    const projection = projectRuntimeEventsToCanvas({
      projectId: loadedProjectId,
      runNodeId: traceRunId,
      events: traceEvents,
      existingSnapshot: { nodes, edges },
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

  const handleMarkdownNodeChange = useCallback(
    (nodeId: string, content: string, blocks: unknown[]) => {
      if (isReplayMode) {
        return;
      }

      const normalizedContent = content.trim();
      const nextBlocksJson = JSON.stringify(blocks);
      setNodes((current) =>
        current.map((node) => {
          if (node.id !== nodeId || node.data.kind !== "markdown") {
            return node;
          }

          const currentBlocks =
            node.data.blockNoteBlocks ??
            node.data.artifact.metadata?.blockNoteBlocks;
          const currentBlocksJson = currentBlocks
            ? JSON.stringify(currentBlocks)
            : "";
          if (
            node.data.content === normalizedContent &&
            currentBlocksJson === nextBlocksJson
          ) {
            return node;
          }

          const summary = summarizeMarkdownForCanvasNode(normalizedContent);
          return {
            ...node,
            data: {
              ...node.data,
              artifact: {
                ...node.data.artifact,
                metadata: {
                  ...node.data.artifact.metadata,
                  blockNoteBlocks: blocks,
                  markdown: normalizedContent,
                  preview: summary,
                },
              },
              blockNoteBlocks: blocks,
              content: normalizedContent,
              summary,
            },
          };
        })
      );
    },
    [isReplayMode, setNodes]
  );

  const handleStickyTextChange = useCallback(
    (nodeId: string, text: string) => {
      if (isReplayMode) {
        return;
      }

      setNodes((current) =>
        current.map((node) =>
          node.id === nodeId && node.data.kind === "stickyNote"
            ? { ...node, data: { ...node.data, text } }
            : node
        )
      );
    },
    [isReplayMode, setNodes]
  );

  const handleShapeLabelChange = useCallback(
    (nodeId: string, label: string) => {
      if (isReplayMode) {
        return;
      }

      setNodes((current) =>
        current.map((node) =>
          node.id === nodeId && node.data.kind === "shape"
            ? { ...node, data: { ...node.data, label } }
            : node
        )
      );
    },
    [isReplayMode, setNodes]
  );

  return (
    <main
      className="app-shell"
      onDragEnter={fileDrop.handleFileDragEnter}
      onDragLeave={fileDrop.handleFileDragLeave}
      onDragOver={fileDrop.handleFileDragOver}
      onDrop={fileDrop.handleFileDrop}
    >
      <MarkdownNodeEditingContext.Provider
        value={{
          readOnly: isReplayMode,
          onChange: handleMarkdownNodeChange,
        }}
      >
        <ManualNodeEditingContext.Provider
          value={{
            readOnly: isReplayMode,
            onShapeLabelChange: handleShapeLabelChange,
            onStickyTextChange: handleStickyTextChange,
          }}
        >
          <ImageNodeActionContext.Provider value={imageNodeActions}>
            <Canvas<AgentCanvasNode, AgentCanvasEdge>
              className={`agent-canvas canvas-tool-${canvasTool}${
                isCreateTool ? " canvas-tool-create" : ""
              }`}
              colorMode="light"
              edgeTypes={edgeTypes}
              fitViewOptions={{ maxZoom: 1, padding: 0.32 }}
              maxZoom={5}
              minZoom={0.05}
              nodeTypes={nodeTypes}
              nodes={canvasNodes}
              edges={canvasEdges}
              onInit={handleCanvasInit}
              onEdgesChange={isReplayMode ? undefined : onEdgesChange}
              onNodesChange={isReplayMode ? undefined : handleNodesChange}
              onMouseDown={handleCreationMouseDown}
              onPaneClick={() => {
                if (!isReplayMode && !isHandTool && !isCreateTool) {
                  setNodes((current) => applySelectedNodeIds(current, []));
                }
              }}
              selectionMode={SelectionMode.Partial}
              nodesDraggable={!isReplayMode && !isHandTool && !isCreateTool}
              nodesConnectable={false}
              panOnDrag={isHandTool}
              selectionOnDrag={!isHandTool && !isCreateTool}
              proOptions={{ hideAttribution: true }}
            >
              <CanvasAutoFit
                fitRequest={layoutFitRequest}
                nodeCount={canvasNodes.length}
              />
              <Controls position="bottom-right" showInteractive={false} />
              <MiniMap
                pannable
                zoomable
                position="top-right"
                className="canvas-minimap"
              />
            </Canvas>
          </ImageNodeActionContext.Provider>
        </ManualNodeEditingContext.Provider>
      </MarkdownNodeEditingContext.Provider>
      <CanvasCreationPreview preview={creationPreview} />

      <TopBar
        storageError={storageError}
        storageStatus={storageStatus}
        title={projectTitle}
        onBack={onBack}
      />
      <ToolRail activeTool={canvasTool} onToolChange={setCanvasTool} />
      <ViewportControls
        canAutoLayout={!isReplayMode && nodes.length > 0}
        onAutoLayout={handleAutoLayout}
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
        contextCount={contextCount}
        prompt={prompt}
        referenceContextCount={referenceContextCount}
        referenceNode={referenceNode}
        referenceNodeCount={referenceNodeIds.length}
        replayActive={isReplayMode}
        selectionCount={selectedNodeIds.length}
        setPrompt={setPrompt}
        stop={handleStop}
        onSubmit={handleSubmit}
      />
    </main>
  );
}

function CanvasAutoFit({
  fitRequest,
  nodeCount,
}: {
  fitRequest: number;
  nodeCount: number;
}) {
  const { fitView } = useReactFlow<AgentCanvasNode, AgentCanvasEdge>();

  useEffect(() => {
    if (!nodeCount) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      fitView({ duration: 180, maxZoom: 1, padding: 0.32 });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [fitRequest, fitView, nodeCount]);

  return null;
}

function CanvasCreationPreview({ preview }: { preview: CreationPreview | null }) {
  if (!preview) {
    return null;
  }

  return (
    <div
      aria-hidden
      className="canvas-creation-preview"
      style={{
        height: preview.rect.height,
        left: preview.rect.left,
        top: preview.rect.top,
        width: preview.rect.width,
      }}
    >
      <span>{preview.label}</span>
    </div>
  );
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

function applyLinkedNodeDragChanges(
  changes: NodeChange<AgentCanvasNode>[],
  nodes: AgentCanvasNode[],
  edges: AgentCanvasEdge[]
) {
  const nextNodes = applyNodeChanges<AgentCanvasNode>(changes, nodes);
  const positionChanges = changes.filter(isPositionChangeWithPosition);
  if (!positionChanges.length) {
    return nextNodes;
  }

  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const nextNodesById = new Map(nextNodes.map((node) => [node.id, node]));
  const movedNodeIds = new Set(positionChanges.map((change) => change.id));
  const rootPositionChanges = positionChanges.filter(
    (change) => !hasMovedAncestor(change.id, movedNodeIds, edges)
  );
  const offsetsByNodeId = new Map<string, { x: number; y: number }>();

  for (const change of rootPositionChanges) {
    const previousNode = nodesById.get(change.id);
    const nextNode = nextNodesById.get(change.id);
    if (!previousNode || !nextNode) {
      continue;
    }

    const offset = {
      x: nextNode.position.x - previousNode.position.x,
      y: nextNode.position.y - previousNode.position.y,
    };
    if (!offset.x && !offset.y) {
      continue;
    }

    for (const descendantId of getDescendantNodeIds(change.id, edges)) {
      if (movedNodeIds.has(descendantId) || offsetsByNodeId.has(descendantId)) {
        continue;
      }
      offsetsByNodeId.set(descendantId, offset);
    }
  }

  if (!offsetsByNodeId.size) {
    return nextNodes;
  }

  return nextNodes.map((node) => {
    const offset = offsetsByNodeId.get(node.id);
    if (!offset) {
      return node;
    }

    return {
      ...node,
      position: {
        x: node.position.x + offset.x,
        y: node.position.y + offset.y,
      },
    };
  });
}

type PositionChangeWithPosition = Extract<
  NodeChange<AgentCanvasNode>,
  { type: "position" }
> & {
  position: { x: number; y: number };
};

function isPositionChangeWithPosition(
  change: NodeChange<AgentCanvasNode>
): change is PositionChangeWithPosition {
  return (
    change.type === "position" &&
    "position" in change &&
    typeof change.position?.x === "number" &&
    typeof change.position.y === "number"
  );
}

function hasMovedAncestor(
  nodeId: string,
  movedNodeIds: Set<string>,
  edges: AgentCanvasEdge[]
) {
  const incomingByTarget = new Map<string, string[]>();
  for (const edge of edges) {
    const incoming = incomingByTarget.get(edge.target) ?? [];
    incoming.push(edge.source);
    incomingByTarget.set(edge.target, incoming);
  }

  const visited = new Set<string>();
  const queue = [...(incomingByTarget.get(nodeId) ?? [])];
  while (queue.length) {
    const currentId = queue.shift();
    if (!currentId || visited.has(currentId)) {
      continue;
    }
    visited.add(currentId);
    if (movedNodeIds.has(currentId)) {
      return true;
    }
    queue.push(...(incomingByTarget.get(currentId) ?? []));
  }

  return false;
}

function getDescendantNodeIds(nodeId: string, edges: AgentCanvasEdge[]) {
  const outgoingBySource = new Map<string, string[]>();
  for (const edge of edges) {
    const outgoing = outgoingBySource.get(edge.source) ?? [];
    outgoing.push(edge.target);
    outgoingBySource.set(edge.source, outgoing);
  }

  const descendants: string[] = [];
  const visited = new Set<string>([nodeId]);
  const queue = [...(outgoingBySource.get(nodeId) ?? [])];
  while (queue.length) {
    const currentId = queue.shift();
    if (!currentId || visited.has(currentId)) {
      continue;
    }
    visited.add(currentId);
    descendants.push(currentId);
    queue.push(...(outgoingBySource.get(currentId) ?? []));
  }

  return descendants;
}

function getRetryAnchorNodeId(
  runNodeId: string,
  nodes: AgentCanvasNode[],
  edges: AgentCanvasEdge[]
) {
  const promptEdge = edges.find((edge) => edge.target === runNodeId);
  const promptNodeId = promptEdge?.source;
  const promptNode = nodes.find((node) => node.id === promptNodeId);
  if (!promptNode || promptNode.data.kind !== "prompt") {
    return null;
  }

  const upstreamEdge = edges.find((edge) => edge.target === promptNode.id);
  const upstreamNode = nodes.find((node) => node.id === upstreamEdge?.source);
  return getRunReferenceNodeId(upstreamNode);
}

function hasReadyRunOutput(nodes: AgentCanvasNode[], runId: string) {
  const runNode = nodes.find(
    (node) => node.id === runId && node.data.kind === "run"
  );
  const hasReadyResultNode = nodes.some((node) => {
    if (node.data.kind === "imageResult") {
      return node.data.runId === runId && (node.data.status ?? "ready") === "ready";
    }

    if ("runId" in node.data) {
      return node.data.runId === runId;
    }

    return false;
  });

  if (hasReadyResultNode) {
    return true;
  }
  if (!runNode || runNode.data.kind !== "run") {
    return false;
  }

  const toolParts = runNode.data.toolParts?.length
    ? runNode.data.toolParts
    : runNode.data.toolPart
      ? [runNode.data.toolPart]
      : [];

  return (
    toolParts.length > 0 &&
    toolParts.every((part) => part.state === "output-available")
  );
}

function dedupeRuntimeEvents(events: StreamedRuntimeEvents): StreamedRuntimeEvents {
  const seen = new Set<string>();
  const deduped: StreamedRuntimeEvents = [];

  for (const event of events) {
    const key =
      event.id ??
      `${event.projectId}:${event.runNodeId}:${event.stepId}:${event.type}:${event.createdAt}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(event);
  }

  return deduped;
}

function getManualNodeTemplateForTool(tool: CanvasTool) {
  if (tool === "select" || tool === "hand") {
    return null;
  }

  return manualNodeTemplates.find((template) => template.tool === tool) ?? null;
}

function isCanvasPaneEventTarget(target: EventTarget) {
  if (!(target instanceof Element)) {
    return false;
  }

  return Boolean(
    target.closest(".react-flow__pane") && !target.closest(".react-flow__node")
  );
}

function screenRectFromPoints(start: CanvasPoint, end: CanvasPoint) {
  return {
    height: Math.abs(end.y - start.y),
    left: Math.min(start.x, end.x),
    top: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
  };
}

function createManualCanvasNodeFromDrag(
  draft: CreationDraft,
  endScreen: CanvasPoint,
  instance: ReactFlowInstance<AgentCanvasNode, AgentCanvasEdge>
) {
  const endFlow = instance.screenToFlowPosition(endScreen);
  const defaultDimensions = getDefaultManualNodeDimensions(draft.template);
  const minimumDimensions = getMinimumManualNodeDimensions(draft.template);
  const draggedWidth = Math.abs(endFlow.x - draft.startFlow.x);
  const draggedHeight = Math.abs(endFlow.y - draft.startFlow.y);
  const usedDefaultSize = draggedWidth < 8 && draggedHeight < 8;
  const dimensions = usedDefaultSize
    ? defaultDimensions
    : {
        width: Math.max(draggedWidth, minimumDimensions.width),
        height: Math.max(draggedHeight, minimumDimensions.height),
      };
  const position = usedDefaultSize
    ? draft.startFlow
    : {
        x: Math.min(draft.startFlow.x, endFlow.x),
        y: Math.min(draft.startFlow.y, endFlow.y),
      };

  return createManualCanvasNode(draft.template, position, dimensions);
}

function createManualCanvasNode(
  template: ManualNodeTemplate,
  position: CanvasPoint,
  dimensions: { width: number; height: number }
): AgentCanvasNode {
  const createdAt = new Date().toISOString();
  if (template.kind === "stickyNote") {
    return {
      id: createCanvasNodeId("sticky"),
      type: "stickyNoteNode",
      position,
      ...dimensions,
      data: {
        kind: "stickyNote",
        color: template.color,
        createdAt,
        text: template.text,
      },
    };
  }

  return {
    id: createCanvasNodeId("shape"),
    type: "shapeNode",
    position,
    ...dimensions,
    data: {
      kind: "shape",
      createdAt,
      label: template.label,
      shape: template.shape,
    },
  };
}

function createCanvasNodeId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function getDefaultManualNodeDimensions(template: ManualNodeTemplate) {
  if (template.kind === "stickyNote") {
    return { width: 220, height: 170 };
  }

  return getDefaultShapeDimensions(template.shape);
}

function getMinimumManualNodeDimensions(template: ManualNodeTemplate) {
  if (template.kind === "stickyNote") {
    return { width: 150, height: 110 };
  }
  if (template.shape === "ellipse") {
    return { width: 72, height: 72 };
  }

  return { width: 88, height: 64 };
}

function getDefaultShapeDimensions(shape: ShapeVariant) {
  if (shape === "frame") {
    return { width: 280, height: 190 };
  }
  if (shape === "pill") {
    return { width: 220, height: 96 };
  }
  if (shape === "ellipse") {
    return { width: 180, height: 180 };
  }
  if (shape === "triangle") {
    return { width: 190, height: 170 };
  }

  return { width: 200, height: 140 };
}

function getCurrentPersistableProjectSnapshot({
  edges,
  lastRunId,
  nodes,
  selectedNodeId,
  title,
}: {
  edges: AgentCanvasEdge[];
  lastRunId: string | null;
  nodes: AgentCanvasNode[];
  selectedNodeId: string | null;
  title: string;
}) {
  const persistableNodes = toPersistableNodes(nodes);
  const persistableNodeIds = new Set(persistableNodes.map((node) => node.id));
  const persistableEdges = edges.filter(
    (edge) =>
      persistableNodeIds.has(edge.source) && persistableNodeIds.has(edge.target)
  );

  return {
    digest: getProjectSnapshotDigest({
      edges: persistableEdges,
      lastRunId,
      nodes: persistableNodes,
      selectedNodeId,
      title,
    }),
    edges: persistableEdges,
    lastRunId,
    nodes: persistableNodes,
    selectedNodeId,
    title,
  };
}

type PersistableProjectSnapshot = ReturnType<
  typeof getCurrentPersistableProjectSnapshot
>;

function getProjectSnapshotDigest({
  edges,
  lastRunId,
  nodes,
  selectedNodeId,
  title,
}: {
  edges: AgentCanvasEdge[];
  lastRunId: string | null;
  nodes: AgentCanvasNode[];
  selectedNodeId: string | null;
  title: string;
}) {
  return JSON.stringify({ edges, lastRunId, nodes, selectedNodeId, title });
}

async function hydrateProjectSnapshotFromLastRun(
  project: PersistedProject
): Promise<{ nodes: AgentCanvasNode[]; edges: AgentCanvasEdge[] } | null> {
  const snapshot = {
    nodes: project.nodes,
    edges: project.edges,
  };

  if (!project.lastRunId) {
    return null;
  }

  try {
    const { events } = await loadRunTrace(project.id, project.lastRunId);
    if (!events.length) {
      return null;
    }

    const projection = projectRuntimeEventsToCanvas({
      projectId: project.id,
      runNodeId: project.lastRunId,
      events,
      existingSnapshot: snapshot,
    });

    if (
      !shouldMergeHydratedSnapshot({
        currentEdges: project.edges,
        currentNodes: project.nodes,
        projectedEdges: projection.edges,
        projectedNodes: projection.nodes,
      })
    ) {
      return null;
    }

    return {
      nodes: projection.nodes,
      edges: projection.edges,
    };
  } catch {
    return null;
  }
}

function shouldMergeHydratedSnapshot({
  currentEdges,
  currentNodes,
  projectedEdges,
  projectedNodes,
}: {
  currentEdges: AgentCanvasEdge[];
  currentNodes: AgentCanvasNode[];
  projectedEdges: AgentCanvasEdge[];
  projectedNodes: AgentCanvasNode[];
}) {
  const nodesById = new Map(currentNodes.map((node) => [node.id, node]));
  for (const projectedNode of projectedNodes) {
    const currentNode = nodesById.get(projectedNode.id);
    if (!currentNode || JSON.stringify(currentNode) !== JSON.stringify(projectedNode)) {
      return true;
    }
  }

  const edgesById = new Map(currentEdges.map((edge) => [edge.id, edge]));
  for (const projectedEdge of projectedEdges) {
    const currentEdge = edgesById.get(projectedEdge.id);
    if (!currentEdge || JSON.stringify(currentEdge) !== JSON.stringify(projectedEdge)) {
      return true;
    }
  }

  return false;
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

function ToolRail({
  activeTool,
  onToolChange,
}: {
  activeTool: CanvasTool;
  onToolChange: (tool: CanvasTool) => void;
}) {
  const tools: ToolRailItem[] = [
    { icon: MousePointer2, label: "移动工具", tool: "select" },
    { icon: Hand, label: "抓手工具", tool: "hand" },
    ...manualNodeTemplates.map((template) => ({
      icon: template.icon,
      label: template.label,
      tool: template.tool,
    })),
  ];

  return (
    <aside className="tool-rail" aria-label="Canvas tools">
      {tools.map(({ icon: Icon, label, tool }) => {
        const active = tool === activeTool;
        return (
          <button
            aria-label={label}
            className={active ? "active" : ""}
            key={label}
            onClick={() => onToolChange(tool)}
            type="button"
            title={label}
          >
            <Icon size={16} />
          </button>
        );
      })}
    </aside>
  );
}

function ViewportControls({
  canAutoLayout,
  onAutoLayout,
}: {
  canAutoLayout: boolean;
  onAutoLayout: () => void;
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
        aria-label="自动布局"
        disabled={!canAutoLayout}
        onClick={onAutoLayout}
        title={canAutoLayout ? "自动布局" : "暂无节点"}
        type="button"
      >
        <Workflow size={14} />
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
  contextCount,
  prompt,
  referenceContextCount,
  referenceNode,
  referenceNodeCount,
  replayActive,
  selectionCount,
  setPrompt,
  stop,
  onSubmit,
}: {
  busy: boolean;
  canSubmit: boolean;
  contextCount: number;
  prompt: string;
  referenceContextCount: number;
  referenceNode?: AgentCanvasNode;
  referenceNodeCount: number;
  replayActive: boolean;
  selectionCount: number;
  setPrompt: (value: string) => void;
  stop: () => void;
  onSubmit: (
    message: PromptInputMessage,
    event?: FormEvent<HTMLFormElement>
  ) => void;
}) {
  const hasReference = Boolean(referenceNode);
  const hasMultiSelection = selectionCount > 1;
  const hasMultipleReferences = referenceNodeCount > 1;
  const footerContextLabel = hasReference
    ? hasMultipleReferences
      ? `${referenceNodeCount} 个引用节点 · ${referenceContextCount} upstream items`
      : `${referenceContextCount} upstream items`
    : hasMultiSelection
      ? "选中的 Run 节点不会引用"
      : `${contextCount} upstream items`;

  return (
    <div className="composer-wrap">
      <div className="context-pill" data-active={hasReference || hasMultiSelection}>
        {hasReference
          ? hasMultipleReferences
            ? `引用节点: ${referenceNodeCount} 个`
            : `引用节点: ${getReferenceNodeLabel(referenceNode)}`
          : hasMultiSelection
            ? `已选中 ${selectionCount} 个节点，无可引用节点`
          : "未引用节点"}
      </div>
      <PromptInput
        attachmentsEnabled={false}
        className="composer"
        onSubmit={(message, event) => onSubmit(message, event)}
      >
        <PromptInputBody>
          <PromptInputTextarea
            disabled={!canSubmit && !busy}
            placeholder={
              replayActive
                ? "Run 回放模式为只读..."
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
          <ComposerFooterStatus
            label={
              hasReference
                ? hasMultipleReferences
                  ? `继续基于 ${referenceNodeCount} 个引用节点生成分支`
                  : "继续基于引用节点生成分支"
                : footerContextLabel
            }
          />
          <PromptInputSubmit
            disabled={busy ? false : !prompt.trim() || !canSubmit}
            onStop={stop}
            status={busy ? "streaming" : "ready"}
          />
        </PromptInputFooter>
      </PromptInput>
    </div>
  );
}

function ComposerFooterStatus({
  label,
}: {
  label: string;
}) {
  return (
    <span className="composer-footer-status">
      <span>{label}</span>
    </span>
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
  width,
  height,
}: NodeProps<FlowNode<PromptNodeData, "promptNode">>) {
  const isExpanded = typeof height === "number" && height > 96;
  const nodeClassName = [
    "canvas-node",
    "prompt-card",
    selected ? "selected" : "",
    isExpanded ? "expanded" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Node
      className={nodeClassName}
      handles={{ source: true, target: true }}
      minHeight={64}
      minWidth={180}
      selected={selected}
      style={getResizableNodeStyle(width, height)}
    >
      <NodeContent className="prompt-content">
        <p className="copyable-text nodrag nopan" title={data.contextLabel}>
          {data.prompt}
        </p>
      </NodeContent>
    </Node>
  );
}

function StickyNoteNode({
  id,
  data,
  selected,
  width,
  height,
}: NodeProps<FlowNode<StickyNoteNodeData, "stickyNoteNode">>) {
  const { onStickyTextChange, readOnly } = useContext(ManualNodeEditingContext);

  return (
    <Node
      className={
        selected
          ? `canvas-node selected sticky-note-card ${data.color}`
          : `canvas-node sticky-note-card ${data.color}`
      }
      handles={{ source: true, target: true }}
      minHeight={120}
      minWidth={160}
      selected={selected}
      style={getResizableNodeStyle(width, height)}
    >
      <NodeContent className="sticky-note-content">
        <textarea
          aria-label="便签内容"
          className="sticky-note-input nodrag nopan nowheel"
          onChange={(event) => onStickyTextChange(id, event.currentTarget.value)}
          placeholder="写下想法..."
          readOnly={readOnly}
          spellCheck={false}
          value={data.text}
        />
      </NodeContent>
    </Node>
  );
}

function ShapeNode({
  id,
  data,
  selected,
  width,
  height,
}: NodeProps<FlowNode<ShapeNodeData, "shapeNode">>) {
  const { onShapeLabelChange, readOnly } = useContext(ManualNodeEditingContext);

  return (
    <Node
      className={
        selected
          ? `canvas-node selected shape-card ${data.shape}`
          : `canvas-node shape-card ${data.shape}`
      }
      handles={{ source: true, target: true }}
      minHeight={72}
      minWidth={96}
      selected={selected}
      style={getResizableNodeStyle(width, height)}
    >
      <NodeContent className="shape-content">
        <div className="shape-visual">
          <input
            aria-label="形状标签"
            className="shape-label-input nodrag nopan"
            onChange={(event) => onShapeLabelChange(id, event.currentTarget.value)}
            readOnly={readOnly}
            spellCheck={false}
            value={data.label}
          />
        </div>
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

function ArtifactLikeNode({ data, selected, width, height }: ArtifactLikeNodeProps) {
  const label = getArtifactNodeLabel(data);
  const summary = getArtifactNodeSummary(data);
  const metaLine = getArtifactMetaLine(data);
  const contentUrl = getArtifactContentUrl(data.artifact);
  const canPreview = Boolean(getInlineArtifactPreview(data) || contentUrl);
  const [isPreviewOpen, setPreviewOpen] = useState(false);

  return (
    <>
      {selected && (
        <NodeToolbar
          align="end"
          className="artifact-node-toolbar nodrag nopan nowheel"
          isVisible={selected}
          offset={10}
          position={Position.Top}
        >
          <button
            aria-label="预览产物"
            disabled={!canPreview}
            onClick={(event) => {
              stopNodeToolbarEvent(event);
              setPreviewOpen(true);
            }}
            onMouseDown={stopNodeToolbarEvent}
            onPointerDown={stopNodeToolbarEvent}
            title="预览"
            type="button"
          >
            <Maximize2 size={14} />
          </button>
          <button
            aria-label="打开产物"
            disabled={!contentUrl}
            onClick={(event) => {
              stopNodeToolbarEvent(event);
              if (contentUrl) {
                window.open(contentUrl, "_blank", "noreferrer");
              }
            }}
            onMouseDown={stopNodeToolbarEvent}
            onPointerDown={stopNodeToolbarEvent}
            title="打开"
            type="button"
          >
            <ArrowUpRight size={14} />
          </button>
          <button
            aria-label="下载产物"
            disabled={!contentUrl}
            onClick={(event) => {
              stopNodeToolbarEvent(event);
              if (contentUrl) {
                downloadArtifactAsset(contentUrl, data);
              }
            }}
            onMouseDown={stopNodeToolbarEvent}
            onPointerDown={stopNodeToolbarEvent}
            title="下载"
            type="button"
          >
            <Download size={14} />
          </button>
        </NodeToolbar>
      )}

      <Node
        className={
          selected
            ? `canvas-node selected artifact-card ${data.kind}`
            : `canvas-node artifact-card ${data.kind}`
        }
        handles={{ source: true, target: true }}
        minHeight={96}
        minWidth={180}
        selected={selected}
        style={getResizableNodeStyle(width, height)}
      >
        <NodeContent className="artifact-content">
          <div className="artifact-heading">
            <span className="artifact-icon">
              <ArtifactNodeIcon kind={data.kind} />
            </span>
            <span className="copyable-text nodrag nopan">{label}</span>
          </div>
          <strong className="copyable-text nodrag nopan" title={data.title}>
            {data.title}
          </strong>
          {summary && (
            <p className="copyable-text nodrag nopan" title={summary}>
              {summary}
            </p>
          )}
          {metaLine && (
            <small className="artifact-meta copyable-text nodrag nopan">
              {metaLine}
            </small>
          )}
          {data.upload && (
            <span className={`upload-state ${data.upload.status}`}>
              {data.upload.status === "error" ? "上传失败" : "上传中"}
            </span>
          )}
        </NodeContent>
      </Node>

      <ArtifactPreviewDialog
        contentUrl={contentUrl}
        data={data}
        open={isPreviewOpen}
        onOpenChange={setPreviewOpen}
      />
    </>
  );
}

function ArtifactPreviewDialog({
  contentUrl,
  data,
  open,
  onOpenChange,
}: {
  contentUrl?: string;
  data: ArtifactLikeNodeProps["data"];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const inlinePreview = getInlineArtifactPreview(data);
  const shouldFetchText = Boolean(
    open &&
      contentUrl &&
      isTextualArtifact(data) &&
      (data.kind === "code" || !inlinePreview)
  );
  const loadedPreview = useTextArtifactContent(contentUrl, shouldFetchText);
  const loadState =
    loadedPreview?.status === "error"
      ? "error"
      : inlinePreview || loadedPreview?.text
        ? "ready"
        : !contentUrl
          ? "idle"
          : !isTextualArtifact(data)
            ? "binary"
            : shouldFetchText
              ? "loading"
              : "idle";
  const previewText =
    (loadedPreview && loadedPreview.url === contentUrl ? loadedPreview.text : null) ??
    inlinePreview;
  const metaLine = getArtifactMetaLine(data);
  const codeLanguage = data.kind === "code" ? getCodeBlockLanguage(data) : null;

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="artifact-preview-dialog nodrag nopan nowheel">
        <DialogTitle>{data.title}</DialogTitle>
        <DialogDescription>{metaLine || getArtifactNodeLabel(data)}</DialogDescription>
        <div className="artifact-preview-body">
          {loadState === "loading" && <span>读取预览...</span>}
          {loadState === "error" && <span>无法读取预览</span>}
          {loadState === "binary" && <span>此产物可下载或打开查看</span>}
          {previewText && data.kind === "code" && codeLanguage && (
            <CodeBlock
              className="artifact-preview-code"
              code={previewText}
              language={codeLanguage}
              showLineNumbers
            >
              <CodeBlockHeader>
                <CodeBlockTitle>
                  <CodeBlockFilename>{data.title}</CodeBlockFilename>
                </CodeBlockTitle>
                <CodeBlockActions>
                  <CodeBlockCopyButton aria-label="复制代码" title="复制代码" />
                </CodeBlockActions>
              </CodeBlockHeader>
            </CodeBlock>
          )}
          {previewText && data.kind !== "code" && (
            <pre className="artifact-preview-text">{previewText}</pre>
          )}
          {!previewText && loadState === "idle" && <span>暂无预览</span>}
        </div>
        {contentUrl && (
          <div className="artifact-preview-actions">
            <a href={contentUrl} rel="noreferrer" target="_blank">
              打开
            </a>
            <button
              type="button"
              onClick={() => downloadArtifactAsset(contentUrl, data)}
            >
              下载
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CodeNode({
  data,
  selected,
  width,
  height,
}: NodeProps<FlowNode<CodeNodeData, "codeNode">>) {
  const contentUrl = getArtifactContentUrl(data.artifact);
  const inlinePreview = getInlineArtifactPreview(data);
  const [isPreviewOpen, setPreviewOpen] = useState(false);
  const loadedPreview = useTextArtifactContent(
    contentUrl,
    Boolean(contentUrl && isTextualArtifact(data))
  );
  const metaLine = getArtifactMetaLine(data);
  const codeText =
    (loadedPreview && loadedPreview.url === contentUrl ? loadedPreview.text : null) ??
    inlinePreview ??
    "";
  const displayCode =
    codeText ||
    (loadedPreview?.status === "error" ? "无法读取代码预览" : "读取代码...");
  const language = getCodeBlockLanguage(data);
  const canPreview = Boolean(codeText || contentUrl);

  return (
    <>
      {selected && (
        <NodeToolbar
          align="end"
          className="artifact-node-toolbar nodrag nopan nowheel"
          isVisible={selected}
          offset={10}
          position={Position.Top}
        >
          <button
            aria-label="预览代码"
            disabled={!canPreview}
            onClick={(event) => {
              stopNodeToolbarEvent(event);
              setPreviewOpen(true);
            }}
            onMouseDown={stopNodeToolbarEvent}
            onPointerDown={stopNodeToolbarEvent}
            title="预览"
            type="button"
          >
            <Maximize2 size={14} />
          </button>
          <button
            aria-label="打开代码文件"
            disabled={!contentUrl}
            onClick={(event) => {
              stopNodeToolbarEvent(event);
              if (contentUrl) {
                window.open(contentUrl, "_blank", "noreferrer");
              }
            }}
            onMouseDown={stopNodeToolbarEvent}
            onPointerDown={stopNodeToolbarEvent}
            title="打开"
            type="button"
          >
            <ArrowUpRight size={14} />
          </button>
          <button
            aria-label="下载代码文件"
            disabled={!contentUrl}
            onClick={(event) => {
              stopNodeToolbarEvent(event);
              if (contentUrl) {
                downloadArtifactAsset(contentUrl, data);
              }
            }}
            onMouseDown={stopNodeToolbarEvent}
            onPointerDown={stopNodeToolbarEvent}
            title="下载"
            type="button"
          >
            <Download size={14} />
          </button>
        </NodeToolbar>
      )}

      <Node
        className={
          selected ? "canvas-node selected code-card" : "canvas-node code-card"
        }
        handles={{ source: true, target: true }}
        minHeight={160}
        minWidth={260}
        selected={selected}
        style={getResizableNodeStyle(width, height)}
      >
        <NodeContent className="code-content">
          <div className="code-heading">
            <span className="artifact-icon">
              <Type size={14} />
            </span>
            <div>
              <span>Code</span>
              <strong className="copyable-text nodrag nopan" title={data.title}>
                {data.title}
              </strong>
            </div>
          </div>
          <div className="code-node-editor nodrag nopan nowheel">
            <CodeBlock
              className="code-node-block"
              code={displayCode}
              language={language}
              showLineNumbers
            >
              <CodeBlockHeader className="code-node-block-header">
                <CodeBlockTitle>
                  <CodeBlockFilename>{language}</CodeBlockFilename>
                </CodeBlockTitle>
                <CodeBlockActions>
                  <CodeBlockCopyButton aria-label="复制代码" title="复制代码" />
                </CodeBlockActions>
              </CodeBlockHeader>
            </CodeBlock>
          </div>
          {metaLine && (
            <small className="artifact-meta copyable-text nodrag nopan">
              {metaLine}
            </small>
          )}
          {data.upload && (
            <span className={`upload-state ${data.upload.status}`}>
              {data.upload.status === "error" ? "上传失败" : "上传中"}
            </span>
          )}
        </NodeContent>
      </Node>

      <ArtifactPreviewDialog
        contentUrl={contentUrl}
        data={data}
        open={isPreviewOpen}
        onOpenChange={setPreviewOpen}
      />
    </>
  );
}

function HtmlPageNode({
  data,
  selected,
  width,
  height,
}: NodeProps<FlowNode<WebpageNodeData, "webpageNode">>) {
  const previewUrl = data.previewUrl ?? data.artifact.contentRef ?? data.artifact.uri;
  const frameTitle = `${data.title} preview`;

  return (
    <Node
      className={
        selected
          ? "canvas-node selected html-page-card"
          : "canvas-node html-page-card"
      }
      handles={{ source: true, target: true }}
      minHeight={220}
      minWidth={280}
      selected={selected}
      style={getResizableNodeStyle(width, height)}
    >
      <NodeContent className="html-page-content">
        <div className="html-page-heading">
          <span className="artifact-icon">
            <Globe2 size={14} />
          </span>
          <div>
            <span>HTML</span>
            <strong className="copyable-text nodrag nopan" title={data.title}>
              {data.title}
            </strong>
          </div>
          {previewUrl && (
            <a
              aria-label="打开页面预览"
              className="html-page-open nodrag nopan"
              href={previewUrl}
              rel="noreferrer"
              target="_blank"
              title="打开页面预览"
            >
              <ArrowUpRight size={13} />
            </a>
          )}
        </div>
        <div className="html-page-frame nodrag nopan">
          {data.html || previewUrl ? (
            <iframe
              sandbox=""
              src={data.html ? undefined : previewUrl}
              srcDoc={data.html}
              title={frameTitle}
            />
          ) : (
            <div className="html-page-empty">暂无预览</div>
          )}
        </div>
        {selected && (
          <div className="html-page-footer">
            <span className="copyable-text nodrag nopan">
              {data.summary ?? "页面预览"}
            </span>
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

function getArtifactMetaLine(data: ArtifactLikeNodeProps["data"]) {
  const parts = [
    readMetadataString(data.artifact.metadata?.sourceToolName) ??
      (data.runId ? "Run" : undefined),
    formatArtifactDate(data.createdAt ?? readMetadataString(data.artifact.metadata?.createdAt)),
    formatArtifactBytes(readMetadataNumber(data.artifact.metadata?.byteSize)),
  ].filter(Boolean);

  return parts.join(" · ");
}

function getInlineArtifactPreview(data: ArtifactLikeNodeProps["data"]) {
  if (data.kind === "markdown") {
    return data.content;
  }
  if (data.kind === "decision") {
    return data.decision;
  }
  if (data.kind === "memory") {
    return data.memory;
  }
  if (data.kind === "toolResult") {
    return (
      stringifyPreviewValue(data.artifact.metadata?.output) ??
      stringifyPreviewValue(data.artifact.metadata?.result) ??
      data.summary
    );
  }

  return (
    readMetadataString(data.artifact.metadata?.preview) ??
    readMetadataString(data.artifact.metadata?.text) ??
    readMetadataString(data.artifact.metadata?.content) ??
    data.summary
  );
}

function getArtifactContentUrl(artifact: ArtifactLikeNodeProps["data"]["artifact"]) {
  if (artifact.uri?.startsWith("/api/") || artifact.uri?.startsWith("http")) {
    return artifact.uri;
  }

  const projectId =
    readMetadataString(artifact.metadata?.projectId) ??
    readProjectIdFromStoragePath(readMetadataString(artifact.metadata?.storagePath)) ??
    readProjectIdFromContentRef(artifact.contentRef);
  if (!projectId) {
    return undefined;
  }

  return `/api/projects/${encodeURIComponent(projectId)}/artifacts/${encodeURIComponent(
    artifact.id
  )}/content`;
}

type TextArtifactContentState = {
  status: "ready" | "error";
  text: string | null;
  url: string;
};

function useTextArtifactContent(
  contentUrl: string | undefined,
  enabled: boolean,
  maxLength = 24_000
) {
  const [loadedPreview, setLoadedPreview] =
    useState<TextArtifactContentState | null>(null);

  useEffect(() => {
    if (!enabled || !contentUrl) {
      return;
    }

    let ignore = false;
    fetch(contentUrl, { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const contentType = response.headers.get("Content-Type") ?? "";
        if (!isTextContentType(contentType)) {
          if (!ignore) {
            setLoadedPreview({ status: "ready", text: null, url: contentUrl });
          }
          return;
        }
        const text = await response.text();
        if (!ignore) {
          setLoadedPreview({
            status: "ready",
            text: text.slice(0, maxLength),
            url: contentUrl,
          });
        }
      })
      .catch(() => {
        if (!ignore) {
          setLoadedPreview({ status: "error", text: null, url: contentUrl });
        }
      });

    return () => {
      ignore = true;
    };
  }, [contentUrl, enabled, maxLength]);

  return loadedPreview;
}

const CODE_LANGUAGE_ALIASES: Record<string, BundledLanguage> = {
  bash: "bash" as BundledLanguage,
  c: "c" as BundledLanguage,
  cc: "cpp" as BundledLanguage,
  cpp: "cpp" as BundledLanguage,
  cs: "csharp" as BundledLanguage,
  css: "css" as BundledLanguage,
  go: "go" as BundledLanguage,
  htm: "html" as BundledLanguage,
  html: "html" as BundledLanguage,
  java: "java" as BundledLanguage,
  js: "javascript" as BundledLanguage,
  json: "json" as BundledLanguage,
  jsonl: "json" as BundledLanguage,
  jsx: "jsx" as BundledLanguage,
  kt: "kotlin" as BundledLanguage,
  lua: "lua" as BundledLanguage,
  md: "markdown" as BundledLanguage,
  mdx: "mdx" as BundledLanguage,
  ndjson: "json" as BundledLanguage,
  php: "php" as BundledLanguage,
  py: "python" as BundledLanguage,
  rb: "ruby" as BundledLanguage,
  rs: "rust" as BundledLanguage,
  scss: "scss" as BundledLanguage,
  sh: "shellscript" as BundledLanguage,
  sql: "sql" as BundledLanguage,
  swift: "swift" as BundledLanguage,
  toml: "toml" as BundledLanguage,
  ts: "typescript" as BundledLanguage,
  tsx: "tsx" as BundledLanguage,
  vue: "vue" as BundledLanguage,
  xml: "xml" as BundledLanguage,
  yaml: "yaml" as BundledLanguage,
  yml: "yaml" as BundledLanguage,
  zsh: "zsh" as BundledLanguage,
};

const CODE_MIME_LANGUAGE_ALIASES: Record<string, BundledLanguage> = {
  "application/json": "json" as BundledLanguage,
  "application/typescript": "typescript" as BundledLanguage,
  "application/x-javascript": "javascript" as BundledLanguage,
  "application/x-sh": "shellscript" as BundledLanguage,
  "application/xml": "xml" as BundledLanguage,
  "text/css": "css" as BundledLanguage,
  "text/html": "html" as BundledLanguage,
  "text/javascript": "javascript" as BundledLanguage,
  "text/markdown": "markdown" as BundledLanguage,
  "text/x-markdown": "markdown" as BundledLanguage,
  "text/x-python": "python" as BundledLanguage,
  "text/xml": "xml" as BundledLanguage,
};

function getCodeBlockLanguage(data: CodeNodeData): BundledLanguage {
  const mimeType = readMetadataString(data.artifact.metadata?.mimeType)?.toLowerCase();
  const candidates = [
    data.language,
    readMetadataString(data.artifact.metadata?.language),
    getFileExtensionFromName(readMetadataString(data.artifact.metadata?.fileName)),
    getFileExtensionFromName(data.title),
  ];

  for (const candidate of candidates) {
    const language = normalizeCodeLanguage(candidate);
    if (language) {
      return language;
    }
  }

  if (mimeType) {
    if (CODE_MIME_LANGUAGE_ALIASES[mimeType]) {
      return CODE_MIME_LANGUAGE_ALIASES[mimeType];
    }
    if (mimeType.endsWith("+json")) {
      return "json" as BundledLanguage;
    }
    if (mimeType.includes("javascript")) {
      return "javascript" as BundledLanguage;
    }
  }

  return "text" as BundledLanguage;
}

function normalizeCodeLanguage(value: string | undefined) {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase().replace(/^\./, "");
  return CODE_LANGUAGE_ALIASES[normalized] ?? (normalized as BundledLanguage);
}

function getFileExtensionFromName(value: string | undefined) {
  const match = value?.trim().match(/\.([a-z0-9]+)$/i);
  return match?.[1];
}

function readProjectIdFromStoragePath(value: string | undefined) {
  return value?.match(/^projects\/([^/]+)\//)?.[1];
}

function readProjectIdFromContentRef(value: string | undefined) {
  return value?.match(/^supabase:\/\/[^/]+\/projects\/([^/]+)\//)?.[1];
}

function isTextualArtifact(data: ArtifactLikeNodeProps["data"]) {
  const mimeType = readMetadataString(data.artifact.metadata?.mimeType)?.toLowerCase();
  return (
    data.kind === "code" ||
    data.kind === "markdown" ||
    data.kind === "toolResult" ||
    data.kind === "webpage" ||
    mimeType?.startsWith("text/") ||
    mimeType?.includes("json") ||
    mimeType?.includes("javascript") ||
    mimeType?.includes("xml") ||
    mimeType?.includes("yaml")
  );
}

function isTextContentType(contentType: string) {
  const normalized = contentType.toLowerCase();
  return (
    normalized.startsWith("text/") ||
    normalized.includes("json") ||
    normalized.includes("javascript") ||
    normalized.includes("xml") ||
    normalized.includes("yaml")
  );
}

function formatArtifactDate(value: string | undefined) {
  if (!value) {
    return undefined;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatArtifactBytes(value: number | undefined) {
  if (!Number.isFinite(value) || !value) {
    return undefined;
  }
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function readMetadataString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readMetadataNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringifyPreviewValue(value: unknown) {
  if (typeof value === "string") {
    return value;
  }
  if (value === undefined || value === null) {
    return undefined;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function downloadArtifactAsset(
  url: string,
  data: ArtifactLikeNodeProps["data"]
) {
  triggerImageDownload(url, getArtifactDownloadName(data));
}

function getArtifactDownloadName(data: ArtifactLikeNodeProps["data"]) {
  const extension = getArtifactDownloadExtension(data);
  const safeName =
    data.title
      .trim()
      .replace(/\.[a-z0-9]{2,8}$/i, "")
      .replace(/[^a-z0-9\u4e00-\u9fa5_-]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || data.artifact.id;

  return `${safeName}.${extension}`;
}

function getArtifactDownloadExtension(data: ArtifactLikeNodeProps["data"]) {
  const mimeType = readMetadataString(data.artifact.metadata?.mimeType)?.toLowerCase();
  if (data.kind === "code") {
    return readMetadataString(data.artifact.metadata?.language) ?? "txt";
  }
  if (data.kind === "markdown") {
    return "md";
  }
  if (data.kind === "webpage" || mimeType === "text/html") {
    return "html";
  }
  if (mimeType?.includes("json")) {
    return "json";
  }
  if (mimeType === "application/pdf") {
    return "pdf";
  }
  return "txt";
}

function MarkdownNode({
  id,
  data,
  selected,
  width,
  height,
}: NodeProps<FlowNode<MarkdownNodeData, "markdownNode">>) {
  const { readOnly, onChange } = useContext(MarkdownNodeEditingContext);
  const contentUrl = getArtifactContentUrl(data.artifact);
  const [loadedContent, setLoadedContent] = useState<{
    text: string;
    url: string;
  } | null>(null);
  const shouldLoadFullContent = shouldLoadFullMarkdownContent(data, contentUrl);

  useEffect(() => {
    if (!shouldLoadFullContent || !contentUrl) {
      return;
    }

    let ignore = false;
    fetch(contentUrl, { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const contentType = response.headers.get("Content-Type") ?? "";
        if (contentType && !isTextContentType(contentType)) {
          return;
        }
        const text = await response.text();
        if (!ignore && text.trim()) {
          setLoadedContent({ text, url: contentUrl });
        }
      })
      .catch((error: unknown) => {
        console.error("[markdown-node] failed to load artifact content", error);
      });

    return () => {
      ignore = true;
    };
  }, [contentUrl, shouldLoadFullContent]);

  const loadedText =
    shouldLoadFullContent && loadedContent && loadedContent.url === contentUrl
      ? loadedContent.text
      : null;
  const editorData =
    loadedText && loadedText !== data.content
      ? { ...data, content: loadedText }
      : data;

  return (
    <Node
      className={
        selected
          ? "canvas-node selected markdown-card"
          : "canvas-node markdown-card"
      }
      handles={{ source: true, target: true }}
      minHeight={220}
      minWidth={280}
      selected={selected}
      style={getResizableNodeStyle(width, height)}
    >
      <NodeContent className="markdown-content">
        <div className="markdown-heading">
          <span className="artifact-icon">
            <FileText size={14} />
          </span>
          <div>
            <span>Markdown</span>
            <strong className="copyable-text nodrag nopan" title={data.title}>
              {data.title}
            </strong>
          </div>
        </div>
        <div className="blocknote-body nodrag nopan nowheel">
          <Suspense
            fallback={
              <pre className="markdown-plain-preview">{editorData.content}</pre>
            }
          >
            <BlockNoteMarkdownEditor
              key={`${data.artifact.id}:${loadedText ? "loaded" : "inline"}`}
              data={editorData}
              nodeId={id}
              readOnly={readOnly}
              onChange={onChange}
            />
          </Suspense>
        </div>
      </NodeContent>
    </Node>
  );
}

function shouldLoadFullMarkdownContent(
  data: MarkdownNodeData,
  contentUrl: string | undefined
) {
  return Boolean(
    contentUrl &&
      !data.blockNoteBlocks &&
      data.content.trimEnd().endsWith("...内容已截断")
  );
}

function summarizeMarkdownForCanvasNode(content: string) {
  return (
    content
      .replace(/```[\s\S]*?```/g, "")
      .split("\n")
      .map((line) => line.replace(/^#{1,6}\s+/, "").trim())
      .filter(Boolean)
      .find((line) => !/^[-*]\s*$/.test(line))
      ?.slice(0, 160) ?? "Markdown document"
  );
}

function ImageResultNode({
  data,
  id,
  selected,
  width,
  height,
}: NodeProps<FlowNode<ImageResultNodeData, "imageResultNode">>) {
  const { onUpscale } = useContext(ImageNodeActionContext);
  const status = data.status ?? (data.image.url ? "ready" : "loading");
  const requestLabel = formatImageRequestLabel(data.request);
  const [isPreviewOpen, setPreviewOpen] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "link" | "error">(
    "idle"
  );
  const copyResetTimer = useRef<number | undefined>(undefined);
  const isReady = status === "ready" && Boolean(data.image.url);

  useEffect(() => {
    return () => {
      if (copyResetTimer.current) {
        window.clearTimeout(copyResetTimer.current);
      }
    };
  }, []);

  const resetCopyStateSoon = useCallback((state: "copied" | "link" | "error") => {
    setCopyState(state);
    if (copyResetTimer.current) {
      window.clearTimeout(copyResetTimer.current);
    }
    copyResetTimer.current = window.setTimeout(() => setCopyState("idle"), 1600);
  }, []);

  const handleDownload = useCallback(async () => {
    if (!data.image.url) {
      return;
    }

    await downloadImageAsset(data.image);
  }, [data.image]);

  const handleCopy = useCallback(async () => {
    if (!data.image.url) {
      return;
    }

    try {
      const result = await copyImageAsset(data.image);
      resetCopyStateSoon(result);
    } catch {
      resetCopyStateSoon("error");
    }
  }, [data.image, resetCopyStateSoon]);

  return (
    <>
      {isReady && (
        <NodeToolbar
          align="end"
          className="image-node-toolbar nodrag nopan nowheel"
          isVisible={selected}
          offset={12}
          position={Position.Top}
        >
          <button
            aria-label="放大查看图片"
            onClick={(event) => {
              stopNodeToolbarEvent(event);
              setPreviewOpen(true);
            }}
            onMouseDown={stopNodeToolbarEvent}
            onPointerDown={stopNodeToolbarEvent}
            title="放大查看"
            type="button"
          >
            <Maximize2 size={14} />
          </button>
          <button
            aria-label="高清放大图片"
            onClick={(event) => {
              stopNodeToolbarEvent(event);
              onUpscale(id);
            }}
            onMouseDown={stopNodeToolbarEvent}
            onPointerDown={stopNodeToolbarEvent}
            title="高清放大"
            type="button"
          >
            <Sparkles size={14} />
          </button>
          <button
            aria-label="下载图片"
            onClick={(event) => {
              stopNodeToolbarEvent(event);
              void handleDownload();
            }}
            onMouseDown={stopNodeToolbarEvent}
            onPointerDown={stopNodeToolbarEvent}
            title="下载"
            type="button"
          >
            <Download size={14} />
          </button>
          <button
            aria-label="复制图片"
            onClick={(event) => {
              stopNodeToolbarEvent(event);
              void handleCopy();
            }}
            onMouseDown={stopNodeToolbarEvent}
            onPointerDown={stopNodeToolbarEvent}
            title={
              copyState === "idle"
                ? "复制"
                : copyState === "copied"
                  ? "已复制图片"
                  : copyState === "link"
                    ? "已复制链接"
                    : "复制失败"
            }
            type="button"
          >
            {copyState === "idle" ? <Copy size={14} /> : <Check size={14} />}
          </button>
        </NodeToolbar>
      )}

      <Node
        className={
          selected ? "canvas-node selected result-card" : "canvas-node result-card"
        }
        handles={{ source: true, target: true }}
        minHeight={24}
        minWidth={120}
        selected={selected}
        style={getResizableNodeStyle(width, height)}
      >
        <div className={`result-image-frame ${status}`}>
          {data.image.url ? (
            <img src={data.image.url} alt={data.image.title ?? "Generated result"} />
          ) : (
            <div className="result-placeholder" aria-label={data.image.title}>
              <span>{status === "error" ? "生成失败" : "生成中"}</span>
              {requestLabel && <small>{requestLabel}</small>}
            </div>
          )}
        </div>
        {selected && isReady && <NodeFooterLike image={data.image} />}
        {data.upload && (
          <span className={`upload-state image-upload-state ${data.upload.status}`}>
            {data.operation === "upscale"
              ? data.upload.status === "error"
                ? "放大失败"
                : "放大中"
              : data.upload.status === "error"
                ? "上传失败"
                : "上传中"}
          </span>
        )}
      </Node>

      <Dialog onOpenChange={setPreviewOpen} open={isPreviewOpen}>
        <DialogContent className="image-preview-dialog nodrag nopan nowheel">
          <DialogTitle>{data.image.title ?? "Generated image"}</DialogTitle>
          <DialogDescription>{requestLabel || "图片预览"}</DialogDescription>
          <div className="image-preview-stage">
            <img src={data.image.url} alt={data.image.title ?? "Generated result"} />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function stopNodeToolbarEvent(
  event: ReactMouseEvent<HTMLElement> | ReactPointerEvent<HTMLElement>
) {
  event.stopPropagation();
}

function createPendingUpscaleImageNode(
  sourceNode: AgentCanvasNode,
  pendingId: string
): AgentCanvasNode {
  const width = getNodeDimension(sourceNode, "width") ?? 240;
  const height = getNodeDimension(sourceNode, "height") ?? 240;
  return {
    height,
    id: pendingId,
    position: {
      x: sourceNode.position.x,
      y: sourceNode.position.y + 310,
    },
    style: {
      width,
      height,
    },
    type: "imageResultNode",
    width,
    data: {
      image: {
        id: pendingId,
        metadata: {
          operation: "upscale",
        },
        title: "高清放大中",
        url: "",
      },
      kind: "imageResult",
      operation: "upscale",
      prompt:
        sourceNode.data.kind === "imageResult" ? sourceNode.data.prompt : "",
      sourceNodeId: sourceNode.id,
      status: "loading",
      upload: {
        status: "uploading",
      },
    },
  };
}

function getNodeDimension(
  node: AgentCanvasNode,
  dimension: "height" | "width"
) {
  const styleValue =
    node.style && typeof node.style === "object" ? node.style[dimension] : null;
  const value = node[dimension] ?? styleValue ?? node.measured?.[dimension];
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

async function downloadImageAsset(image: GeneratedImage) {
  const filename = getImageDownloadName(image);

  try {
    const response = await fetch(image.url);
    if (!response.ok) {
      throw new Error(`Image download failed (${response.status}).`);
    }

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    triggerImageDownload(objectUrl, filename);
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    return;
  } catch {
    triggerImageDownload(image.url, filename);
  }
}

async function copyImageAsset(image: GeneratedImage): Promise<"copied" | "link"> {
  const clipboard = navigator.clipboard;

  if (clipboard?.write && typeof ClipboardItem !== "undefined") {
    try {
      const blob = await fetchImageBlob(image.url, 900);
      const mimeType = blob.type || "image/png";
      if (mimeType.startsWith("image/")) {
        await clipboard.write([new ClipboardItem({ [mimeType]: blob })]);
        return "copied";
      }
    } catch {
      // Fall back to a link below when image clipboard writes are unavailable.
    }
  }

  await copyTextToClipboard(image.url);
  return "link";
}

async function fetchImageBlob(url: string, timeoutMs?: number) {
  const controller = timeoutMs ? new AbortController() : undefined;
  const timeoutId = controller
    ? window.setTimeout(() => controller.abort(), timeoutMs)
    : undefined;

  try {
    const response = await fetch(url, { signal: controller?.signal });
    if (!response.ok) {
      throw new Error(`Image fetch failed (${response.status}).`);
    }

    return await response.blob();
  } finally {
    if (timeoutId) {
      window.clearTimeout(timeoutId);
    }
  }
}

async function copyTextToClipboard(text: string) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.append(textarea);
  textarea.select();

  try {
    const copied = document.execCommand("copy");
    if (!copied) {
      throw new Error("Text copy command failed.");
    }
  } finally {
    textarea.remove();
  }
}

function triggerImageDownload(url: string, filename: string) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

function getImageDownloadName(image: GeneratedImage) {
  const fallback = image.id || "generated-image";
  const rawName = image.title || fallback;
  const safeName =
    rawName
      .trim()
      .replace(/\.[a-z0-9]{2,5}$/i, "")
      .replace(/[^a-z0-9\u4e00-\u9fa5_-]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || fallback;
  const extension =
    image.url.match(/\.(png|jpe?g|webp|gif)(?:[?#]|$)/i)?.[1]?.toLowerCase() ??
    "png";

  return `${safeName}.${extension === "jpeg" ? "jpg" : extension}`;
}

function hasLocalUploadState(node: AgentCanvasNode) {
  return "upload" in node.data && Boolean(node.data.upload);
}

function getResizableNodeStyle(
  width?: number,
  height?: number
): CSSProperties | undefined {
  if (!width && !height) {
    return undefined;
  }

  return {
    height,
    width,
  };
}

function formatImageRequestLabel(request: ImageResultNodeData["request"]) {
  if (!request) {
    return "";
  }

  const count = request.count ? `${request.index ?? 1}/${request.count}` : "";
  const size =
    request.width && request.height
      ? `${request.width}x${request.height}`
      : request.size
        ? `${Math.round(Math.sqrt(request.size) / 1024)}K`
        : "";
  const ratio = request.aspectRatio ?? "";

  return [count, ratio, size].filter(Boolean).join(" · ");
}

function NodeFooterLike({ image }: { image: GeneratedImage }) {
  return (
    <div className="result-footer">
      <span>{image.title ?? "Generated image"}</span>
      <span>Follow up</span>
    </div>
  );
}
