export const CRAFT_HTML_FORMAT = "craft-html-v1";
export const CRAFT_HTML_RENDERER_VERSION = 1;

type SerializedCraftNode = {
  custom?: Record<string, unknown>;
  displayName?: string;
  hidden?: boolean;
  isCanvas?: boolean;
  linkedNodes?: Record<string, string>;
  nodes?: string[];
  parent?: string | null;
  props?: Record<string, unknown>;
  type?: string | { resolvedName?: string };
};

type SerializedCraftNodes = Record<string, SerializedCraftNode>;
type CraftImportState = {
  nextId: number;
  nodes: SerializedCraftNodes;
};

export type CraftHtmlContentJson = {
  craftState: string;
  format: typeof CRAFT_HTML_FORMAT;
  rendererVersion: number;
};

export function createCraftHtmlContentJson(
  craftState: string
): CraftHtmlContentJson {
  return {
    craftState,
    format: CRAFT_HTML_FORMAT,
    rendererVersion: CRAFT_HTML_RENDERER_VERSION,
  };
}

export function readCraftHtmlState(contentJson: unknown) {
  if (!contentJson || typeof contentJson !== "object") {
    return undefined;
  }

  const value = contentJson as {
    craftState?: unknown;
    format?: unknown;
  };
  if (
    value.format !== CRAFT_HTML_FORMAT ||
    typeof value.craftState !== "string" ||
    !value.craftState.trim()
  ) {
    return undefined;
  }

  return value.craftState;
}

export function readCraftHtmlStateFromArtifactPayload(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  const content = (payload as { content?: { contentJson?: unknown } }).content;
  return readCraftHtmlState(content?.contentJson);
}

export function renderCraftHtml({
  craftState,
  fallbackHtml,
  title,
}: {
  craftState: string;
  fallbackHtml?: string;
  title: string;
}) {
  const nodes = parseCraftNodes(craftState);
  const body = nodes ? renderCraftBody(nodes) : fallbackHtml?.trim();
  const safeTitle = escapeHtml(title.trim() || "HTML Page");

  return [
    "<!doctype html>",
    '<html lang="zh-CN">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${safeTitle}</title>`,
    "<style>",
    getCraftHtmlBaseCss(),
    "</style>",
    "</head>",
    "<body>",
    body?.trim() || renderEmptyPage(),
    "</body>",
    "</html>",
  ].join("\n");
}

export function summarizeHtmlForCanvas(html: string, fallbackTitle = "HTML page") {
  const text = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

  return text.slice(0, 160) || fallbackTitle || "HTML page";
}

export function toEditableHtmlFragment(html: string) {
  const trimmed = html.trim();
  if (!trimmed) {
    return "";
  }

  const headStyles = [...trimmed.matchAll(/<style\b[^>]*>[\s\S]*?<\/style>/gi)]
    .map((match) => match[0])
    .join("\n");
  const bodyMatch = trimmed.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch?.[1]) {
    return [headStyles, bodyMatch[1].trim()].filter(Boolean).join("\n");
  }

  return trimmed;
}

export function createCraftHtmlStateFromHtml(html: string, title = "HTML Page") {
  const fragment = toEditableHtmlFragment(html);
  const state: CraftImportState = {
    nextId: 1,
    nodes: {
      ROOT: createSerializedCraftNode({
        displayName: "Page",
        isCanvas: true,
        parent: null,
        props: {
          background: "#f7f8f2",
          color: "#111827",
          maxWidth: "1120px",
          padding: "48px 24px",
        },
        type: "CraftPage",
      }),
    },
  };

  const root = state.nodes.ROOT;
  if (!fragment) {
    root.nodes = [
      addSerializedCraftNode(state, {
        displayName: "Text",
        parent: "ROOT",
        props: {
          align: "center",
          size: "44px",
          tag: "h1",
          text: title || "HTML Page",
          weight: "700",
        },
        type: "CraftText",
      }),
    ];
    return JSON.stringify(state.nodes);
  }

  if (typeof DOMParser === "undefined") {
    root.nodes = [addRawHtmlNode(state, "ROOT", fragment)];
    return JSON.stringify(state.nodes);
  }

  try {
    const document = new DOMParser().parseFromString(html, "text/html");
    const childIds = convertHtmlChildNodes(
      [...document.body.childNodes],
      "ROOT",
      state
    );
    root.nodes = childIds.length ? childIds : [addRawHtmlNode(state, "ROOT", fragment)];
  } catch {
    root.nodes = [addRawHtmlNode(state, "ROOT", fragment)];
  }

  return JSON.stringify(state.nodes);
}

