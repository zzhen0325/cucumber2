import {
  CancelIcon as X,
  PhotoIcon as ImageIcon,
  SparkleIcon as Sparkles,
} from "@proicons/react";
import { useMemo, type FormEvent } from "react";

import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputSelect,
  PromptInputSelectContent,
  PromptInputSelectItem,
  PromptInputSelectTrigger,
  PromptInputSelectValue,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import {
  readAgentProviderSelection,
  readImageAspectRatioSelection,
  readImageProviderSelection,
  readImageResultCountSelection,
  type AgentProviderSelection,
  type ComposerMode,
  type ImageAspectRatioSelection,
  type ImageProviderSelection,
  type ImageResultCountSelection,
} from "@/components/canvas/composer-config";
import {
  COMPOSER_AGENT_FORM_CLASS,
  COMPOSER_BODY_CLASS,
  COMPOSER_BODY_INNER_CLASS,
  COMPOSER_FOOTER_AGENT_CLASS,
  COMPOSER_FOOTER_BASE_CLASS,
  COMPOSER_FOOTER_IMAGE_CLASS,
  COMPOSER_FORM_CLASS,
  COMPOSER_HEADER_CLASS,
  COMPOSER_IMAGE_FORM_CLASS,
  COMPOSER_MODE_BUTTON_CLASS,
  COMPOSER_MODE_SWITCH_CLASS,
  COMPOSER_SELECT_CONTENT_CLASS,
  COMPOSER_SELECT_TRIGGER_CLASS,
  COMPOSER_SKILL_MENU_CLASS,
  COMPOSER_SKILL_OPTION_CLASS,
  COMPOSER_SUBMIT_BUTTON_CLASS,
  COMPOSER_TEXTAREA_BASE_CLASS,
  COMPOSER_TOKEN_CLASS,
  COMPOSER_TOKEN_KIND_CLASS,
  COMPOSER_TOKEN_LABEL_CLASS,
  COMPOSER_TOOLS_CLASS,
  COMPOSER_WRAP_CLASS,
} from "@/components/design-system/canvas-patterns";
import { cn } from "@/lib/utils";
import type { AgentSkillDefinitionSummary } from "@/lib/skill-storage";
import type { AgentCanvasNode } from "@/types/canvas";

type ComposerProps = {
  busy: boolean;
  canEdit: boolean;
  canSubmit: boolean;
  agentProvider: AgentProviderSelection;
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
  setAgentProvider: (value: AgentProviderSelection) => void;
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
};

