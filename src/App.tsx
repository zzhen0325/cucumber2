import {
  Controls,
  MiniMap,
  useEdgesState,
  useNodesState,
  type Node as FlowNode,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import {
  ArrowUpRight,
  Box,
  Check,
  CircleAlert,
  CircleDot,
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
import {
  Node,
  NodeAction,
  NodeContent,
  NodeDescription,
  NodeHeader,
  NodeTitle,
} from "@/components/ai-elements/node";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  createImageResultNodes,
  createRunDraft,
  extractImagesFromToolOutput,
  isImageResultNode,
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

import "./App.css";

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

function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState<AgentCanvasNode>(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<AgentCanvasEdge>(initialEdges);
  const [prompt, setPrompt] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [contextCount, setContextCount] = useState(0);
  const activeRunId = useRef<string | null>(null);

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
  const selectedIsResult = isImageResultNode(selectedNode);
  const isBusy = status === "submitted" || status === "streaming";

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

      const anchorId = selectedIsResult ? selectedNodeId : null;
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
      nodes,
      prompt,
      selectedIsResult,
      selectedNodeId,
      sendMessage,
      setEdges,
      setNodes,
    ]
  );

  return (
    <TooltipProvider>
      <main className="app-shell">
        <Canvas<AgentCanvasNode, AgentCanvasEdge>
          className="agent-canvas"
          colorMode="light"
          edgeTypes={edgeTypes}
          fitViewOptions={{ maxZoom: 1, padding: 0.28 }}
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
          <Controls position="bottom-right" showInteractive={false} />
          <MiniMap
            pannable
            zoomable
            position="top-right"
            className="canvas-minimap"
          />
        </Canvas>

        <TopBar />
        <ToolRail />
        <ViewportControls />
        <EmptyState visible={!nodes.length} />

        <Composer
          busy={isBusy}
          contextCount={contextCount}
          prompt={prompt}
          selectedIsResult={selectedIsResult}
          selectedNode={selectedNode}
          setPrompt={setPrompt}
          stop={stop}
          onSubmit={handleSubmit}
        />
      </main>
    </TooltipProvider>
  );
}

function TopBar() {
  return (
    <div className="top-bar">
      <div className="brand-mark">
        <Sparkles size={17} />
      </div>
      <span>Untitled</span>
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
  contextCount,
  prompt,
  selectedIsResult,
  selectedNode,
  setPrompt,
  stop,
  onSubmit,
}: {
  busy: boolean;
  contextCount: number;
  prompt: string;
  selectedIsResult: boolean;
  selectedNode?: AgentCanvasNode;
  setPrompt: (value: string) => void;
  stop: () => void;
  onSubmit: (event?: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="composer-wrap">
      <div className="context-pill" data-active={selectedIsResult}>
        {selectedIsResult
          ? `引用结果: ${selectedNode?.data.kind === "imageResult" ? selectedNode.data.image.title ?? selectedNode.data.image.id : ""}`
          : "未选择结果节点"}
      </div>
      <PromptInput
        className="composer"
        onSubmit={(_, event) => onSubmit(event)}
      >
        <PromptInputBody>
          <PromptInputTextarea
            placeholder={
              selectedIsResult
                ? "基于选中结果继续修改..."
                : "输入需求，让 Agent 生成图片..."
            }
            value={prompt}
            onChange={(event) => setPrompt(event.currentTarget.value)}
          />
        </PromptInputBody>
        <PromptInputFooter className="composer-footer">
          <span>{selectedIsResult ? "上游上下文会随请求发送" : `${contextCount} upstream items`}</span>
          <PromptInputSubmit
            disabled={!prompt.trim()}
            onStop={stop}
            status={busy ? "streaming" : "ready"}
          />
        </PromptInputFooter>
      </PromptInput>
    </div>
  );
}

function PromptNode({
  data,
  selected,
}: NodeProps<FlowNode<PromptNodeData, "promptNode">>) {
  return (
    <Node className={selected ? "canvas-node selected prompt-card" : "canvas-node prompt-card"} handles={{ source: true, target: true }}>
      <NodeHeader>
        <NodeTitle>需求</NodeTitle>
        <NodeDescription>{data.contextLabel}</NodeDescription>
      </NodeHeader>
      <NodeContent>
        <p>{data.prompt}</p>
      </NodeContent>
    </Node>
  );
}

function RunNode({
  data,
  selected,
}: NodeProps<FlowNode<RunNodeData, "runNode">>) {
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

  return (
    <Node className={selected ? "canvas-node selected run-card" : "canvas-node run-card"} handles={{ source: true, target: true }}>
      <NodeHeader>
        <NodeTitle>Agent Run</NodeTitle>
        <NodeAction>
          <span className={`run-status ${data.status}`}>
            {statusIcon}
            {data.status}
          </span>
        </NodeAction>
      </NodeHeader>
      <NodeContent className="run-content">
        <div className="run-summary">
          <span>Thinking...</span>
          <small>{data.error ?? "generate_image"}</small>
        </div>
        <Tool className="run-tool" defaultOpen={data.status === "error"}>
          <ToolHeader
            title="generate_image"
            type={toolPart.type}
            state={toolPart.state}
          />
          <ToolContent>
            <ToolInput input={toolPart.input} />
            <ToolOutput
              output={toolPart.output}
              errorText={toolPart.errorText}
            />
          </ToolContent>
        </Tool>
      </NodeContent>
    </Node>
  );
}

function ImageResultNode({
  data,
  selected,
}: NodeProps<FlowNode<ImageResultNodeData, "imageResultNode">>) {
  return (
    <Node className={selected ? "canvas-node selected result-card" : "canvas-node result-card"} handles={{ source: true, target: true }}>
      <div className="result-image-frame">
        <img src={data.image.url} alt={data.image.title ?? "Generated result"} />
      </div>
      <NodeFooterLike image={data.image} />
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

export default App;
