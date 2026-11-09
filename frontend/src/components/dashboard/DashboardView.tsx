"use client";

import { Lock } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { Skeleton } from "@/components/ui/Skeleton";
import { buildProjectGraph, clusterSizes } from "@/lib/graph";
import { Counter } from "@/components/ui/Counter";
import { Reveal } from "@/components/ui/Reveal";
import { ProjectList } from "@/components/projects/ProjectList";
import { useMyPapers } from "@/hooks/useMyPapers";
import { useProjects } from "@/hooks/useProjects";
import { cn } from "@/lib/utils";

function ago(iso: string, now: number): string {
  const m = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d < 30 ? `${d} d ago` : new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
import { ActivityChart, BarList, PipelineProgress } from "./charts";

function tally(items: string[]): [string, number][] {
  const m = new Map<string, number>();
  for (const i of items) m.set(i, (m.get(i) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

const GHOSTS = [
  { title: "Literature discovery trends", desc: "Papers retrieved over time, by source.", phase: 3 },
  { title: "Knowledge graph growth", desc: "Nodes and relationships added per week.", phase: 4 },
  { title: "Experiment performance", desc: "Metrics per run with confidence intervals.", phase: 6 },
  { title: "Model comparison", desc: "Side-by-side evaluation across architectures.", phase: 6 },
];

function GhostChart({ title, desc, phase }: { title: string; desc: string; phase: number }) {
  return (
    <div className="rounded-xl border border-dashed border-line-strong p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">{title}</h3>
          <p className="mt-1 text-xs text-muted">{desc}</p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-muted">
          <Lock size={11} /> Phase {phase}
        </span>
      </div>
      <svg viewBox="0 0 240 80" className="mt-4 w-full" aria-hidden>
        <path d="M8 72h224M8 72V8" stroke="var(--line-strong)" fill="none" />
        {[24, 40, 56].map((y) => (
          <line key={y} x1="8" x2="232" y1={y} y2={y} stroke="var(--line)" strokeDasharray="2 4" />
        ))}
      </svg>
      <p className="mt-2 text-[11px] text-slate-600">No data — this module is not built yet.</p>
    </div>
  );
}

export function DashboardView() {
  const { projects, loading, error, status, refresh, loadedAt } = useProjects();

  const modalities = useMemo(() => tally(projects.map((p) => p.modality)), [projects]);
  const diseases = useMemo(() => tally(projects.map((p) => p.disease)), [projects]);

  const { papers, loading: papersLoading, error: papersError } = useMyPapers();
  const graph = useMemo(() => buildProjectGraph(projects, papers), [projects, papers]);
  const clusters = useMemo(() => clusterSizes(graph.nodes, graph.edges), [graph]);
  const timeline = useMemo(
    () => [...projects].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 6),
    [projects],
  );
  const ready = !loading && !error;

  const stats: { label: string; value: number | null; note: string; live: boolean }[] = [
    { label: "Research projects", value: loading || error ? null : projects.length, note: "Live from PostgreSQL", live: true },
    { label: "Saved papers", value: papersLoading || papersError ? null : papers.length, note: "Saved from OpenAlex / Europe PMC", live: true },
    { label: "Project graph nodes", value: ready ? graph.nodes.length : null, note: "Derived from your projects and saved papers", live: true },
    { label: "Completed experiments", value: null, note: "Not available yet", live: false },
    { label: "Active pipelines", value: null, note: "Not available yet", live: false },
  ];

  return (
    <div className="mx-auto max-w-7xl px-6 py-14">
      <Reveal>
        <p className="eyebrow">Dashboard</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Research overview</h1>
        <p className="mt-3 max-w-xl text-sm text-muted">
          Everything shown here is computed from your database. Metrics for modules that are not built yet are left
          empty rather than estimated.
        </p>
      </Reveal>

      {error && (
        <div role="alert" className="mt-8 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
          {error}
          <button onClick={refresh} className="ml-3 underline">Retry</button>
        </div>
      )}

      {/* one continuous strip rather than five identical cards */}
      <Reveal delay={0.05}>
        <dl className="glass mt-10 grid grid-cols-2 divide-line rounded-2xl sm:grid-cols-3 lg:grid-cols-5 lg:divide-x">
          {stats.map((s) => (
            <div key={s.label} className="p-5">
              <dt className="text-xs text-muted">{s.label}</dt>
              <dd className="mt-2 text-3xl font-semibold tabular-nums">
                {s.value === null ? (loading && s.live ? <Skeleton className="h-9 w-14" /> : <span className="text-slate-600">—</span>) : <Counter value={s.value} />}
              </dd>
              <p className={cn("mt-2 font-mono text-[10px] uppercase tracking-wider", s.live ? "text-emerald-300" : "text-slate-600")}>
                {s.live ? `● ${status === "online" ? s.note : "Backend not reachable"}` : s.note}
              </p>
            </div>
          ))}
        </dl>
      </Reveal>

      <div className="mt-8 grid gap-8 lg:grid-cols-3">
        <Reveal delay={0.05} className="lg:col-span-2">
          <section className="glass h-full rounded-2xl p-6">
            <h2 className="mb-4 text-sm font-medium">Research activity</h2>
            {loading || !loadedAt ? <Skeleton className="h-[220px]" /> : <ActivityChart projects={projects} today={loadedAt} />}
          </section>
        </Reveal>
        <Reveal delay={0.1}>
          <section className="glass h-full rounded-2xl p-6">
            <h2 className="mb-4 text-sm font-medium">Recent projects</h2>
            <ProjectList limit={3} />
            {projects.length > 3 && (
              <Link href="/workspace" className="mt-4 inline-block text-xs text-cyan hover:underline">
                All {projects.length} projects →
              </Link>
            )}
          </section>
        </Reveal>
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-3">
        <Reveal className="lg:col-span-2">
          <section className="glass lift h-full rounded-2xl p-6">
            <h2 className="mb-5 text-sm font-medium">Research timeline</h2>
            {loading ? (
              <div className="space-y-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div>
            ) : timeline.length === 0 ? (
              <p className="text-sm text-muted">No projects yet. Created projects appear here in order.</p>
            ) : (
              <ol className="relative space-y-5 border-l border-line pl-6">
                {timeline.map((p) => (
                  <li key={p.id} className="relative">
                    <span className="absolute -left-[29px] top-1.5 h-2.5 w-2.5 rounded-full border border-cyan bg-ink-950 shadow-[0_0_12px_rgba(0,207,255,0.7)]" aria-hidden />
                    <p className="font-mono text-[10px] uppercase tracking-wider text-muted">
                      {loadedAt ? ago(p.created_at, loadedAt.getTime()) : ""} · {p.modality}
                    </p>
                    <p className="mt-1 line-clamp-2 text-sm text-slate-200">{p.research_question}</p>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </Reveal>
        <Reveal delay={0.05}>
          <section className="glass lift h-full rounded-2xl p-6">
            <h2 className="text-sm font-medium">Knowledge graph</h2>
            <p className="mt-1 text-xs text-muted">Computed from your saved projects. Includes papers you saved from the Literature page.</p>
            <dl className="mt-5 grid grid-cols-3 gap-3">
              {[
                ["Nodes", graph.nodes.length],
                ["Links", graph.edges.length],
                ["Clusters", clusters.length],
              ].map(([label, v]) => (
                <div key={label as string}>
                  <dt className="text-[11px] text-muted">{label}</dt>
                  <dd className="mt-1 text-2xl font-semibold tabular-nums">{ready ? <Counter value={v as number} /> : <Skeleton className="h-8 w-10" />}</dd>
                </div>
              ))}
            </dl>
            <Link href="/knowledge-graph" className="mt-5 inline-block text-xs text-cyan hover:underline">Explore in 3D →</Link>
          </section>
        </Reveal>
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-3">
        <Reveal>
          <section className="glass h-full rounded-2xl p-6"><BarList title="By imaging modality" entries={modalities} /></section>
        </Reveal>
        <Reveal delay={0.05}>
          <section className="glass h-full rounded-2xl p-6"><BarList title="By research domain" entries={diseases} /></section>
        </Reveal>
        <Reveal delay={0.1}>
          <section className="glass h-full rounded-2xl p-6">
            <h3 className="mb-4 text-sm font-medium">Pipeline progress</h3>
            <PipelineProgress count={projects.length} />
          </section>
        </Reveal>
      </div>

      <Reveal>
        <section className="mt-14">
          <p className="eyebrow">Unlocks as modules ship</p>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {GHOSTS.map((g) => (
              <GhostChart key={g.title} {...g} />
            ))}
          </div>
        </section>
      </Reveal>
    </div>
  );
}
