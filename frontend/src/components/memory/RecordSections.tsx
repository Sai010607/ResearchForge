"use client";

import { useCallback, useState, type FormEvent } from "react";
import { buttonStyles } from "@/components/ui/MagneticButton";
import { Badge, Empty, ErrorBox, Loading, PaperLine, inputCls, labelCls, when } from "@/components/memory/ui";
import { useAction, useRemote } from "@/hooks/useRemote";
import { api, type EvidenceInput } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Claim, ClaimType, Decision, DecisionType, EvidenceRelationship, Gap, GapCategory, MemoryEvent } from "@/types/memory";
import type { Paper } from "@/types/paper";

interface Common {
  projectId: number;
  version: number;
  onChanged: () => void;
}
const btn = cn(buttonStyles("ghost"), "min-h-10 !py-1.5 text-xs");

// ------------------------------------------------------------------------------------------------ Evidence
const RELATIONS: EvidenceRelationship[] = ["supports", "contradicts", "contextualizes", "neutral"];
const REL_TONE = { supports: "good", contradicts: "bad", contextualizes: "info", neutral: "neutral" } as const;

function EvidenceForm({ papers, onSubmit, busy, label }: { papers: Paper[]; onSubmit: (e: EvidenceInput) => void; busy: boolean; label: string }) {
  const [paperId, setPaperId] = useState("");
  const [rel, setRel] = useState<EvidenceRelationship>("supports");
  const [kind, setKind] = useState<"quote" | "paraphrase">("quote");
  const [text, setText] = useState("");
  const [section, setSection] = useState("");
  return (
    <fieldset className="grid min-w-0 gap-3 rounded-lg border border-line-strong p-3">
      <legend className="px-1 text-xs text-muted">{label}</legend>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="min-w-0">
          <label className={labelCls} htmlFor={`${label}-paper`}>Paper</label>
          <select id={`${label}-paper`} className={inputCls} value={paperId} onChange={(e) => setPaperId(e.target.value)}>
            <option value="">Choose a saved paper…</option>
            {papers.map((p) => <option key={p.id} value={p.id}>{p.title.slice(0, 80)}</option>)}
          </select>
        </div>
        <div className="min-w-0">
          <label className={labelCls} htmlFor={`${label}-rel`}>Relationship</label>
          <select id={`${label}-rel`} className={inputCls} value={rel} onChange={(e) => setRel(e.target.value as EvidenceRelationship)}>
            {RELATIONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div className="min-w-0">
          <label className={labelCls} htmlFor={`${label}-kind`}>Text is a</label>
          <select id={`${label}-kind`} className={inputCls} value={kind} onChange={(e) => setKind(e.target.value as "quote" | "paraphrase")}>
            <option value="quote">Direct quote</option>
            <option value="paraphrase">Your paraphrase</option>
          </select>
        </div>
      </div>
      <div>
        <label className={labelCls} htmlFor={`${label}-text`}>Passage</label>
        <textarea id={`${label}-text`} className={cn(inputCls, "min-h-20")} value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} />
      </div>
      <div>
        <label className={labelCls} htmlFor={`${label}-section`}>Section (optional)</label>
        <input id={`${label}-section`} className={inputCls} value={section} onChange={(e) => setSection(e.target.value)} maxLength={80} />
      </div>
      <button type="button" disabled={busy || !paperId || text.trim().length < 3} className={cn(buttonStyles("primary"), "min-h-11 justify-self-start disabled:opacity-50")}
        onClick={() => { onSubmit({ paper_id: Number(paperId), relationship: rel, evidence_kind: kind, quoted_text: text.trim(), ...(section.trim() ? { section_name: section.trim() } : {}) }); setText(""); }}>
        {label}
      </button>
    </fieldset>
  );
}

