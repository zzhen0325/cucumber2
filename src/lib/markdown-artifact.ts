export function repairMarkdownBlockBoundaries(content: string) {
  const normalized = content.replace(/\r\n?/g, "\n").trim();
  if (!hasCollapsedMarkdownBlock(normalized)) {
    return normalized;
  }

  return normalized
    .replace(/([^\n])([ \t]+)(#{1,6}[ \t]+\S)/g, "$1\n\n$3")
    .replace(/(^|\n)(#{1,6}[^\n|]+?)[ \t]+(\|[^\n]+\|[^\n]*)/g, "$1$2\n\n$3")
    .replace(/([^\n])([ \t]+)(```[A-Za-z0-9_-]*)/g, "$1\n\n$3")
    .replace(/([^\n])([ \t]+)(-{3,})(?=[ \t]|$)/g, "$1\n\n$3")
    .replace(/(```[A-Za-z0-9_-]*)[ \t]+(?=\S)/g, "$1\n");
}

function hasCollapsedMarkdownBlock(content: string) {
  return (
    /[^\n][ \t]+(?:#{1,6}[ \t]+\S|```[A-Za-z0-9_-]*|-{3,}(?=[ \t]|$))/.test(
      content
    ) || /(^|\n)#{1,6}[^\n|]+?[ \t]+\|[^\n]+\|/.test(content)
  );
}
