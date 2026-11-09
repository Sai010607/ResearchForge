import type { Paper } from "@/types/paper";
import type { Project } from "@/types/project";
import { mulberry32 } from "./utils";

export type NodeType = "project" | "paper" | "author" | "concept" | "method" | "dataset" | "modality" | "disease";
export type Shape = "sphere" | "octahedron" | "icosahedron" | "box" | "tetrahedron" | "dodecahedron" | "cone" | "torus";
export type V3 = [number, number, number];

export interface GNode { id: string; label: string; type: NodeType; detail?: string }
export interface GEdge { source: string; target: string; relation: string }
export interface GraphData { nodes: GNode[]; edges: GEdge[]; synthetic: boolean }

// Shape AND colour differ per type so the legend works without relying on colour alone.
export const NODE_STYLE: Record<NodeType, { label: string; color: string; shape: Shape; size: number }> = {
  project: { label: "Project", color: "#2563ff", shape: "sphere", size: 0.42 },
  paper: { label: "Paper", color: "#38bdf8", shape: "sphere", size: 0.3 },
  author: { label: "Author", color: "#c4b5fd", shape: "tetrahedron", size: 0.3 },
  concept: { label: "Concept / objective", color: "#00cfff", shape: "octahedron", size: 0.3 },
  method: { label: "Method", color: "#8b5cf6", shape: "icosahedron", size: 0.32 },
  dataset: { label: "Dataset", color: "#2dd4bf", shape: "box", size: 0.46 },
  modality: { label: "Modality", color: "#f472b6", shape: "dodecahedron", size: 0.34 },
  disease: { label: "Disease / domain", color: "#fbbf24", shape: "cone", size: 0.38 },
};

const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

/**
 * REAL graph: derived live from the user's saved projects and the papers they saved to them.
 * Paper nodes come from OpenAlex / Europe PMC; dataset, method, modality and disease links come from
 * rule-based tags found in each paper's own title/abstract (the matched text is shown in the panel).
 */
export function buildProjectGraph(projects: Project[], papers: Paper[] = []): GraphData {
  const nodes = new Map<string, GNode>();
  const edges: GEdge[] = [];
  const edgeKeys = new Set<string>();
  const link = (source: string, target: string, relation: string) => {
    const k = `${source}|${target}|${relation}`;
    if (!edgeKeys.has(k)) {
      edgeKeys.add(k);
      edges.push({ source, target, relation });
    }
  };
  for (const p of projects) {
    const pid = `project:${p.id}`;
    nodes.set(pid, { id: pid, label: `Project #${p.id}`, type: "project", detail: p.research_question });
    const mid = `modality:${p.modality}`;
    nodes.set(mid, { id: mid, label: p.modality, type: "modality", detail: "Imaging modality" });
    link(pid, mid, "Uses modality");
    const did = `disease:${p.disease}`;
    nodes.set(did, { id: did, label: p.disease, type: "disease", detail: "Research domain" });
    link(pid, did, "Studies disease");
    for (const o of p.objectives) {
      const oid = `objective:${o}`;
      nodes.set(oid, { id: oid, label: o, type: "concept", detail: "Research objective" });
      link(pid, oid, "Shares research objective");
    }
  }
  const projectIds = new Set(projects.map((p) => p.id));
  for (const paper of papers) {
    const nid = `paper:${paper.id}`;
    const meta = [paper.year, paper.venue, paper.doi ? `doi:${paper.doi}` : null].filter(Boolean).join(" · ");
    nodes.set(nid, { id: nid, label: clip(paper.title, 46), type: "paper", detail: `${paper.title}${meta ? `\n${meta}` : ""}` });
    for (const pid of paper.project_ids) if (projectIds.has(pid)) link(`project:${pid}`, nid, "Saved in project");
    for (const a of paper.authors.slice(0, 3)) {
      const aid = `author:${a.toLowerCase()}`;
      nodes.set(aid, { id: aid, label: a, type: "author", detail: "Author (from the paper's source record)" });
      link(aid, nid, "Authored");
    }
    const ex = paper.extracted;
    const tag = (list: { value: string; matched: string; field: string }[] | undefined, type: NodeType, prefix: string, relation: string, detail: string) => {
      for (const t of list ?? []) {
        const id = `${prefix}:${t.value}`;
        if (!nodes.has(id)) nodes.set(id, { id, label: t.value, type, detail });
        link(nid, id, `${relation} (matched “${t.matched}” in ${t.field})`);
      }
    };
    tag(ex.modalities, "modality", "modality", "Uses modality", "Imaging modality");
    tag(ex.diseases, "disease", "disease", "Studies disease", "Research domain");
    tag(ex.datasets, "dataset", "dataset", "Uses dataset", "Dataset named in the paper");
    tag(ex.methods, "method", "method", "Applies methodology", "Method named in the paper");
  }
  const byId = new Map(papers.map((p) => [p.id, p]));
  for (const paper of papers) for (const c of paper.cites) if (byId.has(c)) link(`paper:${paper.id}`, `paper:${c}`, "Cites");
  return { nodes: [...nodes.values()], edges, synthetic: false };
}

