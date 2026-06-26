import {
  applyEdgeChanges,
  applyNodeChanges,
  MiniMap,
  NodeToolbar,
  Position,
  SelectionMode,
  useReactFlow,
  useEdgesState,
  useNodesState,
  type EdgeChange,
  type Node as FlowNode,
  type NodeChange,
  type NodeMouseHandler,
  type NodeProps,
  type NodeTypes,
  type ReactFlowInstance,
} from "@xyflow/react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { BundledLanguage } from "shiki";
import {
  ArrowLeftIcon as ArrowLeft,
  ArrowMaximizeIcon as ArrowUpRight,
  CheckmarkIcon as Check,
  ChevronDownIcon as ChevronDown,
  CircleIcon as Circle,
  DotCircleIcon as CircleDot,
  CopyIcon as Copy,
  DatabaseIcon as Database,
  DiamondIcon as Diamond,
  ArrowDownloadIcon as Download,
  EraserSparkleIcon as EraserSparkle,
  FileTextIcon as FileText,
  SquareMarginsIcon as Frame,
  BranchIcon as Workflow,
  GlobeIcon as Globe2,
  FullScreenMaximizeIcon as Maximize2,
  PhotoIcon as ImageIcon,
  SearchIcon as Search,
  SparkleIcon as Sparkles,
  SquareIcon as Square,
  NoteIcon as StickyNote,
  TextIcon as Type,
  TriangleIcon as Triangle,
  CancelIcon as X,
} from "@proicons/react";
import {
  createContext,
  lazy,
  memo,
  type ReactNode,
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

type IconComponent = typeof StickyNote;

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
import { HtmlSourcePreview } from "@/components/HtmlSourcePreview";
import { LoadingIndicator } from "@/components/LoadingIndicator";
import { LoadingScreen } from "@/components/LoadingScreen";
import { Node, NodeContent } from "@/components/ai-elements/node";
import {
  AgentRunDebugPanel,
  ReplayBanner,
  RunTracePanel,
} from "@/components/RunTracePanel";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getCanvasLayoutSignature,
  layoutAgentCanvasGraph,
} from "@/lib/canvas-layout";
import { normalizeLoadedCanvasSnapshot } from "@/lib/canvas-load-normalization";
import {
  loadProject,
  loadRunTrace,
  mattingProjectImage,
  saveProjectCanvasPatch,
  updateTextArtifactContent,
  upscaleProjectImage,
  ProjectVersionConflictError,
  type SaveProjectCanvasPatchInput,
} from "@/lib/project-storage";
import {
  loadAgentSkills,
  type AgentSkillDefinitionSummary,
} from "@/lib/skill-storage";
import {
  hasNodeContentChanged,
  toPersistableEdges,
  toPersistableNodes,
} from "@/lib/canvas-persistence";
import type { CanvasLocalMutation } from "@/lib/canvas-mutation";
import {
  collectUpstreamContext,
  createRunDraft,
  getRunReferenceNodeId,
  getRunReferenceNodeIds,
} from "@/lib/graph";
import { getPromptNodeDimensions } from "@/lib/canvas-node-dimensions";
import {
  applyCanvasPatch,
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
import { cn } from "@/lib/utils";
import type {
  AgentCanvasEdge,
  AgentCanvasNode,
  AgentCanvasNodeData,
  AgentRunStatus,
  CanvasPatch,
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
const CANVAS_CLIPBOARD_MIME = "application/x-cucumber2-canvas-nodes";
const CANVAS_CLIPBOARD_TEXT = "Cucumber canvas nodes";
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
  onPromptTextChange: (nodeId: string, prompt: string) => void;
  readOnly: boolean;
  onShapeLabelChange: (nodeId: string, label: string) => void;
  onStickyTextChange: (nodeId: string, text: string) => void;
}>({
  onPromptTextChange: () => undefined,
  readOnly: true,
  onShapeLabelChange: () => undefined,
  onStickyTextChange: () => undefined,
});
const ImageNodeActionContext = createContext<{
  onMatting: (nodeId: string) => void;
  onUpscale: (nodeId: string) => void;
}>({
  onMatting: () => undefined,
  onUpscale: () => undefined,
});

type StorageStatus = "loading" | "saving" | "saved" | "error";
type StreamedRuntimeEvents = ReturnType<typeof runtimeEventsFromMessages>;
type AgentRunRequestBody = {
  projectId: string;
  runNodeId: string;
  canvasPatch?: Omit<SaveProjectCanvasPatchInput, "projectId">;
  canvasContext: {
    forcedSkillId?: string;
    forcedSkillName?: string;
    imageAspectRatio?: ImageAspectRatioSelection;
    imageResultCount?: ImageResultCountSelection;
    imageProvider?: ImageProviderSelection;
    inputMode?: ComposerMode;
    prompt: string;
    promptNodeId: string;
    retryFrom?: {
      failedRunNodeId: string;
      stepId?: string;
    } | null;
    selectedNodeId: string | null;
    selectedNodeIds: string[];
  };
};

type PendingRunCanvasPatchAck = {
  dirtyEdgeIds: string[];
  dirtyNodeIds: string[];
  edgeDeleteIds: string[];
  lastRunId?: string | null;
  nodeDeleteIds: string[];
  revision: number;
};

type ComposerMode = "agent" | "image";
type ImageAspectRatioSelection = "1:1" | "16:9" | "9:16" | "4:3" | "3:4";
type ImageResultCountSelection = 1 | 2 | 3 | 4;
type ImageProviderSelection = "byteartist" | "seed5_duotu_zz";

type CanvasWorkspaceProps = {
  projectId: string;
  onBack: () => void;
};

type ManualCanvasTool = "prompt" | "stickyNote" | ShapeVariant;
type CanvasTool = "select" | "hand" | ManualCanvasTool;
type ManualNodeTemplate =
  | {
      icon: IconComponent;
      kind: "prompt";
      label: string;
      prompt: string;
      tool: "prompt";
    }
  | {
      icon: IconComponent;
      kind: "stickyNote";
      label: string;
      tool: "stickyNote";
      color: StickyNoteNodeData["color"];
      text: string;
    }
  | {
      icon: IconComponent;
      kind: "shape";
      label: string;
      tool: ShapeVariant;
      shape: ShapeVariant;
    };
type ToolRailItem = {
  icon: IconComponent;
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
type PendingMarkdownArtifactContentSave = {
  artifactId: string;
  blocks: unknown[];
  content: string;
  expectedVersion?: number;
  nodeId: string;
  projectId: string;
  summary: string;
  title: string;
};

const LEFT_MOUSE_BUTTON = 0;
const MIDDLE_MOUSE_BUTTON = 1;
const PAN_ON_DRAG_BUTTONS = [MIDDLE_MOUSE_BUTTON];
const HAND_TOOL_PAN_ON_DRAG_BUTTONS = [LEFT_MOUSE_BUTTON, MIDDLE_MOUSE_BUTTON];
const SHIFT_MULTI_SELECTION_KEYS = ["Shift", "ShiftLeft", "ShiftRight"];
const COMPOSER_MODE_STORAGE_KEY = "cucumber:composer-mode";
const IMAGE_ASPECT_RATIO_STORAGE_KEY = "cucumber:image-aspect-ratio";
const IMAGE_RESULT_COUNT_STORAGE_KEY = "cucumber:image-result-count";
const IMAGE_PROVIDER_STORAGE_KEY = "cucumber:image-provider";
const TRACE_RECONCILE_DELAYS_MS = [0, 1500, 4000, 8000] as const;
const SHELL_ICON_BUTTON_CLASS =
  "grid place-items-center border-0 bg-transparent text-[#5c5c5c] cursor-pointer [&:hover:not(:disabled)]:bg-cuc-surface-warm [&:hover:not(:disabled)]:text-cuc-text disabled:cursor-default disabled:opacity-[0.38]";
const TOP_ICON_BUTTON_CLASS =
  "grid h-cuc-control place-items-center border-0 bg-transparent text-cuc-text-heading cursor-pointer hover:bg-cuc-surface/72 hover:text-cuc-text-heading";
const TOP_CONTROL_BUTTON_CLASS = cn(
  TOP_ICON_BUTTON_CLASS,
  "rounded-cuc-control"
);
const STORAGE_CHIP_CLASS =
  "hidden h-cuc-icon-button items-center gap-1 bg-white/0 px-2 text-[11px] leading-none text-cuc-text-muted";
const COMPOSER_WRAP_CLASS =
  "absolute bottom-8 left-1/2 z-30 flex w-[var(--cuc-width-composer)] -translate-x-1/2 flex-col items-start gap-1 max-[760px]:bottom-4 max-[760px]:w-[calc(100vw-24px)]";
const COMPOSER_FORM_CLASS =
  "min-h-cuc-composer-height rounded-cuc-composer border-[0.5px] border-cuc-border bg-cuc-surface shadow-cuc-composer [&_[data-slot=input-group]]:min-h-[inherit] [&_[data-slot=input-group]]:items-center [&_[data-slot=input-group]]:overflow-hidden [&_[data-slot=input-group]]:rounded-cuc-composer [&_[data-slot=input-group]]:border-0 [&_[data-slot=input-group]]:bg-transparent [&_[data-slot=input-group]]:shadow-none";
const COMPOSER_AGENT_FORM_CLASS =
  "[&_[data-slot=input-group]]:grid [&_[data-slot=input-group]]:grid-cols-[minmax(0,1fr)_52px] max-[560px]:[&_[data-slot=input-group]]:grid-cols-[minmax(0,1fr)_50px]";
const COMPOSER_IMAGE_FORM_CLASS =
  "min-h-cuc-composer-image-height [&_[data-slot=input-group]]:flex [&_[data-slot=input-group]]:flex-col [&_[data-slot=input-group]]:items-stretch [&_[data-slot=input-group]]:justify-between";
const COMPOSER_MODE_SWITCH_CLASS =
  "inline-flex min-h-[41px] items-center gap-1 rounded-cuc-floating border-[0.5px] border-cuc-control-border bg-cuc-border p-[4.5px] shadow-[0_2px_20px_rgba(41,37,100,0.06)]";
const COMPOSER_MODE_BUTTON_CLASS =
  "inline-flex h-cuc-control min-w-cuc-control cursor-pointer items-center justify-center gap-1.5 rounded-cuc-control border-0 bg-transparent px-2 text-[13px] leading-5 text-cuc-control-dark disabled:cursor-not-allowed disabled:opacity-[0.58]";
const COMPOSER_SKILL_MENU_CLASS =
  "max-h-60 w-full overflow-auto rounded-cuc-floating border-[0.5px] border-cuc-border bg-cuc-surface p-1.5 shadow-[0_6px_18px_rgba(41,37,100,0.08)]";
const COMPOSER_SKILL_OPTION_CLASS =
  "grid min-h-cuc-tool w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-2.5 rounded-cuc-image border-0 bg-transparent px-2.5 text-left text-[13px] leading-[18px] text-cuc-text outline-0 hover:bg-cuc-control-hover focus-visible:bg-cuc-control-hover";
const COMPOSER_TOKEN_CLASS =
  "inline-flex max-w-44 min-w-0 items-center gap-[5px] rounded-cuc-pill border-[0.5px] border-cuc-control-border bg-[#f5f5f5] px-[7px] py-[3px] text-xs leading-4 text-cuc-control-dark";
const COMPOSER_TOKEN_KIND_CLASS =
  "flex-none text-[11px] text-cuc-text-soft";
const COMPOSER_TOKEN_LABEL_CLASS =
  "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap";
const COMPOSER_FOOTER_BASE_CLASS =
  "box-border h-cuc-composer-height justify-end border-0";
const COMPOSER_FOOTER_AGENT_CLASS =
  "w-[52px] p-0 pr-2.5 max-[560px]:w-[50px] max-[560px]:pr-2";
const COMPOSER_FOOTER_IMAGE_CLASS =
  "h-[52px] w-full justify-between p-2";
const COMPOSER_TEXTAREA_BASE_CLASS =
  "resize-none px-4 text-sm leading-5 text-cuc-text placeholder:text-cuc-text-soft";
const COMPOSER_SUBMIT_BUTTON_CLASS =
  "size-cuc-control min-w-cuc-control rounded-cuc-control bg-cuc-control-dark text-cuc-surface";
const COMPOSER_SELECT_CONTENT_CLASS =
  "border-cuc-border bg-cuc-surface text-cuc-text";
const COMPOSER_SELECT_TRIGGER_CLASS =
  "h-cuc-control rounded-cuc-control border-[0.5px] border-cuc-border bg-cuc-control-surface text-xs font-medium text-[#333842] shadow-none hover:bg-cuc-control-hover disabled:opacity-[0.58] data-[disabled]:opacity-[0.58] aria-disabled:opacity-[0.58]";

function getSelectedNodeIds(nodes: AgentCanvasNode[]) {
  return nodes.filter((node) => node.selected).map((node) => node.id);
}

function hasPersistableNodeChanges(changes: NodeChange<AgentCanvasNode>[]) {
  return changes.some((change) => {
    if (change.type === "select") {
      return false;
    }
    if (
      change.type === "dimensions" &&
      !change.resizing &&
      !change.setAttributes
    ) {
      return false;
    }
    return true;
  });
}

const manualNodeTemplates: ManualNodeTemplate[] = [
  {
    icon: Type,
    kind: "prompt",
    label: "用户输入",
    prompt: "",
    tool: "prompt",
  },
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
  const [edges, setEdges] = useEdgesState<AgentCanvasEdge>(initialEdges);
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
  const [debugRunId, setDebugRunId] = useState<string | null>(null);
  const [debugEvents, setDebugEvents] = useState<RunStepTraceEvent[]>([]);
  const [debugOpen, setDebugOpen] = useState(true);
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
  const traceReconcileTimers = useRef<number[]>([]);
  const traceRunIdRef = useRef<string | null>(null);
  const hasLoadedProject = useRef(false);
  const messagesRef = useRef<ReturnType<typeof useChat>["messages"]>([]);
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const selectionBeforeNodeChangeRef = useRef<string[]>([]);
  const persistedSelectedNodeIdRef = useRef<string | null>(null);
  const isReplayModeRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const artifactContentSaveTimersRef = useRef(
    new Map<string, ReturnType<typeof window.setTimeout>>()
  );
  const artifactContentSavePayloadsRef = useRef(
    new Map<string, PendingMarkdownArtifactContentSave>()
  );
  const projectVersionRef = useRef(0);
  const isSavingRef = useRef(false);
  const pendingSaveRef = useRef(false);
  const saveWaitersRef = useRef<Array<(saved: boolean) => void>>([]);
  const dirtyNodeIdsRef = useRef(new Set<string>());
  const dirtyEdgeIdsRef = useRef(new Set<string>());
  const deletedNodeIdsRef = useRef(new Set<string>());
  const deletedEdgeIdsRef = useRef(new Set<string>());
  const dirtyProjectMetaRef = useRef(false);
  const mutationRevisionRef = useRef(0);
  const atomicRunSaveRevisionRef = useRef<number | null>(null);
  const pendingRunCanvasPatchAcksRef = useRef(
    new Map<string, PendingRunCanvasPatchAck>()
  );
  const prevSaveClassifyNodesRef = useRef<AgentCanvasNode[]>([]);
  const prevSaveClassifyTitleRef = useRef(projectTitle);
  const imageProcessingInFlightRef = useRef(new Set<string>());
  const autoLayoutFrame = useRef<number | null>(null);
  const autoLayoutSignatureRef = useRef<string | null>(null);
  const flowInstance = useRef<ReactFlowInstance<
    AgentCanvasNode,
    AgentCanvasEdge
  > | null>(null);
  const creationDraftRef = useRef<CreationDraft | null>(null);
  const clipboardRef = useRef<{
    nodes: AgentCanvasNode[];
    edges: AgentCanvasEdge[];
  } | null>(null);
  const pointerScreenRef = useRef<CanvasPoint | null>(null);
  const [creationPreview, setCreationPreview] = useState<CreationPreview | null>(null);
  const [composerMode, setComposerModeState] = useState<ComposerMode>(
    () => readStoredComposerMode()
  );
  const [imageAspectRatio, setImageAspectRatioState] =
    useState<ImageAspectRatioSelection>(() => readStoredImageAspectRatio());
  const [imageResultCount, setImageResultCountState] =
    useState<ImageResultCountSelection>(() => readStoredImageResultCount());
  const [imageProvider, setImageProviderState] = useState<ImageProviderSelection>(
    () => readStoredImageProvider()
  );
  const [skillOptions, setSkillOptions] = useState<AgentSkillDefinitionSummary[]>([]);
  const [skillOptionsStatus, setSkillOptionsStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [skillOptionsError, setSkillOptionsError] = useState<string | null>(null);
  const [forcedSkill, setForcedSkill] =
    useState<AgentSkillDefinitionSummary | null>(null);
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
    isReplayModeRef.current = isReplayMode;
  }, [isReplayMode]);

  useEffect(() => {
    loadedProjectIdRef.current = loadedProjectId;
  }, [loadedProjectId]);

  useEffect(() => {
    traceRunIdRef.current = traceRunId;
  }, [traceRunId]);

  const hasPendingCanvasSaveNow = useCallback(
    () =>
      dirtyProjectMetaRef.current ||
      dirtyNodeIdsRef.current.size > 0 ||
      dirtyEdgeIdsRef.current.size > 0 ||
      deletedNodeIdsRef.current.size > 0 ||
      deletedEdgeIdsRef.current.size > 0,
    []
  );

  const recordDirtyFromPatch = useCallback((patch: CanvasLocalMutation["patch"]) => {
    for (const node of patch.nodeUpserts ?? []) {
      dirtyNodeIdsRef.current.add(node.id);
      deletedNodeIdsRef.current.delete(node.id);
    }
    for (const nodeId of patch.nodeDeletes ?? []) {
      deletedNodeIdsRef.current.add(nodeId);
      dirtyNodeIdsRef.current.delete(nodeId);
    }
    for (const edge of patch.edgeUpserts ?? []) {
      dirtyEdgeIdsRef.current.add(edge.id);
      deletedEdgeIdsRef.current.delete(edge.id);
    }
    for (const edgeId of patch.edgeDeletes ?? []) {
      deletedEdgeIdsRef.current.add(edgeId);
      dirtyEdgeIdsRef.current.delete(edgeId);
    }
  }, []);

  const commitCanvasMutation = useCallback(
    (mutation: CanvasLocalMutation) => {
      const patch = mutation.patch;
      const next = applyCanvasPatch(
        { edges: edgesRef.current, nodes: nodesRef.current },
        patch
      );

      nodesRef.current = next.nodes;
      edgesRef.current = next.edges;
      setNodes(next.nodes);
      setEdges(next.edges);

      let hasPersistedChange = hasCanvasPatchChanges(patch);
      if (mutation.selectedNodeId !== undefined) {
        persistedSelectedNodeIdRef.current = mutation.selectedNodeId;
        dirtyProjectMetaRef.current = true;
        hasPersistedChange = true;
      }
      if (mutation.lastRunId !== undefined) {
        activeRunId.current = mutation.lastRunId;
        dirtyProjectMetaRef.current = true;
        hasPersistedChange = true;
      }

      if (mutation.persist ?? true) {
        recordDirtyFromPatch(patch);
        if (hasPersistedChange) {
          mutationRevisionRef.current += 1;
          setStorageStatus("saving");
        }
      }
    },
    [recordDirtyFromPatch, setEdges, setNodes]
  );

  const handleAutoLayout = useCallback(() => {
    if (isReplayModeRef.current || !nodesRef.current.length) {
      return;
    }

    const layoutedNodes = layoutAgentCanvasGraph(
      nodesRef.current,
      edgesRef.current
    );
    autoLayoutSignatureRef.current = getCanvasLayoutSignature(
      layoutedNodes,
      edgesRef.current
    );
    commitCanvasMutation({
      reason: "auto-layout",
      patch: {
        nodeUpserts: layoutedNodes,
      },
      persist: true,
    });
    setLayoutFitRequest((current) => current + 1);
  }, [commitCanvasMutation]);

  const clearTraceReconcileTimers = useCallback(() => {
    for (const timer of traceReconcileTimers.current) {
      window.clearTimeout(timer);
    }
    traceReconcileTimers.current = [];
  }, []);

  useEffect(() => clearTraceReconcileTimers, [clearTraceReconcileTimers]);

  const acknowledgeRunCanvasPatchPersistence = useCallback(
    (events: StreamedRuntimeEvents) => {
      for (const event of events) {
        if (
          event.type !== "run.created" ||
          event.payload.canvasPatchApplied !== true
        ) {
          continue;
        }

        const pending = pendingRunCanvasPatchAcksRef.current.get(event.runNodeId);
        if (!pending) {
          continue;
        }

        pendingRunCanvasPatchAcksRef.current.delete(event.runNodeId);
        if (atomicRunSaveRevisionRef.current === pending.revision) {
          atomicRunSaveRevisionRef.current = null;
        }

        if (typeof event.payload.projectVersion === "number") {
          projectVersionRef.current = event.payload.projectVersion;
        }

        if (mutationRevisionRef.current !== pending.revision) {
          continue;
        }

        for (const nodeId of pending.dirtyNodeIds) {
          dirtyNodeIdsRef.current.delete(nodeId);
        }
        for (const nodeId of pending.nodeDeleteIds) {
          deletedNodeIdsRef.current.delete(nodeId);
        }
        for (const edgeId of pending.dirtyEdgeIds) {
          dirtyEdgeIdsRef.current.delete(edgeId);
        }
        for (const edgeId of pending.edgeDeleteIds) {
          deletedEdgeIdsRef.current.delete(edgeId);
        }
        if (activeRunId.current === pending.lastRunId) {
          dirtyProjectMetaRef.current = false;
        }

        if (!hasPendingCanvasSaveNow()) {
          setStorageStatus("saved");
          setStorageError(null);
        }
      }
    },
    [hasPendingCanvasSaveNow]
  );

  const releaseRunCanvasPatchPersistence = useCallback((runId: string | null) => {
    if (!runId) {
      return;
    }
    const pending = pendingRunCanvasPatchAcksRef.current.get(runId);
    if (!pending) {
      return;
    }
    pendingRunCanvasPatchAcksRef.current.delete(runId);
    if (atomicRunSaveRevisionRef.current === pending.revision) {
      atomicRunSaveRevisionRef.current = null;
    }
  }, []);

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
      acknowledgeRunCanvasPatchPersistence(nextEvents);
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
      setDebugRunId(runId);
      setDebugEvents(runtimeEvents);

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
    [acknowledgeRunCanvasPatchPersistence, setEdges, setNodes]
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

  const mergePersistedRunTrace = useCallback(
    (runId: string, events: RunStepTraceEvent[]) => {
      if (!events.length) {
        return false;
      }

      acknowledgeRunCanvasPatchPersistence(events);
      const projectId = loadedProjectIdRef.current ?? undefined;
      const projection = projectRuntimeEventsToCanvas({
        projectId,
        runNodeId: runId,
        events,
        existingSnapshot: {
          nodes: nodesRef.current,
          edges: edgesRef.current,
        },
        streamedAgentTextByRunId: streamedAgentTextByRunId.current,
      });

      setNodes((current) => {
        const next = mergeCanvasUpserts(
          { edges: edgesRef.current, nodes: current },
          { edges: projection.edges, nodes: projection.nodes }
        ).nodes;
        nodesRef.current = next;
        return next;
      });
      setEdges((current) => {
        const next = mergeCanvasUpserts(
          { edges: current, nodes: nodesRef.current },
          { edges: projection.edges, nodes: projection.nodes }
        ).edges;
        edgesRef.current = next;
        return next;
      });

      if (traceRunIdRef.current === runId) {
        setTraceEvents(events);
      }
      setDebugRunId(runId);
      setDebugEvents(events);

      const hasTerminalEvent = hasTerminalRunEvent(events);
      if (hasTerminalEvent) {
        releaseRunCanvasPatchPersistence(runId);
      }

      return hasTerminalEvent;
    },
    [acknowledgeRunCanvasPatchPersistence, releaseRunCanvasPatchPersistence, setEdges, setNodes]
  );

  const reconcileRunFromPersistedTrace = useCallback(
    (runId: string | null, fallbackError: string) => {
      if (!runId) {
        return;
      }
      const projectId = loadedProjectIdRef.current;
      if (!projectId) {
        releaseRunCanvasPatchPersistence(runId);
        markRunError(runId, fallbackError);
        return;
      }

      clearTraceReconcileTimers();
      let sawPersistedEvents = false;

      const runAttempt = (attempt: number) => {
        void loadRunTrace(projectId, runId)
          .then(({ events }) => {
            if (events.length) {
              sawPersistedEvents = true;
              if (mergePersistedRunTrace(runId, events)) {
                return;
              }
            }

            const nextDelay = TRACE_RECONCILE_DELAYS_MS[attempt + 1];
            if (
              nextDelay === undefined ||
              !isActiveRunNode(nodesRef.current, runId)
            ) {
              if (!sawPersistedEvents) {
                releaseRunCanvasPatchPersistence(runId);
                markRunError(runId, fallbackError);
              }
              return;
            }

            const timer = window.setTimeout(() => runAttempt(attempt + 1), nextDelay);
            traceReconcileTimers.current.push(timer);
          })
          .catch(() => {
            const nextDelay = TRACE_RECONCILE_DELAYS_MS[attempt + 1];
            if (nextDelay === undefined) {
              if (!sawPersistedEvents) {
                releaseRunCanvasPatchPersistence(runId);
                markRunError(runId, fallbackError);
              }
              return;
            }
            const timer = window.setTimeout(() => runAttempt(attempt + 1), nextDelay);
            traceReconcileTimers.current.push(timer);
          });
      };

      runAttempt(0);
    },
    [
      clearTraceReconcileTimers,
      markRunError,
      mergePersistedRunTrace,
      releaseRunCanvasPatchPersistence,
    ]
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
        reconcileRunFromPersistedTrace(runId, "Agent 连接已中断。");
      } else if (isError) {
        reconcileRunFromPersistedTrace(runId, "Agent 流式响应异常。");
      } else if (!isError) {
        settleRunIfOutputReady(runId);
        window.requestAnimationFrame(() => {
          settleRunIfOutputReady(runId);
        });
      }
    },
    onError: (nextError) => {
      reconcileRunFromPersistedTrace(activeRunId.current, nextError.message);
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
  const hasUploadingLocalNodes = useMemo(
    () => nodes.some(hasUploadingLocalNode),
    [nodes]
  );
  const hasFailedLocalUploadNodes = useMemo(
    () => nodes.some(hasFailedLocalUploadNode),
    [nodes]
  );
  const persistedSelectedNodeId = referenceNodeId ?? null;
  useEffect(() => {
    if (
      hasLoadedProject.current &&
      persistedSelectedNodeIdRef.current !== persistedSelectedNodeId
    ) {
      dirtyProjectMetaRef.current = true;
      mutationRevisionRef.current += 1;
      setStorageStatus("saving");
    }
    persistedSelectedNodeIdRef.current = persistedSelectedNodeId;
  }, [persistedSelectedNodeId]);

  const isBusy = status === "submitted" || status === "streaming";
  const canEditComposer =
    Boolean(loadedProjectId) &&
    storageStatus !== "loading" &&
    !storageError &&
    !isReplayMode;
  const canSubmit =
    canEditComposer &&
    !hasLocalUploadNodes;
  const skillSlashQuery = getSkillSlashQuery(prompt);
  const showSkillMenu =
    skillSlashQuery !== null && canEditComposer && !isBusy && !isReplayMode;
  const canUploadFiles =
    Boolean(loadedProjectId) &&
    storageStatus !== "loading" &&
    !storageError &&
    !isReplayMode;
  const fileDrop = useCanvasFileDrop({
    canUploadFiles,
    commitCanvasMutation,
    edges,
    nodes,
    projectId: loadedProjectId,
    setEdges,
    setNodes,
  });
  const { handleClipboardFiles, showUploadError } = fileDrop;

  const handleCanvasInit = useCallback(
    (instance: ReactFlowInstance<AgentCanvasNode, AgentCanvasEdge>) => {
      flowInstance.current = instance;
      fileDrop.handleCanvasInit(instance);
    },
    [fileDrop]
  );

  const handleNodesChange = useCallback(
    (changes: NodeChange<AgentCanvasNode>[]) => {
      const previous = nodesRef.current;
      const next = applyLinkedNodeDragChanges(
        changes,
        previous,
        edgesRef.current
      );

      if (changes.some((change) => change.type === "select")) {
        selectionBeforeNodeChangeRef.current = getSelectedNodeIds(previous);
      }

      const patch = diffCanvasPatch(
        { edges: edgesRef.current, nodes: previous },
        { edges: edgesRef.current, nodes: next }
      );
      commitCanvasMutation({
        reason: "reactflow-node-change",
        patch,
        persist: hasPersistableNodeChanges(changes),
      });
    },
    [commitCanvasMutation]
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange<AgentCanvasEdge>[]) => {
      const previous = edgesRef.current;
      const next = applyEdgeChanges(changes, previous);
      const patch = diffCanvasPatch(
        { edges: previous, nodes: nodesRef.current },
        { edges: next, nodes: nodesRef.current }
      );
      commitCanvasMutation({
        reason: "reactflow-edge-change",
        patch,
        persist: changes.some((change) => change.type !== "select"),
      });
    },
    [commitCanvasMutation]
  );

  const handleNodeClick = useCallback<NodeMouseHandler<AgentCanvasNode>>(
    (event, node) => {
      if (isReplayMode || isCreateTool || !event.shiftKey) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const baseSelectedNodeIds = selectionBeforeNodeChangeRef.current;
      const nextSelectedNodeIds = baseSelectedNodeIds.includes(node.id)
        ? baseSelectedNodeIds.filter(
            (selectedNodeId) => selectedNodeId !== node.id
          )
        : [...baseSelectedNodeIds, node.id];

      selectionBeforeNodeChangeRef.current = nextSelectedNodeIds;
      setNodes((current) => applySelectedNodeIds(current, nextSelectedNodeIds));
    },
    [isCreateTool, isReplayMode, setNodes]
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
    dirtyNodeIdsRef.current.clear();
    dirtyEdgeIdsRef.current.clear();
    deletedNodeIdsRef.current.clear();
    deletedEdgeIdsRef.current.clear();
    dirtyProjectMetaRef.current = false;
    mutationRevisionRef.current = 0;
    atomicRunSaveRevisionRef.current = null;
    pendingRunCanvasPatchAcksRef.current.clear();

    const loadStartedAt = performance.now();

    loadProject(projectId)
      .then(({ edges, nodes, project }) => {
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
        setDebugRunId(null);
        setDebugEvents([]);
        setDebugOpen(true);
        setReplaySnapshot(null);
        const normalizedSnapshot = normalizeLoadedCanvasSnapshot({
          edges,
          nodes,
          projectId: project.id,
        });
        const nextSelectedNodeIds = getInitialSelectedNodeIds(
          normalizedSnapshot.nodes,
          project.selectedNodeId
        );
        autoLayoutSignatureRef.current = getCanvasLayoutSignature(
          normalizedSnapshot.nodes,
          normalizedSnapshot.edges
        );
        const selectedNodes = applySelectedNodeIds(
          normalizedSnapshot.nodes,
          nextSelectedNodeIds
        );
        nodesRef.current = selectedNodes;
        edgesRef.current = normalizedSnapshot.edges;
        setNodes(selectedNodes);
        setEdges(normalizedSnapshot.edges);
        activeRunId.current = project.lastRunId;
        projectVersionRef.current = project.version;
        persistedSelectedNodeIdRef.current = project.selectedNodeId;
        dirtyNodeIdsRef.current.clear();
        dirtyEdgeIdsRef.current.clear();
        deletedNodeIdsRef.current.clear();
        deletedEdgeIdsRef.current.clear();
        dirtyProjectMetaRef.current = false;
        mutationRevisionRef.current = 0;
        atomicRunSaveRevisionRef.current = null;
        pendingRunCanvasPatchAcksRef.current.clear();
        hasLoadedProject.current = true;
        setStorageStatus("saved");
        setStorageError(null);

        if (import.meta.env.DEV) {
          // Diagnostics for the slow-load investigation (DEV only, never ships).
          console.info("[canvas-load]", {
            projectId: project.id,
            nodeCount: normalizedSnapshot.nodes.length,
            edgeCount: normalizedSnapshot.edges.length,
            payloadBytes: JSON.stringify({
              edges: normalizedSnapshot.edges,
              nodes: normalizedSnapshot.nodes,
              project,
            }).length,
            fetchMs: Math.round(projectLoadedAt - loadStartedAt),
            totalMs: Math.round(performance.now() - loadStartedAt),
          });
        }

        const lastRunId = project.lastRunId;
        if (lastRunId) {
          void loadRunTrace(project.id, lastRunId)
            .then(({ events }) => {
              if (!ignore && events.length) {
                mergePersistedRunTrace(lastRunId, events);
              }
            })
            .catch(() => {
              // The saved canvas is still usable; trace hydration only repairs
              // richer runtime projections when persisted events are available.
            });
        }
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
  }, [mergePersistedRunTrace, projectId, setEdges, setNodes]);

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

  const savePendingArtifactContent = useCallback(
    async (artifactId: string) => {
      const payload = artifactContentSavePayloadsRef.current.get(artifactId);
      if (!payload) {
        return true;
      }

      const existingTimer = artifactContentSaveTimersRef.current.get(artifactId);
      if (existingTimer) {
        window.clearTimeout(existingTimer);
        artifactContentSaveTimersRef.current.delete(artifactId);
      }
      artifactContentSavePayloadsRef.current.delete(artifactId);

      const currentMarkdownNode = nodesRef.current.find(
        (node) => node.id === payload.nodeId && node.data.kind === "markdown"
      );
      const expectedVersion =
        currentMarkdownNode?.data.kind === "markdown"
          ? currentMarkdownNode.data.artifact.version
          : payload.expectedVersion;

      try {
        const { artifact } = await updateTextArtifactContent({
          artifactId: payload.artifactId,
          contentFormat: "markdown-json",
          contentJson: {
            blockNoteBlocks: payload.blocks,
            format: "markdown-json",
            markdown: payload.content,
            plainText: payload.content,
            version: 1,
          },
          contentText: payload.content,
          expectedVersion,
          mimeType: "application/vnd.cucumber.markdown+json",
          plainText: payload.content,
          previewKind: "markdown",
          previewText: payload.summary,
          projectId: payload.projectId,
          summary: payload.summary,
          title: payload.title,
          type: "doc",
        });

        const previous = {
          edges: edgesRef.current,
          nodes: nodesRef.current,
        };
        const nextNodes = nodesRef.current.map((node) =>
          node.id === payload.nodeId && node.data.kind === "markdown"
            ? {
                ...node,
                data: {
                  ...node.data,
                  artifact: {
                    ...node.data.artifact,
                    ...artifact,
                    metadata: undefined,
                  },
                  summary: artifact.summary ?? payload.summary,
                },
              }
            : node
        );
        commitCanvasMutation({
          reason: "markdown-edit",
          patch: diffCanvasPatch(previous, {
            edges: edgesRef.current,
            nodes: nextNodes,
          }),
          persist: true,
        });
        return true;
      } catch (nextError: unknown) {
        if (!artifactContentSavePayloadsRef.current.has(artifactId)) {
          setStorageStatus("error");
          setStorageError(`Markdown 保存失败：${getClientError(nextError)}`);
        }
        return false;
      }
    },
    [commitCanvasMutation]
  );

  const flushPendingArtifactContentSaves = useCallback(() => {
    const artifactIds = [...artifactContentSavePayloadsRef.current.keys()];
    return Promise.all(
      artifactIds.map((artifactId) => savePendingArtifactContent(artifactId))
    );
  }, [savePendingArtifactContent]);

  const hasPendingCanvasSave = hasPendingCanvasSaveNow;

  const buildPendingCanvasSaveInput = useCallback(
    (currentProjectId: string): SaveProjectCanvasPatchInput => {
      const nodeUpserts = toPersistableNodes(
        nodesRef.current.filter((node) => dirtyNodeIdsRef.current.has(node.id))
      );
      const persistedNodeIds = new Set(
        nodesRef.current
          .filter((node) => !deletedNodeIdsRef.current.has(node.id))
          .map((node) => node.id)
      );
      const edgeUpserts = toPersistableEdges(
        edgesRef.current.filter(
          (edge) =>
            dirtyEdgeIdsRef.current.has(edge.id) &&
            persistedNodeIds.has(edge.source) &&
            persistedNodeIds.has(edge.target)
        )
      );

      return {
        projectId: currentProjectId,
        nodeUpserts,
        nodeDeletes: [...deletedNodeIdsRef.current],
        edgeUpserts,
        edgeDeletes: [...deletedEdgeIdsRef.current],
        selectedNodeId: persistedSelectedNodeIdRef.current,
        lastRunId: activeRunId.current,
        expectedVersion: projectVersionRef.current,
      };
    },
    []
  );

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

      const artifactSaveResults = await flushPendingArtifactContentSaves();
      if (artifactSaveResults.some((saved) => !saved)) {
        return false;
      }

      if (!hasPendingCanvasSave()) {
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
          if (!hasPendingCanvasSave()) {
            if (shouldReportStatus) {
              setStorageStatus("saved");
              setStorageError(null);
            }
            break;
          }

          for (let attempt = 0; ; attempt += 1) {
            try {
              const pendingCanvasSaveInput =
                buildPendingCanvasSaveInput(currentProjectId);
              const { project } = await saveProjectCanvasPatch(
                pendingCanvasSaveInput,
                options.keepalive ? { keepalive: true } : undefined
              );

              projectVersionRef.current = project.version;
              dirtyNodeIdsRef.current.clear();
              dirtyEdgeIdsRef.current.clear();
              deletedNodeIdsRef.current.clear();
              deletedEdgeIdsRef.current.clear();
              dirtyProjectMetaRef.current = false;
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
    [buildPendingCanvasSaveInput, flushPendingArtifactContentSaves, hasPendingCanvasSave]
  );

  const setComposerMode = useCallback((mode: ComposerMode) => {
    setComposerModeState(mode);
    window.localStorage.setItem(COMPOSER_MODE_STORAGE_KEY, mode);
  }, []);

  const setImageAspectRatio = useCallback((ratio: ImageAspectRatioSelection) => {
    setImageAspectRatioState(ratio);
    window.localStorage.setItem(IMAGE_ASPECT_RATIO_STORAGE_KEY, ratio);
  }, []);

  const setImageResultCount = useCallback((count: ImageResultCountSelection) => {
    setImageResultCountState(count);
    window.localStorage.setItem(IMAGE_RESULT_COUNT_STORAGE_KEY, String(count));
  }, []);

  const setImageProvider = useCallback((provider: ImageProviderSelection) => {
    setImageProviderState(provider);
    window.localStorage.setItem(IMAGE_PROVIDER_STORAGE_KEY, provider);
  }, []);

  const loadComposerSkills = useCallback(async () => {
    if (skillOptionsStatus === "loading" || skillOptionsStatus === "ready") {
      return;
    }
    setSkillOptionsStatus("loading");
    setSkillOptionsError(null);
    try {
      const { skills } = await loadAgentSkills();
      setSkillOptions(skills.filter((skill) => skill.enabled));
      setSkillOptionsStatus("ready");
    } catch (nextError: unknown) {
      setSkillOptionsStatus("error");
      setSkillOptionsError(getClientError(nextError));
    }
  }, [skillOptionsStatus]);

  const handleSelectForcedSkill = useCallback(
    (skill: AgentSkillDefinitionSummary) => {
      setForcedSkill(skill);
      setPrompt((current) => removeLeadingSkillSlashCommand(current));
    },
    []
  );

  const handleClearForcedSkill = useCallback(() => {
    setForcedSkill(null);
  }, []);

  const handleComposerPromptChange = useCallback(
    (value: string) => {
      setPrompt(value);
      if (getSkillSlashQuery(value) !== null) {
        void loadComposerSkills();
      }
    },
    [loadComposerSkills]
  );

  const startAgentRun = useCallback(
    async ({
      clearComposer = false,
      forcedSkill: requestedForcedSkill = null,
      inputMode = composerMode,
      imageAspectRatio: requestedImageAspectRatio = imageAspectRatio,
      imageResultCount: requestedImageResultCount = imageResultCount,
      promptText,
      retryFrom,
      selectedNodeId,
      selectedNodeIds = selectedNodeId ? [selectedNodeId] : [],
    }: {
      clearComposer?: boolean;
      forcedSkill?: AgentSkillDefinitionSummary | null;
      promptText: string;
      retryFrom?: AgentRunRequestBody["canvasContext"]["retryFrom"];
      inputMode?: ComposerMode;
      imageAspectRatio?: ImageAspectRatioSelection;
      imageResultCount?: ImageResultCountSelection;
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
      setDebugRunId(draft.runNode.id);
      setDebugEvents([]);
      setDebugOpen(true);
      activeRunMessageStartIndex.current = messagesRef.current.length;
      clearTraceReconcileTimers();
      streamedRuntimeEvents.current = streamedRuntimeEvents.current.filter(
        (event) => event.runNodeId !== draft.runNode.id
      );
      streamedAgentTextByRunId.current.delete(draft.runNode.id);
      setContextCount(draft.upstreamContext.length);
      const requestBody: AgentRunRequestBody = {
        projectId,
        runNodeId: draft.runNode.id,
        canvasContext: {
          ...(requestedForcedSkill
            ? {
                forcedSkillId: requestedForcedSkill.id,
                forcedSkillName: requestedForcedSkill.name,
              }
            : {}),
          ...(inputMode === "image"
            ? {
                imageAspectRatio: requestedImageAspectRatio,
                imageResultCount: requestedImageResultCount,
                inputMode,
              }
            : { inputMode }),
          imageProvider,
          prompt: value,
          promptNodeId: draft.promptNode.id,
          retryFrom,
          selectedNodeId,
          selectedNodeIds,
        },
      };
      const nextNodes = [
        ...applySelectedNodeIds(currentNodes, []),
        draft.promptNode,
        withRunClientStep(draft.runNode, "client.connect", "连接 Agent"),
      ];
      const nextEdges = [...currentEdges, ...draft.edges];
      const draftPatch = diffCanvasPatch(
        { edges: currentEdges, nodes: currentNodes },
        { edges: nextEdges, nodes: nextNodes }
      );
      commitCanvasMutation({
        reason: "manual-create",
        patch: draftPatch,
        persist: true,
        lastRunId: draft.runNode.id,
      });

      const artifactSaveResults = await flushPendingArtifactContentSaves();
      if (artifactSaveResults.some((saved) => !saved)) {
        if (isActiveRunNode(nodesRef.current, draft.runNode.id)) {
          markRunError(draft.runNode.id, "项目内容保存失败，Agent 未启动。");
        }
        void stop();
        return;
      }

      if (saveTimer.current) {
        window.clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }

      const pendingCanvasSaveInput = buildPendingCanvasSaveInput(projectId);
      const canvasPatch = toAgentRunCanvasPatch(pendingCanvasSaveInput);
      const requestRevision = mutationRevisionRef.current;
      atomicRunSaveRevisionRef.current = requestRevision;
      pendingRunCanvasPatchAcksRef.current.set(
        draft.runNode.id,
        createPendingRunCanvasPatchAck(pendingCanvasSaveInput, requestRevision)
      );
      requestBody.canvasPatch = canvasPatch;

      if (clearComposer) {
        setPrompt("");
        setForcedSkill(null);
      }

      try {
        await sendMessage(
          { text: value },
          {
            body: requestBody,
          }
        );
      } catch (sendError: unknown) {
        pendingRunCanvasPatchAcksRef.current.delete(draft.runNode.id);
        if (atomicRunSaveRevisionRef.current === requestRevision) {
          atomicRunSaveRevisionRef.current = null;
        }
        if (isActiveRunNode(nodesRef.current, draft.runNode.id)) {
          markRunError(draft.runNode.id, `Agent 启动失败：${getClientError(sendError)}`);
        }
        throw sendError;
      }
    },
    [
      buildPendingCanvasSaveInput,
      clearTraceReconcileTimers,
      commitCanvasMutation,
      composerMode,
      flushPendingArtifactContentSaves,
      hasLocalUploadNodes,
      imageAspectRatio,
      imageProvider,
      imageResultCount,
      isBusy,
      markRunError,
      sendMessage,
      showUploadError,
      storageError,
      stop,
    ]
  );

  const handleRetryRun = useCallback(
    (
      runNodeId: string,
      retryFrom?: { stepId?: string }
    ) => {
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
        retryFrom: {
          failedRunNodeId: runNodeId,
          stepId: retryFrom?.stepId ?? getLatestFailedStepId(runNode),
        },
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
      const detail = (event as CustomEvent<{
        retryFrom?: { stepId?: unknown };
        runNodeId?: unknown;
      }>).detail;
      if (typeof detail?.runNodeId === "string") {
        handleRetryRun(
          detail.runNodeId,
          typeof detail.retryFrom?.stepId === "string"
            ? { stepId: detail.retryFrom.stepId }
            : undefined
        );
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
    if (!hasPendingCanvasSave()) {
      return;
    }
    if (
      atomicRunSaveRevisionRef.current !== null &&
      mutationRevisionRef.current <= atomicRunSaveRevisionRef.current
    ) {
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

    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      setStorageStatus("saving");
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
    hasPendingCanvasSave,
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
      reconcileRunFromPersistedTrace(activeRunId.current, error.message);
    }
  }, [error, reconcileRunFromPersistedTrace]);

  useEffect(
    () => () => {
      for (const timer of artifactContentSaveTimersRef.current.values()) {
        window.clearTimeout(timer);
      }
      artifactContentSaveTimersRef.current.clear();
    },
    []
  );

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
      const previous = {
        edges: edgesRef.current,
        nodes: nodesRef.current,
      };
      const next = {
        edges: edgesRef.current,
        nodes: [
          ...applySelectedNodeIds(nodesRef.current, []),
          { ...node, selected: true },
        ],
      };
      commitCanvasMutation({
        reason: "manual-create",
        patch: diffCanvasPatch(previous, next),
        persist: true,
      });
      setCanvasTool("select");
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp, { once: true });

    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [commitCanvasMutation, creationPreview]);

  const handleCopySelection = useCallback(() => {
    if (isReplayModeRef.current) {
      return false;
    }
    const selected = nodesRef.current.filter((node) => node.selected);
    if (!selected.length) {
      return false;
    }
    const selectedIds = new Set(selected.map((node) => node.id));
    const internalEdges = edgesRef.current.filter(
      (edge) => selectedIds.has(edge.source) && selectedIds.has(edge.target)
    );
    clipboardRef.current = {
      nodes: structuredClone(selected),
      edges: structuredClone(internalEdges),
    };
    return true;
  }, []);

  const handlePasteClipboard = useCallback(() => {
    if (isReplayModeRef.current) {
      return;
    }
    const clipboard = clipboardRef.current;
    if (!clipboard || !clipboard.nodes.length) {
      return;
    }

    const instance = flowInstance.current;
    const sourceNodes = clipboard.nodes;
    const minX = Math.min(...sourceNodes.map((node) => node.position.x));
    const minY = Math.min(...sourceNodes.map((node) => node.position.y));

    const pointer = pointerScreenRef.current;
    const anchor =
      pointer && instance
        ? instance.screenToFlowPosition(pointer)
        : { x: minX + 32, y: minY + 32 };

    const idMap = new Map<string, string>();
    const pastedNodes = sourceNodes.map((source) => {
      const newId = createCanvasNodeId("paste");
      idMap.set(source.id, newId);
      const position = {
        x: anchor.x + (source.position.x - minX),
        y: anchor.y + (source.position.y - minY),
      };
      return createPastedNode(source, newId, position);
    });

    const pastedEdges = clipboard.edges.map((edge) => {
      const source = idMap.get(edge.source) ?? edge.source;
      const target = idMap.get(edge.target) ?? edge.target;
      return {
        ...structuredClone(edge),
        id: `edge-${source}-${target}-${Math.random().toString(36).slice(2, 8)}`,
        source,
        target,
        selected: false,
      };
    });

    const previous = { edges: edgesRef.current, nodes: nodesRef.current };
    const next = {
      edges: [...edgesRef.current, ...pastedEdges],
      nodes: [...applySelectedNodeIds(nodesRef.current, []), ...pastedNodes],
    };
    commitCanvasMutation({
      reason: "paste",
      patch: diffCanvasPatch(previous, next),
      persist: true,
    });
  }, [commitCanvasMutation]);

  const handlePasteTextAsPromptNode = useCallback(
    (rawText: string) => {
      if (isReplayModeRef.current) {
        return false;
      }

      const promptText = normalizePastedPlainText(rawText);
      const instance = flowInstance.current;
      if (!promptText || !instance) {
        return false;
      }

      const template = createManualPromptTemplate(promptText);
      const dimensions = getDefaultManualNodeDimensions(template);
      const position = instance.screenToFlowPosition(
        getCanvasPasteScreenPoint(pointerScreenRef.current)
      );
      const node = createManualCanvasNode(template, position, dimensions);
      const previous = { edges: edgesRef.current, nodes: nodesRef.current };
      const next = {
        edges: edgesRef.current,
        nodes: [
          ...applySelectedNodeIds(nodesRef.current, []),
          { ...node, selected: true },
        ],
      };
      commitCanvasMutation({
        reason: "paste",
        patch: diffCanvasPatch(previous, next),
        persist: true,
      });

      return true;
    },
    [commitCanvasMutation]
  );

  useEffect(() => {
    const handlePointerMove = (event: MouseEvent) => {
      pointerScreenRef.current = { x: event.clientX, y: event.clientY };
    };
    window.addEventListener("mousemove", handlePointerMove);
    return () => window.removeEventListener("mousemove", handlePointerMove);
  }, []);

  useEffect(() => {
    const handleCopy = (event: ClipboardEvent) => {
      if (isEditableTextTarget(event.target)) {
        return;
      }

      const selection = window.getSelection();
      if (selection && selection.toString().length > 0) {
        return;
      }

      if (!handleCopySelection()) {
        return;
      }

      event.clipboardData?.setData(CANVAS_CLIPBOARD_MIME, "nodes");
      event.clipboardData?.setData("text/plain", CANVAS_CLIPBOARD_TEXT);
      event.preventDefault();
    };

    const handlePaste = (event: ClipboardEvent) => {
      if (isEditableTextTarget(event.target)) {
        return;
      }

      const files = getClipboardFiles(event.clipboardData);
      if (files.length) {
        event.preventDefault();
        void handleClipboardFiles(
          files,
          getCanvasPasteScreenPoint(pointerScreenRef.current)
        );
        return;
      }

      if (
        hasCanvasClipboardPayload(event.clipboardData) &&
        clipboardRef.current?.nodes.length
      ) {
        event.preventDefault();
        handlePasteClipboard();
        return;
      }

      const text = getClipboardPlainText(event.clipboardData);
      if (text && handlePasteTextAsPromptNode(text)) {
        event.preventDefault();
        return;
      }

      if (clipboardRef.current?.nodes.length) {
        event.preventDefault();
        handlePasteClipboard();
      }
    };

    window.addEventListener("copy", handleCopy);
    window.addEventListener("paste", handlePaste);
    return () => {
      window.removeEventListener("copy", handleCopy);
      window.removeEventListener("paste", handlePaste);
    };
  }, [
    handleClipboardFiles,
    handleCopySelection,
    handlePasteClipboard,
    handlePasteTextAsPromptNode,
  ]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key !== "c") {
        return;
      }
      if (isEditableTextTarget(event.target)) {
        return;
      }
      const selection = window.getSelection();
      if (key === "c" && selection && selection.toString().length > 0) {
        return;
      }
      if (key === "c") {
        handleCopySelection();
        return;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleCopySelection]);

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

      const operationKey = `upscale:${sourceNodeId}`;
      if (imageProcessingInFlightRef.current.has(operationKey)) {
        return;
      }
      imageProcessingInFlightRef.current.add(operationKey);

      try {
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
        commitCanvasMutation({
          reason: "upscale-pending",
          patch: diffCanvasPatch(
            { edges: edgesRef.current, nodes: nodesRef.current },
            { edges: withPendingEdges, nodes: withPendingNodes }
          ),
          persist: false,
        });
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
      } finally {
        imageProcessingInFlightRef.current.delete(operationKey);
      }
    },
    [commitCanvasMutation, loadedProjectId, saveProjectSnapshot, setEdges, setNodes]
  );

  const handleMattingImageNode = useCallback(
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
        setStorageError("只能对图片节点执行抠图。");
        return;
      }
      if ((sourceNode.data.status ?? "ready") !== "ready" || !sourceNode.data.image.url) {
        setStorageStatus("error");
        setStorageError("图片尚未准备完成，无法抠图。");
        return;
      }

      const operationKey = `matting:${sourceNodeId}`;
      if (imageProcessingInFlightRef.current.has(operationKey)) {
        return;
      }
      imageProcessingInFlightRef.current.add(operationKey);

      try {
        const saved = await saveProjectSnapshot();
        if (!saved) {
          setStorageStatus("error");
          setStorageError("项目快照保存失败，无法抠图。");
          return;
        }

        const pendingId = `image-matting-pending-${Date.now().toString(36)}`;
        const pendingEdgeId = `edge-${sourceNodeId}-${pendingId}`;
        const pendingNode = createPendingMattingImageNode(sourceNode, pendingId);
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
        commitCanvasMutation({
          reason: "matting-pending",
          patch: diffCanvasPatch(
            { edges: edgesRef.current, nodes: nodesRef.current },
            { edges: withPendingEdges, nodes: withPendingNodes }
          ),
          persist: false,
        });
        setStorageStatus("saving");
        setStorageError(null);

        try {
          const result = await mattingProjectImage({
            expectedVersion: projectVersionRef.current,
            projectId: loadedProjectId,
            sourceNodeId,
          });
          projectVersionRef.current = result.project.version;
          persistedSelectedNodeIdRef.current = result.node.id;

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
                        title: "抠图失败",
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
          setStorageError(`抠图失败：${getClientError(nextError)}`);
        }
      } finally {
        imageProcessingInFlightRef.current.delete(operationKey);
      }
    },
    [commitCanvasMutation, loadedProjectId, saveProjectSnapshot, setEdges, setNodes]
  );

  const imageNodeActions = useMemo(
    () => ({
      onMatting: handleMattingImageNode,
      onUpscale: handleUpscaleImageNode,
    }),
    [handleMattingImageNode, handleUpscaleImageNode]
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
        forcedSkill,
        inputMode: composerMode,
        imageAspectRatio,
        imageResultCount,
        promptText: value,
        selectedNodeId: referenceNodeId,
        selectedNodeIds: referenceNodeIds,
      });
    },
    [
      composerMode,
      forcedSkill,
      imageAspectRatio,
      imageResultCount,
      prompt,
      referenceNodeId,
      referenceNodeIds,
      startAgentRun,
    ]
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

  const handleCloseAgentRunDebug = useCallback(() => {
    setDebugOpen(false);
  }, []);

  const scheduleMarkdownArtifactContentSave = useCallback(
    ({
      artifactId,
      blocks,
      content,
      expectedVersion,
      nodeId,
      summary,
      title,
    }: {
      artifactId: string;
      blocks: unknown[];
      content: string;
      expectedVersion?: number;
      nodeId: string;
      summary: string;
      title: string;
    }) => {
      const projectId = loadedProjectIdRef.current;
      if (!projectId) {
        return;
      }

      const existingTimer = artifactContentSaveTimersRef.current.get(artifactId);
      if (existingTimer) {
        window.clearTimeout(existingTimer);
      }
      artifactContentSavePayloadsRef.current.set(artifactId, {
        artifactId,
        blocks,
        content,
        expectedVersion,
        nodeId,
        projectId,
        summary,
        title,
      });
      setStorageStatus("saving");
      setStorageError(null);

      const timer = window.setTimeout(() => {
        void savePendingArtifactContent(artifactId);
      }, 700);

      artifactContentSaveTimersRef.current.set(artifactId, timer);
    },
    [savePendingArtifactContent]
  );

  const handleMarkdownNodeChange = useCallback(
    (nodeId: string, content: string, blocks: unknown[]) => {
      if (isReplayMode) {
        return;
      }

      const normalizedContent = content.trim();
      const nextBlocksJson = JSON.stringify(blocks);
      const currentMarkdownNode = nodesRef.current.find(
        (node) => node.id === nodeId && node.data.kind === "markdown"
      );
      const nextNodes = nodesRef.current.map((node) => {
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
      });
      nodesRef.current = nextNodes;
      setNodes(nextNodes);

      if (currentMarkdownNode?.data.kind === "markdown") {
        scheduleMarkdownArtifactContentSave({
          artifactId: currentMarkdownNode.data.artifact.id,
          blocks,
          content: normalizedContent,
          expectedVersion: currentMarkdownNode.data.artifact.version,
          nodeId,
          summary: summarizeMarkdownForCanvasNode(normalizedContent),
          title: currentMarkdownNode.data.title,
        });
      }
    },
    [isReplayMode, scheduleMarkdownArtifactContentSave, setNodes]
  );

  const handleStickyTextChange = useCallback(
    (nodeId: string, text: string) => {
      if (isReplayMode) {
        return;
      }

      const previous = { edges: edgesRef.current, nodes: nodesRef.current };
      const nextNodes = nodesRef.current.map((node) =>
        node.id === nodeId && node.data.kind === "stickyNote"
          ? { ...node, data: { ...node.data, text } }
          : node
      );
      commitCanvasMutation({
        reason: "text-edit",
        patch: diffCanvasPatch(previous, {
          edges: edgesRef.current,
          nodes: nextNodes,
        }),
        persist: true,
      });
    },
    [commitCanvasMutation, isReplayMode]
  );

  const handleShapeLabelChange = useCallback(
    (nodeId: string, label: string) => {
      if (isReplayMode) {
        return;
      }

      const previous = { edges: edgesRef.current, nodes: nodesRef.current };
      const nextNodes = nodesRef.current.map((node) =>
        node.id === nodeId && node.data.kind === "shape"
          ? { ...node, data: { ...node.data, label } }
          : node
      );
      commitCanvasMutation({
        reason: "shape-edit",
        patch: diffCanvasPatch(previous, {
          edges: edgesRef.current,
          nodes: nextNodes,
        }),
        persist: true,
      });
    },
    [commitCanvasMutation, isReplayMode]
  );

  const handlePromptTextChange = useCallback(
    (nodeId: string, prompt: string) => {
      if (isReplayMode) {
        return;
      }

      const previous = { edges: edgesRef.current, nodes: nodesRef.current };
      const nextNodes = nodesRef.current.map((node) => {
        if (
          node.id !== nodeId ||
          node.data.kind !== "prompt" ||
          !node.data.manual
        ) {
          return node;
        }

        return {
          ...node,
          data: {
            ...node.data,
            prompt,
          },
        };
      });
      commitCanvasMutation({
        reason: "text-edit",
        patch: diffCanvasPatch(previous, {
          edges: edgesRef.current,
          nodes: nextNodes,
        }),
        persist: true,
      });
    },
    [commitCanvasMutation, isReplayMode]
  );

  if (storageStatus === "loading" && !loadedProjectId) {
    return <LoadingScreen label="加载画布中" />;
  }

  return (
    <main
      className="relative h-screen w-screen overflow-hidden bg-cuc-surface p-cuc-canvas-inset"
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
            onPromptTextChange: handlePromptTextChange,
            readOnly: isReplayMode,
            onShapeLabelChange: handleShapeLabelChange,
            onStickyTextChange: handleStickyTextChange,
          }}
        >
          <ImageNodeActionContext.Provider value={imageNodeActions}>
            <Canvas<AgentCanvasNode, AgentCanvasEdge>
              className={`agent-canvas h-full w-full overflow-hidden rounded-cuc-canvas border border-cuc-canvas-border bg-cuc-canvas canvas-tool-${canvasTool}${
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
              onEdgesChange={isReplayMode ? undefined : handleEdgesChange}
              onNodeClick={handleNodeClick}
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
              panOnDrag={
                isHandTool ? HAND_TOOL_PAN_ON_DRAG_BUTTONS : PAN_ON_DRAG_BUTTONS
              }
              selectionKeyCode={null}
              multiSelectionKeyCode={SHIFT_MULTI_SELECTION_KEYS}
              selectionOnDrag={!isHandTool && !isCreateTool}
              proOptions={{ hideAttribution: true }}
            >
              <CanvasAutoFit
                fitRequest={layoutFitRequest}
                nodeCount={canvasNodes.length}
              />
              <MiniMap
                pannable
                zoomable
                position="top-right"
                className="hidden"
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
      <AgentRunDebugPanel
        events={debugEvents}
        open={debugOpen && Boolean(debugRunId)}
        runNodeId={debugRunId}
        onClose={handleCloseAgentRunDebug}
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
        canEdit={canEditComposer}
        canSubmit={canSubmit}
        composerMode={composerMode}
        contextCount={contextCount}
        forcedSkill={forcedSkill}
        hasFailedUpload={hasFailedLocalUploadNodes}
        hasUploading={hasUploadingLocalNodes}
        imageAspectRatio={imageAspectRatio}
        imageProvider={imageProvider}
        imageResultCount={imageResultCount}
        prompt={prompt}
        referenceContextCount={referenceContextCount}
        referenceNode={referenceNode}
        referenceNodeIds={referenceNodeIds}
        referenceNodeCount={referenceNodeIds.length}
        replayActive={isReplayMode}
        selectionCount={selectedNodeIds.length}
        selectedNodes={selectedNodes}
        setComposerMode={setComposerMode}
        setImageAspectRatio={setImageAspectRatio}
        setImageProvider={setImageProvider}
        setImageResultCount={setImageResultCount}
        setPrompt={handleComposerPromptChange}
        showSkillMenu={showSkillMenu}
        skillOptions={skillOptions}
        skillOptionsError={skillOptionsError}
        skillOptionsStatus={skillOptionsStatus}
        skillSlashQuery={skillSlashQuery ?? ""}
        stop={handleStop}
        onClearForcedSkill={handleClearForcedSkill}
        onSelectForcedSkill={handleSelectForcedSkill}
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
      className="pointer-events-none absolute z-[18] grid min-h-2 min-w-2 place-items-center rounded-cuc-popover border border-black/75 bg-cuc-ink/8 text-[11px] leading-[14px] text-[#174222]/80 shadow-[0_0_0_3px_rgba(0,0,0,0.08)]"
      style={{
        height: preview.rect.height,
        left: preview.rect.left,
        top: preview.rect.top,
        width: preview.rect.width,
      }}
    >
      <span className="max-w-[86px] overflow-hidden truncate rounded-cuc-pill bg-cuc-surface/72 px-1.5 py-0.5">
        {preview.label}
      </span>
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

function isActiveRunStatus(status: AgentRunStatus) {
  return status === "queued" || status === "running";
}

function isActiveRunNode(nodes: AgentCanvasNode[], runId: string) {
  return nodes.some(
    (node) =>
      node.id === runId &&
      node.data.kind === "run" &&
      isActiveRunStatus(node.data.status)
  );
}

function toAgentRunCanvasPatch(
  input: SaveProjectCanvasPatchInput
): Omit<SaveProjectCanvasPatchInput, "projectId"> {
  return {
    expectedVersion: input.expectedVersion,
    nodeUpserts: input.nodeUpserts,
    nodeDeletes: input.nodeDeletes,
    edgeUpserts: input.edgeUpserts,
    edgeDeletes: input.edgeDeletes,
    selectedNodeId: input.selectedNodeId,
    lastRunId: input.lastRunId,
  };
}

function createPendingRunCanvasPatchAck(
  input: SaveProjectCanvasPatchInput,
  revision: number
): PendingRunCanvasPatchAck {
  const patch: CanvasPatch = {
    nodeUpserts: input.nodeUpserts,
    nodeDeletes: input.nodeDeletes,
    edgeUpserts: input.edgeUpserts,
    edgeDeletes: input.edgeDeletes,
  };

  return {
    dirtyEdgeIds: patch.edgeUpserts?.map((edge) => edge.id) ?? [],
    dirtyNodeIds: patch.nodeUpserts?.map((node) => node.id) ?? [],
    edgeDeleteIds: patch.edgeDeletes ?? [],
    lastRunId: input.lastRunId,
    nodeDeleteIds: patch.nodeDeletes ?? [],
    revision,
  };
}

function hasTerminalRunEvent(events: RunStepTraceEvent[]) {
  return events.some(
    (event) => event.type === "run.completed" || event.type === "run.failed"
  );
}

function withRunClientStep(
  node: AgentCanvasNode,
  stepId: string,
  label: string
): AgentCanvasNode {
  if (node.data.kind !== "run") {
    return node;
  }

  return {
    ...node,
    data: {
      ...node.data,
      currentStep: {
        id: stepId,
        label,
        startedAt: new Date().toISOString(),
        status: "running",
      },
      status: "running",
    },
  };
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

function getLatestFailedStepId(runNode: AgentCanvasNode) {
  if (runNode.data.kind !== "run") {
    return undefined;
  }

  const failedStep = runNode.data.stepTimeline?.findLast(
    (step) => step.status === "error"
  );
  return failedStep?.id;
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

function isEditableTextTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) {
    return false;
  }

  const tagName = target.tagName;
  return (
    (target instanceof HTMLElement && target.isContentEditable) ||
    tagName === "INPUT" ||
    tagName === "TEXTAREA" ||
    tagName === "SELECT" ||
    Boolean(target.closest('[contenteditable="true"], [role="textbox"]'))
  );
}

function getClipboardPlainText(clipboardData: DataTransfer | null) {
  return normalizePastedPlainText(clipboardData?.getData("text/plain") ?? "");
}

function getClipboardFiles(clipboardData: DataTransfer | null) {
  if (!clipboardData) {
    return [];
  }

  const files = Array.from(clipboardData.files ?? []);
  if (files.length) {
    return files;
  }

  return Array.from(clipboardData.items ?? []).flatMap((item) => {
    if (item.kind !== "file") {
      return [];
    }

    const file = item.getAsFile();
    return file ? [file] : [];
  });
}

function hasCanvasClipboardPayload(clipboardData: DataTransfer | null) {
  if (!clipboardData) {
    return false;
  }

  return (
    Array.from(clipboardData.types).includes(CANVAS_CLIPBOARD_MIME) ||
    clipboardData.getData("text/plain") === CANVAS_CLIPBOARD_TEXT
  );
}

function normalizePastedPlainText(text: string) {
  const normalized = text.replace(/\r\n?/g, "\n");
  return normalized.trim().length > 0 ? normalized : "";
}

function getCanvasPasteScreenPoint(pointer: CanvasPoint | null) {
  if (typeof document !== "undefined") {
    const pane = document.querySelector(".react-flow__pane");
    const rect = pane?.getBoundingClientRect();
    if (rect && rect.width > 0 && rect.height > 0) {
      if (
        pointer &&
        pointer.x >= rect.left &&
        pointer.x <= rect.right &&
        pointer.y >= rect.top &&
        pointer.y <= rect.bottom
      ) {
        return pointer;
      }

      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
    }
  }

  if (pointer) {
    return pointer;
  }

  return {
    x: typeof window === "undefined" ? 0 : window.innerWidth / 2,
    y: typeof window === "undefined" ? 0 : window.innerHeight / 2,
  };
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
  if (template.kind === "prompt") {
    return {
      height: dimensions.height,
      id: createCanvasNodeId("prompt"),
      position,
      style: dimensions,
      type: "promptNode",
      width: dimensions.width,
      data: {
        kind: "prompt",
        contextLabel: "Manual input",
        createdAt,
        manual: true,
        prompt: template.prompt,
      },
    };
  }

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

function createManualPromptTemplate(prompt: string) {
  const template = manualNodeTemplates.find(
    (item): item is Extract<ManualNodeTemplate, { kind: "prompt" }> =>
      item.kind === "prompt"
  );

  if (!template) {
    throw new Error("Manual prompt template is missing.");
  }

  return { ...template, prompt };
}

function createCanvasNodeId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function createPastedNode(
  source: AgentCanvasNode,
  newId: string,
  position: CanvasPoint
): AgentCanvasNode {
  const data = structuredClone(source.data) as AgentCanvasNodeData;
  // Pasted copies are standalone: drop ties to the originating run/source node
  // and any in-flight upload state so they never block submission.
  if ("runId" in data) {
    delete (data as { runId?: string }).runId;
  }
  if ("sourceNodeId" in data) {
    delete (data as { sourceNodeId?: string }).sourceNodeId;
  }
  if ("operation" in data) {
    delete (data as { operation?: string }).operation;
  }
  if ("upload" in data) {
    delete (data as { upload?: unknown }).upload;
  }

  return {
    ...source,
    id: newId,
    position,
    selected: true,
    dragging: false,
    data,
  };
}

function getDefaultManualNodeDimensions(template: ManualNodeTemplate) {
  if (template.kind === "prompt") {
    return getPromptNodeDimensions(template.prompt);
  }

  if (template.kind === "stickyNote") {
    return { width: 220, height: 170 };
  }

  return getDefaultShapeDimensions(template.shape);
}

function getMinimumManualNodeDimensions(template: ManualNodeTemplate) {
  if (template.kind === "prompt") {
    return { width: 180, height: 64 };
  }

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
    <div className="absolute left-3.5 top-3.5 z-20 flex h-cuc-floating-height items-center gap-1 rounded-cuc-floating bg-cuc-canvas-glass p-2 text-[13px] font-normal text-cuc-text-strong backdrop-blur-sm max-[760px]:left-3 max-[760px]:max-w-[calc(100vw-24px)] max-[760px]:overflow-hidden">
      <button
        aria-label="返回项目列表"
        className={cn(TOP_ICON_BUTTON_CLASS, "size-cuc-icon-button rounded-cuc-card text-cuc-text-secondary hover:bg-cuc-surface/72")}
        onClick={onBack}
        title="返回项目列表"
        type="button"
      >
        <ArrowLeft size={12} />
      </button>
      <div className="flex h-cuc-control w-[271px] items-center gap-1 overflow-hidden max-[760px]:w-[min(271px,calc(100vw-88px))]">
        <div className="grid size-cuc-control flex-none place-items-center rounded-cuc-control text-cuc-control-dark">
          <img className="size-5" src="/LOGO.svg" alt="cucumber logo" />
        </div>
        <span className="mx-2 h-3 w-px flex-none bg-cuc-edge" />
        <button
          className={cn(
            TOP_CONTROL_BUTTON_CLASS,
            "grid w-[150px] grid-cols-[minmax(0,1fr)_12px] gap-1.5 px-2 text-left max-[760px]:w-[min(150px,calc(100vw-210px))]"
          )}
          title={title}
          type="button"
        >
          <span className="truncate">{title}</span>
          <ChevronDown size={12} />
        </button>
        <button aria-label="分享" className={cn(TOP_CONTROL_BUTTON_CLASS, "w-cuc-control")} title="分享" type="button">
          <ArrowUpRight size={14} />
        </button>
        <button aria-label="评论" className={cn(TOP_CONTROL_BUTTON_CLASS, "w-cuc-control")} title="评论" type="button">
          <Copy size={14} />
        </button>
        <span
          className={cn(
            STORAGE_CHIP_CLASS,
            storageStatus === "saved" && "text-[#B7B7B7]",
            (storageStatus === "saving" || storageStatus === "loading") && "text-[#B8B8B8]",
            storageStatus === "error" && "border-cuc-danger-border text-cuc-danger-strong"
          )}
          title={storageError ?? getStorageStatusLabel(storageStatus)}
        >
          {getStorageStatusLabel(storageStatus)}
        </span>
      </div>
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
    { icon: Search, label: "搜索节点", tool: "select" },
    { icon: Workflow, label: "知识花园", tool: "hand" },
    ...manualNodeTemplates.map((template) => ({
      icon: template.icon,
      label: template.label,
      tool: template.tool,
    })),
  ];

  return (
    <aside className="absolute left-3.5 top-1/2 z-20 flex w-14 -translate-y-1/2 flex-col items-center gap-1 rounded-cuc-composer border-[0.5px] border-cuc-border bg-cuc-surface p-[8.5px] max-[760px]:left-3 max-[760px]:w-12 max-[760px]:p-1.5" aria-label="Canvas tools">
      {tools.map(({ icon: Icon, label, tool }) => {
        const active = tool === activeTool;
        return (
          <button
            aria-label={label}
            className={cn(
              SHELL_ICON_BUTTON_CLASS,
              "size-cuc-tool rounded-cuc-floating max-[760px]:size-9",
              active && "bg-cuc-surface-warm text-cuc-text"
            )}
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
    <div className="absolute right-5 top-3.5 z-20 flex h-cuc-floating-height items-center gap-1 rounded-cuc-floating bg-cuc-canvas-glass px-2 backdrop-blur-sm max-[760px]:right-3 max-[760px]:top-[68px] max-[760px]:max-w-[calc(100vw-118px)] max-[760px]:overflow-hidden">
      <button
        aria-label="自动布局"
        className={cn(SHELL_ICON_BUTTON_CLASS, "h-cuc-control w-cuc-control rounded-cuc-control")}
        disabled={!canAutoLayout}
        onClick={onAutoLayout}
        title={canAutoLayout ? "自动布局" : "暂无节点"}
        type="button"
      >
        <Workflow size={14} />
      </button>
      <button
        aria-label="适应画布"
        className={cn(
          SHELL_ICON_BUTTON_CLASS,
          "!flex h-cuc-control w-[69px] items-center justify-center gap-1 rounded-cuc-control px-2 disabled:opacity-100"
        )}
        disabled
        title="暂未开放"
        type="button"
      >
        <span className="w-[37px] text-center text-[13px] leading-5 text-cuc-text-heading">100%</span>
        <ChevronDown size={12} />
      </button>
     
     
    </div>
  );
}

function EmptyState({ visible }: { visible: boolean }) {
  if (!visible) {
    return null;
  }

  return (
    <div className="pointer-events-none absolute left-1/2 top-1/2 z-[5] flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 text-[13px] text-cuc-text-subtle">
      <CircleDot size={18} />
      <span>输入需求，让 Agent 帮你实现它</span>
    </div>
  );
}

function Composer({
  busy,
  canEdit,
  canSubmit,
  composerMode,
  contextCount,
  forcedSkill,
  hasFailedUpload,
  hasUploading,
  imageAspectRatio,
  imageProvider,
  imageResultCount,
  prompt,
  referenceContextCount,
  referenceNode,
  referenceNodeIds,
  referenceNodeCount,
  replayActive,
  selectionCount,
  selectedNodes,
  setComposerMode,
  setImageAspectRatio,
  setImageProvider,
  setImageResultCount,
  setPrompt,
  showSkillMenu,
  skillOptions,
  skillOptionsError,
  skillOptionsStatus,
  skillSlashQuery,
  stop,
  onClearForcedSkill,
  onSelectForcedSkill,
  onSubmit,
}: {
  busy: boolean;
  canEdit: boolean;
  canSubmit: boolean;
  composerMode: ComposerMode;
  contextCount: number;
  forcedSkill: AgentSkillDefinitionSummary | null;
  hasFailedUpload: boolean;
  hasUploading: boolean;
  imageAspectRatio: ImageAspectRatioSelection;
  imageProvider: ImageProviderSelection;
  imageResultCount: ImageResultCountSelection;
  prompt: string;
  referenceContextCount: number;
  referenceNode?: AgentCanvasNode;
  referenceNodeIds: string[];
  referenceNodeCount: number;
  replayActive: boolean;
  selectionCount: number;
  selectedNodes: AgentCanvasNode[];
  setComposerMode: (value: ComposerMode) => void;
  setImageAspectRatio: (value: ImageAspectRatioSelection) => void;
  setImageProvider: (value: ImageProviderSelection) => void;
  setImageResultCount: (value: ImageResultCountSelection) => void;
  setPrompt: (value: string) => void;
  showSkillMenu: boolean;
  skillOptions: AgentSkillDefinitionSummary[];
  skillOptionsError: string | null;
  skillOptionsStatus: "idle" | "loading" | "ready" | "error";
  skillSlashQuery: string;
  stop: () => void;
  onClearForcedSkill: () => void;
  onSelectForcedSkill: (skill: AgentSkillDefinitionSummary) => void;
  onSubmit: (
    message: PromptInputMessage,
    event?: FormEvent<HTMLFormElement>
  ) => void;
}) {
  const hasReference = Boolean(referenceNode);
  const hasMultipleReferences = referenceNodeCount > 1;
  const hasSelectedTokens = selectedNodes.length > 0 || Boolean(forcedSkill);
  const referenceNodeIdSet = useMemo(
    () => new Set(referenceNodeIds),
    [referenceNodeIds]
  );
  const submitBlockedLabel = hasFailedUpload
    ? "请先移除上传失败文件"
    : hasUploading
      ? "文件上传中，可继续输入，完成后提交"
      : "项目连接失败，无法提交";
  const footerContextLabel =
    !canSubmit && canEdit
      ? submitBlockedLabel
      : hasReference
        ? hasMultipleReferences
          ? `继续基于 ${referenceNodeCount} 个引用节点生成分支`
          : "继续基于引用节点生成分支"
        : selectionCount > 1
          ? "选中节点无可引用内容"
          : `${contextCount} upstream items`;
  const placeholder = replayActive
    ? "Run 回放模式为只读..."
    : !canEdit
      ? "项目连接失败，无法输入..."
      : !canSubmit
        ? submitBlockedLabel
        : hasReference
          ? composerMode === "image"
            ? "基于引用节点生成图像..."
            : "基于引用节点继续生成..."
          : composerMode === "image"
            ? "描述你要生成的图像..."
            : "输入需求，让 Agent 帮你实现...";

  return (
    <div className={COMPOSER_WRAP_CLASS} data-mode={composerMode}>
      <ComposerModeSwitch
        disabled={busy || replayActive}
        value={composerMode}
        onChange={setComposerMode}
      />
      <ComposerSkillMenu
        error={skillOptionsError}
        loading={skillOptionsStatus === "loading" || skillOptionsStatus === "idle"}
        open={showSkillMenu}
        query={skillSlashQuery}
        skills={skillOptions}
        onSelect={onSelectForcedSkill}
      />
      <PromptInput
        attachmentsEnabled={false}
        className={cn(
          COMPOSER_FORM_CLASS,
          composerMode === "agent" && COMPOSER_AGENT_FORM_CLASS,
          composerMode === "image" && COMPOSER_IMAGE_FORM_CLASS,
          composerMode === "agent" && hasSelectedTokens && "min-h-[88px]"
        )}
        data-mode={composerMode}
        data-has-tokens={hasSelectedTokens}
        onSubmit={(message, event) => onSubmit(message, event)}
      >
        <PromptInputBody>
          <div
            className={cn(
              "flex min-w-0 flex-1 flex-col",
              composerMode === "agent" && "min-h-[52px] justify-center",
              composerMode === "image" && "min-h-[123px] pt-2.5"
            )}
          >
            <ComposerInlineTokens
              forcedSkill={forcedSkill}
              nodes={selectedNodes}
              referenceNodeIdSet={referenceNodeIdSet}
              onClearForcedSkill={onClearForcedSkill}
            />
            <PromptInputTextarea
              className={cn(
                COMPOSER_TEXTAREA_BASE_CLASS,
                composerMode === "agent" && "h-[52px] min-h-[52px] max-h-[52px] pb-[15px] pt-4",
                composerMode === "agent" && hasSelectedTokens && "h-[34px] min-h-[34px] max-h-[34px] pt-1",
                composerMode === "image" && "h-[76px] min-h-[76px] max-h-24 pb-2 pt-1"
              )}
              disabled={!canEdit && !busy}
              placeholder={placeholder}
              value={prompt}
              onChange={(event) => setPrompt(event.currentTarget.value)}
            />
          </div>
        </PromptInputBody>
        <PromptInputFooter
          className={cn(
            COMPOSER_FOOTER_BASE_CLASS,
            composerMode === "agent" && COMPOSER_FOOTER_AGENT_CLASS,
            composerMode === "image" && COMPOSER_FOOTER_IMAGE_CLASS
          )}
        >
          <div className="flex min-w-0 items-center gap-1">
            {composerMode === "image" ? (
              <>
                <ImageAspectRatioSelect
                  disabled={busy || replayActive}
                  value={imageAspectRatio}
                  onChange={setImageAspectRatio}
                />
                <ImageProviderSelect
                  disabled={busy || replayActive}
                  value={imageProvider}
                  onChange={setImageProvider}
                />
                <ImageResultCountSelect
                  disabled={busy || replayActive}
                  value={imageResultCount}
                  onChange={setImageResultCount}
                />
              </>
            ) : (
              <ComposerFooterStatus
                label={
                  hasReference && !hasMultipleReferences
                    ? `${referenceContextCount} upstream items`
                    : footerContextLabel
                }
              />
            )}
          </div>
          <PromptInputSubmit
            className={COMPOSER_SUBMIT_BUTTON_CLASS}
            disabled={busy ? false : !prompt.trim() || !canSubmit}
            onStop={stop}
            status={busy ? "streaming" : "ready"}
          />
        </PromptInputFooter>
      </PromptInput>
    </div>
  );
}

function ComposerModeSwitch({
  disabled,
  value,
  onChange,
}: {
  disabled: boolean;
  value: ComposerMode;
  onChange: (value: ComposerMode) => void;
}) {
  return (
    <div aria-label="输入模式" className={COMPOSER_MODE_SWITCH_CLASS} role="tablist">
      <button
        aria-label="Agent 模式"
        aria-selected={value === "agent"}
        className={cn(
          COMPOSER_MODE_BUTTON_CLASS,
          value === "agent" ? "bg-cuc-ink text-cuc-surface" : "px-0"
        )}
        data-active={value === "agent"}
        disabled={disabled}
        onClick={() => onChange("agent")}
        role="tab"
        title="Agent 模式"
        type="button"
      >
        <Sparkles size={14} />
        <span className={value === "agent" ? undefined : "hidden"}>Agent</span>
      </button>
      <button
        aria-label="图像模式"
        aria-selected={value === "image"}
        className={cn(
          COMPOSER_MODE_BUTTON_CLASS,
          value === "image" ? "bg-cuc-ink text-cuc-surface" : "px-0"
        )}
        data-active={value === "image"}
        disabled={disabled}
        onClick={() => onChange("image")}
        role="tab"
        title="图像模式"
        type="button"
      >
        <ImageIcon size={14} />
        <span className={value === "image" ? undefined : "hidden"}>图像</span>
      </button>
    </div>
  );
}

function ComposerInlineTokens({
  forcedSkill,
  nodes,
  onClearForcedSkill,
  referenceNodeIdSet,
}: {
  forcedSkill: AgentSkillDefinitionSummary | null;
  nodes: AgentCanvasNode[];
  onClearForcedSkill: () => void;
  referenceNodeIdSet: Set<string>;
}) {
  if (!forcedSkill && !nodes.length) {
    return null;
  }

  const visibleNodes = nodes.slice(0, 4);
  const hiddenCount = nodes.length - visibleNodes.length;

  return (
    <div aria-label="输入上下文" className="flex max-w-full flex-wrap gap-1.5 px-3.5 pb-1">
      {forcedSkill ? (
        <span
          className={cn(
            COMPOSER_TOKEN_CLASS,
            "border-cuc-primary-border bg-[#edfff1] text-cuc-accent-foreground"
          )}
          title={`强制使用 ${forcedSkill.name}`}
        >
          <span className={cn(COMPOSER_TOKEN_KIND_CLASS, "text-cuc-primary-strong")}>技能</span>
          <span className={COMPOSER_TOKEN_LABEL_CLASS}>{forcedSkill.name}</span>
          <button
            aria-label={`移除技能 ${forcedSkill.name}`}
            className="grid size-4 min-w-4 cursor-pointer place-items-center rounded-cuc-pill border-0 bg-cuc-primary-surface p-0 text-cuc-primary-strong hover:bg-cuc-primary-surface-hover"
            onClick={onClearForcedSkill}
            title="移除技能"
            type="button"
          >
            <X size={12} />
          </button>
        </span>
      ) : null}
      {visibleNodes.map((node) => {
        const referenceable = referenceNodeIdSet.has(node.id);
        const label = getCanvasNodeTokenLabel(node);
        return (
          <span
            className={cn(
              COMPOSER_TOKEN_CLASS,
              !referenceable && "text-cuc-text-soft"
            )}
            data-referenceable={referenceable}
            key={node.id}
            title={referenceable ? label : `${label} · 未引用`}
          >
            <span className={COMPOSER_TOKEN_KIND_CLASS}>
              {getCanvasNodeKindLabel(node)}
            </span>
            <span className={COMPOSER_TOKEN_LABEL_CLASS}>{label}</span>
          </span>
        );
      })}
      {hiddenCount > 0 ? (
        <span className={cn(COMPOSER_TOKEN_CLASS, "flex-none")}>
          +{hiddenCount}
        </span>
      ) : null}
    </div>
  );
}

function ComposerSkillMenu({
  error,
  loading,
  open,
  query,
  skills,
  onSelect,
}: {
  error: string | null;
  loading: boolean;
  open: boolean;
  query: string;
  skills: AgentSkillDefinitionSummary[];
  onSelect: (skill: AgentSkillDefinitionSummary) => void;
}) {
  const visibleSkills = useMemo(
    () => filterComposerSkills(skills, query).slice(0, 8),
    [query, skills]
  );

  if (!open) {
    return null;
  }

  return (
    <div className={COMPOSER_SKILL_MENU_CLASS} role="listbox">
      {loading ? (
        <div className="px-2.5 py-2.5 text-xs leading-[18px] text-cuc-text-soft">加载技能...</div>
      ) : error ? (
        <div className="px-2.5 py-2.5 text-xs leading-[18px] text-cuc-text-soft">技能加载失败</div>
      ) : visibleSkills.length ? (
        visibleSkills.map((skill) => (
          <button
            aria-selected={false}
            className={COMPOSER_SKILL_OPTION_CLASS}
            key={skill.id}
            onClick={() => onSelect(skill)}
            role="option"
            title={skill.description || skill.name}
            type="button"
          >
            <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{skill.name}</span>
            <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-cuc-text-soft">
              {[skill.agentScope, skill.purpose].filter(Boolean).join(" · ")}
            </span>
          </button>
        ))
      ) : (
        <div className="px-2.5 py-2.5 text-xs leading-[18px] text-cuc-text-soft">没有匹配技能</div>
      )}
    </div>
  );
}

function ComposerFooterStatus({
  label,
}: {
  label: string;
}) {
  return (
    <span className="inline-flex items-center">
      <span className="hidden">{label}</span>
    </span>
  );
}

function ImageProviderSelect({
  disabled,
  value,
  onChange,
}: {
  disabled: boolean;
  value: ImageProviderSelection;
  onChange: (value: ImageProviderSelection) => void;
}) {
  return (
    <Select
      disabled={disabled}
      value={value}
      onValueChange={(nextValue) =>
        onChange(readImageProviderSelection(nextValue))
      }
    >
      <SelectTrigger
        aria-label="选择生图模型"
        className={cn(
          COMPOSER_SELECT_TRIGGER_CLASS,
          "w-[132px] min-w-[132px] max-[560px]:w-[112px] max-[560px]:min-w-[112px] max-[560px]:px-2"
        )}
        title="选择生图模型"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end" className={COMPOSER_SELECT_CONTENT_CLASS}>
        <SelectItem value="byteartist">Lemo</SelectItem>
        <SelectItem value="seed5_duotu_zz">Seedream 5</SelectItem>
      </SelectContent>
    </Select>
  );
}

function ImageAspectRatioSelect({
  disabled,
  value,
  onChange,
}: {
  disabled: boolean;
  value: ImageAspectRatioSelection;
  onChange: (value: ImageAspectRatioSelection) => void;
}) {
  return (
    <Select
      disabled={disabled}
      value={value}
      onValueChange={(nextValue) =>
        onChange(readImageAspectRatioSelection(nextValue))
      }
    >
      <SelectTrigger
        aria-label="选择图像比例"
        className={cn(
          COMPOSER_SELECT_TRIGGER_CLASS,
          "w-[70px] min-w-[70px] max-[560px]:w-16 max-[560px]:min-w-16"
        )}
        title="选择图像比例"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="start" className={COMPOSER_SELECT_CONTENT_CLASS}>
        <SelectItem value="1:1">1:1</SelectItem>
        <SelectItem value="16:9">16:9</SelectItem>
        <SelectItem value="9:16">9:16</SelectItem>
        <SelectItem value="4:3">4:3</SelectItem>
        <SelectItem value="3:4">3:4</SelectItem>
      </SelectContent>
    </Select>
  );
}

function ImageResultCountSelect({
  disabled,
  value,
  onChange,
}: {
  disabled: boolean;
  value: ImageResultCountSelection;
  onChange: (value: ImageResultCountSelection) => void;
}) {
  return (
    <Select
      disabled={disabled}
      value={String(value)}
      onValueChange={(nextValue) =>
        onChange(readImageResultCountSelection(nextValue))
      }
    >
      <SelectTrigger
        aria-label="选择生成数量"
        className={cn(
          COMPOSER_SELECT_TRIGGER_CLASS,
          "w-16 min-w-16 max-[560px]:w-[58px] max-[560px]:min-w-[58px] max-[560px]:px-2"
        )}
        title="选择生成数量"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end" className={COMPOSER_SELECT_CONTENT_CLASS}>
        <SelectItem value="1">1 张</SelectItem>
        <SelectItem value="2">2 张</SelectItem>
        <SelectItem value="3">3 张</SelectItem>
        <SelectItem value="4">4 张</SelectItem>
      </SelectContent>
    </Select>
  );
}

function getCanvasNodeTokenLabel(node: AgentCanvasNode) {
  if (node.data.kind === "prompt") {
    return truncateTokenLabel(node.data.prompt || "用户输入");
  }

  if (node.data.kind === "imageResult") {
    return truncateTokenLabel(node.data.image.title ?? "生成图像");
  }

  if (node.data.kind === "stickyNote") {
    return truncateTokenLabel(node.data.text || "便签");
  }

  if (node.data.kind === "shape") {
    return truncateTokenLabel(node.data.label || "形状");
  }

  if (node.data.kind === "run") {
    return truncateTokenLabel(node.data.agentText || node.data.prompt || "Run");
  }

  if ("artifact" in node.data) {
    return truncateTokenLabel(node.data.title);
  }

  return "节点";
}

function getCanvasNodeKindLabel(node: AgentCanvasNode) {
  switch (node.data.kind) {
    case "prompt":
      return "输入";
    case "imageResult":
      return "图像";
    case "stickyNote":
      return "便签";
    case "shape":
      return "形状";
    case "run":
      return "Run";
    case "markdown":
      return "文档";
    case "webpage":
      return "网页";
    case "code":
      return "代码";
    case "toolResult":
      return "工具";
    default:
      return "素材";
  }
}

function truncateTokenLabel(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= 28) {
    return normalized;
  }
  return `${normalized.slice(0, 27)}...`;
}

function getSkillSlashQuery(value: string) {
  const match = value.match(/^\s*\/([^\s]*)/);
  return match ? match[1].toLowerCase() : null;
}

function removeLeadingSkillSlashCommand(value: string) {
  return value.replace(/^\s*\/\S*\s?/, "").trimStart();
}

function filterComposerSkills(
  skills: AgentSkillDefinitionSummary[],
  query: string
) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return skills;
  }

  return skills.filter((skill) =>
    [
      skill.name,
      skill.description,
      skill.agentScope,
      skill.purpose,
      ...skill.tags,
    ]
      .join(" ")
      .toLowerCase()
      .includes(normalizedQuery)
  );
}

function readStoredComposerMode(): ComposerMode {
  if (typeof window === "undefined") {
    return "agent";
  }
  return readComposerMode(window.localStorage.getItem(COMPOSER_MODE_STORAGE_KEY));
}

function readComposerMode(value: string | null | undefined): ComposerMode {
  return value === "image" ? "image" : "agent";
}

function readStoredImageAspectRatio(): ImageAspectRatioSelection {
  if (typeof window === "undefined") {
    return "1:1";
  }
  return readImageAspectRatioSelection(
    window.localStorage.getItem(IMAGE_ASPECT_RATIO_STORAGE_KEY)
  );
}

function readImageAspectRatioSelection(
  value: string | null | undefined
): ImageAspectRatioSelection {
  if (
    value === "16:9" ||
    value === "9:16" ||
    value === "4:3" ||
    value === "3:4"
  ) {
    return value;
  }
  return "1:1";
}

function readStoredImageResultCount(): ImageResultCountSelection {
  if (typeof window === "undefined") {
    return 1;
  }
  return readImageResultCountSelection(
    window.localStorage.getItem(IMAGE_RESULT_COUNT_STORAGE_KEY)
  );
}

function readImageResultCountSelection(
  value: string | null | undefined
): ImageResultCountSelection {
  if (value === "2") {
    return 2;
  }
  if (value === "3") {
    return 3;
  }
  if (value === "4") {
    return 4;
  }
  return 1;
}

function readStoredImageProvider(): ImageProviderSelection {
  if (typeof window === "undefined") {
    return "seed5_duotu_zz";
  }
  return readImageProviderSelection(
    window.localStorage.getItem(IMAGE_PROVIDER_STORAGE_KEY)
  );
}

function readImageProviderSelection(
  value: string | null | undefined
): ImageProviderSelection {
  if (value === "byteartist" || value === "seed5_duotu_zz") {
    return value;
  }
  return "seed5_duotu_zz";
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
  id,
  data,
  selected,
  width,
  height,
}: NodeProps<FlowNode<PromptNodeData, "promptNode">>) {
  const { onPromptTextChange, readOnly } = useContext(ManualNodeEditingContext);
  const isExpanded = typeof height === "number" && height > 96;
  const isManualPrompt = Boolean(data.manual);

  return (
    <Node
      className="h-[78px] min-h-[78px]"
      handles={{ source: true, target: true }}
      minHeight={64}
      minWidth={180}
      selected={selected}
      style={getResizableNodeStyle(width, height)}
    >
      <NodeContent
        className={cn(
          "grid h-full min-h-0 overflow-auto px-[26px] py-cuc-node-padding",
          isExpanded ? "[place-items:start_stretch]" : "place-items-center"
        )}
      >
        {isManualPrompt ? (
          <textarea
            aria-label="用户输入"
            className="nodrag nopan nowheel h-full w-full resize-none border-0 bg-transparent text-left text-cuc-ink text-cuc-node-body outline-0 [font:inherit] placeholder:text-cuc-ink/42"
            onChange={(event) => onPromptTextChange(id, event.currentTarget.value)}
            placeholder="输入需求..."
            readOnly={readOnly}
            spellCheck={false}
            value={data.prompt}
          />
        ) : (
          <p
            className="copyable-text nodrag nopan m-0 block overflow-visible whitespace-pre-wrap text-left text-cuc-ink text-cuc-node-body [overflow-wrap:anywhere]"
            title={data.contextLabel}
          >
            {data.prompt}
          </p>
        )}
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
      className={cn(
        "!h-[170px] !w-[220px] border-[rgba(217,207,116,0.48)] !bg-[#fff8b8] shadow-[0_6px_18px_rgba(111,93,18,0.07)]",
        data.color === "green" && "border-black/25 !bg-[#eaffcf]",
        data.color === "blue" && "border-[rgba(74,132,195,0.2)] !bg-[#eaf4ff]",
        data.color === "pink" && "border-[rgba(212,92,142,0.2)] !bg-[#ffeef5]"
      )}
      handles={{ source: true, target: true }}
      minHeight={120}
      minWidth={160}
      selected={selected}
      style={getResizableNodeStyle(width, height)}
    >
      <NodeContent className="h-full p-cuc-node-padding">
        <textarea
          aria-label="便签内容"
          className="nodrag nopan nowheel h-full w-full resize-none border-0 bg-transparent text-cuc-node-body text-cuc-text outline-0 [font:inherit] placeholder:text-[#111111]/42"
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
  const visualClassName = cn(
    "relative grid size-full place-items-center rounded-cuc-node border border-input bg-cuc-surface/88 shadow-cuc-card",
    data.shape === "ellipse" && "rounded-cuc-pill",
    data.shape === "pill" && "rounded-cuc-pill",
    data.shape === "diamond" &&
      "rounded-none [clip-path:polygon(50%_0,100%_50%,50%_100%,0_50%)]",
    data.shape === "triangle" &&
      "rounded-none [clip-path:polygon(50%_0,100%_100%,0_100%)]",
    data.shape === "frame" &&
      "border-[1.5px] border-dashed border-cuc-border-dashed bg-cuc-surface/42"
  );

  return (
    <Node
      className="!h-[140px] !w-[200px] !border-0 !bg-transparent !shadow-none"
      handles={{ source: true, target: true }}
      minHeight={72}
      minWidth={96}
      selected={selected}
      style={getResizableNodeStyle(width, height)}
    >
      <NodeContent className="grid size-full place-items-stretch p-0">
        <div className={visualClassName}>
          <input
            aria-label="形状标签"
            className="nodrag nopan w-[min(80%,140px)] border-0 bg-transparent text-center text-cuc-node-title text-cuc-text outline-0 [font:inherit]"
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

type ArtifactFrameProps = {
  children: ReactNode;
  className: string;
  copyText?: string;
  data: ArtifactLikeNodeData;
  downloadText?: string;
  downloadUrl?: string;
};

function ArtifactFrame({
  children,
  className,
  copyText,
  data,
  downloadText,
  downloadUrl,
}: ArtifactFrameProps) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const copyResetTimer = useRef<number | undefined>(undefined);
  const displayName = getArtifactDisplayName(data);
  const canCopy = Boolean(copyText?.trim());
  const canDownload = Boolean(downloadUrl || downloadText?.trim());

  useEffect(
    () => () => {
      if (copyResetTimer.current) {
        window.clearTimeout(copyResetTimer.current);
      }
    },
    []
  );

  const scheduleCopyReset = useCallback((state: "copied" | "error") => {
    setCopyState(state);
    if (copyResetTimer.current) {
      window.clearTimeout(copyResetTimer.current);
    }
    copyResetTimer.current = window.setTimeout(() => setCopyState("idle"), 1200);
  }, []);

  const handleCopy = useCallback(async () => {
    if (!copyText?.trim()) {
      return;
    }
    try {
      await copyTextToClipboard(copyText);
      scheduleCopyReset("copied");
    } catch {
      scheduleCopyReset("error");
    }
  }, [copyText, scheduleCopyReset]);

  const handleDownload = useCallback(() => {
    if (downloadUrl) {
      downloadArtifactAsset(downloadUrl, data);
      return;
    }
    if (downloadText?.trim()) {
      downloadTextArtifact(downloadText, data);
    }
  }, [data, downloadText, downloadUrl]);

  return (
    <NodeContent className="artifact-frame p-0">
      <div className="artifact-frame-header">
        <span
          className="artifact-frame-title copyable-text nodrag nopan"
          title={displayName}
        >
          {displayName}
        </span>
        <div className="artifact-frame-actions nodrag nopan">
          <button
            aria-label="复制产物内容"
            disabled={!canCopy}
            onClick={(event) => {
              if (event.detail === 0) {
                void handleCopy();
              }
              event.stopPropagation();
            }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void handleCopy();
            }}
            title={copyState === "error" ? "复制失败" : "复制"}
            type="button"
          >
            {copyState === "copied" ? <Check size={13} /> : <Copy size={13} />}
          </button>
          <button
            aria-label="下载产物"
            disabled={!canDownload}
            onClick={(event) => {
              if (event.detail === 0) {
                handleDownload();
              }
              event.stopPropagation();
            }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              handleDownload();
            }}
            title="下载"
            type="button"
          >
            <Download size={13} />
          </button>
        </div>
      </div>
      <div className={className}>{children}</div>
      {data.upload && (
        <span className={`upload-state artifact-frame-upload ${data.upload.status}`}>
          {data.upload.status === "error" ? "上传失败" : "上传中"}
        </span>
      )}
    </NodeContent>
  );
}

function ArtifactLikeNode({ data, selected, width, height }: ArtifactLikeNodeProps) {
  const label = getArtifactNodeLabel(data);
  const metaLine = getArtifactMetaLine(data);
  const contentUrl = getArtifactContentUrl(data.artifact);
  const inlinePreview = getInlineArtifactPreview(data);
  const loadedCardPreview = useTextArtifactContent(
    contentUrl,
    shouldLoadArtifactCardPreview(data, inlinePreview, contentUrl),
    4_000
  );
  const loadedCardText =
    loadedCardPreview && loadedCardPreview.url === contentUrl
      ? loadedCardPreview.text
      : null;
  const summary = getArtifactNodeSummary(data, loadedCardText ?? undefined);
  const canPreview = Boolean(inlinePreview || loadedCardText || contentUrl);
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
            ? `selected artifact-card ${data.kind}`
            : `artifact-card ${data.kind}`
        }
        handles={{ source: true, target: true }}
        minHeight={160}
        minWidth={180}
        selected={selected}
        style={getResizableNodeStyle(width, height)}
      >
        <ArtifactFrame
          className="artifact-content"
          copyText={inlinePreview ?? loadedCardText ?? summary}
          data={data}
          downloadText={inlinePreview ?? loadedCardText ?? summary}
          downloadUrl={contentUrl}
        >
          <div className="artifact-heading">
            <span className="artifact-icon">
              <ArtifactNodeIcon kind={data.kind} />
            </span>
            <span className="copyable-text nodrag nopan">{label}</span>
          </div>
          {summary && (
            <p className="artifact-body-text copyable-text nodrag nopan" title={summary}>
              {summary}
            </p>
          )}
          {metaLine && (
            <small className="artifact-meta copyable-text nodrag nopan">
              {metaLine}
            </small>
          )}
        </ArtifactFrame>
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
  const inlinePreview =
    data.kind === "code"
      ? data.code ?? getInlineArtifactPreview(data)
      : getInlineArtifactPreview(data);
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
          {previewText &&
            data.kind === "code" &&
            codeLanguage === "html" && (
              <HtmlSourcePreview
                className="artifact-preview-html"
                defaultMode="preview"
                filename={data.title}
                html={previewText}
                showLineNumbers
                sourceLabel="html"
                title={data.title}
              />
            )}
          {previewText &&
            data.kind === "code" &&
            codeLanguage &&
            codeLanguage !== "html" && (
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
  const inlinePreview = data.code ?? getInlineArtifactPreview(data);
  const [isPreviewOpen, setPreviewOpen] = useState(false);
  const metaLine = getArtifactMetaLine(data);
  const language = getCodeBlockLanguage(data);
  const isHtmlCode = language === "html";
  const loadedCode = useTextArtifactContent(
    contentUrl,
    isHtmlCode && !inlinePreview && Boolean(contentUrl),
    2_000_000
  );
  const fetchedCodeText =
    loadedCode && loadedCode.url === contentUrl ? loadedCode.text : null;
  const codeText = inlinePreview ?? fetchedCodeText ?? "";
  const displayCode =
    codeText ||
    (isHtmlCode && loadedCode?.status !== "error"
      ? "读取 HTML..."
      : "打开预览读取代码");
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
        className={selected ? "selected code-card" : "code-card"}
        handles={{ source: true, target: true }}
        minHeight={180}
        minWidth={180}
        selected={selected}
        style={getResizableNodeStyle(width, height)}
      >
        <ArtifactFrame
          className="code-content"
          copyText={codeText}
          data={data}
          downloadText={codeText}
          downloadUrl={contentUrl}
        >
          <div className="code-node-editor nodrag nopan nowheel">
            <CodeBlock
              className="code-node-block"
              code={displayCode}
              language={language}
              showLineNumbers
            />
          </div>
          {metaLine && (
            <small className="artifact-meta copyable-text nodrag nopan">
              {metaLine}
            </small>
          )}
        </ArtifactFrame>
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
  const contentUrl = getArtifactContentUrl(data.artifact);
  const inlineHtml = data.html?.trim() ? data.html : "";
  const loadedHtml = useTextArtifactContent(
    contentUrl,
    !inlineHtml && Boolean(contentUrl),
    2_000_000
  );
  const htmlText =
    inlineHtml ||
    (loadedHtml && loadedHtml.url === contentUrl ? loadedHtml.text ?? "" : "");
  const htmlLoadState =
    htmlText.trim().length > 0
      ? "ready"
      : loadedHtml?.status === "error"
        ? "error"
        : contentUrl
          ? "loading"
          : "empty";
  const previewDisabledText =
    htmlLoadState === "loading"
      ? "读取 HTML..."
      : htmlLoadState === "error"
        ? "无法读取 HTML"
        : "暂无预览";

  return (
    <Node
      className={
        selected
          ? "selected html-page-card"
          : "html-page-card"
      }
      handles={{ source: true, target: true }}
      minHeight={180}
      minWidth={180}
      selected={selected}
      style={getResizableNodeStyle(width, height)}
    >
      <ArtifactFrame
        className="html-page-content"
        copyText={htmlText}
          data={data}
          downloadText={htmlText}
          downloadUrl={contentUrl}
        >
        <div className="html-page-frame nodrag nopan nowheel">
          {htmlText ? (
            <iframe
              referrerPolicy="no-referrer"
              sandbox="allow-forms allow-modals allow-scripts"
              srcDoc={htmlText}
              title={`${data.title} 预览`}
            />
          ) : (
            <div className="html-page-empty">{previewDisabledText}</div>
          )}
        </div>
        {selected && (
          <div className="html-page-footer">
            <span className="copyable-text nodrag nopan">
              {data.summary ?? "页面预览"}
            </span>
          </div>
        )}
      </ArtifactFrame>
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

function getArtifactNodeSummary(
  data: ArtifactLikeNodeProps["data"],
  loadedPreview?: string
) {
  if (loadedPreview?.trim()) {
    return summarizeMarkdownForCanvasNode(loadedPreview);
  }
  if (data.kind === "markdown") {
    return data.summary ?? readArtifactPreviewText(data.artifact) ?? data.content;
  }
  if (data.kind === "decision") {
    return data.decision;
  }
  if (data.kind === "memory") {
    return data.memory;
  }

  return (
    readMeaningfulSummary(data.summary, data.title) ??
    summarizeArtifactPreview(readArtifactPreviewText(data.artifact)) ??
    data.artifact.contentRef ??
    data.artifact.uri
  );
}

function getArtifactMetaLine(data: ArtifactLikeNodeProps["data"]) {
  const parts = [
    readMetadataString(data.artifact.metadata?.sourceToolName) ??
      (data.runId ? "Run" : undefined),
    formatArtifactDate(data.createdAt ?? readMetadataString(data.artifact.metadata?.createdAt)),
    formatArtifactBytes(
      readMetadataNumber(data.artifact.sizeBytes) ??
        readMetadataNumber(data.artifact.metadata?.byteSize)
    ),
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
      readArtifactPreviewText(data.artifact) ??
      data.summary
    );
  }

  return (
    readArtifactPreviewText(data.artifact) ??
    readMetadataString(data.artifact.metadata?.preview) ??
    readMetadataString(data.artifact.metadata?.text) ??
    readMetadataString(data.artifact.metadata?.content) ??
    data.summary
  );
}

function readArtifactPreviewText(
  artifact: ArtifactLikeNodeProps["data"]["artifact"]
) {
  return (
    readMetadataString(artifact.preview) ??
    readMetadataString(artifact.metadata?.preview) ??
    readMetadataString(artifact.metadata?.markdown) ??
    readMetadataString(artifact.metadata?.text) ??
    readMetadataString(artifact.metadata?.content) ??
    readMetadataString(artifact.summary)
  );
}

function readMeaningfulSummary(
  summary: string | undefined,
  title: string | undefined
) {
  const normalized = summary?.trim();
  if (!normalized || normalized === title?.trim()) {
    return undefined;
  }
  return normalized;
}

function summarizeArtifactPreview(preview: string | undefined) {
  return preview?.trim() ? summarizeMarkdownForCanvasNode(preview) : undefined;
}

function shouldLoadArtifactCardPreview(
  data: ArtifactLikeNodeProps["data"],
  inlinePreview: string | undefined,
  contentUrl: string | undefined
) {
  if (!contentUrl || !isTextualArtifact(data)) {
    return false;
  }
  if (data.kind !== "document" && data.kind !== "toolResult") {
    return false;
  }

  const normalizedPreview = inlinePreview?.trim();
  return !normalizedPreview || normalizedPreview === data.title.trim();
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
        if (contentType.includes("application/json")) {
          const payload = await response.json();
          if (!ignore) {
            setLoadedPreview({
              status: "ready",
              text: readArtifactContentTextPayload(payload)?.slice(0, maxLength) ?? null,
              url: contentUrl,
            });
          }
          return;
        }
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
  const mimeType = readArtifactMimeType(data.artifact);
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
  const mimeType = readArtifactMimeType(data.artifact);
  return (
    data.kind === "code" ||
    data.kind === "document" ||
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

function readArtifactContentTextPayload(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  const content = (payload as { content?: Record<string, unknown> }).content;
  if (!content) {
    return undefined;
  }
  if (typeof content.contentText === "string") {
    return content.contentText;
  }
  if (typeof content.plainText === "string") {
    return content.plainText;
  }
  const contentJson = content.contentJson;
  if (contentJson && typeof contentJson === "object") {
    const markdown = (contentJson as { markdown?: unknown }).markdown;
    if (typeof markdown === "string") {
      return markdown;
    }
  }
  return undefined;
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

function downloadTextArtifact(text: string, data: ArtifactLikeNodeProps["data"]) {
  const blob = new Blob([text], { type: getArtifactDownloadMimeType(data) });
  const url = URL.createObjectURL(blob);
  triggerImageDownload(url, getArtifactDownloadName(data));
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
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

function getArtifactDisplayName(data: ArtifactLikeNodeProps["data"]) {
  const extension = getArtifactDownloadExtension(data);
  const title = data.title.trim() || data.artifact.title?.trim() || data.artifact.id;
  return title.toLowerCase().endsWith(`.${extension.toLowerCase()}`)
    ? title
    : `${title}.${extension}`;
}

function getArtifactDownloadMimeType(data: ArtifactLikeNodeProps["data"]) {
  if (data.kind === "markdown") {
    return "text/markdown;charset=utf-8";
  }
  if (data.kind === "webpage") {
    return "text/html;charset=utf-8";
  }
  if (data.kind === "code") {
    return `${readArtifactMimeType(data.artifact) ?? "text/plain"};charset=utf-8`;
  }
  return `${readArtifactMimeType(data.artifact) ?? "text/plain"};charset=utf-8`;
}

const CODE_LANGUAGE_EXTENSIONS: Record<string, string> = {
  javascript: "js",
  markdown: "md",
  python: "py",
  shellscript: "sh",
  text: "txt",
  typescript: "ts",
};

function getArtifactDownloadExtension(data: ArtifactLikeNodeProps["data"]) {
  const mimeType = readArtifactMimeType(data.artifact);
  if (data.kind === "code") {
    const language = getCodeBlockLanguage(data);
    return CODE_LANGUAGE_EXTENSIONS[language] ?? language;
  }
  if (data.kind === "markdown") {
    return "md";
  }
  if (data.kind === "webpage" || mimeType === "text/html") {
    return "html";
  }
  if (mimeType?.includes("markdown")) {
    return "md";
  }
  if (mimeType?.includes("json")) {
    return "json";
  }
  if (mimeType === "application/pdf") {
    return "pdf";
  }
  return "txt";
}

function readArtifactMimeType(artifact: ArtifactLikeNodeProps["data"]["artifact"]) {
  return (
    readMetadataString(artifact.mimeType) ??
    readMetadataString(artifact.metadata?.mimeType)
  )?.toLowerCase();
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
        if (contentType.includes("application/json")) {
          const payload = await response.json();
          const text = readArtifactContentTextPayload(payload);
          if (!ignore && text?.trim()) {
            setLoadedContent({ text, url: contentUrl });
          }
          return;
        }
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
  const metaLine = getArtifactMetaLine(data);

  return (
    <Node
      className={
        selected
          ? "selected markdown-card"
          : "markdown-card"
      }
      handles={{ source: true, target: true }}
      minHeight={180}
      minWidth={180}
      selected={selected}
      style={getResizableNodeStyle(width, height)}
    >
      <ArtifactFrame
        className="markdown-content"
        copyText={editorData.content}
        data={data}
        downloadText={editorData.content}
        downloadUrl={contentUrl}
      >
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
        {metaLine && (
          <small className="artifact-meta copyable-text nodrag nopan">
            {metaLine}
          </small>
        )}
      </ArtifactFrame>
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
  const { onMatting, onUpscale } = useContext(ImageNodeActionContext);
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
            aria-label="抠图图片"
            onClick={(event) => {
              stopNodeToolbarEvent(event);
              onMatting(id);
            }}
            onMouseDown={stopNodeToolbarEvent}
            onPointerDown={stopNodeToolbarEvent}
            title="抠图"
            type="button"
          >
            <EraserSparkle size={14} />
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
        className={selected ? "selected result-card" : "result-card"}
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
              {status === "loading" && (
                <LoadingIndicator ariaLabel="图片生成中" size={35} />
              )}
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
              : data.operation === "matting"
                ? data.upload.status === "error"
                  ? "抠图失败"
                  : "抠图中"
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

function createPendingMattingImageNode(
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
          operation: "matting",
        },
        title: "抠图中",
        url: "",
      },
      kind: "imageResult",
      operation: "matting",
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
  const clipboard = navigator.clipboard;
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(text);
      return;
    } catch {
      // Fall back to the legacy copy path below.
    }
  }

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

function hasUploadingLocalNode(node: AgentCanvasNode) {
  return (
    "upload" in node.data &&
    Boolean(node.data.upload) &&
    node.data.upload?.status === "uploading"
  );
}

function hasFailedLocalUploadNode(node: AgentCanvasNode) {
  return (
    "upload" in node.data &&
    Boolean(node.data.upload) &&
    node.data.upload?.status === "error"
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