function parseCraftNodes(craftState: string): SerializedCraftNodes | null {
  try {
    const parsed = JSON.parse(craftState) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as SerializedCraftNodes;
  } catch {
    return null;
  }
}

function convertHtmlChildNodes(
  childNodes: ChildNode[],
  parent: string,
  state: CraftImportState
) {
  return childNodes
    .map((childNode) => convertHtmlNode(childNode, parent, state))
    .filter((nodeId): nodeId is string => Boolean(nodeId));
}

function convertHtmlNode(
  childNode: ChildNode,
  parent: string,
  state: CraftImportState
): string | null {
  if (childNode.nodeType === 3) {
    const text = normalizeHtmlText(childNode.textContent);
    return text ? addTextNode(state, parent, { text }) : null;
  }

  if (childNode.nodeType !== 1) {
    return null;
  }

  const element = childNode as Element;
  const tag = element.tagName.toLowerCase();
  if (["script", "meta", "link", "title", "template"].includes(tag)) {
    return null;
  }
  if (tag === "style") {
    return addRawHtmlNode(state, parent, element.outerHTML);
  }
  if (tag === "br") {
    return addSerializedCraftNode(state, {
      displayName: "Spacer",
      parent,
      props: { height: "12px" },
      type: "CraftSpacer",
    });
  }
  if (tag === "img") {
    return addImageNode(state, parent, element);
  }
  if (tag === "button" || tag === "a") {
    return addButtonNode(state, parent, element);
  }
  if (isTextElement(tag)) {
    const text = normalizeHtmlText(element.textContent);
    return text ? addTextNode(state, parent, readTextProps(element, tag, text)) : null;
  }
  if (tag === "hr") {
    return addSerializedCraftNode(state, {
      displayName: "Spacer",
      parent,
      props: { height: "32px" },
      type: "CraftSpacer",
    });
  }
  if (isContainerElement(tag) || hasElementChildren(element)) {
    return addContainerNode(state, parent, element, tag);
  }

  const text = normalizeHtmlText(element.textContent);
  if (text) {
    return addTextNode(state, parent, { text });
  }

  return addRawHtmlNode(state, parent, element.outerHTML);
}

function addContainerNode(
  state: CraftImportState,
  parent: string,
  element: Element,
  tag: string
) {
  const isCard = isCardLikeElement(element, tag);
  const id = addSerializedCraftNode(state, {
    displayName: isCard ? "Card" : "Section",
    isCanvas: true,
    parent,
    props: isCard ? readCardProps(element) : readSectionProps(element),
    type: isCard ? "CraftCard" : "CraftSection",
  });
  const childIds = convertHtmlChildNodes([...element.childNodes], id, state);
  if (!childIds.length) {
    const text = normalizeHtmlText(element.textContent);
    state.nodes[id].nodes = text ? [addTextNode(state, id, { text })] : [];
    return id;
  }
  state.nodes[id].nodes = childIds;
  return id;
}

function addTextNode(
  state: CraftImportState,
  parent: string,
  props: Record<string, string>
) {
  return addSerializedCraftNode(state, {
    displayName: "Text",
    parent,
    props: {
      align: "inherit",
      color: "inherit",
      lineHeight: "1.55",
      margin: "0 0 16px",
      size: "18px",
      tag: "p",
      weight: "400",
      ...props,
    },
    type: "CraftText",
  });
}

