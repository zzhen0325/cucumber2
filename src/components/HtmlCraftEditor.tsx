import {
  Editor,
  Frame,
  useEditor,
  useNode,
  type UserComponent,
} from "@craftjs/core";
import {
  AddIcon as Add,
  ButtonIcon as ButtonGlyph,
  LayoutIcon as Layout,
  PhotoIcon as Photo,
  SaveIcon as Save,
  SquareIcon as Square,
  TextIcon as Text,
} from "@proicons/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type FormEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  createCraftHtmlStateFromHtml,
  renderCraftHtml,
  summarizeHtmlForCanvas,
  toEditableHtmlFragment,
} from "@/lib/html-craft";
import { cn } from "@/lib/utils";

export type HtmlCraftEditorSavePayload = {
  craftState: string;
  html: string;
  summary: string;
};

type HtmlCraftEditorProps = {
  fallbackHtml: string;
  initialCraftState?: string;
  loading?: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (payload: HtmlCraftEditorSavePayload) => Promise<void>;
  open: boolean;
  title: string;
};

type CraftContainerProps = {
  background?: string;
  children?: ReactNode;
  color?: string;
  padding?: string;
};

type CraftPageProps = CraftContainerProps & {
  maxWidth?: string;
};

type CraftSectionProps = CraftContainerProps & {
  align?: "left" | "center" | "right";
  gapAfter?: string;
  radius?: string;
};

type CraftTextProps = {
  align?: "inherit" | "left" | "center" | "right";
  color?: string;
  lineHeight?: string;
  margin?: string;
  size?: string;
  tag?: "h1" | "h2" | "h3" | "p";
  text?: string;
  weight?: string;
};

type CraftImageProps = {
  alt?: string;
  height?: string;
  margin?: string;
  radius?: string;
  src?: string;
  width?: string;
};

type CraftButtonProps = {
  href?: string;
  label?: string;
  padding?: string;
  radius?: string;
  variant?: "primary" | "secondary";
};

type CraftCardProps = CraftContainerProps & {
  border?: string;
  radius?: string;
};

type CraftSpacerProps = {
  height?: string;
};

type RawHtmlBlockProps = {
  html?: string;
};

type CraftSelectableProps = {
  children: ReactNode;
  className?: string;
  dragEnabled?: boolean;
  style?: CSSProperties;
};

export function HtmlCraftEditor({
  fallbackHtml,
  initialCraftState,
  loading = false,
  onOpenChange,
  onSave,
  open,
  title,
}: HtmlCraftEditorProps) {
  const editableFallbackHtml = useMemo(
    () => toEditableHtmlFragment(fallbackHtml),
    [fallbackHtml]
  );
  const craftState = useMemo(
    () =>
      initialCraftState ||
      createCraftHtmlStateFromHtml(editableFallbackHtml, title || "HTML Page"),
    [editableFallbackHtml, initialCraftState, title]
  );
  const frameKey = useMemo(() => `state-${hashString(craftState)}`, [craftState]);

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="html-craft-editor-dialog nodrag nopan nowheel"
        showCloseButton={!loading}
      >
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>编辑 HTML 页面</DialogDescription>
        <Editor
          enabled={!loading}
          resolver={craftResolver}
          indicator={{ success: "rgba(31, 122, 77, 0.42)" }}
        >
          <CraftEditorBody
            craftState={craftState}
            fallbackHtml={editableFallbackHtml}
            frameKey={frameKey}
            loading={loading}
            onSave={onSave}
            title={title}
          />
        </Editor>
      </DialogContent>
    </Dialog>
  );
}

function CraftEditorBody({
  craftState,
  fallbackHtml,
  frameKey,
  loading,
  onSave,
  title,
}: {
  craftState: string;
  fallbackHtml: string;
  frameKey: string;
  loading: boolean;
  onSave: (payload: HtmlCraftEditorSavePayload) => Promise<void>;
  title: string;
}) {
  return (
    <div className="html-craft-editor-shell">
      <CraftPalette />
      <div className="html-craft-stage" aria-busy={loading}>
        {loading ? (
          <div className="html-craft-loading">读取 HTML...</div>
        ) : (
          <Frame key={frameKey} data={craftState} />
        )}
      </div>
      <div className="html-craft-side-panel">
        <CraftInspector />
        <CraftSaveControls fallbackHtml={fallbackHtml} onSave={onSave} title={title} />
      </div>
    </div>
  );
}