/** SYNTHETIC demo structure. Paper/author nodes are placeholders, not real publications. */
export function buildSampleGraph(): GraphData {
  const PH = "Synthetic placeholder — not a real publication.";
  const n = (id: string, label: string, type: NodeType, detail?: string): GNode => ({ id, label, type, detail });
  const nodes: GNode[] = [
    n("ds_adni", "ADNI", "dataset", "Public Alzheimer's neuroimaging dataset."),
    n("ds_abide", "ABIDE", "dataset", "Public autism neuroimaging dataset."),
    n("ds_oasis", "OASIS", "dataset", "Public open-access neuroimaging dataset."),
    n("mod_t1", "T1-weighted MRI", "modality"),
    n("mod_fmri", "fMRI", "modality"),
    n("mod_dti", "DTI", "modality"),
    n("dis_ad", "Alzheimer's Disease", "disease"),
    n("dis_asd", "Autism Spectrum Disorder", "disease"),
    n("dis_ms", "Multiple sclerosis", "disease"),
    n("m_gcn", "Graph convolutional network", "method"),
    n("m_rf", "Random forest", "method"),
    n("m_cnn", "3D CNN", "method"),
    n("m_svm", "SVM", "method"),
    n("m_unet", "U-Net", "method"),
    n("c_hip", "Hippocampal atrophy", "concept"),
    n("c_interp", "Interpretable biomarkers", "concept"),
    n("c_fc", "Functional connectivity", "concept"),
    n("c_wm", "White-matter integrity", "concept"),
    ...Array.from({ length: 8 }, (_, i) => n(`p${i + 1}`, `Sample paper 0${i + 1}`, "paper", PH)),
    ...["A", "B", "C", "D"].map((x, i) => n(`a${i + 1}`, `Sample author ${x}`, "author", "Synthetic placeholder.")),
  ];
  const e = (source: string, target: string, relation: string): GEdge => ({ source, target, relation });
  const paper = (p: string, ds: string, mod: string, dis: string, m: string, c: string): GEdge[] => [
    e(p, ds, "Uses dataset"), e(p, mod, "Uses modality"), e(p, dis, "Studies disease"), e(p, m, "Applies methodology"), e(p, c, "Investigates"),
  ];
  const edges: GEdge[] = [
    ...paper("p1", "ds_adni", "mod_t1", "dis_ad", "m_cnn", "c_hip"),
    ...paper("p2", "ds_adni", "mod_t1", "dis_ad", "m_rf", "c_interp"),
    ...paper("p3", "ds_oasis", "mod_t1", "dis_ad", "m_svm", "c_hip"),
    ...paper("p4", "ds_abide", "mod_fmri", "dis_asd", "m_gcn", "c_fc"),
    ...paper("p5", "ds_abide", "mod_fmri", "dis_asd", "m_svm", "c_fc"),
    ...paper("p6", "ds_adni", "mod_t1", "dis_ad", "m_gcn", "c_interp"),
    ...paper("p7", "ds_x", "mod_dti", "dis_ms", "m_unet", "c_wm"),
    e("p6", "p1", "Extends previous work"),
    e("p5", "p4", "Similar methodology"),
    e("a1", "p1", "Authored"), e("a1", "p2", "Authored"), e("a1", "p6", "Authored"),
    e("a2", "p2", "Authored"), e("a2", "p3", "Authored"),
    e("a3", "p4", "Authored"), e("a3", "p5", "Authored"),
    e("a4", "p7", "Authored"), e("a4", "p8", "Authored"),
    e("p8", "mod_dti", "Uses modality"), e("p8", "dis_ms", "Studies disease"), e("p8", "c_wm", "Investigates"),
  ].filter((x) => x.target !== "ds_x");
  return { nodes, edges, synthetic: true };
}

