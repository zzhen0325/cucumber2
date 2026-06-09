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
  CircleDot,
  Cpu,
  Database,
  FileText,
  Frame,
  Globe2,
  Image,
  Layers,
  MousePointer2,
  Paperclip,
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
import {
  createContext,
  lazy,
  memo,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties, FormEvent } from "react";

import { Canvas } from "@/components/ai-elements/canvas";
import { Edge } from "@/components/ai-elements/edge";
import { FileUploadOverlay } from "@/components/FileUploadOverlay";
import { Node, NodeContent } from "@/components/ai-elements/node";
import { ReplayBanner, RunTracePanel } from "@/components/RunTracePanel";
import { RunNodeView } from "@/components/RunNodeView";
import { SkillPanel } from "@/components/SkillPanel";
import { useCanvasFileDrop } from "@/components/useCanvasFileDrop";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputSubmit,
  PromptInputTextarea,
  usePromptInputAttachments,
  type PromptInputMessage,
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
  type PersistedProject,
} from "@/lib/project-storage";
import {
  buildRunRevisionPrompt,
  collectUpstreamContext,
  createRunDraft,
  getRunRevisionAnchorNodeId,
  getRunReferenceNodeId,
} from "@/lib/graph";
import type { RunStepTraceEvent } from "@/lib/graph-projection";
import {
  projectRuntimeEventsToCanvas,
  runtimeEventsFromMessageParts,
  runtimeEventsFromMessages,
} from "@/lib/runtime-event-renderer";
import type {
  AgentCanvasEdge,
  AgentCanvasNode,
  GeneratedImage,
  ImageResultNodeData,
  MarkdownNodeData,
  PromptNodeData,
  WebpageNodeData,
} from "@/types/canvas";
import type { InputAttachment } from "@/types/runtime";

