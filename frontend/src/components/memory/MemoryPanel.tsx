"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useState } from "react";
import { EntriesSection } from "@/components/memory/EntriesSection";
import { DecisionsSection, EvidenceSection, GapsSection, HistorySection } from "@/components/memory/RecordSections";
import { Badge, Empty, ErrorBox, Loading, inputCls, labelCls, when } from "@/components/memory/ui";
import { buttonStyles } from "@/components/ui/MagneticButton";
import { useAuth } from "@/hooks/useAuth";
import { useProjects } from "@/hooks/useProjects";
import { useAction, useRemote } from "@/hooks/useRemote";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { MemoryConflict } from "@/types/memory";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "identity", label: "Research identity" },
  { id: "literature", label: "Literature insights" },
  { id: "evidence", label: "Evidence" },
  { id: "decisions", label: "Decisions" },
  { id: "gaps", label: "Research gaps" },
  { id: "experiment", label: "Experiment context" },
  { id: "history", label: "Memory history" },
] as const;
type TabId = (typeof TABS)[number]["id"];

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0 rounded-lg border border-line-strong bg-white/[0.02] p-3">
      <dd className="text-xl font-semibold tabular-nums">{value}</dd>
      <dt className="text-[11px] text-muted">{label}</dt>
    </div>
  );
}

function Conflict({ c }: { c: MemoryConflict }) {
  return (
    <li className="min-w-0 rounded-lg border border-amber-400/40 bg-amber-400/10 p-3 text-xs">
      <p className="font-medium text-amber-200">{c.kind === "contested_claim" ? "Contested claim" : `Reported ${c.metric} differs between papers`}</p>
      {c.claim_text && <p className="mt-1 text-slate-200 [overflow-wrap:anywhere]">{c.claim_text}</p>}
      {c.supports?.map((s, i) => <p key={`s${i}`} className="mt-1 text-slate-300 [overflow-wrap:anywhere]">Supports — {s.paper}</p>)}
      {c.contradicts?.map((s, i) => <p key={`c${i}`} className="mt-1 text-slate-300 [overflow-wrap:anywhere]">Contradicts — {s.paper}</p>)}
      {c.values?.map((v, i) => (
        <p key={i} className="mt-1 text-slate-300 [overflow-wrap:anywhere]">
          {v.value} — {v.paper}{v.datasets_named_in_paper.length ? ` (datasets named: ${v.datasets_named_in_paper.join(", ")})` : ""}
        </p>
      ))}
      <p className="mt-2 text-muted [overflow-wrap:anywhere]">{c.note}</p>
    </li>
  );
}

function Overview({ projectId, version, onChanged }: { projectId: number; version: number; onChanged: () => void }) {
  const load = useCallback(() => api.memory.overview(projectId), [projectId]);
  const { data, error, loading } = useRemote(load, version);
  const [result, setResult] = useState("");
  const { run, busy, error: rebuildError } = useAction(onChanged);
  async function rebuild() {
    const out = await run(() => api.memory.rebuild(projectId));
    if (out) setResult(`Rebuilt: ${out.created} new entr${out.created === 1 ? "y" : "ies"}, ${out.removed_stale} stale removed, ${out.papers_processed} paper(s) processed.`);
  }
  if (loading) return <Loading label="Loading overview" />;
  if (error || !data) return <ErrorBox message={error || "Could not load the memory overview."} />;
  const c = data.counts;
  return (
    <div className="space-y-5">
      <div>
        <p className="eyebrow">Research question</p>
        <p className="mt-1 text-sm [overflow-wrap:anywhere]">{data.research_question}</p>
        <p className="mt-1 text-xs text-muted">{data.disease} · {data.modality}</p>
      </div>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Memory counts">
        <Stat label="Saved papers" value={c.saved_papers} />
        <Stat label="Memory entries" value={c.entries} />
        <Stat label="Research claims" value={c.claims} />
        <Stat label="Evidence links" value={c.evidence} />
        <Stat label="Confirmed by you" value={c.confirmed} />
        <Stat label="Unverified" value={c.unverified} />
        <Stat label="Decisions" value={c.decisions} />
        <Stat label="Potential gaps" value={c.gaps} />
      </dl>
      <p className="text-xs text-muted">
        Last memory update: {when(data.last_updated_at)} · last rebuild: {when(data.last_rebuilt_at)} · rebuild count: {data.version}
      </p>
      {data.summary && <p className="text-xs text-muted [overflow-wrap:anywhere]">{data.summary}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={rebuild} disabled={busy} className={cn(buttonStyles("primary"), "min-h-11 gap-2 disabled:opacity-60")}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}Rebuild memory
        </button>
        {result && <span role="status" className="text-xs text-teal">{result}</span>}
      </div>
      <ErrorBox message={rebuildError} />
      {data.conflicts.length > 0 && (
        <section aria-label="Conflicts">
          <h3 className="mb-2 text-sm font-medium">Conflicting information kept side by side</h3>
          <ul className="space-y-2">{data.conflicts.map((x, i) => <Conflict key={i} c={x} />)}</ul>
        </section>
      )}
      <div className="space-y-2 rounded-lg border border-line-strong p-3 text-xs text-muted">
        <p>{data.notice}</p>
        <p>Not extracted automatically (stays missing unless you add it): {data.not_extracted.map((f) => f.replace(/_/g, " ")).join(", ")}.</p>
      </div>
    </div>
  );
}

