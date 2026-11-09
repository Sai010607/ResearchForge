import type { Metadata } from "next";
import { MemoryPanel } from "@/components/memory/MemoryPanel";
import { ProjectForm } from "@/components/projects/ProjectForm";
import { ProjectList } from "@/components/projects/ProjectList";
import { Reveal } from "@/components/ui/Reveal";

export const metadata: Metadata = { title: "Research Workspace — ResearchForge" };

export default function WorkspacePage() {
  return (
    <div className="relative isolate">
      <div className="grid-bg absolute inset-x-0 top-0 -z-10 h-[420px] opacity-50" aria-hidden />
      <div className="mx-auto max-w-7xl px-6 py-14">
        <Reveal>
          <p className="eyebrow">Research workspace</p>
          <h1 className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
            Define the question. Everything else follows from it.
          </h1>
        </Reveal>

        <div className="mt-10 grid gap-8 lg:grid-cols-5">
          <Reveal delay={0.05} className="lg:col-span-3">
            <ProjectForm />
          </Reveal>
          <Reveal delay={0.12} className="lg:col-span-2">
            <div className="lg:sticky lg:top-24">
              <h2 className="mb-4 flex items-center justify-between text-sm font-medium">
                Project history
                <span className="font-mono text-[10px] uppercase tracking-wider text-muted">from PostgreSQL</span>
              </h2>
              <ProjectList />
            </div>
          </Reveal>
        </div>

        <MemoryPanel />
      </div>
    </div>
  );
}
