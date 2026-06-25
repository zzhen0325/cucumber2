import {
  CodeIcon as Code2,
  ArrowDownloadIcon as Download,
  ArchiveIcon as FileArchive,
  FileTextIcon as FileText,
  PhotoIcon as ImageIcon,
  AddIcon as Plus,
  SaveIcon as Save,
  SparkleIcon as Sparkles,
  DeleteIcon as Trash2,
  ArrowUploadIcon as Upload,
} from "@proicons/react";
import { useEffect, useMemo, useRef, useState } from "react";

import { LoadingIndicator } from "@/components/LoadingIndicator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  createAgentSkill,
  deleteAgentSkill,
  downloadAgentSkillSourcePackage,
  fileToBase64,
  getAgentSkillResourceContentUrl,
  importAgentSkillZip,
  loadAgentSkill,
  loadAgentSkillResourceText,
  loadAgentSkillResources,
  loadAgentSkills,
  updateAgentSkill,
  type AgentSkillDefinition,
  type AgentSkillDefinitionSummary,
  type AgentSkillResourceSummary,
} from "@/lib/skill-storage";
import { cn, formatDate } from "@/lib/utils";

const NEW_SKILL_TEMPLATE = `---
name: canvas-helper
description: Help the Manager reason about a focused canvas workflow.
agent_scope: general
purpose: canvas
tags:
  - canvas
triggers:
  keywords:
    - canvas
  canvas_kinds:
    - prompt
bindings:
  tools:
    - propose_canvas_operations
  agents: []
---

# Canvas Helper

Follow the user's request and keep all canvas changes proposal-first.
`;

type DraftState = {
  enabled: boolean;
  skillMd: string;
};

type SkillsPageProps = {
  className?: string;
};