/** Deterministic 3D force-directed layout (Fruchterman–Reingold). */
export function layout3d(nodes: GNode[], edges: GEdge[]): Record<string, V3> {
  const rnd = mulberry32(42);
  const idx = new Map(nodes.map((nd, i) => [nd.id, i]));
  const P = nodes.map(() => [(rnd() - 0.5) * 8, (rnd() - 0.5) * 8, (rnd() - 0.5) * 8]);
  const k = 3;
  const ITER = 260;
  for (let it = 0; it < ITER; it++) {
    const temp = 0.9 * (1 - it / ITER) + 0.02;
    const D = nodes.map(() => [0, 0, 0]);
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = P[i][0] - P[j][0], dy = P[i][1] - P[j][1], dz = P[i][2] - P[j][2];
        const dist = Math.max(0.05, Math.hypot(dx, dy, dz));
        const f = (k * k) / dist / dist;
        D[i][0] += dx * f; D[i][1] += dy * f; D[i][2] += dz * f;
        D[j][0] -= dx * f; D[j][1] -= dy * f; D[j][2] -= dz * f;
      }
    }
    for (const ed of edges) {
      const a = idx.get(ed.source), b = idx.get(ed.target);
      if (a === undefined || b === undefined) continue;
      const dx = P[a][0] - P[b][0], dy = P[a][1] - P[b][1], dz = P[a][2] - P[b][2];
      const dist = Math.max(0.05, Math.hypot(dx, dy, dz));
      const f = dist / k;
      D[a][0] -= dx * f; D[a][1] -= dy * f; D[a][2] -= dz * f;
      D[b][0] += dx * f; D[b][1] += dy * f; D[b][2] += dz * f;
    }
    for (let i = 0; i < nodes.length; i++) {
      for (let c = 0; c < 3; c++) D[i][c] -= P[i][c] * 0.35;
      const len = Math.hypot(D[i][0], D[i][1], D[i][2]) || 1;
      const step = Math.min(len, temp);
      for (let c = 0; c < 3; c++) P[i][c] += (D[i][c] / len) * step;
    }
  }
  // centre on the centroid so disconnected clusters don't drift off-screen
  const n = Math.max(1, P.length);
  const cen = [0, 1, 2].map((c) => P.reduce((a, p) => a + p[c], 0) / n);
  for (const p of P) for (let c = 0; c < 3; c++) p[c] -= cen[c];
  const maxR = Math.max(0.01, ...P.map((p) => Math.hypot(p[0], p[1], p[2])));
  // always fit the view: disconnected clusters can fly far apart, so never clamp the scale upward
  const scale = Math.min(4, 6.5 / maxR);
  const out: Record<string, V3> = {};
  nodes.forEach((nd, i) => (out[nd.id] = [P[i][0] * scale, P[i][1] * scale, P[i][2] * scale]));
  return out;
}

/** Connected components = distinct, mutually disconnected research areas. */
export function clusterSizes(nodes: GNode[], edges: GEdge[]): number[] {
  const parent = new Map(nodes.map((n) => [n.id, n.id]));
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  for (const e of edges) if (parent.has(e.source) && parent.has(e.target)) parent.set(find(e.source), find(e.target));
  const sizes = new Map<string, number>();
  for (const n of nodes) sizes.set(find(n.id), (sizes.get(find(n.id)) ?? 0) + 1);
  return [...sizes.values()].sort((a, b) => b - a);
}