function addButtonNode(state: CraftImportState, parent: string, element: Element) {
  const label = normalizeHtmlText(element.textContent);
  if (!label) {
    return null;
  }
  return addSerializedCraftNode(state, {
    displayName: "Button",
    parent,
    props: {
      href: element.getAttribute("href") || "#",
      label,
      padding: readStyleValue(element, "padding") || "14px 20px",
      radius: readStyleValue(element, "border-radius") || "999px",
      variant: isPrimaryButtonLike(element) ? "primary" : "secondary",
    },
    type: "CraftButton",
  });
}

function addImageNode(state: CraftImportState, parent: string, element: Element) {
  const src = element.getAttribute("src");
  if (!src) {
    return null;
  }
  return addSerializedCraftNode(state, {
    displayName: "Image",
    parent,
    props: {
      alt: element.getAttribute("alt") || "",
      height:
        normalizeCssLength(element.getAttribute("height")) ||
        readStyleValue(element, "height") ||
        "auto",
      margin: readStyleValue(element, "margin") || "0 0 20px",
      radius: readStyleValue(element, "border-radius") || "16px",
      src,
      width:
        normalizeCssLength(element.getAttribute("width")) ||
        readStyleValue(element, "width") ||
        "100%",
    },
    type: "CraftImage",
  });
}

function addRawHtmlNode(state: CraftImportState, parent: string, html: string) {
  return addSerializedCraftNode(state, {
    displayName: "Raw HTML",
    parent,
    props: { html },
    type: "RawHtmlBlock",
  });
}

function addSerializedCraftNode(
  state: CraftImportState,
  input: {
    displayName: string;
    isCanvas?: boolean;
    parent: string;
    props: Record<string, unknown>;
    type: string;
  }
) {
  const id = `node-${state.nextId}`;
  state.nextId += 1;
  state.nodes[id] = createSerializedCraftNode(input);
  return id;
}

function createSerializedCraftNode(input: {
  displayName: string;
  isCanvas?: boolean;
  parent: string | null;
  props: Record<string, unknown>;
  type: string;
}): SerializedCraftNode {
  return {
    custom: {},
    displayName: input.displayName,
    hidden: false,
    isCanvas: Boolean(input.isCanvas),
    linkedNodes: {},
    nodes: [],
    parent: input.parent,
    props: input.props,
    type: { resolvedName: input.type },
  };
}

function readSectionProps(element: Element) {
  return {
    align: readTextAlign(element),
    background: readBackground(element) || "transparent",
    color: readStyleValue(element, "color") || "inherit",
    gapAfter: readStyleValue(element, "margin-bottom") || "24px",
    padding: readStyleValue(element, "padding") || "40px",
    radius: readStyleValue(element, "border-radius") || "0px",
  };
}

function readCardProps(element: Element) {
  return {
    background: readBackground(element) || "#ffffff",
    border:
      readStyleValue(element, "border") || "1px solid rgba(17, 24, 39, 0.12)",
    color: readStyleValue(element, "color") || "inherit",
    padding: readStyleValue(element, "padding") || "24px",
    radius: readStyleValue(element, "border-radius") || "18px",
  };
}

function readTextProps(element: Element, tag: string, text: string) {
  const textTag = tag === "h1" || tag === "h2" || tag === "h3" ? tag : "p";
  const defaultSize = textTag === "h1" ? "44px" : textTag === "h2" ? "32px" : "18px";
  const defaultWeight = textTag === "p" ? "400" : "700";
  return {
    align: readTextAlign(element),
    color: readStyleValue(element, "color") || "inherit",
    lineHeight: readStyleValue(element, "line-height") || "1.55",
    margin: readStyleValue(element, "margin") || "0 0 16px",
    size: readStyleValue(element, "font-size") || defaultSize,
    tag: textTag,
    text,
    weight: readStyleValue(element, "font-weight") || defaultWeight,
  };
}

