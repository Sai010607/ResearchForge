import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { USER, authMock, project } from "@/test/helpers";
import type { MemoryEntry, MemoryOverview } from "@/types/memory";
import { MemoryPanel } from "./MemoryPanel";

const auth = vi.hoisted(() => ({ current: {} as ReturnType<typeof import("@/test/helpers").authMock> }));
const store = vi.hoisted(() => ({ state: { projects: [] as unknown[], loading: false } }));
const m = vi.hoisted(() => ({
  overview: vi.fn(), rebuild: vi.fn(), audit: vi.fn(), entries: vi.fn(), createEntry: vi.fn(), patchEntry: vi.fn(), claims: vi.fn(), createClaim: vi.fn(),
  addEvidence: vi.fn(), patchClaim: vi.fn(), gaps: vi.fn(), createGap: vi.fn(), patchGap: vi.fn(), decisions: vi.fn(), createDecision: vi.fn(), patchDecision: vi.fn(),
  listProjectPapers: vi.fn(),
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth.current }));
vi.mock("@/hooks/useProjects", () => ({ useProjects: () => store.state }));
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  const { listProjectPapers, ...memory } = m;
  return { ...actual, api: { ...actual.api, memory, listProjectPapers } };
});

const page = <T,>(items: T[]) => ({ total: items.length, limit: 100, offset: 0, items });
const OVERVIEW: MemoryOverview = {
  project_id: 1, research_question: project.research_question, disease: "Alzheimer's Disease", modality: "T1-weighted MRI", objectives: ["Early Detection"],
  version: 2, summary: "2 saved paper(s); 9 memory entries.", last_rebuilt_at: "2026-11-09T10:00:00Z", last_updated_at: "2026-11-09T10:05:00Z",
  counts: { entries: 9, confirmed: 1, unverified: 6, rejected: 0, claims: 3, evidence: 4, decisions: 2, gaps: 1, saved_papers: 2,
    by_source: { source_metadata: 2, rule_extracted: 6, ai_extracted: 0, researcher_confirmed: 1, researcher_entered: 0 } },
  conflicts: [], not_extracted: ["limitations", "main_findings"], notice: "Entries marked rule_extracted are keyword/regex matches.",
};
const ENTRY: MemoryEntry = {
  id: 11, paper_id: 5, memory_type: "literature", field: "dataset", title: "Dataset: ADNI", content: "ADNI", origin: "auto", source_type: "rule_extracted",
  source_reference: "title of doi:10.1000/x", extraction_method: "rule-based keyword matching", matched_text: "ADNI cohort", section_name: "title",
  page_number: null, extracted_at: "2026-11-09T10:00:00Z", verification_status: "unverified", confidence: null, reviewed_at: null,
  created_at: "2026-11-09T10:00:00Z", updated_at: "2026-11-09T10:00:00Z",
  paper: { id: 5, title: "Hippocampal biomarkers on ADNI", doi: "10.1000/x", pmid: null, pmcid: null, source: "openalex", year: 2023, in_project: true, url: null },
};

beforeEach(() => {
  auth.current = authMock({ status: "user", user: USER });
  store.state = { projects: [project], loading: false };
  m.overview.mockResolvedValue(OVERVIEW);
  m.entries.mockResolvedValue(page([ENTRY]));
  m.claims.mockResolvedValue(page([]));
  m.gaps.mockResolvedValue(page([]));
  m.decisions.mockResolvedValue(page([]));
  m.audit.mockResolvedValue(page([]));
  m.listProjectPapers.mockResolvedValue([{ id: 5, title: "Hippocampal biomarkers on ADNI" }]);
});

const open = (name: string) => userEvent.setup().click(screen.getByRole("tab", { name }));

