export const toolIds = {
  analyzeReferenceImages: "vision.analyzeReferenceImages",
  analyzeAssets: "asset.analyzeContext",
  attachArtifact: "canvas.attachArtifact",
  createCanvasEdge: "canvas.createEdge",
  createCanvasNode: "canvas.createNode",
  writeDocument: "document.write",
  expandPrompt: "prompt.expand",
  generateImage: "seedream.generateImage",
  generatePage: "page.generate",
  readWebpage: "web.read",
  searchWeb: "web.search",
  updateCanvasNode: "canvas.updateNode",
} as const;

export const TOOL_DEFINITION_VERSION = "1.0.0";
