import type { Metadata } from "next";
import { KnowledgeGraphExplorer } from "@/components/knowledge-graph/KnowledgeGraphExplorer";

export const metadata: Metadata = { title: "Knowledge Graph — ResearchForge" };

export default function KnowledgeGraphPage() {
  return <KnowledgeGraphExplorer />;
}
