"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Lock, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ProjectEditDialog } from "@/components/projects/ProjectEditDialog";
import { useAuth } from "@/hooks/useAuth";
import { useProjects } from "@/hooks/useProjects";
import type { Project } from "@/types/project";

export function ProjectList({ limit }: { limit?: number }) {
  const { projects, loading, error, refresh, removeProject } = useProjects();
  const { status } = useAuth();
  const canManage = status === "user";
  const [target, setTarget] = useState<Project | null>(null);
  const [editing, setEditing] = useState<Project | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const shown = limit ? projects.slice(0, limit) : projects;

  async function confirm() {
    if (!target) return;
    setBusy(true);
    setDeleteError("");
    try {
      await removeProject(target.id);
      setTarget(null);
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "Delete failed.");
      setTarget(null);
    } finally {
      setBusy(false);
    }
  }

  if (loading)
    return (
      <div className="space-y-3" aria-label="Loading projects">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl bg-white/[0.03]" />
        ))}
      </div>
    );

  if (error)
    return (
      <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
        {error}
        <button onClick={refresh} className="ml-3 underline">
          Retry
        </button>
      </div>
    );

  if (projects.length === 0)
    return (
      <div className="rounded-xl border border-dashed border-line-strong p-8 text-center">
        <p className="text-sm text-slate-300">No research projects yet.</p>
        <p className="mt-1 text-xs text-muted">
          {status === "anonymous" ? "Start the free trial or sign in to see your projects here." : "Create your first one to see it here."}
        </p>
      </div>
    );

  return (
    <>
      {deleteError && (
        <div role="alert" className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
          {deleteError}
        </div>
      )}
      <ul className="space-y-3">
        <AnimatePresence initial={false}>
          {shown.map((p) => (
            <motion.li
              key={p.id}
              layout
              data-testid="project-item"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.25 }}
              className="group rounded-xl border border-line bg-ink-900/60 p-4 transition-colors hover:border-line-strong"
            >
              <div className="flex items-start justify-between gap-3">
                <p className="line-clamp-3 text-sm leading-relaxed">{p.research_question}</p>
                {canManage && (
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      aria-label={`Edit project ${p.id}`}
                      onClick={() => setEditing(p)}
                      className="rounded p-1.5 text-muted opacity-60 transition hover:bg-white/[0.06] hover:text-white group-hover:opacity-100"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete project ${p.id}`}
                      onClick={() => setTarget(p)}
                      className="rounded p-1.5 text-muted opacity-60 transition hover:bg-red-500/10 hover:text-red-300 group-hover:opacity-100"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px]">
                <span className="text-cyan">{p.modality}</span>
                <span className="text-muted">{p.disease}</span>
              </div>
              <p className="mt-1 text-[11px] text-muted">{p.objectives.join(" · ")}</p>
              <p className="mt-2 font-mono text-[10px] text-slate-600">
                #{p.id} · {new Date(p.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              </p>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      {status === "guest" && (
        <p className="mt-4 flex items-center gap-2 text-xs text-muted">
          <Lock size={12} aria-hidden />
          <span>
            Guests can’t edit or delete projects.{" "}
            <Link href="/register" className="text-cyan hover:underline">
              Register to unlock full access
            </Link>
          </span>
        </p>
      )}

      <ProjectEditDialog project={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={target !== null}
        title="Delete this project?"
        body={target ? `“${target.research_question.slice(0, 90)}${target.research_question.length > 90 ? "…" : ""}” will be permanently removed from the database.` : ""}
        confirmLabel="Delete project"
        busy={busy}
        onConfirm={confirm}
        onCancel={() => setTarget(null)}
      />
    </>
  );
}