function ClaimCard({ claim, projectId, papers, onChanged }: { claim: Claim; projectId: number; papers: Paper[]; onChanged: () => void }) {
  const { run, busy, error } = useAction(onChanged);
  const [adding, setAdding] = useState(false);
  return (
    <li className={cn("min-w-0 rounded-xl border border-line-strong bg-white/[0.02] p-4", claim.status === "retracted" && "opacity-60")}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={claim.claim_type === "hypothesis" ? "warn" : "info"}>{claim.claim_type === "hypothesis" ? "Researcher hypothesis (not evidence-backed)" : `Claim · ${claim.claim_type}`}</Badge>
        {claim.contested && <Badge tone="bad">Contested: supporting and contradicting evidence</Badge>}
        {claim.status === "retracted" && <Badge tone="neutral">Retracted</Badge>}
      </div>
      <p className="mt-2 text-sm [overflow-wrap:anywhere]">{claim.claim_text}</p>
      {claim.evidence.length === 0 ? (
        <p className="mt-2 text-xs text-muted">No source attached.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {claim.evidence.map((ev) => (
            <li key={ev.id} className="min-w-0 border-l-2 border-line-strong pl-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={REL_TONE[ev.relationship]}>{ev.relationship}</Badge>
                <Badge>{ev.evidence_kind === "quote" ? "Quotation" : "Paraphrase"}</Badge>
                <Badge tone={ev.verification_status === "source_matched" ? "good" : "warn"}>
                  {ev.verification_status === "source_matched" ? "Found in the stored title/abstract" : "Not matched to stored text: unverified"}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-slate-300 [overflow-wrap:anywhere]">{ev.evidence_kind === "quote" ? `“${ev.quoted_text}”` : ev.quoted_text}</p>
              <PaperLine paper={ev.paper} />
              {(ev.section_name || ev.page_number) && <p className="text-xs text-muted">{[ev.section_name, ev.page_number ? `p. ${ev.page_number}` : null].filter(Boolean).join(" · ")}</p>}
            </li>
          ))}
        </ul>
      )}
      <ErrorBox message={error} />
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={btn} onClick={() => setAdding((v) => !v)}>{adding ? "Close" : "Add evidence"}</button>
        <button type="button" disabled={busy} className={btn} onClick={() => run(() => api.memory.patchClaim(projectId, claim.id, claim.status === "active" ? "retracted" : "active"))}>
          {claim.status === "active" ? "Retract" : "Reinstate"}
        </button>
      </div>
      {adding && <div className="mt-3"><EvidenceForm papers={papers} busy={busy} label="Add evidence" onSubmit={async (ev) => { if (await run(() => api.memory.addEvidence(projectId, claim.id, ev))) setAdding(false); }} /></div>}
    </li>
  );
}

export function EvidenceSection({ projectId, version, onChanged, papers }: Common & { papers: Paper[] }) {
  const load = useCallback(() => api.memory.claims(projectId), [projectId]);
  const { data, error, loading } = useRemote(load, version);
  const [text, setText] = useState("");
  const [type, setType] = useState<ClaimType>("finding");
  const [ev, setEv] = useState<EvidenceInput | null>(null);
  const { run, busy, error: saveError } = useAction(onChanged);
  const needsSource = type !== "hypothesis";
  async function submit(e: FormEvent) {
    e.preventDefault();
    const out = await run(() => api.memory.createClaim(projectId, { claim_text: text.trim(), claim_type: type, evidence: ev ? [ev] : [] }));
    if (out) { setText(""); setEv(null); }
  }
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted">Every claim must point to a saved paper, or be marked as your own hypothesis. A citation or a graph edge never counts as support by itself.</p>
      <ErrorBox message={error} />
      {loading ? <Loading label="Loading claims" /> : (data?.items.length ?? 0) === 0 && !error ? <Empty>No claims yet.</Empty> : (
        <ul className="space-y-3">{data?.items.map((c) => <ClaimCard key={c.id} claim={c} projectId={projectId} papers={papers} onChanged={onChanged} />)}</ul>
      )}
      <form onSubmit={submit} className="grid min-w-0 gap-3 rounded-xl border border-line-strong p-4" aria-label="Add claim">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="min-w-0 sm:col-span-2">
            <label className={labelCls} htmlFor="claim-text">Claim</label>
            <textarea id="claim-text" className={cn(inputCls, "min-h-20")} value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} />
          </div>
          <div className="min-w-0">
            <label className={labelCls} htmlFor="claim-type">Kind</label>
            <select id="claim-type" className={inputCls} value={type} onChange={(e) => setType(e.target.value as ClaimType)}>
              <option value="finding">Finding (needs a source)</option>
              <option value="method">Method (needs a source)</option>
              <option value="background">Background (needs a source)</option>
              <option value="hypothesis">My hypothesis (no source)</option>
            </select>
          </div>
        </div>
        {needsSource && (ev ? (
          <p className="text-xs text-teal">Source attached: {papers.find((p) => p.id === ev.paper_id)?.title.slice(0, 80)} <button type="button" className="ml-2 underline" onClick={() => setEv(null)}>remove</button></p>
        ) : (
          <EvidenceForm papers={papers} busy={false} label="Attach source" onSubmit={setEv} />
        ))}
        <ErrorBox message={saveError} />
        <button type="submit" disabled={busy || text.trim().length < 5 || (needsSource && !ev)} className={cn(buttonStyles("primary"), "min-h-11 justify-self-start disabled:opacity-50")}>Add claim</button>
      </form>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ Decisions