function CraftPalette() {
  const { actions, query, selected } = useEditor((state, editorQuery) => {
    const selectedId = editorQuery.getEvent("selected").first();
    const selectedNode = selectedId ? state.nodes[selectedId] : null;
    return {
      selected: selectedNode
        ? {
            id: selectedId,
            isCanvas: selectedNode.data.isCanvas,
          }
        : null,
    };
  });

  const addNode = useCallback(
    (element: ReactElement) => {
      const selectedCanvasAncestor =
        selected?.id && !selected.isCanvas
          ? query.node(selected.id).ancestors(true).find((id) => {
              try {
                return query.node(id).isCanvas();
              } catch {
                return false;
              }
            })
          : undefined;
      const targetId =
        selected?.id && selected.isCanvas
          ? selected.id
          : selectedCanvasAncestor ?? "ROOT";
      const tree = query.parseReactElement(element).toNodeTree();
      const node = tree.nodes[tree.rootNodeId];
      actions.add(node, targetId ?? "ROOT");
    },
    [actions, query, selected]
  );

  return (
    <aside className="html-craft-palette" aria-label="HTML 组件">
      <span className="html-craft-panel-title">组件</span>
      <PaletteButton
        icon={<Layout size={14} />}
        label="区块"
        onClick={() =>
          addNode(
            <CraftSection background="#ffffff" padding="40px" radius="20px" />
          )
        }
      />
      <PaletteButton
        icon={<Text size={14} />}
        label="文本"
        onClick={() => addNode(<CraftText text="新文本" />)}
      />
      <PaletteButton
        icon={<Photo size={14} />}
        label="图片"
        onClick={() =>
          addNode(
            <CraftImage
              alt="图片"
              src="https://images.unsplash.com/photo-1497366754035-f200968a6e72"
            />
          )
        }
      />
      <PaletteButton
        icon={<ButtonGlyph size={14} />}
        label="按钮"
        onClick={() => addNode(<CraftButton href="#" label="按钮" />)}
      />
      <PaletteButton
        icon={<Square size={14} />}
        label="卡片"
        onClick={() => addNode(<CraftCard background="#ffffff" />)}
      />
      <PaletteButton
        icon={<Add size={14} />}
        label="间距"
        onClick={() => addNode(<CraftSpacer height="40px" />)}
      />
    </aside>
  );
}

function PaletteButton({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button className="html-craft-palette-button" onClick={onClick} type="button">
      {icon}
      <span>{label}</span>
    </button>
  );
}

function CraftInspector() {
  const { actions, selected } = useEditor((state, query) => {
    const selectedId = query.getEvent("selected").first();
    const selectedNode = selectedId ? state.nodes[selectedId] : null;
    return {
      selected: selectedNode
        ? {
            id: selectedId,
            name: readCraftDisplayName(selectedNode.data.type, selectedNode.data.name),
            props: selectedNode.data.props ?? {},
          }
        : null,
    };
  });
  const selectedId = selected?.id ?? null;

  const updateProp = useCallback(
    (propName: string, value: string) => {
      if (!selectedId) {
        return;
      }
      actions.setProp(selectedId, (props: Record<string, unknown>) => {
        props[propName] = value;
      });
    },
    [actions, selectedId]
  );

  return (
    <section className="html-craft-inspector" aria-label="HTML 属性">
      <span className="html-craft-panel-title">属性</span>
      {!selected && <p className="html-craft-muted">选择画布中的元素后编辑。</p>}
      {selected && (
        <>
          <p className="html-craft-selected-name">{getFriendlyNodeName(selected.name)}</p>
          {renderInspectorFields({
            name: selected.name,
            props: selected.props,
            updateProp,
          })}
        </>
      )}
    </section>
  );
}

function CraftSaveControls({
  fallbackHtml,
  onSave,
  title,
}: {
  fallbackHtml: string;
  onSave: (payload: HtmlCraftEditorSavePayload) => Promise<void>;
  title: string;
}) {
  const { query } = useEditor();
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">(
    "idle"
  );
  const [errorText, setErrorText] = useState<string | null>(null);

  const handleSave = useCallback(async () => {
    setSaveState("saving");
    setErrorText(null);
    const craftState = query.serialize();
    const html = renderCraftHtml({ craftState, fallbackHtml, title });
    const summary = summarizeHtmlForCanvas(html, title);
    try {
      await onSave({ craftState, html, summary });
      setSaveState("saved");
    } catch (error) {
      setSaveState("error");
      setErrorText(error instanceof Error ? error.message : "HTML 保存失败");
    }
  }, [fallbackHtml, onSave, query, title]);

  return (
    <footer className="html-craft-save-panel">
      {errorText && <p className="html-craft-error">{errorText}</p>}
      {saveState === "saved" && <p className="html-craft-muted">已保存</p>}
      <Button
        className="html-craft-save-button"
        disabled={saveState === "saving"}
        onClick={() => void handleSave()}
        size="sm"
        type="button"
      >
        <Save size={14} />
        {saveState === "saving" ? "保存中" : "保存"}
      </Button>
    </footer>
  );
}

