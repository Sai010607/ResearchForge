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
