import type { Metadata } from "next";
import { ComingSoon } from "@/components/layout/ComingSoon";
import { MODULES } from "@/lib/modules";

export const metadata: Metadata = { title: "Literature — ResearchForge" };

export default function LiteraturePage() {
  return (
    <ComingSoon
      module={MODULES.find((m) => m.id === "literature")!}
      title="Literature retrieval"
      intro="Search real scientific publications, deduplicate them, and keep the ones that matter. Results will come from public scholarly APIs; nothing will be generated or invented."
      planned={[
        { title: "OpenAlex and PubMed search", desc: "Keyword queries with date and author filters, DOIs and abstracts." },
        { title: "Semantic Scholar, arXiv and Europe PMC", desc: "Additional sources, merged and deduplicated by DOI and title." },
        { title: "Library and bookmarks", desc: "Save papers per project, stored in PostgreSQL." },
      ]}
    />
  );
}