describe("MemoryPanel", () => {
  it("anonymous visitors are asked to sign in and no memory call is made", () => {
    auth.current = authMock();
    render(<MemoryPanel />);
    expect(screen.getByText(/Start the free trial or sign in/)).toBeInTheDocument();
    expect(m.overview).not.toHaveBeenCalled();
  });

  it("without a project it explains what to do first", () => {
    store.state = { projects: [], loading: false };
    render(<MemoryPanel />);
    expect(screen.getByText(/Create a research project first/)).toBeInTheDocument();
  });

  it("overview shows only the counts the backend returned", async () => {
    render(<MemoryPanel />);
    const counts = await screen.findByRole("group", { name: "Memory counts" }).catch(() => screen.findByLabelText("Memory counts"));
    expect(within(counts).getByText("Memory entries").previousSibling).toHaveTextContent("9");
    expect(within(counts).getByText("Evidence links").previousSibling).toHaveTextContent("4");
    expect(within(counts).getByText("Saved papers").previousSibling).toHaveTextContent("2");
    expect(screen.getByText(/rebuild count: 2/)).toBeInTheDocument();
    expect(screen.getByText(/Not extracted automatically.*limitations, main findings/)).toBeInTheDocument();
  });

  it("rebuild calls the API, reports the real result and refreshes", async () => {
    m.rebuild.mockResolvedValue({ created: 3, removed_stale: 0, papers_processed: 2, version: 3 });
    render(<MemoryPanel />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Rebuild memory" }));
    expect(m.rebuild).toHaveBeenCalledWith(1);
    expect(await screen.findByRole("status")).toHaveTextContent("3 new entries, 0 stale removed, 2 paper(s) processed");
    await waitFor(() => expect(m.overview.mock.calls.length).toBeGreaterThan(1));
  });

  it("a failing backend shows an error with retry instead of invented numbers", async () => {
    m.overview.mockRejectedValue(new ApiError("Cannot reach the backend"));
    render(<MemoryPanel />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Cannot reach the backend");
    expect(screen.queryByText("Memory entries")).not.toBeInTheDocument();
  });

  it("conflicting information is displayed with its caveat", async () => {
    m.overview.mockResolvedValue({ ...OVERVIEW, conflicts: [{ kind: "metric_variation", metric: "accuracy", note: "not directly comparable",
      values: [{ paper: "Paper A", value: "accuracy 92%", source_sentence: "s", datasets_named_in_paper: ["ADNI"] }, { paper: "Paper B", value: "accuracy 71%", source_sentence: "s", datasets_named_in_paper: [] }] }] });
    render(<MemoryPanel />);
    expect(await screen.findByText(/Reported accuracy differs between papers/)).toBeInTheDocument();
    expect(screen.getByText(/accuracy 92% — Paper A/)).toBeInTheDocument();
    expect(screen.getByText("not directly comparable")).toBeInTheDocument();
  });

  it("category navigation loads each section and the tablist stays scrollable on its own", async () => {
    render(<MemoryPanel />);
    await screen.findByText("Memory entries");
    const tabs = screen.getByRole("tablist");
    expect(tabs.className).toContain("overflow-x-auto");
    expect(screen.getAllByRole("tab")).toHaveLength(8);
    await open("Decisions");
    expect(await screen.findByText("No decisions recorded yet.")).toBeInTheDocument();
    await open("Memory history");
    expect(await screen.findByText("No memory activity yet.")).toBeInTheDocument();
    await open("Evidence");
    expect(await screen.findByText("No claims yet.")).toBeInTheDocument();
  });

  it("literature entries show provenance: source type, verification, matched text and a source link", async () => {
    render(<MemoryPanel />);
    await open("Literature insights");
    expect(await screen.findByText("Rule-extracted (keyword match)")).toBeInTheDocument();
    expect(screen.getByText("Unverified")).toBeInTheDocument();
    expect(screen.getByText(/“ADNI cohort”/)).toBeInTheDocument();
    expect(screen.getByText(/no confidence score \(rule match\)/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Hippocampal biomarkers on ADNI" });
    expect(link).toHaveAttribute("href", "https://doi.org/10.1000/x");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("confirm, reject and edit go through the API with the right payload", async () => {
    m.patchEntry.mockResolvedValue({ ...ENTRY, verification_status: "confirmed" });
    const user = userEvent.setup();
    render(<MemoryPanel />);
    await open("Literature insights");
    await user.click(await screen.findByRole("button", { name: "Confirm" }));
    expect(m.patchEntry).toHaveBeenLastCalledWith(1, 11, { verification_status: "confirmed" });
    await user.click(screen.getByRole("button", { name: "Reject" }));
    expect(m.patchEntry).toHaveBeenLastCalledWith(1, 11, { verification_status: "rejected" });
    await user.click(screen.getByRole("button", { name: "Edit" }));
    const box = screen.getByLabelText("Edit entry 11");
    await user.clear(box);
    await user.type(box, "ADNI-1");
    await user.click(screen.getByRole("button", { name: "Save edit" }));
    expect(m.patchEntry).toHaveBeenLastCalledWith(1, 11, { content: "ADNI-1" });
  });

  it("an entry error from the API is shown on the card", async () => {
    m.patchEntry.mockRejectedValue(new ApiError("Memory entry not found", 404));
    const user = userEvent.setup();
    render(<MemoryPanel />);
    await open("Literature insights");
    await user.click(await screen.findByRole("button", { name: "Confirm" }));
    expect(await screen.findByText("Memory entry not found")).toBeInTheDocument();
  });

  it("records a decision and can supersede an earlier one", async () => {
    m.decisions.mockResolvedValue(page([{ id: 4, supersedes_id: null, decision_type: "method_selected", description: "Use SVR", rationale: "small n", status: "active", created_at: "2026-11-09T10:00:00Z", updated_at: "2026-11-09T10:00:00Z" }]));
    m.createDecision.mockResolvedValue({});
    const user = userEvent.setup();
    render(<MemoryPanel />);
    await open("Decisions");
    await user.click(await screen.findByRole("button", { name: "Supersede…" }));
    expect(screen.getByText(/will supersede decision #4/)).toBeInTheDocument();
    await user.type(screen.getByLabelText("Decision"), "Use ridge regression");
    await user.click(screen.getByRole("button", { name: "Record decision" }));
    expect(m.createDecision).toHaveBeenCalledWith(1, { decision_type: "method_selected", description: "Use ridge regression", supersedes_id: 4 });
  });

  it("gap creation shows the not-proof-of-novelty warning and always sends the researcher's text", async () => {
    m.createGap.mockResolvedValue({});
    const user = userEvent.setup();
    render(<MemoryPanel />);
    await open("Research gaps");
    expect(await screen.findByRole("note")).toHaveTextContent(/not proof of novelty/);
    await user.type(screen.getByLabelText("Gap title"), "No external validation");
    await user.type(screen.getByLabelText("Description"), "All saved studies are single-site.");
    await user.click(screen.getByRole("button", { name: "Add potential gap" }));
    expect(m.createGap).toHaveBeenCalledWith(1, { title: "No external validation", description: "All saved studies are single-site.", gap_category: "methodological" });
  });

  it("a claim needs a source unless it is marked as a hypothesis", async () => {
    m.createClaim.mockResolvedValue({});
    const user = userEvent.setup();
    render(<MemoryPanel />);
    await open("Evidence");
    await user.type(await screen.findByLabelText("Claim"), "Regional selection lowers MAE");
    expect(screen.getByRole("button", { name: "Add claim" })).toBeDisabled();
    await user.selectOptions(screen.getByLabelText("Kind"), "hypothesis");
    await user.click(screen.getByRole("button", { name: "Add claim" }));
    expect(m.createClaim).toHaveBeenCalledWith(1, { claim_text: "Regional selection lowers MAE", claim_type: "hypothesis", evidence: [] });
  });

  it("evidence separates quotations from paraphrases and flags unverified quotes", async () => {
    const ev = { id: 1, claim_id: 2, paper_id: 5, relationship: "supports", evidence_kind: "quote", quoted_text: "accuracy of 92.3%", section_name: "abstract", page_number: null, source_url: null, verification_status: "source_matched", created_at: "x", paper: ENTRY.paper };
    m.claims.mockResolvedValue(page([{ id: 2, claim_text: "CNN works", claim_type: "finding", origin: "researcher", status: "active", confidence: null, created_at: "x", updated_at: "x", contested: true,
      evidence: [ev, { ...ev, id: 2, relationship: "contradicts", evidence_kind: "paraphrase", quoted_text: "it fails across sites", verification_status: "unverified" }] }]));
    render(<MemoryPanel />);
    await open("Evidence");
    expect(await screen.findByText(/Contested: supporting and contradicting evidence/)).toBeInTheDocument();
    expect(screen.getByText("Quotation")).toBeInTheDocument();
    expect(screen.getByText("Paraphrase")).toBeInTheDocument();
    expect(screen.getByText("“accuracy of 92.3%”")).toBeInTheDocument();
    expect(screen.getByText(/Found in the stored title\/abstract/)).toBeInTheDocument();
    expect(screen.getByText(/Not matched to stored text: unverified/)).toBeInTheDocument();
  });

  it("experiment context says it stores notes only and saves a researcher entry", async () => {
    m.entries.mockResolvedValue(page([]));
    m.createEntry.mockResolvedValue({});
    const user = userEvent.setup();
    render(<MemoryPanel />);
    await open("Experiment context");
    expect(await screen.findByText(/nothing here runs an experiment/)).toBeInTheDocument();
    expect(screen.getByText(/No entries yet/)).toBeInTheDocument();
    await user.type(screen.getByLabelText("Your entry"), "ADNI-1, 2024 release");
    await user.click(screen.getByRole("button", { name: "Add entry" }));
    expect(m.createEntry).toHaveBeenCalledWith(1, { memory_type: "experiment_context", field: "objective", content: "ADNI-1, 2024 release" });
  });

  it("history lists real audit events with who did them", async () => {
    m.audit.mockResolvedValue(page([{ id: 1, event_type: "entry_confirmed", actor: "researcher", subject_type: "entry", subject_id: 11, detail: { after: { verification_status: "confirmed" } }, created_at: "2026-11-09T10:00:00Z" }]));
    render(<MemoryPanel />);
    await open("Memory history");
    expect(await screen.findByText("Entry confirmed")).toBeInTheDocument();
    expect(screen.getByText("You")).toBeInTheDocument();
  });
});