const DECISION_TYPES: { value: DecisionType; label: string }[] = [
  { value: "method_selected", label: "Method selected" }, { value: "method_rejected", label: "Method rejected" }, { value: "dataset_choice", label: "Dataset choice" },
  { value: "evaluation_strategy", label: "Evaluation strategy" }, { value: "inclusion_exclusion", label: "Inclusion / exclusion" }, { value: "scope_change", label: "Scope change" }, { value: "other", label: "Other" },
];

export function DecisionsSection({ projectId, version, onChanged }: Common) {
  const load = useCallback(() => api.memory.decisions(projectId), [projectId]);
  const { data, error, loading } = useRemote(load, version);
  const [type, setType] = useState<DecisionType>("method_selected");
  const [description, setDescription] = useState("");
  const [rationale, setRationale] = useState("");
  const [supersedes, setSupersedes] = useState<Decision | null>(null);
  const { run, busy, error: saveError } = useAction(onChanged);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const out = await run(() => api.memory.createDecision(projectId, { decision_type: type, description: description.trim(), ...(rationale.trim() ? { rationale: rationale.trim() } : {}), ...(supersedes ? { supersedes_id: supersedes.id } : {}) }));
    if (out) { setDescription(""); setRationale(""); setSupersedes(null); }
  }
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted">Decisions are never overwritten. Replacing one keeps the old decision in history, marked as superseded.</p>
      <ErrorBox message={error} />
      {loading ? <Loading label="Loading decisions" /> : (data?.items.length ?? 0) === 0 && !error ? <Empty>No decisions recorded yet.</Empty> : (
        <ul className="space-y-3">
          {data?.items.map((d) => (
            <li key={d.id} className={cn("min-w-0 rounded-xl border border-line-strong bg-white/[0.02] p-4", d.status !== "active" && "opacity-70")}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={d.status === "active" ? "good" : d.status === "rejected" ? "bad" : "neutral"}>{d.status}</Badge>
                <Badge>{DECISION_TYPES.find((t) => t.value === d.decision_type)?.label ?? d.decision_type}</Badge>
                {d.supersedes_id && <span className="text-xs text-muted">replaces decision #{d.supersedes_id}</span>}
              </div>
              <p className="mt-2 text-sm [overflow-wrap:anywhere]">{d.description}</p>
              {d.rationale && <p className="mt-1 text-xs text-muted [overflow-wrap:anywhere]">Why: {d.rationale}</p>}
              <p className="mt-1 text-[11px] text-muted">Recorded {when(d.created_at)}</p>
              {d.status !== "superseded" && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" className={btn} onClick={() => setSupersedes(d)}>Supersede…</button>
                  <button type="button" disabled={busy} className={btn} onClick={() => run(() => api.memory.patchDecision(projectId, d.id, d.status === "active" ? "rejected" : "active"))}>
                    {d.status === "active" ? "Mark rejected" : "Mark active"}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={submit} className="grid min-w-0 gap-3 rounded-xl border border-line-strong p-4" aria-label="Record decision">
        {supersedes && <p className="text-xs text-amber-300">This will supersede decision #{supersedes.id}. <button type="button" className="underline" onClick={() => setSupersedes(null)}>Cancel</button></p>}
        <div className="min-w-0">
          <label className={labelCls} htmlFor="decision-type">Decision type</label>
          <select id="decision-type" className={inputCls} value={type} onChange={(e) => setType(e.target.value as DecisionType)}>
            {DECISION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls} htmlFor="decision-desc">Decision</label>
          <textarea id="decision-desc" className={cn(inputCls, "min-h-16")} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={4000} />
        </div>
        <div>
          <label className={labelCls} htmlFor="decision-why">Rationale (optional)</label>
          <textarea id="decision-why" className={cn(inputCls, "min-h-16")} value={rationale} onChange={(e) => setRationale(e.target.value)} maxLength={4000} />
        </div>
        <ErrorBox message={saveError} />
        <button type="submit" disabled={busy || description.trim().length < 3} className={cn(buttonStyles("primary"), "min-h-11 justify-self-start disabled:opacity-50")}>Record decision</button>
      </form>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ Gaps
const GAP_CATEGORIES: { value: GapCategory; label: string }[] = [
  { value: "methodological", label: "Methodological" }, { value: "dataset", label: "Dataset limitation" }, { value: "population", label: "Population" }, { value: "evaluation", label: "Evaluation" },
  { value: "reproducibility", label: "Reproducibility" }, { value: "conflicting_findings", label: "Conflicting findings" }, { value: "unanswered_question", label: "Unanswered question" }, { value: "hypothesis_to_validate", label: "Hypothesis to validate" },
];

function GapCard({ gap, projectId, onChanged }: { gap: Gap; projectId: number; onChanged: () => void }) {
  const [comment, setComment] = useState(gap.researcher_comment ?? "");
  const { run, busy, error } = useAction(onChanged);
  const set = (status: Gap["status"]) => run(() => api.memory.patchGap(projectId, gap.id, { status }));
  return (
    <li className="min-w-0 rounded-xl border border-line-strong bg-white/[0.02] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={gap.status === "validated" ? "good" : gap.status === "dismissed" ? "neutral" : "warn"}>{gap.status === "potential" ? "Potential gap (not validated)" : gap.status === "validated" ? "Validated by you" : "Dismissed"}</Badge>
        <Badge>{GAP_CATEGORIES.find((c) => c.value === gap.gap_category)?.label ?? gap.gap_category}</Badge>
      </div>
      <h3 className="mt-2 text-sm font-medium [overflow-wrap:anywhere]">{gap.title}</h3>
      <p className="mt-1 text-sm text-slate-300 [overflow-wrap:anywhere]">{gap.description}</p>
      {gap.evidence_summary && <p className="mt-1 text-xs text-muted [overflow-wrap:anywhere]">Evidence: {gap.evidence_summary}</p>}
      <label className={cn(labelCls, "mt-3")} htmlFor={`gap-c-${gap.id}`}>Researcher comment</label>
      <textarea id={`gap-c-${gap.id}`} className={cn(inputCls, "min-h-16")} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={4000} />
      <ErrorBox message={error} />
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={busy} className={btn} onClick={() => run(() => api.memory.patchGap(projectId, gap.id, { researcher_comment: comment }))}>Save comment</button>
        {gap.status !== "validated" && <button type="button" disabled={busy} className={btn} onClick={() => set("validated")}>Mark validated</button>}
        {gap.status !== "dismissed" && <button type="button" disabled={busy} className={btn} onClick={() => set("dismissed")}>Dismiss</button>}
        {gap.status !== "potential" && <button type="button" disabled={busy} className={btn} onClick={() => set("potential")}>Back to potential</button>}
      </div>
    </li>
  );
}

export function GapsSection({ projectId, version, onChanged }: Common) {
  const load = useCallback(() => api.memory.gaps(projectId), [projectId]);
  const { data, error, loading } = useRemote(load, version);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<GapCategory>("methodological");
  const [summary, setSummary] = useState("");
  const { run, busy, error: saveError } = useAction(onChanged);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const out = await run(() => api.memory.createGap(projectId, { title: title.trim(), description: description.trim(), gap_category: category, ...(summary.trim() ? { evidence_summary: summary.trim() } : {}) }));
    if (out) { setTitle(""); setDescription(""); setSummary(""); }
  }
  return (
    <div className="space-y-4">
      <div role="note" className="rounded-lg border border-amber-400/40 bg-amber-400/10 p-3 text-xs text-amber-200">
        Gaps are potential until you validate them. A topic missing from your saved papers is not proof of novelty — check the wider literature before you rely on a gap.
      </div>
      <ErrorBox message={error} />
      {loading ? <Loading label="Loading gaps" /> : (data?.items.length ?? 0) === 0 && !error ? <Empty>No research gaps recorded yet.</Empty> : (
        <ul className="space-y-3">{data?.items.map((g) => <GapCard key={`${g.id}-${g.updated_at}`} gap={g} projectId={projectId} onChanged={onChanged} />)}</ul>
      )}
      <form onSubmit={submit} className="grid min-w-0 gap-3 rounded-xl border border-line-strong p-4" aria-label="Add research gap">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="min-w-0 sm:col-span-2">
            <label className={labelCls} htmlFor="gap-title">Gap title</label>
            <input id="gap-title" className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} />
          </div>
          <div className="min-w-0">
            <label className={labelCls} htmlFor="gap-cat">Category</label>
            <select id="gap-cat" className={inputCls} value={category} onChange={(e) => setCategory(e.target.value as GapCategory)}>
              {GAP_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className={labelCls} htmlFor="gap-desc">Description</label>
          <textarea id="gap-desc" className={cn(inputCls, "min-h-16")} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={4000} />
        </div>
        <div>
          <label className={labelCls} htmlFor="gap-ev">Supporting observations (optional)</label>
          <textarea id="gap-ev" className={cn(inputCls, "min-h-16")} value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={4000} />
        </div>
        <ErrorBox message={saveError} />
        <button type="submit" disabled={busy || title.trim().length < 3 || description.trim().length < 5} className={cn(buttonStyles("primary"), "min-h-11 justify-self-start disabled:opacity-50")}>Add potential gap</button>
      </form>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ History
const EVENT_LABEL: Record<string, string> = {
  memory_created: "Memory created", rebuilt: "Memory rebuilt", paper_processed: "Saved paper processed", paper_removed: "Paper removed from project",
  entry_created: "Entry added", entry_confirmed: "Entry confirmed", entry_rejected: "Entry rejected", entry_edited: "Entry edited", entry_unverified: "Entry restored to unverified",
  claim_added: "Claim added", claim_status: "Claim status changed", evidence_added: "Evidence added", decision_recorded: "Decision recorded",
  decision_superseded: "Decision superseded", decision_status: "Decision status changed", gap_added: "Gap added", gap_updated: "Gap updated",
};

export function HistorySection({ projectId, version }: Omit<Common, "onChanged">) {
  const load = useCallback(() => api.memory.audit(projectId, 100), [projectId]);
  const { data, error, loading } = useRemote(load, version);
  return (
    <div className="space-y-3">
      <ErrorBox message={error} />
      {loading ? <Loading label="Loading history" /> : (data?.items.length ?? 0) === 0 && !error ? <Empty>No memory activity yet.</Empty> : (
        <ol className="space-y-2">
          {data?.items.map((ev: MemoryEvent) => (
            <li key={ev.id} className="min-w-0 rounded-lg border border-line-strong bg-white/[0.02] px-3 py-2 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-slate-200">{EVENT_LABEL[ev.event_type] ?? ev.event_type}</span>
                <Badge tone={ev.actor === "researcher" ? "good" : "neutral"}>{ev.actor === "researcher" ? "You" : "System"}</Badge>
                <span className="text-muted">{when(ev.created_at)}</span>
              </div>
              {Object.keys(ev.detail).length > 0 && <p className="mt-1 text-muted [overflow-wrap:anywhere]">{JSON.stringify(ev.detail)}</p>}
            </li>
          ))}
        </ol>
      )}
      {data && data.total > data.items.length && <p className="text-xs text-muted">Showing the latest {data.items.length} of {data.total} events.</p>}
    </div>
  );
}
