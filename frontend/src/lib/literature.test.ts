import { describe, expect, it } from "vitest";
import type { PaperHit, ProviderInfo } from "@/types/paper";
import { appendResults, keyNote, primaryOf, providerName, statusText, usable } from "./literature";

const hit = (o: Partial<PaperHit>): PaperHit => ({ source: "openalex", external_id: "W1", doi: null, pmid: null, title: "T", abstract: null, year: 2020, venue: null, authors: [], url: null, cited_by_count: null, keywords: [], extracted: {}, ...o });
const info = (o: Partial<ProviderInfo>): ProviderInfo => ({ id: "openalex", name: "OpenAlex", group: "general", requires_key: false, supports_key: false, key_configured: false, default_enabled: true, supports_full_text: false, rate_limit: "", docs: "", env_var: null, ...o });

describe("provider names and key notes", () => {
  it("maps every provider id, including Springer Nature, with or without the registry loaded", () => {
    for (const [id, name] of [["openalex", "OpenAlex"], ["pubmed", "PubMed"], ["europepmc", "Europe PMC"], ["crossref", "Crossref"], ["arxiv", "arXiv"], ["semanticscholar", "Semantic Scholar"], ["springer", "Springer Nature"]]) expect(providerName(id)).toBe(name);
    expect(providerName("springer", [info({ id: "springer", name: "Springer (server name)" })])).toBe("Springer (server name)");
    expect(providerName("brand-new")).toBe("brand-new");
  });
  it("describes key requirements without exposing a key", () => {
    const sp = info({ id: "springer", requires_key: true, supports_key: true, env_var: "SPRINGER_API_KEY" });
    expect(keyNote(sp)).toContain("not configured (set SPRINGER_API_KEY on the server)");
    expect(usable(sp)).toBe(false);
    expect(usable({ ...sp, key_configured: true })).toBe(true);
    expect(keyNote(info({}))).toBe("No API key needed");
    expect(keyNote(info({ supports_key: true }))).toContain("Optional API key: not set");
  });
  it("status text per failure kind", () => {
    const st = { provider: "x", name: "X", ok: false, count: 0, error: "e", duration_ms: 1 };
    expect(statusText({ ...st, error_kind: "timeout" })).toBe("timed out");
    expect(statusText({ ...st, error_kind: "rate_limit" })).toBe("rate-limited");
    expect(statusText({ ...st, error_kind: "not_configured" })).toBe("not configured");
    expect(statusText({ ...st, ok: true, count: 1 })).toBe("1 record");
  });
});

describe("primaryOf", () => {
  it("trusts the server's choice", () => {
    const p = { kind: "pmc", label: "Read full text (PMC)", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC1/", access: "full_text" as const };
    expect(primaryOf(hit({ primary_link: p, links: [{ kind: "doi", label: "DOI", url: "https://doi.org/10.1/x" }] }))).toBe(p);
  });
  it("falls back to full text, then DOI, Europe PMC last, then the legacy url", () => {
    const L = (kind: string, url: string) => ({ kind, label: kind, url });
    expect(primaryOf(hit({ links: [L("europepmc", "e"), L("doi", "d"), L("pmc", "p")] }))?.url).toBe("p");
    expect(primaryOf(hit({ links: [L("europepmc", "e"), L("pubmed", "m")] }))?.url).toBe("m");
    expect(primaryOf(hit({ links: [L("europepmc", "e")] }))?.url).toBe("e");
    expect(primaryOf(hit({ url: "https://x.example" }))?.url).toBe("https://x.example");
    expect(primaryOf(hit({}))).toBeNull();
  });
});

describe("appendResults", () => {
  it("merges the same paper by DOI and keeps every source and link once", () => {
    const a = hit({ doi: "10.1/x", sources: [{ provider: "openalex", external_id: "W1" }], links: [{ kind: "doi", label: "DOI", url: "u" }] });
    const b = hit({ source: "crossref", external_id: "10.1/x", doi: "10.1/X", sources: [{ provider: "crossref", external_id: "10.1/x" }], links: [{ kind: "doi", label: "DOI", url: "u" }, { kind: "pmc", label: "PMC", url: "p" }], pmcid: "PMC1" });
    const out = appendResults([a], [b]);
    expect(out).toHaveLength(1);
    expect(out[0].sources).toHaveLength(2);
    expect(out[0].links).toHaveLength(2);
    expect(out[0].pmcid).toBe("PMC1");
  });
  it("never merges papers whose DOIs or PMIDs conflict, even if another id matches", () => {
    const a = hit({ doi: "10.1/a", pmid: "1", sources: [{ provider: "openalex", external_id: "W1" }] });
    expect(appendResults([a], [hit({ source: "pubmed", external_id: "1", doi: "10.1/b", pmid: "1", sources: [{ provider: "pubmed", external_id: "1" }] })])).toHaveLength(2);
    expect(appendResults([a], [hit({ source: "pubmed", external_id: "2", doi: "10.1/a", pmid: "2", sources: [{ provider: "pubmed", external_id: "2" }] })])).toHaveLength(2);
  });
});
