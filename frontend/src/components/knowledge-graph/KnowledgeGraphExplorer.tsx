"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Search, X } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useState } from "react";
import { WebGLBoundary } from "@/components/ui/WebGLBoundary";
import { useProjects } from "@/hooks/useProjects";
import { buildProjectGraph, buildSampleGraph, clusterSizes, layout3d, NODE_STYLE, type NodeType } from "@/lib/graph";
import { cn } from "@/lib/utils";

const GraphScene = dynamic(() => import("./GraphScene"), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-xs text-muted">Loading 3D engine…</div>,
});

type Mode = "projects" | "sample";
const SAMPLE = buildSampleGraph();

export function KnowledgeGraphExplorer() {
  const { projects, loading } = useProjects();
  const reduced = !!useReducedMotion();
  const [userMode, setUserMode] = useState<Mode | null>(null);
  const [query, setQuery] = useState("");
  const [hidden, setHidden] = useState<Set<NodeType>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [compact] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);

  const mode: Mode = userMode ?? (projects.length > 0 ? "projects" : "sample");
  const projectGraph = useMemo(() => buildProjectGraph(projects), [projects]);
  const data = mode === "projects" ? projectGraph : SAMPLE;
  const positions = useMemo(() => layout3d(data.nodes, data.edges), [data]);
  const visibleTypes = useMemo(
    () => new Set((Object.keys(NODE_STYLE) as NodeType[]).filter((t) => !hidden.has(t))),
    [hidden],
  );
  const counts = useMemo(() => {
    const m = new Map<NodeType, number>();
    for (const n of data.nodes) m.set(n.type, (m.get(n.type) ?? 0) + 1);
    return m;
  }, [data]);
  const clusters = useMemo(() => clusterSizes(data.nodes, data.edges), [data]);

  const selected = data.nodes.find((n) => n.id === selectedId) ?? null;
  const connections = useMemo(() => {
    if (!selected) return [];
    return data.edges
      .filter((e) => e.source === selected.id || e.target === selected.id)
      .map((e) => {
        const otherId = e.source === selected.id ? e.target : e.source;
        return { relation: e.relation, node: data.nodes.find((n) => n.id === otherId)! };
      });
  }, [selected, data]);

  function switchMode(m: Mode) {
    setUserMode(m);
    setSelectedId(null);
    setQuery("");
    setHidden(new Set());
  }
  const toggleType = (t: NodeType) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });

  const emptyProjects = mode === "projects" && data.nodes.length === 0;

  return (
    <div className="mx-auto max-w-[1500px] px-4 py-8 sm:px-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4 px-2">
        <div>
          <p className="eyebrow">Knowledge graph</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Explore the research landscape</h1>
        </div>
        <div role="tablist" aria-label="Graph source" className="relative flex rounded-lg border border-line p-1 text-sm">
          {(["projects", "sample"] as const).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              onClick={() => switchMode(m)}
              className={cn("relative z-10 rounded-md px-4 py-1.5 transition-colors", mode === m ? "text-white" : "text-muted hover:text-white")}
            >
              {mode === m && (
                <motion.span layoutId="kg-mode" className="absolute inset-0 -z-10 rounded-md bg-white/[0.07]" transition={{ type: "spring", stiffness: 400, damping: 34 }} />
              )}
              {m === "projects" ? `My projects${projects.length ? ` (${projects.length})` : ""}` : "Sample structure"}
            </button>
          ))}
        </div>
      </div>

      {mode === "sample" && (
        <div role="note" className="mb-4 rounded-lg border border-amber-400/30 bg-amber-400/[0.07] px-4 py-3 text-xs text-amber-200">
          <strong className="font-semibold">Sample data.</strong> This is a synthetic structure that demonstrates the explorer. “Sample paper” and “Sample
          author” nodes are placeholders, not real publications. Real literature arrives with the Literature module (Phase 3).
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[260px_1fr_300px]">
        {/* controls */}
        <aside className="glass order-2 space-y-6 rounded-2xl p-5 lg:order-1">
          <label className="block">
            <span className="mb-2 block text-xs font-medium uppercase tracking-wider text-muted">Search nodes <span className="normal-case tracking-normal text-slate-600">· Enter to select</span></span>
            <span className="flex items-center gap-2 rounded-lg border border-line-strong bg-ink-900 px-3 py-2 focus-within:border-cyan/60">
              <Search size={14} className="text-muted" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  const q = query.trim().toLowerCase();
                  const hit = q ? data.nodes.find((n) => visibleTypes.has(n.type) && n.label.toLowerCase().includes(q)) : undefined;
                  if (hit) setSelectedId(hit.id);
                }}
                placeholder="e.g. hippocampal"
                className="w-full bg-transparent text-sm outline-none placeholder:text-slate-600"
              />
              {query && (
                <button type="button" aria-label="Clear search" onClick={() => setQuery("")} className="text-muted hover:text-white">
                  <X size={14} />
                </button>
              )}
            </span>
          </label>

          <div>
            <p className="mb-3 text-xs font-medium uppercase tracking-wider text-muted">Node types</p>
            <ul className="space-y-1.5">
              {(Object.keys(NODE_STYLE) as NodeType[])
                .filter((t) => counts.has(t))
                .map((t) => {
                  const off = hidden.has(t);
                  return (
                    <li key={t}>
                      <button
                        type="button"
                        aria-pressed={!off}
                        onClick={() => toggleType(t)}
                        className={cn("flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition", off ? "opacity-40" : "hover:bg-white/[0.04]")}
                      >
                        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: NODE_STYLE[t].color }} />
                        <span className="flex-1">{NODE_STYLE[t].label}</span>
                        <span className="font-mono text-xs text-muted">{counts.get(t)}</span>
                      </button>
                    </li>
                  );
                })}
            </ul>
          </div>

          <dl className="grid grid-cols-3 gap-2 border-t border-line pt-4 text-center">
            {[["Nodes", data.nodes.length], ["Edges", data.edges.length], ["Clusters", clusters.length]].map(([k, v]) => (
              <div key={k as string}>
                <dd className="text-lg font-semibold tabular-nums">{v}</dd>
                <dt className="font-mono text-[10px] uppercase tracking-wider text-muted">{k}</dt>
              </div>
            ))}
          </dl>
          {clusters.length > 1 && (
            <p className="text-xs leading-relaxed text-muted">
              {clusters.length} disconnected research areas (sizes {clusters.join(", ")}). Nothing links them yet.
            </p>
          )}
        </aside>

        {/* canvas */}
        <div className="glass relative order-1 h-[62vh] min-h-[420px] overflow-hidden rounded-2xl lg:order-2 lg:h-[72vh]">
          <div className="grid-bg pointer-events-none absolute inset-0 opacity-40" aria-hidden />
          {loading && mode === "projects" ? (
            <div className="flex h-full items-center justify-center text-xs text-muted">Loading your projects…</div>
          ) : emptyProjects ? (
            <div className="relative flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
              <p className="text-sm text-slate-300">No projects yet, so there is nothing to graph.</p>
              <Link href="/workspace" className="rounded-lg bg-gradient-to-r from-azure to-[#3b82ff] px-5 py-2.5 text-sm font-medium">
                Create a research project
              </Link>
            </div>
          ) : (
            <WebGLBoundary fallback={<div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted">3D view unavailable: this browser or device does not support WebGL.</div>}>
              <GraphScene
                data={data}
                positions={positions}
                visibleTypes={visibleTypes}
                query={query}
                selectedId={selected?.id ?? null}
                onSelect={setSelectedId}
                reduced={reduced}
                compact={compact}
              />
            </WebGLBoundary>
          )}
          <p className="pointer-events-none absolute bottom-3 left-4 font-mono text-[10px] text-slate-600">
            drag · rotate &nbsp; scroll · zoom &nbsp; click · inspect
          </p>
        </div>

        {/* inspector */}
        <aside className="glass order-3 rounded-2xl p-5" aria-live="polite">
          <AnimatePresence mode="wait" initial={false}>
            {selected ? (
              <motion.div key={selected.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
                <div className="flex items-start justify-between gap-3">
                  <span className="inline-flex items-center gap-2 rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider" style={{ borderColor: `${NODE_STYLE[selected.type].color}77`, color: NODE_STYLE[selected.type].color }}>
                    {NODE_STYLE[selected.type].label}
                  </span>
                  <button type="button" aria-label="Clear selection" onClick={() => setSelectedId(null)} className="text-muted hover:text-white">
                    <X size={16} />
                  </button>
                </div>
                <h2 className="mt-3 text-lg font-semibold leading-snug">{selected.label}</h2>
                {selected.detail && <p className="mt-2 text-sm leading-relaxed text-slate-300">{selected.detail}</p>}
                <h3 className="mb-2 mt-6 text-xs font-medium uppercase tracking-wider text-muted">Connections ({connections.length})</h3>
                <ul className="max-h-[38vh] space-y-1 overflow-auto pr-1">
                  {connections.map((c, i) => (
                    <li key={i}>
                      <button type="button" onClick={() => setSelectedId(c.node.id)} className="w-full rounded-md px-2 py-1.5 text-left hover:bg-white/[0.05]">
                        <span className="block font-mono text-[10px] uppercase tracking-wider text-muted">{c.relation}</span>
                        <span className="flex items-center gap-2 text-sm">
                          <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: NODE_STYLE[c.node.type].color }} />
                          {c.node.label}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </motion.div>
            ) : (
              <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-sm text-muted">
                <p className="text-slate-300">Select a node</p>
                <p className="mt-2 leading-relaxed">
                  Click any node to see what it connects to. Connected nodes stay lit while the rest of the graph fades back.
                </p>
                <p className="mt-4 leading-relaxed">
                  {mode === "projects"
                    ? "This graph is built from your saved projects: each links to its modality, domain and objectives. Projects that share them cluster together."
                    : "Each shape marks a node type. Use the filters to hide whole categories."}
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </aside>
      </div>
    </div>
  );
}
