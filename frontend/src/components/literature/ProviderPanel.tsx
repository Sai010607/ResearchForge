"use client";

import { Loader2 } from "lucide-react";
import { GROUP_LABEL, keyNote, statusText, usable } from "@/lib/literature";
import { cn } from "@/lib/utils";
import type { ProviderInfo, ProviderStatus } from "@/types/paper";

const PRESETS: { label: string; pick: (p: ProviderInfo[]) => string[] }[] = [
  { label: "Select all", pick: (p) => p.filter(usable).map((x) => x.id) },
  { label: "Biomedical", pick: (p) => p.filter((x) => usable(x) && (x.group === "biomedical" || x.id === "openalex")).map((x) => x.id) },
  { label: "Computer science", pick: (p) => p.filter((x) => usable(x) && (x.group === "cs" || x.id === "openalex")).map((x) => x.id) },
  { label: "Deselect all", pick: () => [] },
];

interface Props {
  providers: ProviderInfo[];
  selected: string[];
  onSelect: (ids: string[]) => void;
}

/** Which sources to search: individual choice, presets, and for every source whether it is on, off by default, or needs a server-side key. */
export function ProviderPicker({ providers, selected, onSelect }: Props) {
  const enabled = providers.filter((p) => selected.includes(p.id)).length;
  const needKey = providers.filter((p) => !usable(p));
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
        {PRESETS.map((pr) => (
          <button key={pr.label} type="button" onClick={() => onSelect(pr.pick(providers))}
            className="min-h-8 rounded-full px-2 text-[11px] text-muted underline-offset-2 hover:text-white hover:underline">{pr.label}</button>
        ))}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        {providers.map((p) => {
          const off = !usable(p);
          const on = !off && selected.includes(p.id);
          return (
            <label key={p.id} title={`${keyNote(p)}. ${p.rate_limit}`}
              className={cn("inline-flex min-h-9 max-w-full items-center rounded-full border px-3 py-1 text-xs", off ? "cursor-not-allowed border-dashed border-line text-muted/60" : "cursor-pointer", !off && (on ? "border-sky-400 text-white" : "border-line text-muted"))}>
              <input type="checkbox" className="sr-only" checked={on} disabled={off}
                onChange={() => onSelect(on ? selected.filter((x) => x !== p.id) : [...selected, p.id])} />
              <span className="truncate">{p.name}</span>
              {off && <span className="ml-1 shrink-0 text-[10px]">(key needed)</span>}
            </label>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] text-muted">
        {enabled} of {providers.length} sources selected
        {needKey.length > 0 && <> · {needKey.map((p) => p.name).join(", ")} {needKey.length === 1 ? "needs" : "need"} an API key on the server</>}
      </p>
      <details className="mt-1 text-xs">
        <summary className="inline-flex min-h-9 cursor-pointer items-center text-sky-300">Source details and API keys</summary>
        <ul className="mt-1 space-y-2">
          {providers.map((p) => (
            <li key={p.id} className="min-w-0 rounded-lg border border-line p-3">
              <p className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium text-slate-200">{p.name}</span>
                <span className="text-[10px] uppercase tracking-wide text-muted">{GROUP_LABEL[p.group] ?? p.group}</span>
                <span className={cn("text-[10px] uppercase tracking-wide", usable(p) ? (selected.includes(p.id) ? "text-emerald-300" : "text-muted") : "text-amber-300")}>
                  {!usable(p) ? "disabled: key missing" : selected.includes(p.id) ? "enabled" : "available, not selected"}
                </span>
              </p>
              <p className="mt-1 text-muted">{keyNote(p)}</p>
              <p className="mt-0.5 text-muted [overflow-wrap:anywhere]">Limits: {p.rate_limit}</p>
            </li>
          ))}
        </ul>
      </details>
    </>
  );
}

interface StatusProps {
  stats: ProviderStatus[];
  retrying: string | null;
  onRetry: (id: string) => void;
}

/** What every source did for the last search: records returned, time taken, and for failures why, how many retries, and a retry button. */
export function ProviderStatusList({ stats, retrying, onRetry }: StatusProps) {
  return (
    <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Source status">
      {stats.map((st) => (
        <li key={st.provider} className={cn("min-w-0 max-w-full rounded-lg border px-2 py-1", st.ok ? "border-line" : "w-full border-red-500/40 text-red-300 sm:w-auto")}>
          <span className="font-medium">{st.name}</span>: {statusText(st)}
          <span className="text-muted"> · {(st.duration_ms / 1000).toFixed(1)} s{st.retries ? ` · retried ${st.retries}×` : ""}</span>
          {!st.ok && (
            <>
              <span className="block text-[11px] [overflow-wrap:anywhere]">{st.error}</span>
              {st.error_kind !== "not_configured" && (
                <button type="button" onClick={() => onRetry(st.provider)} disabled={retrying !== null}
                  className="mt-1 inline-flex min-h-8 items-center gap-1 text-[11px] text-sky-300 underline disabled:opacity-60">
                  {retrying === st.provider && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
                  Retry {st.name}
                </button>
              )}
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