export function Composer({
  busy,
  canEdit,
  canSubmit,
  agentProvider,
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
  setAgentProvider,
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
}: ComposerProps) {
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
          ? `${referenceNodeCount} 个引用`
          : "引用结果"
        : selectionCount > 1
          ? "选中节点不可引用"
          : contextCount > 0
            ? `上下文 ${contextCount} 项`
            : "Agent";
  const footerStatusLabel =
    hasReference && !hasMultipleReferences
      ? `上下文 ${referenceContextCount} 项`
      : footerContextLabel;
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
          composerMode === "image" && COMPOSER_IMAGE_FORM_CLASS
        )}
        data-mode={composerMode}
        data-has-tokens={hasSelectedTokens}
        onSubmit={(message, event) => onSubmit(message, event)}
      >
        <PromptInputHeader className={COMPOSER_HEADER_CLASS}>
          <div className="flex max-w-full flex-wrap items-center gap-2">
            <ComposerModeSwitch
              disabled={busy || replayActive}
              value={composerMode}
              onChange={setComposerMode}
            />
            <AgentProviderSelect
              disabled={busy || replayActive}
              value={agentProvider}
              onChange={setAgentProvider}
            />
            <ComposerInlineTokens
              forcedSkill={forcedSkill}
              nodes={selectedNodes}
              referenceNodeIdSet={referenceNodeIdSet}
              onClearForcedSkill={onClearForcedSkill}
            />
          </div>
        </PromptInputHeader>
        <PromptInputBody>
          <div className={COMPOSER_BODY_CLASS}>
            <div className={COMPOSER_BODY_INNER_CLASS}>
              <PromptInputTextarea
                className={cn(
                  COMPOSER_TEXTAREA_BASE_CLASS,
                  composerMode === "agent" && "h-[58px] min-h-[58px] max-h-28 pb-2 pt-3",
                  composerMode === "image" && "h-[84px] min-h-[84px] max-h-28 pb-2 pt-2"
                )}
                disabled={!canEdit && !busy}
                placeholder={placeholder}
                value={prompt}
                onChange={(event) => setPrompt(event.currentTarget.value)}
              />
            </div>
          </div>
        </PromptInputBody>
        <PromptInputFooter
          className={cn(
            COMPOSER_FOOTER_BASE_CLASS,
            composerMode === "agent" && COMPOSER_FOOTER_AGENT_CLASS,
            composerMode === "image" && COMPOSER_FOOTER_IMAGE_CLASS
          )}
        >
          <PromptInputTools className={COMPOSER_TOOLS_CLASS}>
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
              <ComposerFooterStatus label={footerStatusLabel} />
            )}
          </PromptInputTools>
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
          value === "agent" ? "bg-ink text-surface" : "px-0"
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
          value === "image" ? "bg-ink text-surface" : "px-0"
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
    <div aria-label="输入上下文" className="flex max-w-full flex-wrap gap-1.5">
      {forcedSkill ? (
        <span
          className={cn(
            COMPOSER_TOKEN_CLASS,
            "border-primary-border bg-skill-token-surface text-accent-foreground"
          )}
          title={`强制使用 ${forcedSkill.name}`}
        >
          <span className={cn(COMPOSER_TOKEN_KIND_CLASS, "text-primary-strong")}>技能</span>
          <span className={COMPOSER_TOKEN_LABEL_CLASS}>{forcedSkill.name}</span>
          <button
            aria-label={`移除技能 ${forcedSkill.name}`}
            className="grid size-4 min-w-4 cursor-pointer place-items-center rounded-pill border-0 bg-primary-surface p-0 text-primary-strong hover:bg-primary-surface-hover"
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
              !referenceable && "text-text-soft"
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
        <div className="px-2.5 py-2.5 text-xs leading-[18px] text-text-soft">加载技能...</div>
      ) : error ? (
        <div className="px-2.5 py-2.5 text-xs leading-[18px] text-text-soft">技能加载失败</div>
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
            <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-text-soft">
              {[skill.agentScope, skill.purpose].filter(Boolean).join(" · ")}
            </span>
          </button>
        ))
      ) : (
        <div className="px-2.5 py-2.5 text-xs leading-[18px] text-text-soft">没有匹配技能</div>
      )}
    </div>
  );
}

function ComposerFooterStatus({ label }: { label: string }) {
  return (
    <span
      className="inline-flex h-control max-w-[220px] items-center gap-1.5 rounded-control border-[0.5px] border-border bg-control-surface px-2.5 text-xs font-medium text-control-dark max-[560px]:max-w-[156px]"
      title={label}
    >
      <Sparkles size={14} />
      <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{label}</span>
    </span>
  );
}