export function SkillsPage({ className }: SkillsPageProps) {
  const [skills, setSkills] = useState<AgentSkillDefinitionSummary[]>([]);
  const [selectedSkill, setSelectedSkill] =
    useState<AgentSkillDefinition | null>(null);
  const [draft, setDraft] = useState<DraftState>(() => createNewDraft());
  const [isNew, setIsNew] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [updatingEnabled, setUpdatingEnabled] = useState(false);
  const [importing, setImporting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [resources, setResources] = useState<AgentSkillResourceSummary[]>([]);
  const [selectedResourcePath, setSelectedResourcePath] = useState<string | null>(
    null
  );
  const [resourceContent, setResourceContent] = useState<string | null>(null);
  const [resourceLoading, setResourceLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const selectedId = selectedSkill?.id ?? null;
  const stateControlsDisabled =
    saving || updatingEnabled || importing || downloading || deleting || loading;

  async function applyLoadedSkill(skill: AgentSkillDefinition) {
    setSelectedSkill(skill);
    setDraft({
      enabled: skill.enabled,
      skillMd: skill.skillMd,
    });
    setIsNew(false);
    setResourceContent(null);

    const { resources: nextResources } = await loadAgentSkillResources(skill.id);
    setResources(nextResources);
    const nextResource =
      selectedResourcePath &&
      nextResources.find((resource) => resource.path === selectedResourcePath)
        ? nextResources.find((resource) => resource.path === selectedResourcePath) ?? null
        : nextResources[0] ?? null;
    setSelectedResourcePath(nextResource?.path ?? null);
    await loadResourcePreview(skill, nextResource);
  }

  async function loadResourcePreview(
    skill: AgentSkillDefinition,
    resource: AgentSkillResourceSummary | null
  ) {
    setResourceContent(null);
    setResourceLoading(false);
    if (!resource || !resource.readable || isImageResource(resource.path)) {
      return;
    }

    setResourceLoading(true);
    try {
      const content = await loadAgentSkillResourceText(skill.id, resource.path);
      setResourceContent(content);
    } catch (nextError) {
      setError(getClientError(nextError));
    } finally {
      setResourceLoading(false);
    }
  }

  async function refreshSkills(nextSelectedId?: string | null) {
    const { skills: nextSkills } = await loadAgentSkills();
    setSkills(nextSkills);

    if (nextSelectedId === null) {
      return null;
    }

    const targetId =
      nextSelectedId ??
      selectedId ??
      nextSkills[0]?.id;
    if (!targetId) {
      setSelectedSkill(null);
      setDraft(createNewDraft());
      setIsNew(true);
      setResources([]);
      setSelectedResourcePath(null);
      setResourceContent(null);
      return null;
    }

    const { skill } = await loadAgentSkill(targetId);
    await applyLoadedSkill(skill);
    return skill;
  }

  useEffect(() => {
    let ignore = false;

    loadAgentSkills()
      .then(async ({ skills: nextSkills }) => {
        if (ignore) {
          return;
        }

        setSkills(nextSkills);
        const targetId = nextSkills[0]?.id;
        if (!targetId) {
          setSelectedSkill(null);
          setDraft(createNewDraft());
          setIsNew(true);
          setResources([]);
          setSelectedResourcePath(null);
          setResourceContent(null);
          return;
        }

        const { skill } = await loadAgentSkill(targetId);
        if (ignore) {
          return;
        }

        setSelectedSkill(skill);
        setDraft({
          enabled: skill.enabled,
          skillMd: skill.skillMd,
        });
        setIsNew(false);

        const { resources: nextResources } = await loadAgentSkillResources(skill.id);
        if (ignore) {
          return;
        }
        const nextResource = nextResources[0] ?? null;
        setResources(nextResources);
        setSelectedResourcePath(nextResource?.path ?? null);
        setResourceContent(null);
        if (nextResource?.readable && !isImageResource(nextResource.path)) {
          setResourceLoading(true);
          try {
            const content = await loadAgentSkillResourceText(skill.id, nextResource.path);
            if (ignore) {
              return;
            }
            setResourceContent(content);
          } finally {
            if (!ignore) {
              setResourceLoading(false);
            }
          }
        }
      })
      .catch((nextError: unknown) => {
        if (ignore) {
          return;
        }
        setError(getClientError(nextError));
      })
      .finally(() => {
        if (ignore) {
          return;
        }
        setLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, []);

  const selectedSummary = useMemo(
    () => skills.find((skill) => skill.id === selectedId) ?? null,
    [selectedId, skills]
  );
  const selectedResource = useMemo(
    () => resources.find((resource) => resource.path === selectedResourcePath) ?? null,
    [resources, selectedResourcePath]
  );
  const resourceStats = useMemo(() => summarizeResources(resources), [resources]);

  async function handleSelect(skillId: string) {
    setLoading(true);
    setError(null);
    setStatus(null);
    try {
      const { skill } = await loadAgentSkill(skillId);
      await applyLoadedSkill(skill);
    } catch (nextError) {
      setError(getClientError(nextError));
    } finally {
      setLoading(false);
    }
  }

  function handleNew() {
    setSelectedSkill(null);
    setDraft(createNewDraft());
    setIsNew(true);
    setResources([]);
    setSelectedResourcePath(null);
    setResourceContent(null);
    setStatus(null);
    setError(null);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setStatus(null);

    try {
      const { skill } = isNew
        ? await createAgentSkill(draft)
        : await updateAgentSkill({
            skillId: selectedSkill?.id ?? "",
            ...draft,
          });
      await applyLoadedSkill(skill);
      await refreshSkills(skill.id);
      setStatus("已保存");
    } catch (nextError) {
      setError(getClientError(nextError));
    } finally {
      setSaving(false);
    }
  }

  async function handleEnabledChange(enabled: boolean) {
    if (isNew || !selectedSkill) {
      setDraft((current) => ({
        ...current,
        enabled,
      }));
      return;
    }

    setUpdatingEnabled(true);
    setError(null);
    setStatus(null);
    setDraft((current) => ({
      ...current,
      enabled,
    }));

    try {
      const { skill } = await updateAgentSkill({
        enabled,
        skillId: selectedSkill.id,
      });
      await refreshSkills(skill.id);
      setStatus(enabled ? "已启用" : "已停用");
    } catch (nextError) {
      setError(getClientError(nextError));
      await refreshSkills(selectedSkill.id).catch(() => null);
    } finally {
      setUpdatingEnabled(false);
    }
  }

  async function handleDelete() {
    if (!selectedSkill || isNew) {
      return;
    }

    setDeleting(true);
    setError(null);
    setStatus(null);
    try {
      await deleteAgentSkill(selectedSkill.id);
      await refreshSkills(null);
      setSelectedSkill(null);
      setDraft(createNewDraft());
      setIsNew(true);
      setResources([]);
      setSelectedResourcePath(null);
      setResourceContent(null);
      setStatus("已删除");
    } catch (nextError) {
      setError(getClientError(nextError));
    } finally {
      setDeleting(false);
    }
  }

  async function handleImport(file: File | undefined) {
    if (!file) {
      return;
    }

    setImporting(true);
    setError(null);
    setStatus(null);
    try {
      const zipBase64 = await fileToBase64(file);
      const { skill } = await importAgentSkillZip({
        enabled: true,
        fileName: file.name,
        zipBase64,
      });
      await applyLoadedSkill(skill);
      await refreshSkills(skill.id);
      setStatus("已导入");
    } catch (nextError) {
      setError(getClientError(nextError));
    } finally {
      setImporting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  async function handleResourceSelect(resource: AgentSkillResourceSummary) {
    if (!selectedSkill) {
      return;
    }

    setSelectedResourcePath(resource.path);
    await loadResourcePreview(selectedSkill, resource);
  }

  async function handleDownloadPackage() {
    if (!selectedSkill || isNew) {
      return;
    }

    setDownloading(true);
    setError(null);
    setStatus(null);
    try {
      await downloadAgentSkillSourcePackage(selectedSkill);
      setStatus("已开始下载");
    } catch (nextError) {
      setError(getClientError(nextError));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className={cn("skills-page", className)}>
      <div className="workspace-page-inner skills-shell">
        <div className="workspace-page-header">
          <div>
            <h1>技能</h1>
            <p>管理 Agent OS 全局技能</p>
          </div>

          <div className="workspace-header-actions">
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip,application/zip"
              className="hidden"
              onChange={(event) => void handleImport(event.currentTarget.files?.[0])}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="workspace-secondary-button"
              disabled={importing}
              onClick={() => fileInputRef.current?.click()}
              title="导入 Agent Skills zip，最高 100MB，支持 SKILL.md、scripts、references、assets 和其他资源"
            >
              {importing ? (
                <LoadingIndicator ariaLabel="导入中" size={16} />
              ) : (
                <Upload className="size-4" />
              )}
              导入
            </Button>
            <Button type="button" size="lg" className="workspace-primary-button" onClick={handleNew}>
              <Plus className="size-4" />
              新建
            </Button>
          </div>
        </div>

        {(error || status) && (
          <div
            className={cn(
              "workspace-status",
              error
                ? "workspace-status-error"
                : "workspace-status-ok"
            )}
          >
            {error ?? status}
          </div>
        )}

        <div className="skills-layout">
        <section className="skills-list-panel">
          <div className="skills-list-header">
            <span>
              已配置 {skills.length}
            </span>
            {loading && <LoadingIndicator ariaLabel="加载技能中" size={14} />}
          </div>

          <div className="skills-list">
            {skills.map((skill) => (
              <button
                key={skill.id}
                type="button"
                onClick={() => void handleSelect(skill.id)}
                className={cn(
                  "skill-list-item",
                  skill.id === selectedId && !isNew
                    ? "selected"
                    : ""
                )}
              >
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-foreground">
                    {skill.name}
                  </span>
                  <div className="flex shrink-0 items-center gap-1">
                    <Badge variant={skill.enabled ? "secondary" : "outline"}>
                      {skill.enabled ? "启用" : "停用"}
                    </Badge>
                  </div>
                </div>
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                  {skill.description}
                </p>
                <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>{renderScope(skill)}</span>
                  <span>{formatDate(skill.updatedAt)}</span>
                </div>
              </button>
            ))}

            {!loading && skills.length === 0 && (
              <div className="skills-empty">
                <FileArchive className="mx-auto mb-2 size-5 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">还没有技能</p>
              </div>
            )}
          </div>
        </section>

        <section className="skills-detail-panel">
          <div className="skills-detail-header">
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <Sparkles className="size-4 shrink-0 text-primary" />
                <h2 className="truncate text-sm font-medium text-foreground">
                  {isNew
                    ? "新技能"
                    : selectedSummary?.name ?? selectedSkill?.name ?? "技能详情"}
                </h2>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {isNew
                  ? "保存后可被 Agent OS 检索"
                  : selectedSummary?.description ?? selectedSkill?.description}
              </p>
            </div>

            <div className="skills-detail-actions">
              <label className="skills-toggle">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  disabled={stateControlsDisabled}
                  onChange={(event) =>
                    void handleEnabledChange(event.currentTarget.checked)
                  }
                  className="size-3.5 accent-primary"
                />
                {updatingEnabled && (
                  <LoadingIndicator ariaLabel="更新状态中" size={12} />
                )}
                <span>启用</span>
              </label>
              <Button
                type="button"
                size="sm"
                className="workspace-primary-button"
                disabled={
                  saving ||
                  updatingEnabled ||
                  !draft.skillMd.trim() ||
                  (!isNew && !selectedSkill)
                }
                onClick={() => void handleSave()}
                title="保存技能"
              >
                {saving ? (
                  <LoadingIndicator ariaLabel="保存中" size={16} />
                ) : (
                  <Save className="size-4" />
                )}
                保存
              </Button>
              {!isNew && selectedSkill && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="workspace-secondary-button"
                  disabled={downloading}
                  onClick={() => void handleDownloadPackage()}
                  title="下载技能源文件 zip"
                >
                  {downloading ? (
                    <LoadingIndicator ariaLabel="下载中" size={16} />
                  ) : (
                    <Download className="size-4" />
                  )}
                  下载
                </Button>
              )}
              {!isNew && selectedSkill && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  disabled={deleting}
                  onClick={() => void handleDelete()}
                  title="删除技能"
                  aria-label="删除技能"
                >
                  {deleting ? (
                    <LoadingIndicator ariaLabel="删除中" size={16} />
                  ) : (
                    <Trash2 className="size-4" />
                  )}
                </Button>
              )}
            </div>
          </div>

          <div className="skills-detail-body">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline">
                {selectedSummary?.agentScope ?? selectedSkill?.agentScope ?? "general"}
              </Badge>
              <Badge variant="outline">
                {selectedSummary?.purpose ?? selectedSkill?.purpose ?? "general"}
              </Badge>
              {selectedSkill?.sourceType && (
                <Badge variant="outline">{sourceLabel(selectedSkill.sourceType)}</Badge>
              )}
            </div>

            {selectedSkill && (
              <div className="skills-meta-grid">
                <MetaRow label="Tags" value={selectedSkill.tags.join(", ")} />
                <MetaRow
                  label="Triggers"
                  value={[
                    ...selectedSkill.triggers.keywords,
                    ...selectedSkill.triggers.canvasKinds.map((kind) => `canvas:${kind}`),
                  ].join(", ")}
                />
                <MetaRow
                  label="Tools"
                  value={selectedSkill.bindings.tools.join(", ")}
                />
                <MetaRow
                  label="Agents"
                  value={selectedSkill.bindings.agents.join(", ")}
                />
                <MetaRow
                  label="Scripts"
                  value={
                    selectedSkill.scripts.length
                      ? selectedSkill.scripts
                          .map((script) => `${script.name} (${script.runtime})`)
                          .join(", ")
                      : ""
                  }
                />
                <MetaRow
                  label="Package"
                  value={
                    selectedSkill.packageSha256
                      ? `${selectedSkill.packageSha256.slice(0, 12)} · ${formatBytes(
                          selectedSkill.packageSizeBytes
                        )}`
                      : ""
                  }
                />
              </div>
            )}

            <div className="skills-editor-grid">
              <div className="min-w-0">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <FileText className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate text-xs font-medium text-foreground">
                      SKILL.md
                    </span>
                  </div>
                  <Badge variant="outline">{formatChars(draft.skillMd.length)}</Badge>
                </div>
                <Textarea
                  value={draft.skillMd}
                  onChange={(event) => {
                    const skillMd = event.currentTarget.value;
                    setDraft((current) => ({
                      ...current,
                      skillMd,
                    }));
                  }}
                  spellCheck={false}
                  className="min-h-[560px] resize-y font-mono text-xs leading-5"
                  aria-label="SKILL.md"
                />
              </div>

              <div className="min-w-0 rounded-lg border border-border bg-background">
                <div className="border-b border-border px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <FileArchive className="size-4 shrink-0 text-muted-foreground" />
                      <span className="truncate text-xs font-medium text-foreground">
                        包内资源
                      </span>
                    </div>
                    <Badge variant="outline">{resources.length}</Badge>
                  </div>
                  <div className="mt-2 grid grid-cols-4 gap-1 text-[11px] text-muted-foreground">
                    <ResourceStat label="参考" value={resourceStats.reference} />
                    <ResourceStat label="脚本" value={resourceStats.script} />
                    <ResourceStat label="Asset" value={resourceStats.asset} />
                    <ResourceStat label="其他" value={resourceStats.other} />
                  </div>
                </div>

                <div className="grid max-h-[680px] min-h-[560px] grid-rows-[220px_minmax(0,1fr)]">
                  <div className="overflow-auto border-b border-border p-2">
                    {resources.length > 0 ? (
                      <div className="space-y-1">
                        {resources.map((resource) => (
                          <button
                            key={resource.path}
                            type="button"
                            onClick={() => void handleResourceSelect(resource)}
                            className={cn(
                              "flex w-full min-w-0 items-start gap-2 rounded-[8px] border px-2 py-1.5 text-left transition-all",
                              resource.path === selectedResourcePath
                                ? "border-primary bg-primary/10 shadow-[0_4px_12px_rgba(41,191,78,0.08)]"
                                : "border-transparent hover:border-primary/35 hover:bg-[#f4f4f2]"
                            )}
                          >
                            <ResourceIcon resource={resource} />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-xs text-foreground">
                                {resource.path}
                              </span>
                              <span className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                                {resourceTypeLabel(resource.type)}
                                {resource.sizeBytes != null && (
                                  <span>{formatBytes(resource.sizeBytes)}</span>
                                )}
                                {!resource.readable && <span>二进制</span>}
                              </span>
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="flex h-full items-center justify-center rounded-md border border-dashed border-border px-3 text-center text-xs text-muted-foreground">
                        {isNew ? "保存或导入后显示资源" : "没有额外资源"}
                      </div>
                    )}
                  </div>

                  <ResourcePreview
                    content={resourceContent}
                    loading={resourceLoading}
                    resource={selectedResource}
                    skillId={selectedSkill?.id ?? null}
                  />
                </div>
              </div>
            </div>
          </div>
        </section>
        </div>
      </div>
    </div>
  );
}

function createNewDraft(): DraftState {
  return {
    enabled: true,
    skillMd: NEW_SKILL_TEMPLATE,
  };
}

function renderScope(skill: AgentSkillDefinitionSummary) {
  if (skill.agentScope === "image" && skill.purpose === "prompt_expansion") {
    return "Image · 提示词扩写";
  }
  return `${skill.agentScope} · ${skill.purpose}`;
}

function MetaRow({ label, value }: { label: string; value?: string }) {
  return (
    <div className="min-w-0">
      <span className="block text-[11px] uppercase tracking-normal text-muted-foreground/80">
        {label}
      </span>
      <strong className="mt-0.5 block truncate font-normal text-foreground" title={value}>
        {value || "无"}
      </strong>
    </div>
  );
}

function ResourceStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0 rounded-md bg-muted/60 px-2 py-1">
      <span className="block truncate">{label}</span>
      <strong className="block font-medium text-foreground">{value}</strong>
    </div>
  );
}

function ResourceIcon({ resource }: { resource: AgentSkillResourceSummary }) {
  if (isImageResource(resource.path)) {
    return <ImageIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />;
  }
  if (resource.type === "script") {
    return <Code2 className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />;
  }
  return <FileText className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />;
}

function ResourcePreview({
  content,
  loading,
  resource,
  skillId,
}: {
  content: string | null;
  loading: boolean;
  resource: AgentSkillResourceSummary | null;
  skillId: string | null;
}) {
  if (!resource || !skillId) {
    return (
      <div className="flex items-center justify-center p-4 text-center text-xs text-muted-foreground">
        选择资源查看内容
      </div>
    );
  }

  if (isImageResource(resource.path)) {
    return (
      <div className="min-h-0 overflow-auto p-3">
        <div className="mb-2 truncate text-xs font-medium text-foreground">
          {resource.path}
        </div>
        <img
          src={getAgentSkillResourceContentUrl(skillId, resource.path)}
          alt={resource.path}
          className="max-h-[380px] w-full rounded-md border border-border object-contain"
        />
      </div>
    );
  }

  if (!resource.readable) {
    return (
      <div className="flex min-h-0 items-center justify-center p-4 text-center text-xs text-muted-foreground">
        该资源可下载，当前不内联预览
      </div>
    );
  }

  return (
    <div className="min-h-0 overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <span className="truncate text-xs font-medium text-foreground">
          {resource.path}
        </span>
        {loading && <LoadingIndicator ariaLabel="读取资源中" size={14} />}
      </div>
      <pre className="h-full overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-[11px] leading-5 text-foreground">
        {loading ? "" : content ?? "无法读取内容"}
      </pre>
    </div>
  );
}

function sourceLabel(sourceType: AgentSkillDefinitionSummary["sourceType"]) {
  if (sourceType === "zip") {
    return "zip";
  }
  if (sourceType === "seed") {
    return "内置";
  }
  return "手动";
}

function getClientError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function formatBytes(value: number | null) {
  if (!value) {
    return "0 B";
  }
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatChars(value: number) {
  if (value < 1000) {
    return `${value} chars`;
  }
  return `${(value / 1000).toFixed(1)}k chars`;
}

function summarizeResources(resources: AgentSkillResourceSummary[]) {
  return resources.reduce(
    (summary, resource) => {
      if (resource.type === "reference" || resource.type === "style") {
        summary.reference += 1;
      } else if (resource.type === "script") {
        summary.script += 1;
      } else if (resource.type === "asset") {
        summary.asset += 1;
      } else {
        summary.other += 1;
      }
      return summary;
    },
    { asset: 0, other: 0, reference: 0, script: 0 }
  );
}

function resourceTypeLabel(type: AgentSkillResourceSummary["type"]) {
  if (type === "reference") {
    return "reference";
  }
  if (type === "script") {
    return "script";
  }
  if (type === "asset") {
    return "asset";
  }
  if (type === "style") {
    return "style";
  }
  if (type === "metadata") {
    return "metadata";
  }
  return "resource";
}

function isImageResource(path: string) {
  return /\.(?:gif|jpe?g|png|svg|webp)$/i.test(path);
}
