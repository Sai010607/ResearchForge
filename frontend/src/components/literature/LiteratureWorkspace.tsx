"use client";

import { ExternalLink, Loader2, Search, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { buttonStyles } from "@/components/ui/MagneticButton";
import { useMyPapers } from "@/hooks/useMyPapers";
import { useProjects } from "@/hooks/useProjects";
import { ApiError, api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { ExtractedTag, Paper, PaperHit, ProviderInfo, ProviderStatus } from "@/types/paper";

const usable = (p: ProviderInfo) => !p.requires_key || p.key_configured; // providers that need a key the server lacks cannot be selected
const PRESETS: { label: string; pick: (p: ProviderInfo[]) => string[] }[] = [
  { label: "Select all", pick: (p) => p.filter(usable).map((x) => x.id) },
  { label: "Biomedical", pick: (p) => p.filter((x) => usable(x) && (x.group === "biomedical" || x.id === "openalex")).map((x) => x.id) },
  { label: "Computer science", pick: (p) => p.filter((x) => usable(x) && (x.group === "cs" || x.id === "openalex")).map((x) => x.id) },
  { label: "Deselect all", pick: () => [] },
];
const TAG_GROUPS = [
  ["modalities", "Modality"],
  ["diseases", "Disease"],
  ["datasets", "Dataset"],
  ["methods", "Method"],
] as const;

const keyOf = (h: { source: string; external_id: string }) => `${h.source}:${h.external_id}`;
const refsOf = (h: PaperHit) => (h.sources?.length ? h.sources.map((s) => `${s.provider}:${s.external_id}`) : [keyOf(h)]);
const providerName = (id: string) => ({ openalex: "OpenAlex", europepmc: "Europe PMC", pubmed: "PubMed", crossref: "Crossref", semanticscholar: "Semantic Scholar", arxiv: "arXiv" })[id] ?? id;

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
  const links = paper.links ?? [];
  // "Open source" prefers the publisher page, then the DOI, then PubMed, then whatever the source gave
  const primary = ["publisher", "doi", "pubmed", "arxiv"].map((k) => links.find((l) => l.kind === k)).find(Boolean) ?? (paper.url ? { url: paper.url } : links[0]);
  return (
    <li className="rounded-2xl border border-line bg-white/[0.02] p-5">
      <h3 className="text-[15px] font-medium leading-snug">{paper.title}</h3>
      <p className="mt-1.5 text-xs text-muted">
        {[paper.authors.slice(0, 4).join(", ") + (paper.authors.length > 4 ? " et al." : ""), paper.year, paper.venue].filter(Boolean).join(" · ")}
      </p>
      <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
        {(paper.sources?.length ? paper.sources.map((s) => s.provider) : [paper.source]).map((id) => (
          <span key={id} className="rounded border border-line px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-300">{providerName(id)}</span>
        ))}
        {paper.preprint && (
          <span title="Record from a preprint server or DOI prefix; it may not be peer-reviewed." className="rounded border border-amber-400/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-300">Preprint</span>
        )}
        <span>
          {paper.cited_by_count != null && `cited by ${paper.cited_by_count}`}
          {paper.doi && `${paper.cited_by_count != null ? " · " : ""}doi:${paper.doi}`}
        </span>
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
        {primary && (
          <a href={primary.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-sky-300 hover:text-white">
            Open source <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        )}
      </div>
      {links.length > 0 && (
        <ul aria-label="Links" className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
          {links.map((l) => (
            <li key={l.url}>
              <a href={l.url} target="_blank" rel="noopener noreferrer" title={l.url} className="text-muted underline-offset-2 hover:text-white hover:underline">
                {l.label}
                {l.kind === "doi" && paper.doi ? `: ${paper.doi}` : l.kind === "pubmed" && paper.pmid ? ` ${paper.pmid}` : l.kind === "pmc" && paper.pmcid ? ` ${paper.pmcid}` : l.kind === "arxiv" && paper.arxiv_id ? ` ${paper.arxiv_id}` : ""}
              </a>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function LiteratureWorkspace() {
  const { projects, loading: projectsLoading } = useProjects();
  const { papers, loading: papersLoading, error: papersError, refresh } = useMyPapers();
  const [tab, setTab] = useState<"search" | "saved">("search");
  const [projectId, setProjectId] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [providerError, setProviderError] = useState("");
  const [providerTry, setProviderTry] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [stats, setStats] = useState<Record<string, ProviderStatus>>({});
  const [duration, setDuration] = useState(0);
  const [results, setResults] = useState<PaperHit[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [appending, setAppending] = useState(false);
  const [searched, setSearched] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [saveErr, setSaveErr] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    api
      .literatureProviders()
      .then((list) => {
        if (!alive) return;
        setProviders(list);
        setProviderError("");
        setSelected((prev) => (prev.length ? prev : list.filter((p) => p.default_enabled).map((p) => p.id)));
      })
      .catch((e: unknown) => alive && setProviderError(e instanceof ApiError ? e.message : "Could not load the list of sources."));
    return () => {
      alive = false;
    };
  }, [providerTry]);

  const activeId = projectId ?? projects[0]?.id ?? null;
  const savedInProject = useMemo(() => {
    const m = new Map<string, Paper>();
    for (const p of papers) if (activeId != null && p.project_ids.includes(activeId)) m.set(keyOf(p), p);
    return m;
  }, [papers, activeId]);
  const projectPapers = useMemo(() => papers.filter((p) => activeId != null && p.project_ids.includes(activeId)), [papers, activeId]);

  async function run(query: string, nextPage: number, append: boolean) {
    setBusy(true);
    setAppending(append);
    setError("");
    if (!append) {
      setResults([]);
      setStats({});
      setWarnings([]);
    }
    try {
      const r = await api.searchLiterature(query, selected, nextPage);
      setResults((prev) => {
        if (!append) return r.results;
        const seen = new Set(prev.flatMap(refsOf));
        return [...prev, ...r.results.filter((h) => !refsOf(h).some((k) => seen.has(k)))];
      });
      setStats((prev) => {
        const next: Record<string, ProviderStatus> = append ? { ...prev } : {};
        for (const st of r.providers) {
          const before = append ? prev[st.provider] : undefined;
          next[st.provider] = { ...st, count: st.count + (before?.count ?? 0), duration_ms: st.duration_ms + (before?.duration_ms ?? 0) };
        }
        return next;
      });
      setDuration((d) => (append ? d : 0) + r.duration_ms);
      setWarnings(r.warnings);
      setPage(nextPage);
      setSearched(query);
    } catch (e) {
      if (!append) {
        setResults([]);
        setStats({});
      }
      setError(e instanceof ApiError ? e.message : "Search failed. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }
  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const t = q.trim();
    if (t.length >= 3 && !busy && selected.length > 0) void run(t, 1, false);
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

  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!busy) return;
    const t = setTimeout(() => setSlow(true), 6000);
    return () => {
      clearTimeout(t);
      setSlow(false);
    };
  }, [busy]);

  const noProject = !projectsLoading && projects.length === 0;

  return (
    <div className="mx-auto max-w-5xl px-6 py-14">
      <p className="eyebrow">Literature</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">Find and save real publications</h1>
      <p className="mt-3 max-w-2xl text-sm text-muted">
        Results come live from OpenAlex, PubMed, Europe PMC, Crossref, arXiv and (optionally) Semantic Scholar, merged and de-duplicated by DOI, PMID and arXiv id. Saved papers are stored in your project. Detected terms are
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
                <button type="submit" disabled={busy || q.trim().length < 3 || selected.length === 0} className={cn(buttonStyles("primary"), "disabled:opacity-50")}>
                  {busy && !appending ? "Searching…" : "Search"}
                </button>
              </form>

              <fieldset className="mt-4">
                <legend className="mb-2 text-xs text-muted">Sources</legend>
                {providerError ? (
                  <p role="alert" className="text-xs text-red-300">
                    {providerError}{" "}
                    <button type="button" className="underline" onClick={() => setProviderTry((n) => n + 1)}>Retry</button>
                  </p>
                ) : providers.length === 0 ? (
                  <div className="h-7 w-64 animate-pulse rounded-full bg-white/[0.04]" aria-busy="true" />
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    {PRESETS.map((pr) => (
                      <button key={pr.label} type="button" onClick={() => setSelected(pr.pick(providers))}
                        className="rounded-full px-2 py-1 text-[11px] text-muted underline-offset-2 hover:text-white hover:underline">{pr.label}</button>
                    ))}
                    <span className="mx-1 h-4 w-px bg-line" aria-hidden />
                    {providers.map((p) => {
                      const off = !usable(p);
                      const on = !off && selected.includes(p.id);
                      return (
                        <label key={p.id}
                          title={off ? `Needs an API key (${p.env_var ?? "see LITERATURE.md"}) set on the server. Not configured.` : `${p.rate_limit}${p.supports_key && !p.key_configured ? ". Optional API key not set on the server." : ""}`}
                          className={cn("rounded-full border px-3 py-1 text-xs", off ? "cursor-not-allowed border-dashed border-line text-muted/50" : "cursor-pointer", !off && (on ? "border-sky-400 text-white" : "border-line text-muted"))}>
                          <input type="checkbox" className="sr-only" checked={on} disabled={off}
                            onChange={() => setSelected((s) => (on ? s.filter((x) => x !== p.id) : [...s, p.id]))} />
                          {p.name}{off && <span className="ml-1 text-[10px]">(key needed)</span>}
                        </label>
                      );
                    })}
                  </div>
                )}
              </fieldset>

              {error && (
                <div role="alert" className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
                  {error}
                  <button type="button" onClick={() => void run(q.trim(), 1, false)} className="ml-3 underline">Retry</button>
                </div>
              )}
              {searched && !error && !(busy && !appending) && (
                <div role="status" className="mt-4 text-xs text-muted">
                  <p>
                    <strong className="text-slate-200">{results.length}</strong> unique papers for “{searched}” · page {page} · {(duration / 1000).toFixed(1)} s
                  </p>
                  <p className="mt-1 flex flex-wrap gap-2">
                    {Object.values(stats).map((st) => (
                      <span key={st.provider} title={st.error ?? `${st.count} records returned, before duplicates were merged`}
                        className={cn("rounded border px-1.5 py-0.5", st.ok ? "border-line" : "border-red-500/40 text-red-300")}>
                        {st.name}: {st.ok ? st.count : st.error_kind === "timeout" ? "timed out" : st.error_kind === "rate_limit" ? "rate-limited" : st.error_kind === "not_configured" ? "not configured" : "failed"}
                      </span>
                    ))}
                  </p>
                  {warnings.map((w) => <p key={w} className="mt-1 text-amber-300">{w}</p>)}
                </div>
              )}
              {searched && !busy && !error && results.length === 0 && (
                <p className="mt-6 text-sm text-muted">No publications found for “{searched}”.</p>
              )}

              {busy && !appending && (
                <div aria-busy="true" aria-label="Searching" className="mt-5 space-y-4">
                  {[0, 1, 2].map((i) => <div key={i} className="h-32 animate-pulse rounded-2xl bg-white/[0.03]" />)}
                  {slow && <p className="text-xs text-muted">Still searching. The server may be waking up or a source is slow; the other sources will still be shown.</p>}
                </div>
              )}
              <ul className="mt-5 space-y-4">
                {results.map((h) => {
                  const k = keyOf(h);
                  const done = refsOf(h).some((r) => savedInProject.has(r)) || (h.doi != null && [...savedInProject.values()].some((p) => p.doi === h.doi)) || (h.pmid != null && [...savedInProject.values()].some((p) => p.pmid === h.pmid));
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