function AgentProviderSelect({
  disabled,
  value,
  onChange,
}: {
  disabled: boolean;
  value: AgentProviderSelection;
  onChange: (value: AgentProviderSelection) => void;
}) {
  return (
    <PromptInputSelect
      disabled={disabled}
      value={value}
      onValueChange={(nextValue) =>
        onChange(readAgentProviderSelection(nextValue))
      }
    >
      <PromptInputSelectTrigger
        aria-label="选择 Agent 模型"
        className={cn(
          COMPOSER_SELECT_TRIGGER_CLASS,
          "w-[116px] min-w-[116px] max-[560px]:w-[96px] max-[560px]:min-w-[96px] max-[560px]:px-2"
        )}
        title="选择 Agent 模型"
      >
        <PromptInputSelectValue />
      </PromptInputSelectTrigger>
      <PromptInputSelectContent align="start" className={COMPOSER_SELECT_CONTENT_CLASS}>
        <PromptInputSelectItem value="auto">自动</PromptInputSelectItem>
        <PromptInputSelectItem value="super-relay">GLM 5.2</PromptInputSelectItem>
        <PromptInputSelectItem value="ark">Doubao</PromptInputSelectItem>
        <PromptInputSelectItem value="deepseek">DeepSeek</PromptInputSelectItem>
        <PromptInputSelectItem value="openai">OpenAI</PromptInputSelectItem>
      </PromptInputSelectContent>
    </PromptInputSelect>
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
    <PromptInputSelect
      disabled={disabled}
      value={value}
      onValueChange={(nextValue) =>
        onChange(readImageProviderSelection(nextValue))
      }
    >
      <PromptInputSelectTrigger
        aria-label="选择生图模型"
        className={cn(
          COMPOSER_SELECT_TRIGGER_CLASS,
          "w-[132px] min-w-[132px] max-[560px]:w-[112px] max-[560px]:min-w-[112px] max-[560px]:px-2"
        )}
        title="选择生图模型"
      >
        <PromptInputSelectValue />
      </PromptInputSelectTrigger>
      <PromptInputSelectContent align="end" className={COMPOSER_SELECT_CONTENT_CLASS}>
        <PromptInputSelectItem value="byteartist">Lemo</PromptInputSelectItem>
        <PromptInputSelectItem value="seed5_duotu_zz">Seedream 5</PromptInputSelectItem>
      </PromptInputSelectContent>
    </PromptInputSelect>
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
    <PromptInputSelect
      disabled={disabled}
      value={value}
      onValueChange={(nextValue) =>
        onChange(readImageAspectRatioSelection(nextValue))
      }
    >
      <PromptInputSelectTrigger
        aria-label="选择图像比例"
        className={cn(
          COMPOSER_SELECT_TRIGGER_CLASS,
          "w-[70px] min-w-[70px] max-[560px]:w-16 max-[560px]:min-w-16"
        )}
        title="选择图像比例"
      >
        <PromptInputSelectValue />
      </PromptInputSelectTrigger>
      <PromptInputSelectContent align="start" className={COMPOSER_SELECT_CONTENT_CLASS}>
        <PromptInputSelectItem value="1:1">1:1</PromptInputSelectItem>
        <PromptInputSelectItem value="16:9">16:9</PromptInputSelectItem>
        <PromptInputSelectItem value="9:16">9:16</PromptInputSelectItem>
        <PromptInputSelectItem value="4:3">4:3</PromptInputSelectItem>
        <PromptInputSelectItem value="3:4">3:4</PromptInputSelectItem>
      </PromptInputSelectContent>
    </PromptInputSelect>
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
    <PromptInputSelect
      disabled={disabled}
      value={String(value)}
      onValueChange={(nextValue) =>
        onChange(readImageResultCountSelection(nextValue))
      }
    >
      <PromptInputSelectTrigger
        aria-label="选择生成数量"
        className={cn(
          COMPOSER_SELECT_TRIGGER_CLASS,
          "w-16 min-w-16 max-[560px]:w-[58px] max-[560px]:min-w-[58px] max-[560px]:px-2"
        )}
        title="选择生成数量"
      >
        <PromptInputSelectValue />
      </PromptInputSelectTrigger>
      <PromptInputSelectContent align="end" className={COMPOSER_SELECT_CONTENT_CLASS}>
        <PromptInputSelectItem value="1">1 张</PromptInputSelectItem>
        <PromptInputSelectItem value="2">2 张</PromptInputSelectItem>
        <PromptInputSelectItem value="3">3 张</PromptInputSelectItem>
        <PromptInputSelectItem value="4">4 张</PromptInputSelectItem>
      </PromptInputSelectContent>
    </PromptInputSelect>
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
