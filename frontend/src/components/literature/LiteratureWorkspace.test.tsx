import { render, screen, waitFor } from "@testing-library/react";
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
  search: vi.fn(), save: vi.fn(), remove: vi.fn(), refresh: vi.fn(), papers: [] as unknown[],
}));
vi.mock("@/hooks/useProjects", () => ({ useProjects: () => ({ projects: [project], loading: false }) }));
vi.mock("@/hooks/useMyPapers", () => ({
  useMyPapers: () => ({ papers: mocks.papers, loading: false, error: "", refresh: mocks.refresh }),
}));
vi.mock("@/lib/api", async (orig) => {
  const m = await orig<typeof import("@/lib/api")>();
  return { ...m, api: { ...m.api, searchLiterature: mocks.search, savePaper: mocks.save, removePaper: mocks.remove } };
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.papers = [];
  mocks.search.mockResolvedValue({ query: "q", source: "all", page: 1, results: [hit], warnings: ["Europe PMC unavailable"] });
  mocks.save.mockResolvedValue({});
});

describe("LiteratureWorkspace", () => {
  it("searches, shows honest metadata, warnings, and saves by id only", async () => {
    const user = userEvent.setup();
    render(<LiteratureWorkspace />);
    await user.type(screen.getByLabelText("Search publications"), "alzheimer");
    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByText(hit.title)).toBeInTheDocument();
    expect(screen.getByText("No abstract provided by the source.")).toBeInTheDocument();
    expect(screen.getByText("Europe PMC unavailable")).toBeInTheDocument();
    expect(screen.getByTitle(/matched “T1” in the title/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add to project" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(project.id, { source: "openalex", external_id: "W1" }));
    expect(mocks.refresh).toHaveBeenCalled();
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
    mocks.search.mockResolvedValue({ query: "zzz", source: "all", page: 1, results: [], warnings: [] });
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
});