function renderInspectorFields({
  name,
  props,
  updateProp,
}: {
  name: string;
  props: Record<string, unknown>;
  updateProp: (propName: string, value: string) => void;
}) {
  if (name === "CraftText") {
    return (
      <>
        <TextareaField
          label="文字"
          value={readProp(props.text)}
          onChange={(value) => updateProp("text", value)}
        />
        <SelectField
          label="层级"
          value={readProp(props.tag) || "p"}
          options={[
            ["h1", "H1"],
            ["h2", "H2"],
            ["h3", "H3"],
            ["p", "正文"],
          ]}
          onChange={(value) => updateProp("tag", value)}
        />
        <InputField
          label="字号"
          value={readProp(props.size) || "18px"}
          onChange={(value) => updateProp("size", value)}
        />
        <InputField
          label="字重"
          value={readProp(props.weight) || "400"}
          onChange={(value) => updateProp("weight", value)}
        />
        <ColorField
          label="颜色"
          value={readProp(props.color) || "#111827"}
          onChange={(value) => updateProp("color", value)}
        />
        <SelectField
          label="对齐"
          value={readProp(props.align) || "inherit"}
          options={[
            ["inherit", "继承"],
            ["left", "左"],
            ["center", "中"],
            ["right", "右"],
          ]}
          onChange={(value) => updateProp("align", value)}
        />
      </>
    );
  }

  if (name === "CraftImage") {
    return (
      <>
        <TextareaField
          label="图片地址"
          value={readProp(props.src)}
          onChange={(value) => updateProp("src", value)}
        />
        <InputField
          label="替代文本"
          value={readProp(props.alt)}
          onChange={(value) => updateProp("alt", value)}
        />
        <InputField
          label="宽度"
          value={readProp(props.width) || "100%"}
          onChange={(value) => updateProp("width", value)}
        />
        <InputField
          label="圆角"
          value={readProp(props.radius) || "16px"}
          onChange={(value) => updateProp("radius", value)}
        />
      </>
    );
  }

  if (name === "CraftButton") {
    return (
      <>
        <InputField
          label="文案"
          value={readProp(props.label)}
          onChange={(value) => updateProp("label", value)}
        />
        <TextareaField
          label="链接"
          value={readProp(props.href)}
          onChange={(value) => updateProp("href", value)}
        />
        <SelectField
          label="样式"
          value={readProp(props.variant) || "primary"}
          options={[
            ["primary", "主按钮"],
            ["secondary", "次按钮"],
          ]}
          onChange={(value) => updateProp("variant", value)}
        />
      </>
    );
  }

  if (name === "CraftSpacer") {
    return (
      <InputField
        label="高度"
        value={readProp(props.height) || "32px"}
        onChange={(value) => updateProp("height", value)}
      />
    );
  }

  if (name === "RawHtmlBlock") {
    return (
      <TextareaField
        label="HTML"
        value={readProp(props.html)}
        onChange={(value) => updateProp("html", value)}
        rows={14}
      />
    );
  }

  return (
    <>
      <ColorField
        label="背景"
        value={readProp(props.background) || "#ffffff"}
        onChange={(value) => updateProp("background", value)}
      />
      <InputField
        label="内边距"
        value={readProp(props.padding) || "40px"}
        onChange={(value) => updateProp("padding", value)}
      />
      {"maxWidth" in props && (
        <InputField
          label="最大宽度"
          value={readProp(props.maxWidth) || "1120px"}
          onChange={(value) => updateProp("maxWidth", value)}
        />
      )}
      {"radius" in props && (
        <InputField
          label="圆角"
          value={readProp(props.radius) || "20px"}
          onChange={(value) => updateProp("radius", value)}
        />
      )}
      {"align" in props && (
        <SelectField
          label="对齐"
          value={readProp(props.align) || "left"}
          options={[
            ["left", "左"],
            ["center", "中"],
            ["right", "右"],
          ]}
          onChange={(value) => updateProp("align", value)}
        />
      )}
    </>
  );
}