const nodeTypes = {
  artifactNode: memo(ArtifactLikeNode),
  codeNode: memo(ArtifactLikeNode),
  decisionNode: memo(ArtifactLikeNode),
  documentNode: memo(ArtifactLikeNode),
  memoryNode: memo(ArtifactLikeNode),
  promptNode: memo(PromptNode),
  runNode: memo(RunNodeView),
  imageResultNode: memo(ImageResultNode),
  markdownNode: memo(MarkdownNode),
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

type StorageStatus = "loading" | "saving" | "saved" | "error";
type StreamedRuntimeEvents = ReturnType<typeof runtimeEventsFromMessages>;
type AgentRunRequestBody = {
  projectId: string;
  runNodeId: string;
  modelProvider: ModelProviderId;
  attachments: InputAttachment[];
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
  const activeRunMessageStartIndex = useRef(0);
  const loadedProjectIdRef = useRef<string | null>(null);
  const streamedRuntimeEvents = useRef<StreamedRuntimeEvents>([]);
  const hasLoadedProject = useRef(false);
  const messagesRef = useRef<ReturnType<typeof useChat>["messages"]>([]);
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const projectTitleRef = useRef(projectTitle);
  const persistedSelectedNodeIdRef = useRef<string | null>(null);
  const isReplayModeRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const isReplayMode = Boolean(replaySnapshot);
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
      if (!nextEvents.length) {
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
      });

      setNodes((current) => mergeProjectedNodes(current, projection.nodes));
      setEdges((current) => mergeProjectedEdges(current, projection.edges));
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

  const {
    addToolApprovalResponse,
    messages,
    sendMessage,
    status,
    error,
    stop,
  } = useChat({
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
          projectId: loadedProjectIdRef.current ?? undefined,
          prompt: activeRunRequest.current?.canvasContext.prompt,
          promptNodeId: activeRunRequest.current?.canvasContext.promptNodeId,
          selectedNodeId: activeRunRequest.current?.canvasContext.selectedNodeId,
          includeLegacyToolParts: true,
          messageStartIndex: activeRunMessageStartIndex.current,
        }),
        { replace: true }
      );

      if (!isAbort && !isDisconnect && !isError) {
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

  const selectedNodeIds = useMemo(
    () => nodes.filter((node) => node.selected).map((node) => node.id),
    [nodes]
  );

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const selectedNode = useMemo(() => {
    if (selectedNodeIds.length !== 1) {
      return undefined;
    }

    return nodes.find((node) => node.id === selectedNodeIds[0]);
  }, [nodes, selectedNodeIds]);
  const referenceNodeId = getRunReferenceNodeId(selectedNode);
  const referenceNode = referenceNodeId ? selectedNode : undefined;
  const referenceContextCount = useMemo(
    () =>
      referenceNodeId
        ? collectUpstreamContext(referenceNodeId, nodes, edges).length
        : 0,
    [edges, nodes, referenceNodeId]
  );
  const persistedSelectedNodeId = referenceNodeId ?? null;
  useEffect(() => {
    persistedSelectedNodeIdRef.current = persistedSelectedNodeId;
  }, [persistedSelectedNodeId]);

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
    const handlePrepareRunRevision = (event: Event) => {
      if (isReplayMode || isBusy) {
        return;
      }

      const detail = (
        event as CustomEvent<{ runNodeId?: unknown }>
      ).detail;
      if (typeof detail?.runNodeId !== "string") {
        return;
      }

      const runNode = nodes.find(
        (node) => node.id === detail.runNodeId && node.data.kind === "run"
      );
      if (!runNode || runNode.data.kind !== "run" || runNode.data.evaluation?.passed) {
        return;
      }

      const anchorNodeId = getRunRevisionAnchorNodeId(runNode.id, nodes, edges);
      setPrompt(buildRunRevisionPrompt(runNode.data));
      setNodes((current) =>
        applySelectedNodeIds(current, anchorNodeId ? [anchorNodeId] : [])
      );
      window.requestAnimationFrame(() => {
        document.querySelector<HTMLTextAreaElement>(".composer textarea")?.focus();
      });
    };

    window.addEventListener(
      "cucumber:prepare-run-revision",
      handlePrepareRunRevision
    );

    return () => {
      window.removeEventListener(
        "cucumber:prepare-run-revision",
        handlePrepareRunRevision
      );
    };
  }, [edges, isBusy, isReplayMode, nodes, setNodes]);

  useEffect(() => {
    let ignore = false;

    hasLoadedProject.current = false;
    activeRunId.current = null;
    activeRunRequest.current = null;
    activeRunMessageStartIndex.current = 0;
    streamedRuntimeEvents.current = [];

    loadProject(projectId)
      .then(async ({ project }) => {
        if (ignore) {
          return;
        }

        const hydratedSnapshot = await hydrateProjectSnapshotFromLastRun(project);
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
          hydratedSnapshot.nodes,
          project.selectedNodeId
        );
        setNodes(applySelectedNodeIds(hydratedSnapshot.nodes, nextSelectedNodeIds));
        setEdges(hydratedSnapshot.edges);
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
        return;
      }

      if (shouldReportStatus) {
        setStorageStatus("saving");
      }

      try {
        const { project } = await updateProject(
          {
            projectId: currentProjectId,
            title: projectTitleRef.current,
            nodes: nodesRef.current,
            edges: edgesRef.current,
            selectedNodeId: persistedSelectedNodeIdRef.current,
            lastRunId: activeRunId.current,
          },
          options.keepalive ? { keepalive: true } : undefined
        );

        if (shouldReportStatus) {
          setLoadedProjectId(project.id);
          setStorageStatus("saved");
          setStorageError(null);
        }
      } catch (nextError: unknown) {
        if (shouldReportStatus) {
          setStorageStatus("error");
          setStorageError(getClientError(nextError));
        }
      }
    },
    []
  );

  useEffect(() => {
    const flushPendingSave = () => {
      if (saveTimer.current) {
        window.clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }

      void saveProjectSnapshot({ keepalive: true, reportStatus: false });
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

    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
    }

    setStorageStatus("saving");
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      void saveProjectSnapshot();
    }, 420);

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

    const runtimeEvents = runtimeEventsFromMessages(messages, {
      runNodeId: runId,
      projectId: loadedProjectId ?? undefined,
      prompt: activeRunRequest.current?.canvasContext.prompt,
      promptNodeId: activeRunRequest.current?.canvasContext.promptNodeId,
      selectedNodeId: activeRunRequest.current?.canvasContext.selectedNodeId,
      includeLegacyToolParts: true,
      messageStartIndex: activeRunMessageStartIndex.current,
    });
    projectStreamedRuntimeEvents(runtimeEvents, { replace: true });
  }, [
    loadedProjectId,
    messages,
    projectStreamedRuntimeEvents,
    status,
  ]);

  const handleSubmit = useCallback(
    async (
      message: PromptInputMessage = { files: [], text: prompt },
      event?: FormEvent<HTMLFormElement>
    ) => {
      event?.preventDefault();
      const value = (message.text || prompt).trim();
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
      activeRunMessageStartIndex.current = messagesRef.current.length;
      streamedRuntimeEvents.current = streamedRuntimeEvents.current.filter(
        (event) => event.runNodeId !== draft.runNode.id
      );
      setContextCount(draft.upstreamContext.length);
      const requestBody: AgentRunRequestBody = {
        projectId: loadedProjectId,
        runNodeId: draft.runNode.id,
        modelProvider,
        attachments: [
          ...getAttachmentMetadata(message.files),
          ...getWebpageLinkAttachments(value),
        ],
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
      </MarkdownNodeEditingContext.Provider>

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
        referenceContextCount={referenceContextCount}
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

function mergeProjectedNodes(
  current: AgentCanvasNode[],
  projected: AgentCanvasNode[]
) {
  const projectedIds = new Set(projected.map((node) => node.id));
  return [
    ...current.filter((node) => !projectedIds.has(node.id)),
    ...projected,
  ];
}

function mergeProjectedEdges(
  current: AgentCanvasEdge[],
  projected: AgentCanvasEdge[]
) {
  const projectedIds = new Set(projected.map((edge) => edge.id));
  return [
    ...current.filter((edge) => !projectedIds.has(edge.id)),
    ...projected,
  ];
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

async function hydrateProjectSnapshotFromLastRun(project: PersistedProject) {
  const snapshot = {
    nodes: project.nodes,
    edges: project.edges,
  };

  if (!project.lastRunId) {
    return snapshot;
  }

  try {
    const { events } = await loadRunTrace(project.id, project.lastRunId);
    if (!events.length) {
      return snapshot;
    }

    const projection = projectRuntimeEventsToCanvas({
      projectId: project.id,
      runNodeId: project.lastRunId,
      events,
      existingSnapshot: snapshot,
    });

    return {
      nodes: projection.nodes,
      edges: projection.edges,
    };
  } catch {
    return snapshot;
  }
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
  referenceContextCount,
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
  referenceContextCount: number;
  referenceNode?: AgentCanvasNode;
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
  const footerContextLabel = hasReference
    ? `${referenceContextCount} upstream items`
    : hasMultiSelection
      ? "多选不会进入上下文"
      : `${contextCount} upstream items`;

  return (
    <div className="composer-wrap">
      <div className="context-pill" data-active={hasReference || hasMultiSelection}>
        {hasReference
          ? `引用节点: ${getReferenceNodeLabel(referenceNode)}`
          : hasMultiSelection
            ? `已选中 ${selectionCount} 个节点，仅单个节点会作为引用`
          : "未引用节点"}
      </div>
      <PromptInput
        className="composer"
        onSubmit={(message, event) => onSubmit(message, event)}
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
        <ComposerAttachmentStrip />
        <PromptInputFooter className="composer-footer">
          <ComposerFooterStatus
            label={hasReference ? "继续基于引用节点生成分支" : footerContextLabel}
          />
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

function ComposerAttachmentStrip() {
  const attachments = usePromptInputAttachments();

  if (!attachments.files.length) {
    return null;
  }

  return (
    <PromptInputHeader className="composer-attachments">
      {attachments.files.map((file) => (
        <span className="composer-attachment-chip" key={file.id} title={file.filename}>
          <span>{file.filename ?? "Attachment"}</span>
          <button
            aria-label={`移除附件 ${file.filename ?? ""}`.trim()}
            className="nodrag nopan"
            onClick={(event) => {
              event.stopPropagation();
              attachments.remove(file.id);
            }}
            title="移除附件"
            type="button"
          >
            <X size={11} />
          </button>
        </span>
      ))}
    </PromptInputHeader>
  );
}

function ComposerFooterStatus({
  label,
}: {
  label: string;
}) {
  const attachments = usePromptInputAttachments();

  return (
    <span className="composer-footer-status">
      <button
        aria-label="添加附件"
        className="composer-attachment-button nodrag nopan"
        onClick={(event) => {
          event.stopPropagation();
          attachments.openFileDialog();
        }}
        title="添加附件"
        type="button"
      >
        <Paperclip size={12} />
      </button>
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

function getAttachmentMetadata(files: PromptInputMessage["files"]): InputAttachment[] {
  return files.map((file, index) => {
    const name = file.filename?.trim() || `attachment-${index + 1}`;
    const mimeType = file.mediaType || "application/octet-stream";
    const isDataUrl = file.url.startsWith("data:");

    return {
      id: `composer-attachment-${index + 1}-${safeAttachmentId(name)}`,
      kind: getAttachmentKind(mimeType, name),
      name,
      mimeType,
      sizeBytes: isDataUrl ? estimateDataUrlSize(file.url) : undefined,
      uri: isDataUrl ? undefined : file.url,
      contentRef: isDataUrl
        ? `composer-attachment://${encodeURIComponent(name)}`
        : undefined,
      preview: isDataUrl
        ? `${mimeType} attachment captured as metadata`
        : file.url,
    };
  });
}

function getWebpageLinkAttachments(promptText: string): InputAttachment[] {
  const seen = new Set<string>();
  const links: InputAttachment[] = [];

  for (const token of promptText.split(/\s+/)) {
    const normalized = parseWebpageUrl(token);
    if (!normalized || seen.has(normalized.href)) {
      continue;
    }

    seen.add(normalized.href);
    links.push({
      id: `webpage-${safeAttachmentId(normalized.href)}`,
      kind: "webpage",
      name: normalized.hostname,
      uri: normalized.href,
      contentRef: normalized.href,
      preview: normalized.href,
    });
  }

  return links;
}

function parseWebpageUrl(value: string) {
  const trimmed = value.trim().replace(/[),.;，。；）]+$/u, "");
  if (!/^https?:\/\//i.test(trimmed)) {
    return null;
  }

  try {
    return new URL(trimmed);
  } catch {
    return null;
  }
}

function getAttachmentKind(
  mimeType: string,
  name: string
): InputAttachment["kind"] {
  const normalizedMime = mimeType.toLowerCase();
  const extension = name.toLowerCase().split(".").at(-1) ?? "";

  if (normalizedMime.startsWith("image/")) {
    return "image";
  }
  if (
    normalizedMime.includes("markdown") ||
    normalizedMime.includes("document") ||
    extension === "md"
  ) {
    return "doc";
  }
  if (
    normalizedMime.includes("javascript") ||
    normalizedMime.includes("typescript") ||
    ["js", "jsx", "ts", "tsx", "css", "html", "json"].includes(extension)
  ) {
    return "code";
  }
  if (normalizedMime.includes("csv") || extension === "csv") {
    return "dataset";
  }
  return "file";
}

function estimateDataUrlSize(url: string) {
  const payload = url.split(",", 2)[1];
  if (!payload) {
    return undefined;
  }
  return Math.max(0, Math.floor((payload.length * 3) / 4));
}

function safeAttachmentId(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "file";
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
  return (
    <Node
      className={
        selected ? "canvas-node selected prompt-card" : "canvas-node prompt-card"
      }
      handles={{ source: true, target: true }}
      minHeight={64}
      minWidth={180}
      selected={selected}
      style={getResizableNodeStyle(width, height)}
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

function ArtifactLikeNode({ data, selected, width, height }: ArtifactLikeNodeProps) {
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
          <span>{label}</span>
        </div>
        <strong title={data.title}>{data.title}</strong>
        {summary && <p title={summary}>{summary}</p>}
      </NodeContent>
    </Node>
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
            <strong title={data.title}>{data.title}</strong>
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
            <span>{data.summary ?? "页面预览"}</span>
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
  id,
  data,
  selected,
  width,
  height,
}: NodeProps<FlowNode<MarkdownNodeData, "markdownNode">>) {
  const { readOnly, onChange } = useContext(MarkdownNodeEditingContext);

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
            <strong title={data.title}>{data.title}</strong>
          </div>
        </div>
        <div className="blocknote-body nodrag nopan">
          <Suspense
            fallback={
              <pre className="markdown-plain-preview">{data.content}</pre>
            }
          >
            <BlockNoteMarkdownEditor
              data={data}
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
  selected,
  width,
  height,
}: NodeProps<FlowNode<ImageResultNodeData, "imageResultNode">>) {
  const status = data.status ?? (data.image.url ? "ready" : "loading");
  const requestLabel = formatImageRequestLabel(data.request);

  return (
    <Node
      className={
        selected ? "canvas-node selected result-card" : "canvas-node result-card"
      }
      handles={{ source: true, target: true }}
      minHeight={120}
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
      {selected && status === "ready" && <NodeFooterLike image={data.image} />}
    </Node>
  );
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