export function MemoryPanel() {
  const { status } = useAuth();
  const { projects, loading } = useProjects();
  const [selected, setSelected] = useState<number | null>(null);
  const [tab, setTab] = useState<TabId>("overview");
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const projectId = selected !== null && projects.some((p) => p.id === selected) ? selected : (projects[0]?.id ?? null);
  const loadPapers = useCallback(() => (projectId === null ? Promise.resolve([]) : api.listProjectPapers(projectId)), [projectId]);
  const { data: papers } = useRemote(loadPapers, version);

  return (
    <section aria-labelledby="memory-heading" className="mt-16">
      <p className="eyebrow">Project research memory</p>
      <h2 id="memory-heading" className="mt-2 text-2xl font-semibold tracking-tight">What this project knows, and where it came from</h2>
      <p className="mt-2 max-w-2xl text-sm text-muted">
        Memory belongs to one project. Automatic entries are keyword and number matches on your saved papers&apos; titles and abstracts, with the exact source text kept. Nothing is treated as verified until you confirm it.
      </p>

      {status === "anonymous" ? (
        <div className="mt-6"><Empty>Start the free trial or sign in to use project memory.</Empty></div>
      ) : loading ? (
        <div className="mt-6"><Loading label="Loading projects" /></div>
      ) : projectId === null ? (
        <div className="mt-6"><Empty>Create a research project first. Its memory starts from your research question.</Empty></div>
      ) : (
        <div className="mt-6 space-y-5">
          <div className="max-w-md">
            <label className={labelCls} htmlFor="memory-project">Project</label>
            <select id="memory-project" className={inputCls} value={projectId} onChange={(e) => { setSelected(Number(e.target.value)); setTab("overview"); }}>
              {projects.map((p) => <option key={p.id} value={p.id}>#{p.id} · {p.research_question.slice(0, 70)}</option>)}
            </select>
          </div>

          <div role="tablist" aria-label="Memory sections" className="scroll-mt-24 -mx-1 flex max-w-full gap-1 overflow-x-auto px-1 pb-1">
            {TABS.map((t) => (
              <button key={t.id} type="button" role="tab" id={`tab-${t.id}`} aria-selected={tab === t.id} aria-controls="memory-tabpanel" onClick={() => setTab(t.id)}
                className={cn("min-h-11 shrink-0 scroll-mt-24 rounded-full border px-4 text-xs", tab === t.id ? "border-cyan bg-cyan/10 text-ice" : "border-line-strong text-slate-300")}>
                {t.label}
              </button>
            ))}
          </div>

          <div role="tabpanel" id="memory-tabpanel" aria-labelledby={`tab-${tab}`} className="min-w-0 rounded-2xl border border-line-strong bg-white/[0.015] p-4 sm:p-6">
            {tab === "overview" && <Overview projectId={projectId} version={version} onChanged={bump} />}
            {tab === "identity" && (
              <EntriesSection projectId={projectId} memoryType="research_identity" version={version} onChanged={bump}
                intro="Initialised from your project record. Add assumptions, scope and study focus; confirmed assumptions are never overwritten by a rebuild."
                fields={[{ value: "assumption", label: "Assumption" }, { value: "scope", label: "Scope" }, { value: "study_focus", label: "Study focus" }, { value: "note", label: "Note" }]} />
            )}
            {tab === "literature" && (
              <EntriesSection projectId={projectId} memoryType="literature" version={version} onChanged={bump} papers={papers ?? []}
                intro="Insights tied to saved papers. Source metadata comes from the provider; rule-extracted items are keyword/number matches (see the source text) and stay unverified until you confirm them."
                fields={[{ value: "main_finding", label: "Main finding" }, { value: "limitation", label: "Limitation" }, { value: "research_objective", label: "Research objective" }, { value: "study_population", label: "Study population" }, { value: "preprocessing", label: "Preprocessing" }, { value: "feature_extraction", label: "Feature extraction" }, { value: "validation_strategy", label: "Validation strategy" }, { value: "future_research", label: "Future research" }, { value: "note", label: "Note" }]} />
            )}
            {tab === "evidence" && <EvidenceSection projectId={projectId} version={version} onChanged={bump} papers={papers ?? []} />}
            {tab === "decisions" && <DecisionsSection projectId={projectId} version={version} onChanged={bump} />}
            {tab === "gaps" && <GapsSection projectId={projectId} version={version} onChanged={bump} />}
            {tab === "experiment" && (
              <EntriesSection projectId={projectId} memoryType="experiment_context" version={version} onChanged={bump}
                intro="Context for future experiment work. This only stores what you enter; nothing here runs an experiment."
                fields={[{ value: "objective", label: "Experiment objective" }, { value: "dataset", label: "Dataset" }, { value: "dataset_version", label: "Dataset version" }, { value: "model_configuration", label: "Model configuration" }, { value: "training_strategy", label: "Training strategy" }, { value: "evaluation_metrics", label: "Evaluation metrics" }, { value: "results", label: "Results" }, { value: "reproducibility_reference", label: "Reproducibility reference" }]} />
            )}
            {tab === "history" && <HistorySection projectId={projectId} version={version} />}
          </div>
          <p className="text-[11px] text-muted"><Badge>Provenance</Badge> Every entry shows its source type, matched text and review state.</p>
        </div>
      )}
    </section>
  );
}
