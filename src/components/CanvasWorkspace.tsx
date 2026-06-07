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
  Database,
  Frame,
  Image,
  Layers,
  Loader2,
  MousePointer2,
  Palette,
  PenLine,
  Plus,
  Sparkles,
  Pencil,
  Trash2,
  Type,
  Upload,
  WandSparkles,
  X,
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
  deleteSkill,
  loadSkills,
  updateSkill,
  uploadSkill,
  type SkillSummary,
} from "@/lib/skill-storage";
import {
  createImageResultNodes,
  createRunDraft,
  extractImagesFromToolOutput,
  getRunReferenceNodeId,
  textFromMessageParts,
  toolPartsFromMessageParts,
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
  const [contextCount, setContextCount] = useState(0);
  const [storageStatus, setStorageStatus] = useState<StorageStatus>("loading");
  const [storageError, setStorageError] = useState<string | null>(null);
  const [skillPanelOpen, setSkillPanelOpen] = useState(false);
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
  }, [edges, loadedProjectId, nodes, persistedSelectedNodeId, projectTitle]);

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
    const toolParts = toolPartsFromMessageParts(assistantMessage?.parts);
    const toolPart = toolParts.find((part) => part.type === "tool-generate_image")
      ?? toolParts.at(-1);
    const agentText = textFromMessageParts(assistantMessage?.parts);

    if (!toolPart) {
      if (status === "submitted" || status === "streaming") {
        updateRun(runId, { status: "running", agentText });
      }
      return;
    }

    updateRun(runId, {
      status:
        toolParts.some((part) => part.state === "output-error")
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

    const imageToolPart = toolParts.find(
      (part) =>
        part.type === "tool-generate_image" && part.state === "output-available"
    );
    if (imageToolPart) {
      const images = extractImagesFromToolOutput(imageToolPart.output);
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
        onPaneClick={() => setNodes((current) => applySelectedNodeIds(current, []))}
        selectionMode={SelectionMode.Partial}
        nodesDraggable
        nodesConnectable={false}
        panOnDrag={false}
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
      <ViewportControls
        skillPanelOpen={skillPanelOpen}
        onToggleSkills={() => setSkillPanelOpen((current) => !current)}
      />
      <SkillPanel
        open={skillPanelOpen}
        onClose={() => setSkillPanelOpen(false)}
      />
      <EmptyState visible={!nodes.length} />

      <Composer
        busy={isBusy}
        canSubmit={canSubmit}
        contextCount={contextCount}
        prompt={prompt}
        referenceNode={referenceNode}
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

function ViewportControls({
  skillPanelOpen,
  onToggleSkills,
}: {
  skillPanelOpen: boolean;
  onToggleSkills: () => void;
}) {
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

function SkillPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingSkillId, setEditingSkillId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editingDescription, setEditingDescription] = useState("");
  const [editingInstructions, setEditingInstructions] = useState("");
  const hasPromptExpand = skills.some((skill) => skill.slug === "prompt-expand");

  useEffect(() => {
    if (!open) {
      return;
    }

    let ignore = false;

    loadSkills()
      .then(({ skills: nextSkills }) => {
        if (!ignore) {
          setSkills(nextSkills);
        }
      })
      .catch((nextError: unknown) => {
        if (!ignore) {
          setError(getClientError(nextError));
        }
      })
      .finally(() => {
        if (!ignore) {
          setLoading(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [open]);

  const handleUpload = async (file: File | null) => {
    if (!file) {
      return;
    }

    setBusyAction("upload");
    setError(null);

    try {
      const { skill } = await uploadSkill(file);
      setSkills((current) => [skill, ...current]);
    } catch (nextError) {
      setError(getClientError(nextError));
    } finally {
      setBusyAction(null);
    }
  };

  const startEditing = (skill: SkillSummary) => {
    setEditingSkillId(skill.id);
    setEditingName(skill.name);
    setEditingDescription(skill.description);
    setEditingInstructions(skill.instructions);
  };

  const cancelEditing = () => {
    setEditingSkillId(null);
    setEditingName("");
    setEditingDescription("");
    setEditingInstructions("");
  };

  const handleSave = async (event: FormEvent<HTMLFormElement>, skillId: string) => {
    event.preventDefault();
    if (!editingName.trim() || !editingInstructions.trim()) {
      return;
    }

    setBusyAction(`save:${skillId}`);
    setError(null);

    try {
      const { skill } = await updateSkill({
        skillId,
        name: editingName,
        description: editingDescription,
        instructions: editingInstructions,
      });
      setSkills((current) =>
        current.map((item) => (item.id === skill.id ? skill : item))
      );
      cancelEditing();
    } catch (nextError) {
      setError(getClientError(nextError));
    } finally {
      setBusyAction(null);
    }
  };

  const handleDelete = async (skill: SkillSummary) => {
    if (!window.confirm(`删除「${skill.name}」？`)) {
      return;
    }

    setBusyAction(`delete:${skill.id}`);
    setError(null);

    try {
      await deleteSkill(skill.id);
      setSkills((current) => current.filter((item) => item.id !== skill.id));
    } catch (nextError) {
      setError(getClientError(nextError));
    } finally {
      setBusyAction(null);
    }
  };

  if (!open) {
    return null;
  }

  return (
    <aside className="skill-panel" aria-label="Skill 面板">
      <header className="skill-panel-header">
        <div>
          <strong>Skills</strong>
          <span>{hasPromptExpand ? "prompt-expand 默认启用" : "需要上传 prompt-expand"}</span>
        </div>
        <button
          aria-label="关闭 Skill 面板"
          onClick={onClose}
          title="关闭"
          type="button"
        >
          <X size={14} />
        </button>
      </header>

      <label className="skill-upload">
        <input
          accept=".zip,application/zip"
          disabled={busyAction === "upload"}
          type="file"
          onChange={(event) => {
            void handleUpload(event.currentTarget.files?.[0] ?? null);
            event.currentTarget.value = "";
          }}
        />
        {busyAction === "upload" ? <Loader2 size={14} /> : <Upload size={14} />}
        <span>上传 zip</span>
      </label>

      {error && <div className="skill-error">{error}</div>}

      <div className="skill-list">
        {loading && (
          <div className="skill-empty">
            <Loader2 size={15} />
            <span>加载中</span>
          </div>
        )}

        {!loading && !skills.length && (
          <div className="skill-empty">
            <WandSparkles size={15} />
            <span>暂无公开 skill</span>
          </div>
        )}

        {!loading &&
          skills.map((skill) => {
            const isEditing = editingSkillId === skill.id;
            const isSaving = busyAction === `save:${skill.id}`;
            const isDeleting = busyAction === `delete:${skill.id}`;

            return (
              <section className="skill-row" key={skill.id}>
                {isEditing ? (
                  <form
                    className="skill-edit-form"
                    onSubmit={(event) => handleSave(event, skill.id)}
                  >
                    <input
                      maxLength={80}
                      value={editingName}
                      onChange={(event) => setEditingName(event.currentTarget.value)}
                    />
                    <input
                      maxLength={500}
                      placeholder="描述"
                      value={editingDescription}
                      onChange={(event) =>
                        setEditingDescription(event.currentTarget.value)
                      }
                    />
                    <textarea
                      value={editingInstructions}
                      onChange={(event) =>
                        setEditingInstructions(event.currentTarget.value)
                      }
                    />
                    <div className="skill-edit-actions">
                      <button
                        aria-label="保存 skill"
                        disabled={
                          isSaving ||
                          !editingName.trim() ||
                          !editingInstructions.trim()
                        }
                        title="保存"
                        type="submit"
                      >
                        {isSaving ? <Loader2 size={14} /> : <Check size={14} />}
                      </button>
                      <button
                        aria-label="取消编辑"
                        onClick={cancelEditing}
                        title="取消"
                        type="button"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div className="skill-row-main">
                      <div>
                        <strong title={skill.name}>{skill.name}</strong>
                        {skill.slug === "prompt-expand" && <span>默认启用</span>}
                      </div>
                      <p title={skill.description || skill.instructions}>
                        {skill.description || skill.instructions}
                      </p>
                    </div>
                    <div className="skill-row-actions">
                      <button
                        aria-label="编辑 skill"
                        disabled={!skill.canEdit || isDeleting}
                        onClick={() => startEditing(skill)}
                        title={skill.canEdit ? "编辑" : "只有上传者可编辑"}
                        type="button"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        aria-label="删除 skill"
                        disabled={!skill.canEdit || isDeleting}
                        onClick={() => void handleDelete(skill)}
                        title={skill.canEdit ? "删除" : "只有上传者可删除"}
                        type="button"
                      >
                        {isDeleting ? <Loader2 size={14} /> : <Trash2 size={14} />}
                      </button>
                    </div>
                  </>
                )}
              </section>
            );
          })}
      </div>
    </aside>
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
  selectionCount,
  setPrompt,
  stop,
  onSubmit,
}: {
  busy: boolean;
  canSubmit: boolean;
  contextCount: number;
  prompt: string;
  referenceNode?: AgentCanvasNode;
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

  if (status === "success") {
    return "生成完成";
  }

  if (state === "input-available" || state === "output-available") {
    return "调用工具";
  }

  if (state === "approval-requested") {
    return "等待确认";
  }

  return "Thinking...";
}

function getToolName(toolPart: CanvasToolPart) {
  const names: Record<CanvasToolPart["type"], string> = {
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

  return getToolInputLines(toolPart.input);
}

function getToolOutputLines(toolPart: CanvasToolPart) {
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
    skillSlug?: unknown;
    resultCount?: unknown;
    upstreamContext?: unknown;
  };
  const lines: string[] = [];

  if (typeof candidate.prompt === "string" && candidate.prompt.trim()) {
    lines.push(`输入: ${candidate.prompt.trim()}`);
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
