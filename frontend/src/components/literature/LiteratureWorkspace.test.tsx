import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { project } from "@/test/helpers";
import type { Paper, PaperHit } from "@/types/paper";
import { LiteratureWorkspace } from "./LiteratureWorkspace";

const hit: PaperHit = {
  source: "openalex", external_id: "W1", doi: "10.1/x", pmid: null, title: "Hippocampal atrophy in Alzheimer's disease",
  abstract: null, year: 2021, venue: "NeuroImage", authors: ["A. Author"], url: "https://example.org/1", cited_by_count: 7, keywords: [],
  extracted: { modalities: [{ value: "T1-weighted MRI", matched: "T1", field: "title" }], diseases: [] },
};
const mocks = vi.hoisted(() => ({
  providers: vi.fn(),
  search: vi.fn(), save: vi.fn(), remove: vi.fn(), refresh: vi.fn(), papers: [] as unknown[],
}));
vi.mock("@/hooks/useProjects", () => ({ useProjects: () => ({ projects: [project], loading: false }) }));
vi.mock("@/hooks/useMyPapers", () => ({
  useMyPapers: () => ({ papers: mocks.papers, loading: false, error: "", refresh: mocks.refresh }),
}));
vi.mock("@/lib/api", async (orig) => {
  const m = await orig<typeof import("@/lib/api")>();
  return { ...m, api: { ...m.api, literatureProviders: mocks.providers, searchLiterature: mocks.search, savePaper: mocks.save, removePaper: mocks.remove } };
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.papers = [];
  const info = (id: string, name: string, group: string, on = true) => ({ id, name, group, requires_key: false, supports_key: false, key_configured: false, default_enabled: on, supports_full_text: false, rate_limit: "", docs: "", env_var: null });
  mocks.providers.mockResolvedValue([info("openalex", "OpenAlex", "general"), info("pubmed", "PubMed", "biomedical"), info("arxiv", "arXiv", "cs"), info("semanticscholar", "Semantic Scholar", "cs", false), { ...info("springer", "Springer Nature", "general", false), requires_key: true, supports_key: true, key_configured: false, env_var: "SPRINGER_API_KEY" }]);
  mocks.search.mockResolvedValue({
    query: "q", source: "openalex,pubmed,arxiv", page: 1, results: [{ ...hit, pmcid: "PMC999", sources: [{ provider: "openalex", external_id: "W1" }, { provider: "pubmed", external_id: "9" }],
      primary_link: { kind: "pmc", label: "Read full text (PMC)", access: "full_text", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC999/" }, links: [
      { kind: "publisher", label: "Publisher page", url: "https://publisher.example/x" },
      { kind: "doi", label: "DOI", url: "https://doi.org/10.1/x" },
      { kind: "pubmed", label: "PubMed", url: "https://pubmed.ncbi.nlm.nih.gov/9/" },
      { kind: "pmc", label: "PMC full text", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC999/" },
    ] }],
    warnings: ["arXiv: arXiv is down"], total_unique: 1, duration_ms: 1500,
    providers: [
      { provider: "openalex", name: "OpenAlex", ok: true, count: 1, error: null, duration_ms: 400 },
      { provider: "pubmed", name: "PubMed", ok: true, count: 1, error: null, duration_ms: 900 },
      { provider: "arxiv", name: "arXiv", ok: false, count: 0, error: "arXiv is down", error_kind: "timeout", duration_ms: 100 },
    ],
  });
  mocks.save.mockResolvedValue({});
});

describe("LiteratureWorkspace", () => {
  it("searches, shows honest metadata, warnings, and saves by id only", async () => {
    const user = userEvent.setup();
    render(<LiteratureWorkspace />);
    await user.type(screen.getByLabelText("Search publications"), "alzheimer");
    await user.click(await screen.findByLabelText("PubMed"));
    await user.click(screen.getByLabelText("PubMed"));
    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByText(hit.title)).toBeInTheDocument();
    expect(mocks.search).toHaveBeenCalledWith("alzheimer", ["openalex", "arxiv", "pubmed"], 1);
    expect(screen.getAllByText("PubMed").length).toBeGreaterThan(0);
    expect(screen.getByText("No abstract provided by the source.")).toBeInTheDocument();
    expect(screen.getByText("arXiv: arXiv is down")).toBeInTheDocument();
    const status = within(screen.getByRole("list", { name: "Source status" }));
    const rows = status.getAllByRole("listitem").map((li) => li.textContent);
    expect(rows.some((t) => t?.startsWith("arXiv: timed out · 0.1 s"))).toBe(true);
    expect(rows.some((t) => t === "PubMed: 1 record · 0.9 s")).toBe(true);
    expect(screen.getByText(/unique papers for/)).toHaveTextContent("1 unique papers for “alzheimer” · page 1 · 1.5 s");
    expect(screen.getByTitle(/matched “T1” in the title/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add to project" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(project.id, { source: "openalex", external_id: "W1" }));
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("one merged card shows every source badge and links that point at the right records", async () => {
    const user = userEvent.setup();
    render(<LiteratureWorkspace />);
    await user.type(screen.getByLabelText("Search publications"), "alzheimer");
    await user.click(await screen.findByRole("button", { name: "Search" }));
    await screen.findByText(hit.title);
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(1);
    expect(screen.getAllByText("OpenAlex").length).toBeGreaterThan(0);
    const href = (name: RegExp | string) => screen.getByRole("link", { name }).getAttribute("href");
    expect(href(/^Read full text \(PMC\)/)).toBe("https://pmc.ncbi.nlm.nih.gov/articles/PMC999/"); // server-chosen primary action
    expect(href(/^Publisher page/)).toBe("https://publisher.example/x");
    expect(href(/^DOI$/)).toBe("https://doi.org/10.1/x");
    expect(href(/^PubMed/)).toBe("https://pubmed.ncbi.nlm.nih.gov/9/");
    expect(href(/^PMC full text PMC999/)).toBe("https://pmc.ncbi.nlm.nih.gov/articles/PMC999/");
    expect(screen.getByText("10.1/x")).toBeInTheDocument(); // the DOI itself is shown as text
    for (const a of screen.getAllByRole("link")) expect(a).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("without a server-chosen primary link the card falls back to PMC, then DOI, and Europe PMC only as a last resort", async () => {
    const mk = (id: string, links: { kind: string; label: string; url: string }[]) => ({ ...hit, external_id: id, doi: null, title: `Paper ${id}`, sources: [{ provider: "europepmc", external_id: id }], links });
    const epmc = { kind: "europepmc", label: "Europe PMC", url: "https://europepmc.org/article/PMC/PMC1" };
    const pmc = { kind: "pmc", label: "PMC full text", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC1/" };
    const doi = { kind: "doi", label: "DOI", url: "https://doi.org/10.1/x" };
    const pub = { kind: "publisher", label: "Publisher page", url: "https://publisher.example/p" };
    mocks.search.mockResolvedValue({ query: "q", source: "x", page: 1, warnings: [], providers: [], total_unique: 3, duration_ms: 5,
      results: [mk("A", [epmc, pmc]), mk("B", [pub, doi]), mk("C", [epmc])] });
    const user = userEvent.setup();
    render(<LiteratureWorkspace />);
    await user.type(screen.getByLabelText("Search publications"), "alzheimer");
    await user.click(await screen.findByRole("button", { name: "Search" }));
    await screen.findByText("Paper A");
    const primaries = [...document.querySelectorAll("a[data-primary]")].map((a) => a.getAttribute("href"));
    expect(primaries).toEqual([pmc.url, doi.url, epmc.url]);
  });

  it("Load more merges a paper that is returned again instead of listing it twice", async () => {
    const dup = { ...hit, doi: "10.4135/x", external_id: "10.4135/x", source: "crossref", title: "What's Deep About Deep Learning?", sources: [{ provider: "crossref", external_id: "10.4135/x" }] };
    const sameViaOtherProvider = { ...dup, source: "openalex", external_id: "W9", sources: [{ provider: "openalex", external_id: "W9" }] };
    const base = { query: "q", source: "x", warnings: [], providers: [], total_unique: 1, duration_ms: 5 };
    mocks.search.mockResolvedValueOnce({ ...base, page: 1, results: [dup] }).mockResolvedValueOnce({ ...base, page: 2, results: [dup, sameViaOtherProvider] });
    const user = userEvent.setup();
    render(<LiteratureWorkspace />);
    await user.type(screen.getByLabelText("Search publications"), "deep learning");
    await user.click(await screen.findByRole("button", { name: "Search" }));
    await screen.findByText(dup.title);
    await user.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() => expect(mocks.search).toHaveBeenCalledTimes(2));
    await screen.findByText(/unique papers for/);
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(1);
    expect(screen.getAllByText("OpenAlex").length).toBeGreaterThan(0); // badge from the merged second record
    expect(screen.getByText(/unique papers for/)).toHaveTextContent("1 unique papers");
  });

  it("Select all / Deselect all / individual selection", async () => {
    const user = userEvent.setup();
    render(<LiteratureWorkspace />);
    await user.click(await screen.findByRole("button", { name: "Deselect all" }));
    for (const n of ["OpenAlex", "PubMed", "arXiv", "Semantic Scholar"]) expect(screen.getByLabelText(n)).not.toBeChecked();
    await user.click(screen.getByLabelText("arXiv"));
    expect(screen.getByLabelText("arXiv")).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Select all" }));
    for (const n of ["OpenAlex", "PubMed", "arXiv", "Semantic Scholar"]) expect(screen.getByLabelText(n)).toBeChecked();
  });

  it("a provider that needs a missing key is disabled and never selected by Select all", async () => {
    const user = userEvent.setup();
    render(<LiteratureWorkspace />);
    const box = await screen.findByLabelText(/Springer Nature/);
    expect(box).toBeDisabled();
    expect(screen.getByText("(key needed)")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Select all" }));
    expect(box).not.toBeChecked();
    expect(screen.getByLabelText("PubMed")).toBeChecked();
    expect(box.closest("label")).toHaveAttribute("title", expect.stringContaining("SPRINGER_API_KEY"));
  });

  it("shows a loading skeleton while searching and a retry after a whole-search failure", async () => {
    const { ApiError } = await import("@/lib/api");
    let rejectIt: (e: unknown) => void = () => {};
    mocks.search.mockReturnValueOnce(new Promise((_, rej) => { rejectIt = rej; }));
    const user = userEvent.setup();
    render(<LiteratureWorkspace />);
    await user.type(screen.getByLabelText("Search publications"), "alzheimer");
    await user.click(await screen.findByRole("button", { name: "Search" }));
    expect(screen.getByLabelText("Searching")).toHaveAttribute("aria-busy", "true");
    rejectIt(new ApiError("All selected sources failed: OpenAlex: timed out.", 502, "literature_unavailable"));
    expect(await screen.findByText(/All selected sources failed/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText(hit.title)).toBeInTheDocument();
    expect(mocks.search).toHaveBeenCalledTimes(2);
  });

  it("shows an error and retry when the provider list cannot load", async () => {
    const { ApiError } = await import("@/lib/api");
    mocks.providers.mockRejectedValueOnce(new ApiError("Could not load the list of sources.", 500));
    const user = userEvent.setup();
    render(<LiteratureWorkspace />);
    expect(await screen.findByText(/Could not load the list of sources/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByLabelText("PubMed")).toBeInTheDocument();
  });

  it("presets choose provider groups and an empty selection disables search", async () => {
    const user = userEvent.setup();
    render(<LiteratureWorkspace />);
    await user.type(screen.getByLabelText("Search publications"), "alzheimer");
    await user.click(await screen.findByRole("button", { name: "Computer science" }));
    expect(screen.getByLabelText("arXiv")).toBeChecked();
    expect(screen.getByLabelText("PubMed")).not.toBeChecked();
    expect(screen.getByLabelText("Semantic Scholar")).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Deselect all" }));
    expect(screen.getByRole("button", { name: "Search" })).toBeDisabled();
  });

  it("shows a save error and an empty result message", async () => {
    const { ApiError } = await import("@/lib/api");
    mocks.save.mockRejectedValue(new ApiError("Paper limit reached.", 403, "paper_limit_reached"));
    const user = userEvent.setup();
    render(<LiteratureWorkspace />);
    await user.type(screen.getByLabelText("Search publications"), "alzheimer");
    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.click(await screen.findByRole("button", { name: "Add to project" }));
    expect(await screen.findByText("Paper limit reached.")).toBeInTheDocument();
    mocks.search.mockResolvedValue({ query: "zzz", source: "all", page: 1, results: [], warnings: [], providers: [], total_unique: 0, duration_ms: 10 });
    await user.clear(screen.getByLabelText("Search publications"));
    await user.type(screen.getByLabelText("Search publications"), "zzz");
    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByText(/No publications found/)).toBeInTheDocument();
  });

  it("lists saved papers for the project and removes one", async () => {
    mocks.papers = [{ ...hit, id: 5, project_ids: [project.id], cites: [] } satisfies Paper];
    mocks.remove.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<LiteratureWorkspace />);
    await user.click(screen.getByRole("tab", { name: /Saved \(1\)/ }));
    await user.click(screen.getByRole("button", { name: /Remove Hippocampal/ }));
    expect(mocks.remove).toHaveBeenCalledWith(project.id, 5);
  });

  it("shows the publication type, the verification badge and match explanation on a card", async () => {
    const rich = { ...hit, publication_type: "review", relevance: 0.6, match: { terms: 4, terms_found: 3, missing_terms: ["biomarker"], in_title: 2, exact_title: false, phrase_found: true },
      verification: { status: "cross_checked", sources_agreeing: 3, checks: [{ id: "title", status: "pass", detail: "Titles agree across sources." }] } };
    mocks.search.mockResolvedValue({ query: "q", source: "x", page: 1, warnings: [], providers: [], total_unique: 1, duration_ms: 5, results: [rich, { ...hit, external_id: "W2", doi: "10.1/y", title: "Other", publication_type: "book_chapter" }, { ...hit, external_id: "W3", doi: "10.1/z", title: "Third", publication_type: "unknown" }] });
    const user = userEvent.setup();
    render(<LiteratureWorkspace />);
    await user.type(screen.getByLabelText("Search publications"), "alzheimer");
    await user.click(await screen.findByRole("button", { name: "Search" }));
    await screen.findByText(hit.title);
    expect(screen.getByText("Review article")).toBeInTheDocument();
    expect(screen.getByText("Book chapter")).toBeInTheDocument();
    expect(screen.getByText("Type not stated")).toBeInTheDocument();
    expect(screen.getByText(/Matches 3 of 4 search terms/)).toHaveTextContent("missing: biomarker");
    await user.click(screen.getByRole("button", { name: /Cross-checked · 3/ }));
    expect(screen.getByText("Titles agree across sources.")).toBeInTheDocument();
  });

  it("flags an identifier conflict instead of hiding it", async () => {
    const conflict = { ...hit, verification: { status: "conflict", sources_agreeing: 1, checks: [{ id: "identifier_conflict", status: "fail", detail: "Another record shares an identifier with this one but has a different PMID (1 vs 2), so they were not merged." }] } };
    mocks.search.mockResolvedValue({ query: "q", source: "x", page: 1, warnings: [], providers: [], total_unique: 1, duration_ms: 5, results: [conflict] });
    const user = userEvent.setup();
    render(<LiteratureWorkspace />);
    await user.type(screen.getByLabelText("Search publications"), "alzheimer");
    await user.click(await screen.findByRole("button", { name: "Search" }));
    await user.click(await screen.findByRole("button", { name: /Identifier conflict/ }));
    expect(screen.getByText(/so they were not merged/)).toBeInTheDocument();
  });

  it("checks identifiers online on request and reports the registries' answer", async () => {
    const verify = vi.fn().mockResolvedValue({ source: "openalex", external_id: "W1", status: "conflict", checks: [{ id: "pmcid_pmid", status: "fail", detail: "PMC maps PMC999 to PMID 7, not 9." }, { id: "doi_title", status: "pass", detail: "Crossref title matches." }] });
    const apiMod = await import("@/lib/api");
    apiMod.api.verifyPaper = verify;
    const user = userEvent.setup();
    render(<LiteratureWorkspace />);
    await user.type(screen.getByLabelText("Search publications"), "alzheimer");
    await user.click(await screen.findByRole("button", { name: "Search" }));
    await screen.findByText(hit.title);
    await user.click(screen.getByRole("button", { name: "Verify" }));
    await user.click(screen.getByRole("button", { name: "Check identifiers online" }));
    expect(await screen.findByText("PMC maps PMC999 to PMID 7, not 9.")).toBeInTheDocument();
    expect(screen.getByText("An identifier does not match this record.")).toBeInTheDocument();
    expect(verify).toHaveBeenCalledWith("openalex", "W1");
  });

  it("shows source status with retries and retries only the failed provider, merging its papers", async () => {
    const retried = { ...hit, external_id: "arx", doi: "10.9/arx", title: "Arrived after retry", source: "arxiv", relevance: 0.99, sources: [{ provider: "arxiv", external_id: "arx" }] };
    mocks.search.mockResolvedValueOnce({ query: "q", source: "x", page: 1, warnings: ["arXiv: down"], total_unique: 1, duration_ms: 5, results: [{ ...hit, relevance: 0.2 }],
      providers: [{ provider: "openalex", name: "OpenAlex", ok: true, count: 1, error: null, duration_ms: 100, requests: 1, retries: 0 }, { provider: "arxiv", name: "arXiv", ok: false, count: 0, error: "arXiv is down", error_kind: "error", duration_ms: 2400, requests: 3, retries: 2 }] })
      .mockResolvedValueOnce({ query: "q", source: "arxiv", page: 1, warnings: [], total_unique: 1, duration_ms: 5, results: [retried], providers: [{ provider: "arxiv", name: "arXiv", ok: true, count: 1, error: null, duration_ms: 300, requests: 1, retries: 0 }] });
    const user = userEvent.setup();
    render(<LiteratureWorkspace />);
    await user.type(screen.getByLabelText("Search publications"), "alzheimer");
    await user.click(await screen.findByRole("button", { name: "Search" }));
    await screen.findByText(hit.title);
    expect(screen.getByText(/retried 2×/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry arXiv" }));
    await screen.findByText("Arrived after retry");
    expect(mocks.search).toHaveBeenLastCalledWith("alzheimer", ["arxiv"], 1);
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(["Arrived after retry", hit.title]); // re-ranked by relevance
    expect(screen.queryByRole("button", { name: "Retry arXiv" })).not.toBeInTheDocument();
  });

  it("names Springer Nature correctly on result badges and lists key requirements", async () => {
    mocks.search.mockResolvedValue({ query: "q", source: "x", page: 1, warnings: [], providers: [], total_unique: 1, duration_ms: 5,
      results: [{ ...hit, source: "springer", sources: [{ provider: "springer", external_id: "10.1/x" }, { provider: "semanticscholar", external_id: "a" }] }] });
    const user = userEvent.setup();
    render(<LiteratureWorkspace />);
    await user.type(screen.getByLabelText("Search publications"), "alzheimer");
    await user.click(await screen.findByRole("button", { name: "Search" }));
    await screen.findByText(hit.title);
    const card = within(screen.getAllByRole("listitem").find((li) => li.querySelector("h3")) as HTMLElement);
    expect(card.getByText("Springer Nature")).toBeInTheDocument();
    expect(card.getByText("Semantic Scholar")).toBeInTheDocument();
    await user.click(screen.getByText("Source details and API keys"));
    expect(screen.getByText(/API key required: not configured \(set SPRINGER_API_KEY on the server\)/)).toBeInTheDocument();
    expect(screen.getByText(/disabled: key missing/)).toBeInTheDocument();
  });
});

