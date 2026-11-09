"use client";

import { ExternalLink, Loader2, Search, Trash2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import { buttonStyles } from "@/components/ui/MagneticButton";
import { useMyPapers } from "@/hooks/useMyPapers";
import { useProjects } from "@/hooks/useProjects";
import { ApiError, api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { ExtractedTag, LiteratureSource, Paper, PaperHit } from "@/types/paper";

const SOURCES: { id: LiteratureSource; label: string }[] = [
  { id: "all", label: "All sources" },
  { id: "openalex", label: "OpenAlex" },
  { id: "europepmc", label: "Europe PMC" },
];
const SOURCE_NAME: Record<string, string> = { openalex: "OpenAlex", europepmc: "Europe PMC" };
const TAG_GROUPS = [
  ["modalities", "Modality"],
  ["diseases", "Disease"],
  ["datasets", "Dataset"],
  ["methods", "Method"],
] as const;

const keyOf = (h: { source: string; external_id: string }) => `${h.source}:${h.external_id}`;

function Tags({ paper }: { paper: PaperHit }) {
  const groups = TAG_GROUPS.map(([k, label]) => [label, (paper.extracted[k] ?? []) as ExtractedTag[]] as const).filter(([, l]) => l.length);
  if (!groups.length) return <p className="mt-3 text-xs text-muted">No modality, disease, dataset or method terms detected.</p>;
  return (
    <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Detected terms">
      {groups.flatMap(([label, list]) =>
        list.map((t) => (
          <span key={`${label}:${t.value}`} title={`${label} — matched “${t.matched}” in the ${t.field}`}
            className="rounded-full border border-line px-2 py-0.5 text-[11px] text-slate-300">
            <span className="text-muted">{label}:</span> {t.value}
          </span>
        )),
      )}
    </div>
  );
}

function Card({ paper, children }: { paper: PaperHit; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded-2xl border border-line bg-white/[0.02] p-5">
      <h3 className="text-[15px] font-medium leading-snug">{paper.title}</h3>
      <p className="mt-1.5 text-xs text-muted">
        {[paper.authors.slice(0, 4).join(", ") + (paper.authors.length > 4 ? " et al." : ""), paper.year, paper.venue].filter(Boolean).join(" · ")}
      </p>
      <p className="mt-1 text-xs text-muted">
        {SOURCE_NAME[paper.source] ?? paper.source}
        {paper.cited_by_count != null && ` · cited by ${paper.cited_by_count}`}
        {paper.doi && ` · doi:${paper.doi}`}
      </p>
      <Tags paper={paper} />
      {paper.abstract ? (
        <div className="mt-3 text-sm text-slate-300">
          <p className={cn(!open && "line-clamp-3")}>{paper.abstract}</p>
          <button type="button" onClick={() => setOpen((v) => !v)} className="mt-1 text-xs text-sky-300 underline">
            {open ? "Show less" : "Show full abstract"}
          </button>
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted">No abstract provided by the source.</p>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {children}
        {paper.url && (
          <a href={paper.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-muted hover:text-white">
            Open source <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        )}
      </div>
    </li>
  );
}

export function LiteratureWorkspace() {
  const { projects, loading: projectsLoading } = useProjects();
  const { papers, loading: papersLoading, error: papersError, refresh } = useMyPapers();
  const [tab, setTab] = useState<"search" | "saved">("search");
  const [projectId, setProjectId] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const [source, setSource] = useState<LiteratureSource>("all");
  const [results, setResults] = useState<PaperHit[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [saveErr, setSaveErr] = useState<Record<string, string>>({});

  const activeId = projectId ?? projects[0]?.id ?? null;
  const savedInProject = useMemo(() => {
    const m = new Map<string, Paper>();
    for (const p of papers) if (activeId != null && p.project_ids.includes(activeId)) m.set(keyOf(p), p);
    return m;
  }, [papers, activeId]);
  const projectPapers = useMemo(() => papers.filter((p) => activeId != null && p.project_ids.includes(activeId)), [papers, activeId]);

  async function run(query: string, nextPage: number, append: boolean) {
    setBusy(true);
    setError("");
    try {
      const r = await api.searchLiterature(query, source, nextPage);
      setResults((prev) => (append ? [...prev, ...r.results] : r.results));
      setWarnings(r.warnings);
      setPage(nextPage);
      setSearched(query);
    } catch (e) {
      if (!append) setResults([]);
      setError(e instanceof ApiError ? e.message : "Search failed. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }
  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const t = q.trim();
    if (t.length >= 2 && !busy) void run(t, 1, false);
  }
  async function save(h: PaperHit) {
    if (activeId == null) return;
    const k = keyOf(h);
    setSaving((s) => new Set(s).add(k));
    setSaveErr((m) => ({ ...m, [k]: "" }));
    try {
      await api.savePaper(activeId, { source: h.source, external_id: h.external_id });
      refresh();
    } catch (e) {
      setSaveErr((m) => ({ ...m, [k]: e instanceof ApiError ? e.message : "Could not save this paper." }));
    } finally {
      setSaving((s) => {
        const n = new Set(s);
        n.delete(k);
        return n;
      });
    }
  }
  async function remove(p: Paper) {
    if (activeId == null) return;
    try {
      await api.removePaper(activeId, p.id);
      refresh();
    } catch (e) {
      setSaveErr((m) => ({ ...m, [keyOf(p)]: e instanceof ApiError ? e.message : "Could not remove this paper." }));
    }
  }

  const noProject = !projectsLoading && projects.length === 0;

  return (
    <div className="mx-auto max-w-5xl px-6 py-14">
      <p className="eyebrow">Literature</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">Find and save real publications</h1>
      <p className="mt-3 max-w-2xl text-sm text-muted">
        Results come live from OpenAlex and Europe PMC. Saved papers are stored in your project. Detected terms are
        rule-based matches on each paper’s own title and abstract (hover a tag to see what matched), not AI summaries.
      </p>

      {noProject ? (
        <div className="mt-8 rounded-2xl border border-line p-6 text-sm">
          <p>Create a research project first. Saved papers belong to a project.</p>
          <Link href="/workspace" className={cn(buttonStyles("primary"), "mt-4 inline-flex")}>Create a project</Link>
        </div>
      ) : (
        <>
          <div className="mt-8 flex flex-wrap items-center gap-3 text-sm">
            <label htmlFor="lit-project" className="text-muted">Save to project</label>
            <select id="lit-project" value={activeId ?? ""} onChange={(e) => setProjectId(Number(e.target.value))}
              className="max-w-xs rounded-lg border border-line bg-transparent px-3 py-1.5">
              {projects.map((p) => (
                <option key={p.id} value={p.id} className="bg-slate-900">#{p.id} · {p.research_question.slice(0, 60)}</option>
              ))}
            </select>
          </div>

          <div role="tablist" aria-label="Literature view" className="mt-6 flex gap-2 border-b border-line text-sm">
            {(["search", "saved"] as const).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
                className={cn("-mb-px border-b-2 px-3 py-2", tab === t ? "border-sky-400 text-white" : "border-transparent text-muted")}>
                {t === "search" ? "Search" : `Saved (${projectPapers.length})`}
              </button>
            ))}
          </div>

          {tab === "search" ? (
            <section className="mt-6">
              <form onSubmit={onSubmit} className="flex flex-wrap gap-3" role="search">
                <div className="relative min-w-[16rem] flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
                  <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search publications" maxLength={200}
                    placeholder="e.g. alzheimer MRI biomarkers deep learning"
                    className="w-full rounded-xl border border-line bg-transparent py-2.5 pl-9 pr-3 text-sm outline-none focus:border-sky-400" />
                </div>
                <select value={source} onChange={(e) => setSource(e.target.value as LiteratureSource)} aria-label="Source"
                  className="rounded-xl border border-line bg-transparent px-3 text-sm">
                  {SOURCES.map((s) => <option key={s.id} value={s.id} className="bg-slate-900">{s.label}</option>)}
                </select>
                <button type="submit" disabled={busy || q.trim().length < 2} className={cn(buttonStyles("primary"), "disabled:opacity-50")}>
                  {busy && page === 0 ? "Searching…" : "Search"}
                </button>
              </form>

              {error && <div role="alert" className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}
              {warnings.map((w) => <p key={w} role="status" className="mt-3 text-xs text-amber-300">{w}</p>)}
              {searched && !busy && !error && results.length === 0 && (
                <p className="mt-6 text-sm text-muted">No publications found for “{searched}”.</p>
              )}

              <ul className="mt-5 space-y-4">
                {results.map((h) => {
                  const k = keyOf(h);
                  const done = savedInProject.has(k) || (h.doi != null && [...savedInProject.values()].some((p) => p.doi === h.doi));
                  return (
                    <Card key={k} paper={h}>
                      {done ? (
                        <span className="text-xs text-emerald-300">✓ Saved to this project</span>
                      ) : (
                        <button type="button" onClick={() => void save(h)} disabled={saving.has(k) || activeId == null}
                          className={cn(buttonStyles("ghost"), "inline-flex items-center gap-2 !py-1.5 text-xs disabled:opacity-60")}>
                          {saving.has(k) && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
                          {saving.has(k) ? "Saving…" : "Add to project"}
                        </button>
                      )}
                      {saveErr[k] && <span role="alert" className="text-xs text-red-300">{saveErr[k]}</span>}
                    </Card>
                  );
                })}
              </ul>
              {results.length > 0 && (
                <button type="button" onClick={() => void run(searched, page + 1, true)} disabled={busy}
                  className={cn(buttonStyles("ghost"), "mt-6")}>
                  {busy ? "Loading…" : "Load more"}
                </button>
              )}
            </section>
          ) : (
            <section className="mt-6">
              {papersError && <div role="alert" className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{papersError}</div>}
              {papersLoading ? (
                <div className="h-24 animate-pulse rounded-2xl bg-white/[0.03]" aria-busy="true" />
              ) : projectPapers.length === 0 ? (
                <p className="text-sm text-muted">No papers saved to this project yet. Use Search to add some.</p>
              ) : (
                <ul className="space-y-4">
                  {projectPapers.map((p) => (
                    <Card key={p.id} paper={p}>
                      <button type="button" onClick={() => void remove(p)}
                        className="inline-flex items-center gap-1 text-xs text-muted hover:text-red-300" aria-label={`Remove ${p.title}`}>
                        <Trash2 className="h-3 w-3" aria-hidden /> Remove
                      </button>
                      {p.cites.length > 0 && <span className="text-xs text-sky-300">Cites {p.cites.length} other saved paper{p.cites.length > 1 ? "s" : ""}</span>}
                      {saveErr[keyOf(p)] && <span role="alert" className="text-xs text-red-300">{saveErr[keyOf(p)]}</span>}
                    </Card>
                  ))}
                </ul>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
