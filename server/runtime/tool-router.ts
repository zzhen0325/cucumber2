import type { PromptCanvasContext } from "../prompts.ts";
import { toolIds } from "./tools/ids.ts";

export type DeterministicToolRoute = {
  toolIds: string[];
  reason: string;
};

export function routeToolsDeterministically(
  canvasContext: PromptCanvasContext
): DeterministicToolRoute {
  const text = normalizeRouteText(canvasContext.prompt);
  const routedToolIds: string[] = [];
  const reasons: string[] = [];
  const wantsSearch = isSearchOrSourceRequest(text);
  const wantsPage = isPageRequest(text);
  const wantsImage = isImageRequest(text, canvasContext);
  const wantsDocument = isDocumentRequest(text);

  if (wantsSearch) {
    routedToolIds.push(toolIds.searchWeb, toolIds.writeDocument);
    reasons.push("web/source keywords");
  }

  if (wantsPage) {
    routedToolIds.push(toolIds.generateHtml);
    reasons.push("page/html keywords");
  }

  if (wantsImage) {
    if (hasReferenceImageContext(canvasContext)) {
      routedToolIds.push(toolIds.analyzeReferenceImages);
      reasons.push("reference image context");
    }
    routedToolIds.push(toolIds.expandPrompt, toolIds.generateImage);
    reasons.push("image generation keywords");
  }

  if (!routedToolIds.length && wantsDocument) {
    routedToolIds.push(toolIds.writeDocument);
    reasons.push("document/text keywords");
  }

  if (!routedToolIds.length) {
    routedToolIds.push(toolIds.writeDocument);
    reasons.push("default text artifact route");
  }

  return {
    toolIds: uniqueInOrder(routedToolIds),
    reason: reasons.join("; "),
  };
}

export function resolveRoutedAiSdkToolNames({
  route,
  toolNamesById,
}: {
  route: DeterministicToolRoute;
  toolNamesById: Map<string, string>;
}) {
  const missingToolIds = route.toolIds.filter(
    (toolId) => !toolNamesById.has(toolId)
  );
  if (missingToolIds.length) {
    throw new Error(
      `Deterministic tool route selected unregistered tools: ${missingToolIds.join(", ")}.`
    );
  }

  return route.toolIds.map((toolId) => toolNamesById.get(toolId) as string);
}

function normalizeRouteText(text: string) {
  return text.trim().toLowerCase();
}

function isSearchOrSourceRequest(text: string) {
  return /(查最新|最新|今天|现在|近期|实时|联网|搜索|检索|查找|调研|资料来源|资料|来源|引用|新闻|news|latest|current|recent|research|search|sources?|citations?|web research)/i.test(
    text
  );
}

function isPageRequest(text: string) {
  if (/(落地页|官网|单页|h5|html|landing\s*page|web\s*page|homepage)/i.test(text)) {
    return true;
  }

  return (
    /(网页|页面|网站|站点|website|site|\bpage\b)/i.test(text) &&
    /(生成|创建|制作|做|设计|写|搭|输出|预览|create|make|build|design|generate|write|prototype)/i.test(
      text
    )
  );
}

function isImageRequest(text: string, canvasContext: PromptCanvasContext) {
  const asksForImageArtifact =
    /(图片|图像|照片|海报|插画|一张图|出图|logo|image|picture|photo|poster|illustration|graphic)/i.test(
      text
    );
  const asksToCreateOrEdit =
    /(生成|绘制|画|做一张|创建|出图|改成|重绘|编辑|generate|create|make|draw|render|edit|modify)/i.test(
      text
    );

  if (asksForImageArtifact && asksToCreateOrEdit) {
    return true;
  }

  return (
    hasReferenceImageContext(canvasContext) &&
    /(参考|基于|继续|改|编辑|变成|重绘|reference|based on|edit|modify)/i.test(
      text
    ) &&
    asksToCreateOrEdit
  );
}

function isDocumentRequest(text: string) {
  return /(分析|总结|报告|文档|方案|规划|计划|说明|解释|比较|评估|复盘|建议|问答|回答|写|输出\s*(?:md|markdown)|analyze|analysis|summarize|summary|report|document|doc|plan|explain|compare|evaluate|write|answer)/i.test(
    text
  );
}

function hasReferenceImageContext(canvasContext: PromptCanvasContext) {
  return canvasContext.upstreamContext.some(
    (item) => item.type === "image" || item.artifact?.type === "image"
  );
}

function uniqueInOrder(values: string[]) {
  return Array.from(new Set(values));
}
