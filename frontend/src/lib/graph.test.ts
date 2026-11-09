import { describe, expect, it } from "vitest";
import { buildSampleGraph, layout3d } from "./graph";

describe("layout3d", () => {
  it("keeps every node inside the camera's view and centred, even with disconnected clusters", () => {
    const g = buildSampleGraph();
    const pts = Object.values(layout3d(g.nodes, g.edges));
    expect(pts).toHaveLength(g.nodes.length);
    expect(Math.max(...pts.map((p) => Math.hypot(...p)))).toBeLessThanOrEqual(6.6);
    for (let c = 0; c < 3; c++) expect(Math.abs(pts.reduce((a, p) => a + p[c], 0) / pts.length)).toBeLessThan(0.01);
  });
});

describe("buildProjectGraph with saved papers", () => {
  it("adds real paper nodes, tag nodes with evidence, and citation edges", async () => {
    const { buildProjectGraph } = await import("./graph");
    const { project } = await import("@/test/helpers");
    const mk = (id: number, cites: number[]) => ({
      id, source: "openalex", external_id: `W${id}`, doi: null, pmid: null, title: `Paper ${id}`, abstract: null, year: 2020,
      venue: null, authors: ["Ann"], url: null, cited_by_count: null, keywords: [], project_ids: [project.id], cites,
      extracted: { datasets: [{ value: "ADNI", matched: "ADNI", field: "abstract" as const }] },
    });
    const g = buildProjectGraph([project], [mk(1, [2]), mk(2, [])]);
    expect(g.synthetic).toBe(false);
    expect(g.nodes.filter((n) => n.type === "paper")).toHaveLength(2);
    expect(g.nodes.filter((n) => n.id === "dataset:ADNI")).toHaveLength(1);
    expect(g.edges.some((e) => e.source === "paper:1" && e.target === "paper:2" && e.relation === "Cites")).toBe(true);
    expect(g.edges.some((e) => e.relation.includes("matched “ADNI”"))).toBe(true);
  });
});
