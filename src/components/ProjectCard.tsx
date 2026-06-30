import { AddIcon as Plus } from "@proicons/react";

import { cn } from "@/lib/utils";

export function ProjectCreateGlyph() {
  return (
    <span className="mb-0.5 grid size-cuc-tool place-items-center rounded-cuc-floating bg-cuc-node text-cuc-ink">
      <Plus size={18} />
    </span>
  );
}

export function ProjectPreview({ projectId }: { projectId: string }) {
  const tone = getProjectPreviewTone(projectId);

  return (
    <span className="relative block min-h-0 overflow-hidden rounded-cuc-canvas border-[0.5px] border-cuc-canvas-border bg-cuc-canvas">
      <span className="absolute left-[37%] top-[37%] block h-px w-[31%] origin-left rotate-[13deg] border-t border-dashed border-cuc-edge" />
      <span className="absolute left-[43%] top-[61%] block h-px w-[28%] origin-left -rotate-[18deg] border-t border-dashed border-cuc-edge" />
      <span
        className={cn(
          "absolute left-[12%] top-[18%] block h-[22%] w-[31%] rounded-cuc-control-lg border-[0.5px] border-cuc-node-border bg-cuc-node",
          tone === 3 && "bg-cuc-preview-warm"
        )}
      />
      <span
        className={cn(
          "absolute right-[10%] top-[31%] block h-[26%] w-[34%] rounded-cuc-control-lg border-[0.5px] border-cuc-node-border bg-cuc-node",
          tone === 1 && "bg-cuc-preview-green"
        )}
      />
      <span
        className={cn(
          "absolute bottom-[15%] left-[29%] block h-[24%] w-[36%] rounded-cuc-control-lg border-[0.5px] border-cuc-node-border bg-cuc-node",
          tone === 2 && "bg-cuc-preview-blue"
        )}
      />
    </span>
  );
}

function getProjectPreviewTone(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) % 4;
  }
  return hash;
}
