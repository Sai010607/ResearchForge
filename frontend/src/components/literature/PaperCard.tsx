"use client";

import { ExternalLink, Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import { useState, type ReactNode } from "react";
import { ApiError, api } from "@/lib/api";
import { TYPE_LABEL, primaryOf, providerName } from "@/lib/literature";
import { cn } from "@/lib/utils";
import type { ExtractedTag, IdentifierCheck, PaperHit, ProviderInfo, VerificationCheck } from "@/types/paper";

const TAG_GROUPS = [
  ["modalities", "Modality"],
  ["diseases", "Disease"],
  ["datasets", "Dataset"],
  ["methods", "Method"],
] as const;

/** Long unbroken strings (DOIs, URLs, hyphenated compounds) must wrap instead of widening the page. */
const WRAP = "[overflow-wrap:anywhere]";

function Tags({ paper }: { paper: PaperHit }) {
  const groups = TAG_GROUPS.map(([k, label]) => [label, (paper.extracted[k] ?? []) as ExtractedTag[]] as const).filter(([, l]) => l.length);
  if (!groups.length) return <p className="mt-3 text-xs text-muted">No modality, disease, dataset or method terms detected.</p>;
  return (
    <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Detected terms">
      {groups.flatMap(([label, list]) =>
        list.map((t) => (
          <span key={`${label}:${t.value}`} title={`${label} — matched “${t.matched}” in the ${t.field}`}
            className={cn("max-w-full rounded-full border border-line px-2 py-0.5 text-[11px] text-slate-300", WRAP)}>
            <span className="text-muted">{label}:</span> {t.value}
          </span>
        )),
      )}
    </div>
  );
}

const MARK: Record<VerificationCheck["status"], { icon: string; cls: string; word: string }> = {
  pass: { icon: "✓", cls: "text-emerald-300", word: "OK" },
  info: { icon: "i", cls: "text-sky-300", word: "Note" },
  warn: { icon: "!", cls: "text-amber-300", word: "Check" },
  fail: { icon: "✗", cls: "text-red-300", word: "Problem" },
};

function Checks({ checks }: { checks: VerificationCheck[] }) {
  return (
    <ul className="mt-2 space-y-1">
      {checks.map((c) => (
        <li key={c.id} className="flex items-start gap-2">
          <span className={cn("mt-px w-4 shrink-0 text-center font-semibold", MARK[c.status].cls)} aria-label={MARK[c.status].word}>{MARK[c.status].icon}</span>
          <span className={cn("min-w-0 text-slate-300", WRAP)}>{c.detail}</span>
        </li>
      ))}
    </ul>
  );
}

const V_LABEL = { cross_checked: "Cross-checked", single_source: "Single source", warning: "Check details", conflict: "Identifier conflict" } as const;
const V_CLS = {
  cross_checked: "border-emerald-400/40 text-emerald-300",
  single_source: "border-line text-muted",
  warning: "border-amber-400/40 text-amber-300",
  conflict: "border-red-400/50 text-red-300",
} as const;
const DEEP_CLS = { verified: "text-emerald-300", warning: "text-amber-300", conflict: "text-red-300", unchecked: "text-muted" } as const;
const DEEP_TEXT = {
  verified: "Identifiers match their registries.",
  warning: "Identifiers resolve, but some details differ.",
  conflict: "An identifier does not match this record.",
  unchecked: "Could not be checked against a registry right now.",
} as const;

function Verification({ paper }: { paper: PaperHit }) {
  const [deep, setDeep] = useState<{ state: "idle" | "loading" | "error"; result?: IdentifierCheck; error?: string }>({ state: "idle" });
  const v = paper.verification;
  function run() {
    setDeep({ state: "loading" });
    api
      .verifyPaper(paper.source, paper.external_id)
      .then((result) => setDeep({ state: "idle", result }))
      .catch((e: unknown) => setDeep({ state: "error", error: e instanceof ApiError ? e.message : "Could not reach the server." }));
  }
  return (
    <div className="mt-3 rounded-xl border border-line bg-white/[0.02] p-3 text-xs" aria-label="Verification">
      {v && (
        <>
          <p className="font-medium text-slate-200">
            {v.status === "cross_checked" ? `${v.sources_agreeing} sources agree on this record.` : v.status === "single_source" ? "Only one source returned this record, so nothing was cross-checked." : "Sources disagree on some details."}
          </p>
          <Checks checks={v.checks} />
        </>
      )}
      <div className={cn(v && "mt-3 border-t border-line pt-3")}>
        <button type="button" onClick={run} disabled={deep.state === "loading"}
          className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-line px-3 text-sky-300 hover:text-white disabled:opacity-60">
          {deep.state === "loading" && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
          {deep.state === "loading" ? "Asking the registries…" : deep.result ? "Check again" : "Check identifiers online"}
        </button>
        <span className="ml-2 text-muted">Asks Crossref, PubMed, PMC and arXiv about this paper’s identifiers.</span>
        {deep.state === "error" && <p role="alert" className="mt-2 text-red-300">{deep.error}</p>}
        {deep.result && (
          <div role="status">
            <p className={cn("mt-2 font-medium", DEEP_CLS[deep.result.status])}>{DEEP_TEXT[deep.result.status]}</p>
            <Checks checks={deep.result.checks} />
          </div>
        )}
      </div>
    </div>
  );
}

export function PaperCard({ paper, providers = [], children }: { paper: PaperHit; providers?: ProviderInfo[]; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [showVerify, setShowVerify] = useState(false);
  const links = paper.links ?? [];
  const primary = primaryOf(paper);
  const type = paper.publication_type ?? (paper.preprint ? "preprint" : "unknown");
  const v = paper.verification;
  const ids: [string, string][] = [
    ...(paper.doi ? ([["DOI", paper.doi]] as [string, string][]) : []),
    ...(paper.pmid ? ([["PMID", paper.pmid]] as [string, string][]) : []),
    ...(paper.pmcid ? ([["PMCID", paper.pmcid]] as [string, string][]) : []),
    ...(paper.arxiv_id ? ([["arXiv", paper.arxiv_id]] as [string, string][]) : []),
  ];
  return (
    <li className="min-w-0 rounded-2xl border border-line bg-white/[0.02] p-4 sm:p-5">
      <h3 className={cn("text-[15px] font-medium leading-snug", WRAP)}>{paper.title}</h3>
      <p className={cn("mt-1.5 text-xs text-muted", WRAP)}>
        {[paper.authors.slice(0, 4).join(", ") + (paper.authors.length > 4 ? " et al." : ""), paper.year, paper.venue].filter(Boolean).join(" · ")}
      </p>
      <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted">
        <span title="Publication type, as reported by the sources" className={cn("rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide",
          type === "preprint" ? "border-amber-400/40 text-amber-300" : type === "unknown" ? "border-dashed border-line text-muted" : "border-sky-400/40 text-sky-300")}>
          {TYPE_LABEL[type]}
        </span>
        {(paper.sources?.length ? paper.sources.map((s) => s.provider) : [paper.source]).map((id) => (
          <span key={id} className="rounded border border-line px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-300">{providerName(id, providers)}</span>
        ))}
        {v && (
          <button type="button" onClick={() => setShowVerify((s) => !s)} aria-expanded={showVerify}
            title="How well the sources agree on this record. Tap for details."
            className={cn("inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide", V_CLS[v.status])}>
            {v.status === "conflict" || v.status === "warning" ? <ShieldAlert className="h-3 w-3" aria-hidden /> : <ShieldCheck className="h-3 w-3" aria-hidden />}
            {V_LABEL[v.status]}{v.status === "cross_checked" ? ` · ${v.sources_agreeing}` : ""}
          </button>
        )}
      </p>
      {(ids.length > 0 || paper.cited_by_count != null) && (
        <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
          {ids.map(([k, val]) => (
            <div key={k} className="flex min-w-0 max-w-full gap-1">
              <dt>{k}</dt>
              <dd className={cn("min-w-0 font-mono text-slate-300", WRAP)}>{val}</dd>
            </div>
          ))}
          {paper.cited_by_count != null && <div>cited by {paper.cited_by_count}</div>}
        </dl>
      )}
      {paper.match && paper.match.terms > 0 && (
        <p className="mt-2 text-[11px] text-muted" title="How many of your search words were found in this paper’s title, abstract or keywords">
          Matches {paper.match.terms_found} of {paper.match.terms} search terms
          {paper.match.missing_terms.length > 0 && <span className={WRAP}> · missing: {paper.match.missing_terms.join(", ")}</span>}
        </p>
      )}
      <Tags paper={paper} />
      {paper.abstract ? (
        <div className="mt-3 text-sm text-slate-300">
          <p className={cn(WRAP, !open && "line-clamp-3")}>{paper.abstract}</p>
          <button type="button" onClick={() => setOpen((x) => !x)} className="mt-1 min-h-8 text-xs text-sky-300 underline">
            {open ? "Show less" : "Show full abstract"}
          </button>
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted">No abstract provided by the source.</p>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        {children}
        {primary && (
          <a href={primary.url} target="_blank" rel="noopener noreferrer" title={primary.url} data-primary={primary.kind}
            className="inline-flex min-h-9 items-center gap-1 text-xs font-medium text-sky-300 hover:text-white">
            {primary.label} <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        )}
        <button type="button" onClick={() => setShowVerify((s) => !s)} aria-expanded={showVerify} className="inline-flex min-h-9 items-center text-xs text-muted underline-offset-2 hover:text-white hover:underline">
          {showVerify ? "Hide verification" : "Verify"}
        </button>
      </div>
      {showVerify && <Verification paper={paper} />}
      {links.length > 0 && (
        <ul aria-label="Links" className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
          {links.map((l) => (
            <li key={l.url} className="min-w-0 max-w-full">
              <a href={l.url} target="_blank" rel="noopener noreferrer" title={l.url}
                className={cn("inline-block min-h-6 max-w-full text-muted underline-offset-2 hover:text-white hover:underline", WRAP)}>
                {l.label}
                {l.kind === "pubmed" && paper.pmid ? ` ${paper.pmid}` : l.kind === "pmc" && paper.pmcid ? ` ${paper.pmcid}` : l.kind === "arxiv" && paper.arxiv_id ? ` ${paper.arxiv_id}` : ""}
              </a>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