function InputField({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="html-craft-field">
      <span>{label}</span>
      <Input
        className="html-craft-input"
        onChange={(event) => onChange(event.currentTarget.value)}
        value={value}
      />
    </label>
  );
}

function TextareaField({
  label,
  onChange,
  rows = 4,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  rows?: number;
  value: string;
}) {
  return (
    <label className="html-craft-field">
      <span>{label}</span>
      <Textarea
        className="html-craft-textarea"
        onChange={(event) => onChange(event.currentTarget.value)}
        rows={rows}
        value={value}
      />
    </label>
  );
}

function ColorField({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="html-craft-field">
      <span>{label}</span>
      <Input
        className="html-craft-color-input"
        onChange={(event) => onChange(event.currentTarget.value)}
        type="color"
        value={normalizeColor(value)}
      />
    </label>
  );
}

function SelectField({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options: Array<[string, string]>;
  value: string;
}) {
  return (
    <label className="html-craft-field">
      <span>{label}</span>
      <select
        className="html-craft-select"
        onChange={(event) => onChange(event.currentTarget.value)}
        value={value}
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}

const CraftPage: UserComponent<CraftPageProps> = ({
  background = "#ffffff",
  children,
  color = "#111827",
  maxWidth = "1120px",
  padding = "48px 24px",
}) => (
  <SelectableNode
    className="html-craft-page"
    style={{ background, color, padding }}
  >
    <div className="html-craft-page-inner" style={{ maxWidth }}>
      {children}
    </div>
  </SelectableNode>
);

CraftPage.craft = {
  displayName: "Page",
  isCanvas: true,
  props: {
    background: "#ffffff",
    color: "#111827",
    maxWidth: "1120px",
    padding: "48px 24px",
  },
};

const CraftSection: UserComponent<CraftSectionProps> = ({
  align = "left",
  background = "transparent",
  children,
  color = "inherit",
  gapAfter = "24px",
  padding = "40px",
  radius = "0px",
}) => (
  <SelectableNode
    className="html-craft-section"
    style={{
      background,
      borderRadius: radius,
      color,
      marginBottom: gapAfter,
      padding,
      textAlign: align,
    }}
  >
    {children}
  </SelectableNode>
);

CraftSection.craft = {
  displayName: "Section",
  isCanvas: true,
  props: {
    align: "left",
    background: "transparent",
    color: "inherit",
    gapAfter: "24px",
    padding: "40px",
    radius: "0px",
  },
};

const CraftCard: UserComponent<CraftCardProps> = ({
  background = "#ffffff",
  border = "1px solid rgba(17, 24, 39, 0.12)",
  children,
  padding = "24px",
  radius = "18px",
}) => (
  <SelectableNode
    className="html-craft-card"
    style={{ background, border, borderRadius: radius, padding }}
  >
    {children}
  </SelectableNode>
);

CraftCard.craft = {
  displayName: "Card",
  isCanvas: true,
  props: {
    background: "#ffffff",
    border: "1px solid rgba(17, 24, 39, 0.12)",
    padding: "24px",
    radius: "18px",
  },
};

const CraftText: UserComponent<CraftTextProps> = ({
  align = "inherit",
  color = "inherit",
  lineHeight = "1.55",
  margin = "0 0 16px",
  size = "18px",
  tag = "p",
  text = "文本",
  weight = "400",
}) => {
  const Tag = tag === "h1" || tag === "h2" || tag === "h3" ? tag : "p";
  return (
    <SelectableNode>
      <Tag
        className="html-craft-text"
        style={{
          color,
          fontSize: size,
          fontWeight: weight,
          lineHeight,
          margin,
          textAlign: align,
        }}
      >
        {text}
      </Tag>
    </SelectableNode>
  );
};

CraftText.craft = {
  displayName: "Text",
  props: {
    align: "inherit",
    color: "inherit",
    lineHeight: "1.55",
    margin: "0 0 16px",
    size: "18px",
    tag: "p",
    text: "文本",
    weight: "400",
  },
};

const CraftImage: UserComponent<CraftImageProps> = ({
  alt = "",
  height = "auto",
  margin = "0 0 20px",
  radius = "16px",
  src = "",
  width = "100%",
}) => (
  <SelectableNode>
    {src ? (
      <img
        alt={alt}
        className="html-craft-image"
        src={src}
        style={{
          borderRadius: radius,
          height,
          margin,
          objectFit: "cover",
          width,
        }}
      />
    ) : (
      <div className="html-craft-image-empty">图片</div>
    )}
  </SelectableNode>
);

CraftImage.craft = {
  displayName: "Image",
  props: {
    alt: "",
    height: "auto",
    margin: "0 0 20px",
    radius: "16px",
    src: "",
    width: "100%",
  },
};

const CraftButton: UserComponent<CraftButtonProps> = ({
  href = "#",
  label = "按钮",
  padding = "14px 20px",
  radius = "999px",
  variant = "primary",
}) => (
  <SelectableNode>
    <a
      className={cn("html-craft-button", `html-craft-button-${variant}`)}
      href={href}
      onClick={(event) => event.preventDefault()}
      style={{ borderRadius: radius, padding }}
    >
      {label}
    </a>
  </SelectableNode>
);

CraftButton.craft = {
  displayName: "Button",
  props: {
    href: "#",
    label: "按钮",
    padding: "14px 20px",
    radius: "999px",
    variant: "primary",
  },
};

const CraftSpacer: UserComponent<CraftSpacerProps> = ({ height = "32px" }) => (
  <SelectableNode>
    <div className="html-craft-spacer" style={{ height }} />
  </SelectableNode>
);

CraftSpacer.craft = {
  displayName: "Spacer",
  props: {
    height: "32px",
  },
};

const RawHtmlBlock: UserComponent<RawHtmlBlockProps> = ({ html = "" }) => {
  const {
    actions: { setProp },
  } = useNode();
  const latestHtmlRef = useRef(html);

  useEffect(() => {
    latestHtmlRef.current = html;
  }, [html]);

  const commitHtml = useCallback(
    (value: string) => {
      if (value === html) {
        return;
      }
      setProp((props: RawHtmlBlockProps) => {
        props.html = value;
      });
    },
    [html, setProp]
  );

  const handleInput = useCallback((event: FormEvent<HTMLDivElement>) => {
    latestHtmlRef.current = event.currentTarget.innerHTML;
  }, []);

  const handleBlur = useCallback(
    (event: FocusEvent<HTMLDivElement>) => {
      commitHtml(event.currentTarget.innerHTML);
    },
    [commitHtml]
  );

  const handleClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if ((event.target as Element | null)?.closest("a")) {
      event.preventDefault();
    }
  }, []);

  return (
    <SelectableNode className="html-craft-raw-block" dragEnabled={false}>
      <div
        className="html-craft-raw-editable"
        contentEditable
        data-placeholder="输入或粘贴 HTML"
        onBlur={handleBlur}
        onClick={handleClick}
        onInput={handleInput}
        suppressContentEditableWarning
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </SelectableNode>
  );
};

