"use client";

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { Reveal } from "@/components/ui/Reveal";
import { Tilt } from "@/components/ui/Tilt";
import { MODULES, type ResearchModule } from "@/lib/modules";
import { cn } from "@/lib/utils";
import { ModuleArt } from "./ModuleArt";

// Bento layout: tiles intentionally differ in size and composition.
const SPAN: Record<string, string> = {
  literature: "lg:col-span-4",
  metadata: "lg:col-span-2",
  graph: "lg:col-span-3",
  novelty: "lg:col-span-3",
  mri: "lg:col-span-2",
  experiments: "lg:col-span-2",
  validation: "lg:col-span-2",
  publication: "lg:col-span-6",
};

function StatusChip({ m }: { m: ResearchModule }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider"
      style={{
        borderColor: m.status === "preview" ? `${m.accent}77` : "var(--line-strong)",
        color: m.status === "preview" ? m.accent : "var(--muted)",
      }}
    >
      <span className="h-1 w-1 rounded-full" style={{ background: m.status === "preview" ? m.accent : "var(--muted)" }} />
      {m.status === "preview" ? "Preview" : `Planned · Phase ${m.phase}`}
    </span>
  );
}

function Tile({ m }: { m: ResearchModule }) {
  const wide = m.id === "publication";
  const body = (
    <div
      className={cn(
        "group glass relative h-full overflow-hidden rounded-2xl p-6 transition-colors",
        m.href ? "hover:border-white/25" : "",
        wide && "sm:flex sm:items-center sm:gap-10",
      )}
    >
      <div
        className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full opacity-[0.10] blur-3xl transition-opacity group-hover:opacity-25"
        style={{ background: m.accent }}
        aria-hidden
      />
      <div className={cn("relative", wide && "sm:flex-1")}>
        <div className="flex items-center justify-between">
          <span className="font-mono text-xs" style={{ color: m.accent }}>
            {m.number}
          </span>
          <StatusChip m={m} />
        </div>
        <h3 className="mt-4 text-lg font-semibold tracking-tight">{m.title}</h3>
        <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted">{m.blurb}</p>
        {m.href && (
          <span className="mt-5 inline-flex items-center gap-1 text-sm" style={{ color: m.accent }}>
            Open <ArrowUpRight size={14} className="transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
          </span>
        )}
      </div>
      <div className={cn("relative mt-6 h-28", wide && "sm:mt-0 sm:h-32 sm:w-[46%]")}>
        <ModuleArt id={m.id} color={m.accent} />
      </div>
    </div>
  );

  return m.href ? (
    <Link href={m.href} className="block h-full rounded-2xl">
      {body}
    </Link>
  ) : (
    body
  );
}

export function Modules() {
  return (
    <section id="modules" className="scroll-mt-20 border-t border-line bg-ink-900/40">
      <div className="mx-auto max-w-7xl px-6 py-24">
        <Reveal>
          <p className="eyebrow">Eight modules</p>
          <h2 className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
            Every stage of research, connected.
          </h2>
          <p className="mt-4 max-w-xl text-sm text-muted">
            Status labels are literal: modules marked <em>Planned</em> are not built yet, and <em>Preview</em> means a
            working interface exists on top of your own project data.
          </p>
        </Reveal>

        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
          {MODULES.map((m, i) => (
            <Reveal key={m.id} delay={(i % 3) * 0.07} className={cn("[perspective:900px]", SPAN[m.id], m.id === "publication" && "sm:col-span-2")}>
              <Tilt className="h-full">
                <Tile m={m} />
              </Tilt>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
