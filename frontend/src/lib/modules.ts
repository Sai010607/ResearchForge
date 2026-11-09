export type ModuleStatus = "preview" | "planned";

export interface ResearchModule {
  id: string;
  number: string;
  title: string;
  blurb: string;
  accent: string;
  status: ModuleStatus;
  phase: number;
  href?: string;
}

export const MODULES: ResearchModule[] = [
  { id: "literature", number: "01", title: "Literature Retrieval", blurb: "Semantic search across scientific publications.", accent: "#2563ff", status: "preview", phase: 1, href: "/literature" },
  { id: "metadata", number: "02", title: "Metadata Extraction", blurb: "Extract authors, methods, datasets, findings, and research parameters.", accent: "#00cfff", status: "planned", phase: 4 },
  { id: "graph", number: "03", title: "Knowledge Graph", blurb: "Build relationships between scientific concepts and publications.", accent: "#8b5cf6", status: "preview", phase: 4, href: "/knowledge-graph" },
  { id: "novelty", number: "04", title: "Novelty Analysis", blurb: "Identify research gaps, overlaps, and potential contributions.", accent: "#2dd4bf", status: "planned", phase: 4 },
  { id: "mri", number: "05", title: "MRI Preprocessing", blurb: "Support medical imaging preprocessing workflows.", accent: "#38bdf8", status: "planned", phase: 5 },
  { id: "experiments", number: "06", title: "Experiment Engine", blurb: "Manage AI/ML experimentation and model comparisons.", accent: "#818cf8", status: "planned", phase: 6, href: "/experiments" },
  { id: "validation", number: "07", title: "Model Validation", blurb: "Evaluate performance, reproducibility, and statistical reliability.", accent: "#a78bfa", status: "planned", phase: 6 },
  { id: "publication", number: "08", title: "Publication Planning", blurb: "Organize manuscripts, references, and publication readiness.", accent: "#7dd3fc", status: "planned", phase: 7 },
];

export const PIPELINE = [
  { id: "idea", label: "Research Idea", live: true },
  { id: "literature", label: "Literature", live: true },
  { id: "metadata", label: "Metadata", live: false },
  { id: "graph", label: "Knowledge Graph", live: false },
  { id: "novelty", label: "Novelty & Gaps", live: false },
  { id: "experiments", label: "Experiments", live: false },
  { id: "publication", label: "Publication", live: false },
] as const;