RawHtmlBlock.craft = {
  displayName: "Raw HTML",
  props: {
    html: "",
  },
};

const craftResolver = {
  CraftButton,
  CraftCard,
  CraftImage,
  CraftPage,
  CraftSection,
  CraftSpacer,
  CraftText,
  RawHtmlBlock,
};

function SelectableNode({
  children,
  className,
  dragEnabled = true,
  style,
}: CraftSelectableProps) {
  const {
    connectors: { connect, drag },
    selected,
  } = useNode((node) => ({
    selected: node.events.selected,
  }));
  const setRef = useCallback(
    (element: HTMLDivElement | null) => {
      if (element) {
        connect(dragEnabled ? drag(element) : element);
      }
    },
    [connect, drag, dragEnabled]
  );

  return (
    <div
      ref={setRef}
      className={cn("html-craft-node", selected && "is-selected", className)}
      style={style}
    >
      {children}
    </div>
  );
}

function readCraftDisplayName(type: unknown, fallback: string) {
  if (
    type &&
    typeof type === "object" &&
    typeof (type as { resolvedName?: unknown }).resolvedName === "string"
  ) {
    return (type as { resolvedName: string }).resolvedName;
  }
  if (typeof type === "string") {
    return type;
  }
  return fallback;
}

function getFriendlyNodeName(name: string) {
  const names: Record<string, string> = {
    CraftButton: "按钮",
    CraftCard: "卡片",
    CraftImage: "图片",
    CraftPage: "页面",
    CraftSection: "区块",
    CraftSpacer: "间距",
    CraftText: "文本",
    RawHtmlBlock: "Raw HTML",
  };
  return names[name] ?? name;
}

function readProp(value: unknown) {
  return typeof value === "string" ? value : "";
}

function normalizeColor(value: string) {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : "#111827";
}

function hashString(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}
