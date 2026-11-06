"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, LoaderCircle } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Select } from "@/components/ui/Select";
import { useProjects } from "@/hooks/useProjects";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { DISEASES, MODALITIES, OBJECTIVES, type Disease, type Modality, type Objective, type Project } from "@/types/project";

/** Edit an existing project (registered users only — the server enforces ownership). */
export function ProjectEditDialog({ project, onClose }: { project: Project | null; onClose: () => void }) {
  return (
    <AnimatePresence>
      {project && <Dialog key={project.id} project={project} onClose={onClose} />}
    </AnimatePresence>
  );
}

function Dialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const id = useId();
  const { updateProject } = useProjects();
  const [question, setQuestion] = useState(project.research_question);
  const [modality, setModality] = useState<Modality>(project.modality);
  const [disease, setDisease] = useState<Disease>(project.disease);
  const [objectives, setObjectives] = useState<Objective[]>(project.objectives);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const trimmed = question.trim();
  const qError = trimmed.length < 10 ? "Describe your research question in at least 10 characters." : "";
  const oError = objectives.length === 0 ? "Select at least one research objective." : "";

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    setError("");
    if (qError || oError) return;
    setBusy(true);
    try {
      await updateProject(project.id, { research_question: trimmed, modality, disease, objectives });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save your changes.");
      setBusy(false);
    }
  }

  return (
    <motion.div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={() => !busy && onClose()}
    >
      <motion.form
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-t`}
        onSubmit={save}
        noValidate
        onClick={(e) => e.stopPropagation()}
        className="glass max-h-[92vh] w-full max-w-xl space-y-5 overflow-y-auto rounded-xl p-6"
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      >
        <h2 id={`${id}-t`} className="text-base font-semibold">
          Edit project #{project.id}
        </h2>
        <div>
          <label htmlFor={`${id}-q`} className="mb-2 block text-xs font-medium uppercase tracking-wider text-muted">
            Research question
          </label>
          <textarea
            id={`${id}-q`}
            autoFocus
            rows={4}
            maxLength={2000}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            aria-invalid={touched && !!qError}
            className={cn(
              "block w-full resize-none rounded-xl border bg-ink-900 p-3 text-sm leading-relaxed outline-none focus:border-cyan/70",
              touched && qError ? "border-red-500/60" : "border-line-strong",
            )}
          />
          {touched && qError && <p className="mt-1.5 text-xs text-red-300">{qError}</p>}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Imaging modality" value={modality} options={MODALITIES} onChange={setModality} />
          <Select label="Research domain" value={disease} options={DISEASES} onChange={setDisease} />
        </div>
        <fieldset>
          <legend className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">Research objectives</legend>
          <div className="flex flex-wrap gap-2">
            {OBJECTIVES.map((o) => {
              const on = objectives.includes(o);
              return (
                <button
                  key={o}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setObjectives((p) => (p.includes(o) ? p.filter((x) => x !== o) : [...p, o]))}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm transition-colors",
                    on ? "border-cyan/60 bg-cyan/10 text-cyan" : "border-line-strong text-slate-300 hover:border-slate-500",
                  )}
                >
                  {on && <Check size={13} aria-hidden />}
                  {o}
                </button>
              );
            })}
          </div>
          {touched && oError && <p className="mt-2 text-xs text-red-300">{oError}</p>}
        </fieldset>
        {error && (
          <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
            {error}
          </div>
        )}
        <div className="flex justify-end gap-3">
          <button type="button" disabled={busy} onClick={onClose} className="rounded-md border border-line-strong px-4 py-2 text-sm hover:bg-white/[0.04] disabled:opacity-50">
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-md bg-gradient-to-r from-azure to-[#3b82ff] px-5 py-2 text-sm font-medium disabled:opacity-60"
          >
            {busy && <LoaderCircle size={14} className="animate-spin" aria-hidden />}
            Save changes
          </button>
        </div>
      </motion.form>
    </motion.div>
  );
}
