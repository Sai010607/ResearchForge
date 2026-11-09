import type { PaperHit, PaperLink, PrimaryLink, ProviderInfo, ProviderStatus, PublicationType } from "@/types/paper";

/** Display names, used when the provider list has not loaded (saved-paper view, failed registry call). */
export const PROVIDER_NAMES: Record<string, string> = {
  openalex: "OpenAlex",
  pubmed: "PubMed",
  europepmc: "Europe PMC",
  crossref: "Crossref",
  arxiv: "arXiv",
  semanticscholar: "Semantic Scholar",
  springer: "Springer Nature",
};

export function providerName(id: string, providers: ProviderInfo[] = []): string {
  return providers.find((p) => p.id === id)?.name ?? PROVIDER_NAMES[id] ?? id;
}

export const GROUP_LABEL: Record<string, string> = { general: "General", biomedical: "Biomedical", cs: "Computer science" };

/** A provider that needs a key the server lacks cannot be selected. */
export const usable = (p: ProviderInfo) => !p.requires_key || p.key_configured;

export function keyNote(p: ProviderInfo): string {
  if (p.requires_key) return p.key_configured ? "API key required: configured on the server" : `API key required: not configured${p.env_var ? ` (set ${p.env_var} on the server)` : ""}`;
  if (p.supports_key) return p.key_configured ? "Optional API key: configured (higher limits)" : "Optional API key: not set (shared, lower limits)";
  return "No API key needed";
}

export const TYPE_LABEL: Record<PublicationType, string> = {
  journal_article: "Journal article",
  review: "Review article",
  conference_paper: "Conference paper",
  book_chapter: "Book chapter",
  book: "Book",
  preprint: "Preprint",
  other: "Other type",
  unknown: "Type not stated",
};

const PRIMARY_ORDER = ["pmc", "fulltext", "arxiv", "doi", "publisher", "pubmed", "openalex", "semanticscholar", "europepmc"];
const ACCESS: Record<string, PrimaryLink["access"]> = { pmc: "full_text", fulltext: "full_text", arxiv: "full_text", doi: "publisher", publisher: "publisher", pubmed: "abstract" };

/** The server chooses the primary action; this only covers payloads that predate it (same order as the server). */
export function primaryOf(paper: PaperHit): PrimaryLink | null {
  if (paper.primary_link) return paper.primary_link;
  const links = paper.links ?? [];
  for (const k of PRIMARY_ORDER) {
    const l = links.find((x) => x.kind === k);
    if (l) return { ...l, access: ACCESS[k] ?? "record", label: l.label };
  }
  return paper.url ? { kind: "url", label: "Open source", url: paper.url, access: "record" } : null;
}

const keyOf = (h: { source: string; external_id: string }) => `${h.source}:${h.external_id}`;
export { keyOf };
export const refsOf = (h: PaperHit) => (h.sources?.length ? h.sources.map((s) => `${s.provider}:${s.external_id}`) : [keyOf(h)]);

/** Identity keys of a result: provider records plus DOI / PMID / PMCID / arXiv id. Two results sharing any key are the same paper. */
const idsOf = (h: PaperHit) => [
  ...refsOf(h),
  ...(h.doi ? [`doi:${h.doi.toLowerCase()}`] : []),
  ...(h.pmid ? [`pmid:${h.pmid}`] : []),
  ...(h.pmcid ? [`pmcid:${h.pmcid}`] : []),
  ...(h.arxiv_id ? [`arxiv:${h.arxiv_id.toLowerCase()}`] : []),
];

/** Add a page of results, merging any paper already listed (same paper returned again, possibly by another provider).
 *  Papers whose identifiers CONFLICT with a listed paper (different DOI or PMID) are kept as separate cards, like the server does. */
export function appendResults(prev: PaperHit[], incoming: PaperHit[]): PaperHit[] {
  const out = [...prev];
  const conflicts = (a: PaperHit, b: PaperHit) => (a.doi && b.doi && a.doi.toLowerCase() !== b.doi.toLowerCase()) || (a.pmid && b.pmid && a.pmid !== b.pmid);
  for (const h of incoming) {
    const keys = new Set(idsOf(h));
    const i = out.findIndex((o) => !conflicts(o, h) && idsOf(o).some((k) => keys.has(k)));
    if (i < 0) {
      out.push(h);
      continue;
    }
    const o = out[i];
    const sources = [...(o.sources ?? []), ...(h.sources ?? [])].filter((s, j, a) => a.findIndex((x) => x.provider === s.provider && x.external_id === s.external_id) === j);
    const links: PaperLink[] = [...(o.links ?? []), ...(h.links ?? [])].filter((l, j, a) => a.findIndex((x) => x.url === l.url) === j);
    out[i] = { ...o, sources, links, abstract: o.abstract ?? h.abstract, doi: o.doi ?? h.doi, pmid: o.pmid ?? h.pmid, pmcid: o.pmcid ?? h.pmcid, oa_url: o.oa_url ?? h.oa_url };
  }
  return out;
}

export const byRelevance = (a: PaperHit, b: PaperHit) => (b.relevance ?? 0) - (a.relevance ?? 0);

export function statusText(st: ProviderStatus): string {
  if (st.ok) return `${st.count} record${st.count === 1 ? "" : "s"}`;
  return st.error_kind === "timeout" ? "timed out" : st.error_kind === "rate_limit" ? "rate-limited" : st.error_kind === "not_configured" ? "not configured" : "failed";
}
