import {
  Check,
  Loader2,
  Pencil,
  Trash2,
  Upload,
  WandSparkles,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";

import {
  deleteSkill,
  loadSkills,
  updateSkill,
  uploadSkill,
  type SkillSummary,
} from "@/lib/skill-storage";

export function SkillPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingSkillId, setEditingSkillId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editingDescription, setEditingDescription] = useState("");
  const [editingInstructions, setEditingInstructions] = useState("");
  const hasPromptExpand = skills.some((skill) => skill.slug === "prompt-expand");

  useEffect(() => {
    if (!open) {
      return;
    }

    let ignore = false;

    loadSkills()
      .then(({ skills: nextSkills }) => {
        if (!ignore) {
          setSkills(nextSkills);
        }
      })
      .catch((nextError: unknown) => {
        if (!ignore) {
          setError(getClientError(nextError));
        }
      })
      .finally(() => {
        if (!ignore) {
          setLoading(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [open]);

  const handleUpload = async (file: File | null) => {
    if (!file) {
      return;
    }

    setBusyAction("upload");
    setError(null);

    try {
      const { skill } = await uploadSkill(file);
      setSkills((current) => [skill, ...current]);
    } catch (nextError) {
      setError(getClientError(nextError));
    } finally {
      setBusyAction(null);
    }
  };

  const startEditing = (skill: SkillSummary) => {
    setEditingSkillId(skill.id);
    setEditingName(skill.name);
    setEditingDescription(skill.description);
    setEditingInstructions(skill.instructions);
  };

  const cancelEditing = () => {
    setEditingSkillId(null);
    setEditingName("");
    setEditingDescription("");
    setEditingInstructions("");
  };

  const handleSave = async (event: FormEvent<HTMLFormElement>, skillId: string) => {
    event.preventDefault();
    if (!editingName.trim() || !editingInstructions.trim()) {
      return;
    }

    setBusyAction(`save:${skillId}`);
    setError(null);

    try {
      const { skill } = await updateSkill({
        skillId,
        name: editingName,
        description: editingDescription,
        instructions: editingInstructions,
      });
      setSkills((current) =>
        current.map((item) => (item.id === skill.id ? skill : item))
      );
      cancelEditing();
    } catch (nextError) {
      setError(getClientError(nextError));
    } finally {
      setBusyAction(null);
    }
  };

  const handleDelete = async (skill: SkillSummary) => {
    if (!window.confirm(`删除「${skill.name}」？`)) {
      return;
    }

    setBusyAction(`delete:${skill.id}`);
    setError(null);

    try {
      await deleteSkill(skill.id);
      setSkills((current) => current.filter((item) => item.id !== skill.id));
    } catch (nextError) {
      setError(getClientError(nextError));
    } finally {
      setBusyAction(null);
    }
  };

  if (!open) {
    return null;
  }

  return (
    <aside className="skill-panel" aria-label="Skill 面板">
      <header className="skill-panel-header">
        <div>
          <strong>Skills</strong>
          <span>{hasPromptExpand ? "prompt-expand 默认启用" : "需要上传 prompt-expand"}</span>
        </div>
        <button
          aria-label="关闭 Skill 面板"
          onClick={onClose}
          title="关闭"
          type="button"
        >
          <X size={14} />
        </button>
      </header>

      <label className="skill-upload">
        <input
          accept=".zip,application/zip"
          disabled={busyAction === "upload"}
          type="file"
          onChange={(event) => {
            void handleUpload(event.currentTarget.files?.[0] ?? null);
            event.currentTarget.value = "";
          }}
        />
        {busyAction === "upload" ? <Loader2 size={14} /> : <Upload size={14} />}
        <span>上传 zip</span>
      </label>

      {error && <div className="skill-error">{error}</div>}

      <div className="skill-list">
        {loading && (
          <div className="skill-empty">
            <Loader2 size={15} />
            <span>加载中</span>
          </div>
        )}

        {!loading && !skills.length && (
          <div className="skill-empty">
            <WandSparkles size={15} />
            <span>暂无公开 skill</span>
          </div>
        )}

        {!loading &&
          skills.map((skill) => {
            const isEditing = editingSkillId === skill.id;
            const isSaving = busyAction === `save:${skill.id}`;
            const isDeleting = busyAction === `delete:${skill.id}`;

            return (
              <section className="skill-row" key={skill.id}>
                {isEditing ? (
                  <form
                    className="skill-edit-form"
                    onSubmit={(event) => handleSave(event, skill.id)}
                  >
                    <input
                      maxLength={80}
                      value={editingName}
                      onChange={(event) => setEditingName(event.currentTarget.value)}
                    />
                    <input
                      maxLength={500}
                      placeholder="描述"
                      value={editingDescription}
                      onChange={(event) =>
                        setEditingDescription(event.currentTarget.value)
                      }
                    />
                    <textarea
                      value={editingInstructions}
                      onChange={(event) =>
                        setEditingInstructions(event.currentTarget.value)
                      }
                    />
                    <div className="skill-edit-actions">
                      <button
                        aria-label="保存 skill"
                        disabled={
                          isSaving ||
                          !editingName.trim() ||
                          !editingInstructions.trim()
                        }
                        title="保存"
                        type="submit"
                      >
                        {isSaving ? <Loader2 size={14} /> : <Check size={14} />}
                      </button>
                      <button
                        aria-label="取消编辑"
                        onClick={cancelEditing}
                        title="取消"
                        type="button"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div className="skill-row-main">
                      <div>
                        <strong title={skill.name}>{skill.name}</strong>
                        {skill.slug === "prompt-expand" && <span>默认启用</span>}
                      </div>
                      <p title={skill.description || skill.instructions}>
                        {skill.description || skill.instructions}
                      </p>
                    </div>
                    <div className="skill-row-actions">
                      <button
                        aria-label="编辑 skill"
                        disabled={!skill.canEdit || isDeleting}
                        onClick={() => startEditing(skill)}
                        title={skill.canEdit ? "编辑" : "只有上传者可编辑"}
                        type="button"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        aria-label="删除 skill"
                        disabled={!skill.canEdit || isDeleting}
                        onClick={() => void handleDelete(skill)}
                        title={skill.canEdit ? "删除" : "只有上传者可删除"}
                        type="button"
                      >
                        {isDeleting ? <Loader2 size={14} /> : <Trash2 size={14} />}
                      </button>
                    </div>
                  </>
                )}
              </section>
            );
          })}
      </div>
    </aside>
  );
}

function getClientError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
