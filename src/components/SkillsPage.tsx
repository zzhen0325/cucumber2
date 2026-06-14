import {
  Check,
  FileArchive,
  Loader2,
  Plus,
  Save,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  createAgentSkill,
  deleteAgentSkill,
  fileToBase64,
  importAgentSkillZip,
  loadAgentSkill,
  loadAgentSkills,
  updateAgentSkill,
  type AgentSkillDefinition,
  type AgentSkillDefinitionSummary,
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
  isDefault: boolean;
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
  const [importing, setImporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const selectedId = selectedSkill?.id ?? null;

  async function refreshSkills(nextSelectedId?: string | null) {
    const { skills: nextSkills } = await loadAgentSkills();
    setSkills(nextSkills);

    if (nextSelectedId === null) {
      return null;
    }

    const targetId =
      nextSelectedId ??
      selectedId ??
      nextSkills.find((skill) => skill.isDefault)?.id ??
      nextSkills[0]?.id;
    if (!targetId) {
      setSelectedSkill(null);
      setDraft(createNewDraft());
      setIsNew(true);
      return null;
    }

    const { skill } = await loadAgentSkill(targetId);
    setSelectedSkill(skill);
    setDraft({
      enabled: skill.enabled,
      isDefault: skill.isDefault,
      skillMd: skill.skillMd,
    });
    setIsNew(false);
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
        const targetId =
          nextSkills.find((skill) => skill.isDefault)?.id ?? nextSkills[0]?.id;
        if (!targetId) {
          setSelectedSkill(null);
          setDraft(createNewDraft());
          setIsNew(true);
          return;
        }

        const { skill } = await loadAgentSkill(targetId);
        if (ignore) {
          return;
        }

        setSelectedSkill(skill);
        setDraft({
          enabled: skill.enabled,
          isDefault: skill.isDefault,
          skillMd: skill.skillMd,
        });
        setIsNew(false);
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

  async function handleSelect(skillId: string) {
    setLoading(true);
    setError(null);
    setStatus(null);
    try {
      const { skill } = await loadAgentSkill(skillId);
      setSelectedSkill(skill);
      setDraft({
        enabled: skill.enabled,
        isDefault: skill.isDefault,
        skillMd: skill.skillMd,
      });
      setIsNew(false);
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
      setSelectedSkill(skill);
      setDraft({
        enabled: skill.enabled,
        isDefault: skill.isDefault,
        skillMd: skill.skillMd,
      });
      setIsNew(false);
      await refreshSkills(skill.id);
      setStatus("已保存");
    } catch (nextError) {
      setError(getClientError(nextError));
    } finally {
      setSaving(false);
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
        isDefault: true,
        zipBase64,
      });
      setSelectedSkill(skill);
      setDraft({
        enabled: skill.enabled,
        isDefault: skill.isDefault,
        skillMd: skill.skillMd,
      });
      setIsNew(false);
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

  return (
    <div className={cn("min-h-full bg-background px-4 py-6 sm:px-6 md:p-8", className)}>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-base font-medium text-foreground sm:text-lg">
            技能
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Agent OS 全局技能
          </p>
        </div>

        <div className="flex items-center gap-2">
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
            disabled={importing}
            onClick={() => fileInputRef.current?.click()}
            title="导入 Agent Skills zip，最高 100MB，支持 SKILL.md、scripts、references、assets 和其他资源"
          >
            {importing ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            导入
          </Button>
          <Button type="button" size="sm" onClick={handleNew}>
            <Plus className="size-4" />
            新建
          </Button>
        </div>
      </div>

      {(error || status) && (
        <div
          className={cn(
            "mb-4 rounded-lg border px-3 py-2 text-sm",
            error
              ? "border-destructive/20 bg-destructive/10 text-destructive"
              : "border-primary/20 bg-primary/10 text-foreground"
          )}
        >
          {error ?? status}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <section className="rounded-xl border border-border bg-card p-2 shadow-card">
          <div className="mb-2 flex items-center justify-between px-2 py-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              已配置 {skills.length}
            </span>
            {loading && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
          </div>

          <div className="space-y-1">
            {skills.map((skill) => (
              <button
                key={skill.id}
                type="button"
                onClick={() => void handleSelect(skill.id)}
                className={cn(
                  "w-full rounded-lg px-3 py-2 text-left transition-colors",
                  skill.id === selectedId && !isNew
                    ? "bg-primary/10 text-foreground"
                    : "hover:bg-muted"
                )}
              >
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-foreground">
                    {skill.name}
                  </span>
                  <div className="flex shrink-0 items-center gap-1">
                    {skill.isDefault && <Badge>默认</Badge>}
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
              <div className="rounded-lg border border-dashed border-border px-3 py-8 text-center">
                <FileArchive className="mx-auto mb-2 size-5 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">还没有技能</p>
              </div>
            )}
          </div>
        </section>

        <section className="min-w-0 rounded-xl border border-border bg-card shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
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

            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-xs text-foreground">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      enabled: event.currentTarget.checked,
                    }))
                  }
                  className="size-3.5 accent-primary"
                />
                启用
              </label>
              <label className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-xs text-foreground">
                <input
                  type="checkbox"
                  checked={draft.isDefault}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      enabled: event.currentTarget.checked || current.enabled,
                      isDefault: event.currentTarget.checked,
                    }))
                  }
                  className="size-3.5 accent-primary"
                />
                默认
              </label>
              <Button
                type="button"
                size="sm"
                disabled={saving || !draft.skillMd.trim() || (!isNew && !selectedSkill)}
                onClick={() => void handleSave()}
                title="保存技能"
              >
                {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                保存
              </Button>
              {!isNew && selectedSkill && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={deleting}
                  onClick={() => void handleDelete()}
                  title="删除技能"
                  aria-label="删除技能"
                >
                  {deleting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Trash2 className="size-4" />
                  )}
                </Button>
              )}
            </div>
          </div>

          <div className="grid gap-3 p-4">
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
              {draft.isDefault && (
                <span className="inline-flex items-center gap-1 text-foreground">
                  <Check className="size-3.5 text-primary" />
                  默认扩写技能
                </span>
              )}
            </div>

            {selectedSkill && (
              <div className="grid gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground sm:grid-cols-2">
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

            <Textarea
              value={draft.skillMd}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  skillMd: event.currentTarget.value,
                }))
              }
              spellCheck={false}
              className="min-h-[560px] resize-y font-mono text-xs leading-5"
              aria-label="SKILL.md"
            />
          </div>
        </section>
      </div>
    </div>
  );
}

function createNewDraft(): DraftState {
  return {
    enabled: true,
    isDefault: false,
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