function readTextAlign(element: Element) {
  const value = readStyleValue(element, "text-align");
  return value === "center" || value === "right" ? value : "left";
}

function readBackground(element: Element) {
  return (
    readStyleValue(element, "background") || readStyleValue(element, "background-color")
  );
}

function readStyleValue(element: Element, property: string) {
  if (!("style" in element)) {
    return "";
  }
  const value = (element as HTMLElement).style.getPropertyValue(property).trim();
  return value || "";
}

function normalizeCssLength(value: string | null) {
  if (!value) {
    return "";
  }
  return /^\d+(\.\d+)?$/.test(value) ? `${value}px` : value;
}

function normalizeHtmlText(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function hasElementChildren(element: Element) {
  return [...element.children].some((child) => {
    const tag = child.tagName.toLowerCase();
    return !["br", "wbr"].includes(tag);
  });
}

function isTextElement(tag: string) {
  return ["h1", "h2", "h3", "p", "span", "strong", "em", "small", "li"].includes(
    tag
  );
}

function isContainerElement(tag: string) {
  return [
    "article",
    "aside",
    "div",
    "footer",
    "header",
    "main",
    "nav",
    "ol",
    "section",
    "ul",
  ].includes(tag);
}

function isCardLikeElement(element: Element, tag: string) {
  const className = element.getAttribute("class") ?? "";
  return tag === "article" || /\b(card|panel|tile|box)\b/i.test(className);
}

function isPrimaryButtonLike(element: Element) {
  const className = element.getAttribute("class") ?? "";
  const role = element.getAttribute("role") ?? "";
  const background = readBackground(element);
  return /\b(primary|cta|button|btn)\b/i.test(className) || role === "button" || Boolean(background);
}

function renderCraftBody(nodes: SerializedCraftNodes) {
  const rootId = nodes.ROOT ? "ROOT" : Object.keys(nodes)[0];
  if (!rootId) {
    return "";
  }
  return renderCraftNode(nodes, rootId);
}

function renderCraftNode(nodes: SerializedCraftNodes, nodeId: string): string {
  const node = nodes[nodeId];
  if (!node || node.hidden) {
    return "";
  }

  const props = node.props ?? {};
  const children = (node.nodes ?? [])
    .map((childId) => renderCraftNode(nodes, childId))
    .join("\n");
  const nodeName = getCraftNodeName(node);

  switch (nodeName) {
    case "CraftPage":
      return renderPage(props, children);
    case "CraftSection":
      return renderSection(props, children);
    case "CraftCard":
      return renderCard(props, children);
    case "CraftText":
      return renderText(props);
    case "CraftImage":
      return renderImage(props);
    case "CraftButton":
      return renderButton(props);
    case "CraftSpacer":
      return renderSpacer(props);
    case "RawHtmlBlock":
      return getString(props.html) ?? "";
    default:
      return children;
  }
}

function renderPage(props: Record<string, unknown>, children: string) {
  const style = styleAttribute({
    background: getString(props.background) || "#ffffff",
    color: getString(props.color) || "#111111",
    "font-family":
      "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
    "min-height": "100vh",
    padding: getString(props.padding) || "48px 24px",
  });
  const innerStyle = styleAttribute({
    margin: "0 auto",
    "max-width": getString(props.maxWidth) || "1120px",
  });
  return `<main${style}><div${innerStyle}>${children}</div></main>`;
}

function renderSection(props: Record<string, unknown>, children: string) {
  const style = styleAttribute({
    background: getString(props.background) || "transparent",
    "border-radius": getString(props.radius) || "0px",
    color: getString(props.color) || "inherit",
    "margin-bottom": getString(props.gapAfter) || "24px",
    padding: getString(props.padding) || "40px",
    "text-align": getString(props.align) || "left",
  });
  return `<section${style}>${children}</section>`;
}

function renderCard(props: Record<string, unknown>, children: string) {
  const style = styleAttribute({
    background: getString(props.background) || "#ffffff",
    border: getString(props.border) || "1px solid rgba(17, 24, 39, 0.12)",
    "border-radius": getString(props.radius) || "18px",
    padding: getString(props.padding) || "24px",
  });
  return `<div${style}>${children}</div>`;
}

function renderText(props: Record<string, unknown>) {
  const tag = getTextTag(props.tag);
  const style = styleAttribute({
    color: getString(props.color) || "inherit",
    "font-size": getString(props.size) || "18px",
    "font-weight": getString(props.weight) || "400",
    "line-height": getString(props.lineHeight) || "1.55",
    margin: getString(props.margin) || "0 0 16px",
    "text-align": getString(props.align) || "inherit",
  });
  return `<${tag}${style}>${escapeHtml(getString(props.text) || "文本")}</${tag}>`;
}

function renderImage(props: Record<string, unknown>) {
  const src = getString(props.src);
  if (!src) {
    return "";
  }

  const style = styleAttribute({
    "border-radius": getString(props.radius) || "16px",
    display: "block",
    height: getString(props.height) || "auto",
    margin: getString(props.margin) || "0 0 20px",
    "object-fit": "cover",
    width: getString(props.width) || "100%",
  });
  return `<img alt="${escapeHtmlAttribute(getString(props.alt) || "")}" src="${escapeHtmlAttribute(
    src
  )}"${style}>`;
}

function renderButton(props: Record<string, unknown>) {
  const href = getString(props.href) || "#";
  const label = getString(props.label) || "按钮";
  const variant = getString(props.variant) === "secondary" ? "secondary" : "primary";
  const style = styleAttribute({
    background: variant === "primary" ? "#1f7a4d" : "transparent",
    border:
      variant === "primary"
        ? "1px solid #1f7a4d"
        : "1px solid rgba(31, 122, 77, 0.35)",
    "border-radius": getString(props.radius) || "999px",
    color: variant === "primary" ? "#ffffff" : "#1f7a4d",
    display: "inline-flex",
    "font-weight": "600",
    "line-height": "1",
    padding: getString(props.padding) || "14px 20px",
    "text-decoration": "none",
  });
  return `<a href="${escapeHtmlAttribute(href)}"${style}>${escapeHtml(label)}</a>`;
}

function renderSpacer(props: Record<string, unknown>) {
  const style = styleAttribute({
    height: getString(props.height) || "32px",
  });
  return `<div aria-hidden="true"${style}></div>`;
}

function renderEmptyPage() {
  return '<main class="craft-page"><p>HTML page</p></main>';
}

function getCraftNodeName(node: SerializedCraftNode) {
  if (typeof node.type === "object" && typeof node.type.resolvedName === "string") {
    return node.type.resolvedName;
  }
  if (typeof node.type === "string") {
    return node.type;
  }
  return node.displayName ?? "";
}

function getTextTag(value: unknown) {
  const tag = typeof value === "string" ? value : undefined;
  return tag === "h1" || tag === "h2" || tag === "h3" || tag === "p" ? tag : "p";
}

function styleAttribute(styles: Record<string, string | undefined>) {
  const value = Object.entries(styles)
    .flatMap(([key, styleValue]) => {
      const normalized = styleValue?.trim();
      return normalized ? [`${key}:${escapeCssValue(normalized)}`] : [];
    })
    .join(";");
  return value ? ` style="${value}"` : "";
}

function getString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeHtmlAttribute(value: string) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function escapeCssValue(value: string) {
  return value.replace(/["<>]/g, "");
}

function getCraftHtmlBaseCss() {
  return [
    "*,*::before,*::after{box-sizing:border-box}",
    "html,body{margin:0;min-height:100%}",
    "body{-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}",
    "img{max-width:100%}",
  ].join("\n");
}
