"use client";

import { Loader2, Search, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { PaperCard } from "@/components/literature/PaperCard";
import { ProviderPicker, ProviderStatusList } from "@/components/literature/ProviderPanel";
import { buttonStyles } from "@/components/ui/MagneticButton";
import { useMyPapers } from "@/hooks/useMyPapers";
import { useProjects } from "@/hooks/useProjects";
import { ApiError, api } from "@/lib/api";
import { appendResults, byRelevance, keyOf, refsOf } from "@/lib/literature";
import { cn } from "@/lib/utils";
import type { Paper, PaperHit, ProviderInfo, ProviderStatus } from "@/types/paper";

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
  const [retrying, setRetrying] = useState<string | null>(null);
  const [searched, setSearched] = useState("");
  const [searchedWith, setSearchedWith] = useState<string[]>([]);
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

  function mergeStats(list: ProviderStatus[], accumulate: boolean) {
    setStats((prev) => {
      const next: Record<string, ProviderStatus> = accumulate ? { ...prev } : {};
      for (const st of list) {
        const before = accumulate ? prev[st.provider] : undefined;
        next[st.provider] = {
          ...st,
          count: st.count + (before?.ok ? before.count : 0),
          duration_ms: st.duration_ms + (before?.duration_ms ?? 0),
          retries: (st.retries ?? 0) + (before?.retries ?? 0),
        };
      }
      return next;
    });
  }

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
      setResults((prev) => appendResults(append ? prev : [], r.results));
      mergeStats(r.providers, append);
      setDuration((d) => (append ? d : 0) + r.duration_ms);
      setWarnings(r.warnings);
      setPage(nextPage);
      setSearched(query);
      if (!append) setSearchedWith(selected);
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

  /** Re-run only one failed source for the page already on screen; its papers are merged into the list. */
  async function retryProvider(id: string) {
    setRetrying(id);
    try {
      const r = await api.searchLiterature(searched, [id], page);
      setResults((prev) => {
        const merged = appendResults(prev, r.results);
        return page === 1 ? [...merged].sort(byRelevance) : merged;
      });
      setStats((prev) => {
        const st = r.providers[0];
        return st ? { ...prev, [id]: { ...st, retries: (st.retries ?? 0) + (prev[id]?.retries ?? 0) } } : prev;
      });
      setWarnings((w) => w.filter((x) => !x.startsWith(`${stats[id]?.name ?? id}:`)));
    } catch (e) {
      setStats((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id], ok: false, error: e instanceof ApiError ? e.message : "Retry failed.", error_kind: "error" } } : prev));
    } finally {
      setRetrying(null);
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
  const statList = Object.values(stats);

  return (
    <div className="mx-auto min-w-0 max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
      <p className="eyebrow">Literature</p>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">Find and save real publications</h1>
      <p className="mt-3 max-w-2xl text-sm text-muted">
        Searches several scholarly sources at once, merges papers that share a DOI, PMID, PMCID or arXiv id, and ranks them by how well each one matches your query. Detected terms are rule-based matches on each
        paper’s own title and abstract, not AI summaries.
      </p>

      {noProject ? (
        <div className="mt-8 rounded-2xl border border-line p-6 text-sm">
          <p>Create a research project first. Saved papers belong to a project.</p>
          <Link href="/workspace" className={cn(buttonStyles("primary"), "mt-4 inline-flex")}>Create a project</Link>
        </div>
      ) : (
        <>
          <div className="mt-8 flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:gap-3">
            <label htmlFor="lit-project" className="text-muted">Save to project</label>
            <select id="lit-project" value={activeId ?? ""} onChange={(e) => setProjectId(Number(e.target.value))}
              className="w-full min-w-0 rounded-lg border border-line bg-transparent px-3 py-2 sm:w-auto sm:max-w-md">
              {projects.map((p) => (
                <option key={p.id} value={p.id} className="bg-slate-900">#{p.id} · {p.research_question.slice(0, 60)}</option>
              ))}
            </select>
          </div>

          <div role="tablist" aria-label="Literature view" className="mt-6 flex gap-2 border-b border-line text-sm">
            {(["search", "saved"] as const).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
                className={cn("-mb-px min-h-10 border-b-2 px-3 py-2", tab === t ? "border-sky-400 text-white" : "border-transparent text-muted")}>
                {t === "search" ? "Search" : `Saved (${projectPapers.length})`}
              </button>
            ))}
          </div>

          {tab === "search" ? (
            <section className="mt-6 min-w-0">
              <form onSubmit={onSubmit} className="flex gap-2 sm:gap-3" role="search">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
                  <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search publications" maxLength={200}
                    placeholder="e.g. alzheimer MRI deep learning" enterKeyHint="search"
                    className="min-h-11 w-full min-w-0 rounded-xl border border-line bg-transparent py-2.5 pl-9 pr-3 text-base outline-none focus:border-sky-400 sm:text-sm" />
                </div>
                <button type="submit" disabled={busy || q.trim().length < 3 || selected.length === 0}
                  className={cn(buttonStyles("primary"), "min-h-11 shrink-0 !px-4 disabled:opacity-50 sm:!px-6")}>
                  {busy && !appending ? "Searching…" : "Search"}
                </button>
              </form>

              <fieldset className="mt-4 min-w-0">
                <legend className="mb-2 text-xs text-muted">Sources</legend>
                {providerError ? (
                  <p role="alert" className="text-xs text-red-300">
                    {providerError}{" "}
                    <button type="button" className="underline" onClick={() => setProviderTry((n) => n + 1)}>Retry</button>
                  </p>
                ) : providers.length === 0 ? (
                  <div className="h-7 w-full max-w-64 animate-pulse rounded-full bg-white/[0.04]" aria-busy="true" />
                ) : (
                  <ProviderPicker providers={providers} selected={selected} onSelect={setSelected} />
                )}
              </fieldset>

              {error && (
                <div role="alert" className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300 [overflow-wrap:anywhere]">
                  {error}
                  <button type="button" onClick={() => void run(q.trim(), 1, false)} className="ml-3 min-h-8 underline">Retry</button>
                </div>
              )}
              {searched && !error && !(busy && !appending) && (
                <div role="status" className="mt-4 text-xs text-muted">
                  <p className="[overflow-wrap:anywhere]">
                    <strong className="text-slate-200">{results.length}</strong> unique papers for “{searched}” · page {page} · {(duration / 1000).toFixed(1)} s
                    {searchedWith.length > 0 && <> · {searchedWith.length} source{searchedWith.length === 1 ? "" : "s"}</>}
                  </p>
                  <ProviderStatusList stats={statList} retrying={retrying} onRetry={(id) => void retryProvider(id)} />
                  {warnings.map((w) => <p key={w} className="mt-1 text-amber-300 [overflow-wrap:anywhere]">{w}</p>)}
                </div>
              )}
              {searched && !busy && !error && results.length === 0 && (
                <p className="mt-6 text-sm text-muted [overflow-wrap:anywhere]">No publications found for “{searched}”.</p>
              )}

              {busy && !appending && (
                <div aria-busy="true" aria-label="Searching" className="mt-5 space-y-4">
                  {[0, 1, 2].map((i) => <div key={i} className="h-32 animate-pulse rounded-2xl bg-white/[0.03]" />)}
                  {slow && <p className="text-xs text-muted">Still searching. The server may be waking up or a source is slow; the other sources will still be shown.</p>}
                </div>
              )}
              <ul className="mt-5 min-w-0 space-y-4">
                {results.map((h) => {
                  const k = keyOf(h);
                  const done = refsOf(h).some((r) => savedInProject.has(r)) || (h.doi != null && [...savedInProject.values()].some((p) => p.doi === h.doi)) || (h.pmid != null && [...savedInProject.values()].some((p) => p.pmid === h.pmid));
                  return (
                    <PaperCard key={k} paper={h} providers={providers}>
                      {done ? (
                        <span className="text-xs text-emerald-300">✓ Saved to this project</span>
                      ) : (
                        <button type="button" onClick={() => void save(h)} disabled={saving.has(k) || activeId == null}
                          className={cn(buttonStyles("ghost"), "inline-flex min-h-10 items-center gap-2 !py-1.5 text-xs disabled:opacity-60")}>
                          {saving.has(k) && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
                          {saving.has(k) ? "Saving…" : "Add to project"}
                        </button>
                      )}
                      {saveErr[k] && <span role="alert" className="text-xs text-red-300 [overflow-wrap:anywhere]">{saveErr[k]}</span>}
                    </PaperCard>
                  );
                })}
              </ul>
              {results.length > 0 && (
                <button type="button" onClick={() => void run(searched, page + 1, true)} disabled={busy}
                  className={cn(buttonStyles("ghost"), "mt-6 min-h-11")}>
                  {busy ? "Loading…" : "Load more"}
                </button>
              )}
            </section>
          ) : (
            <section className="mt-6 min-w-0">
              {papersError && <div role="alert" className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{papersError}</div>}
              {papersLoading ? (
                <div className="h-24 animate-pulse rounded-2xl bg-white/[0.03]" aria-busy="true" />
              ) : projectPapers.length === 0 ? (
                <p className="text-sm text-muted">No papers saved to this project yet. Use Search to add some.</p>
              ) : (
                <ul className="min-w-0 space-y-4">
                  {projectPapers.map((p) => (
                    <PaperCard key={p.id} paper={p} providers={providers}>
                      <button type="button" onClick={() => void remove(p)}
                        className="inline-flex min-h-9 items-center gap-1 text-xs text-muted hover:text-red-300" aria-label={`Remove ${p.title}`}>
                        <Trash2 className="h-3 w-3" aria-hidden /> Remove
                      </button>
                      {p.cites.length > 0 && <span className="text-xs text-sky-300">Cites {p.cites.length} other saved paper{p.cites.length > 1 ? "s" : ""}</span>}
                      {saveErr[keyOf(p)] && <span role="alert" className="text-xs text-red-300">{saveErr[keyOf(p)]}</span>}
                    </PaperCard>
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
