import type { ReactNode } from "react";
import type { PaperRef, SourceType, Verification } from "@/types/memory";
import { cn } from "@/lib/utils";

export const SOURCE_LABEL: Record<SourceType, string> = {
  source_metadata: "Source metadata",
  rule_extracted: "Rule-extracted (keyword match)",
  ai_extracted: "AI-extracted",
  researcher_confirmed: "Researcher-confirmed",
  researcher_entered: "Researcher-entered",
};
export const VERIFICATION_LABEL: Record<Verification, string> = {
  unverified: "Unverified",
  source_reported: "Reported by source",
  confirmed: "Confirmed by you",
  edited: "Edited by you",
  rejected: "Rejected",
};

const TONE = {
  neutral: "border-line-strong text-slate-300",
  good: "border-teal/50 text-teal",
  warn: "border-amber-400/50 text-amber-300",
  bad: "border-red-400/50 text-red-300",
  info: "border-cyan/50 text-cyan",
};

export function Badge({ tone = "neutral", children }: { tone?: keyof typeof TONE; children: ReactNode }) {
  return <span className={cn("inline-flex max-w-full items-center rounded-full border px-2 py-0.5 text-[11px] leading-4 [overflow-wrap:anywhere]", TONE[tone])}>{children}</span>;
}

export function verificationTone(v: Verification): keyof typeof TONE {
  return v === "confirmed" || v === "edited" ? "good" : v === "rejected" ? "bad" : v === "source_reported" ? "info" : "warn";
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  if (!message) return null;
  return (
    <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300 [overflow-wrap:anywhere]">
      {message}
      {onRetry && (
        <button type="button" onClick={onRetry} className="ml-3 min-h-8 underline">
          Retry
        </button>
      )}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-line-strong p-6 text-center text-sm text-muted">{children}</div>;
}

export function Loading({ label }: { label: string }) {
  return <div aria-label={label} className="h-24 animate-pulse rounded-xl bg-white/[0.03]" />;
}

export const inputCls =
  "min-h-11 w-full min-w-0 rounded-lg border border-line-strong bg-ink-900 px-3 py-2 text-sm text-slate-100 placeholder:text-muted focus:border-cyan focus:outline-none";
export const labelCls = "mb-1 block text-xs text-muted";

export function paperHref(p: PaperRef): string | null {
  if (p.doi) return `https://doi.org/${encodeURI(p.doi)}`;
  if (p.pmid) return `https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(p.pmid)}/`;
  return p.url && /^https?:\/\//i.test(p.url) ? p.url : null;
}

export function PaperLine({ paper }: { paper: PaperRef | null }) {
  if (!paper) return null;
  const href = paperHref(paper);
  const ident = paper.doi ? `doi:${paper.doi}` : paper.pmid ? `PMID ${paper.pmid}` : `${paper.source}`;
  return (
    <p className="min-w-0 text-xs text-muted [overflow-wrap:anywhere]">
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" className="text-cyan underline">
          {paper.title}
        </a>
      ) : (
        paper.title
      )}{" "}
      · {ident}
      {paper.year ? ` · ${paper.year}` : ""}
      {!paper.in_project && <span className="ml-2 text-amber-300">(no longer in this project&apos;s reading list)</span>}
    </p>
  );
}

export function when(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}
