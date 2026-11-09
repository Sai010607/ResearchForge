import type { Metadata } from "next";
import { IdentityGate } from "@/components/auth/IdentityGate";
import { LiteratureWorkspace } from "@/components/literature/LiteratureWorkspace";

export const metadata: Metadata = { title: "Literature — ResearchForge" };

export default function LiteraturePage() {
  return (
    <IdentityGate next="/literature" title="Sign in to search literature" blurb="Saved papers belong to your research projects.">
      <LiteratureWorkspace />
    </IdentityGate>
  );
}
