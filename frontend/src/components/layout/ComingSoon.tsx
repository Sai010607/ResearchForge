import { ModuleArt } from "@/components/landing/ModuleArt";
import { Reveal } from "@/components/ui/Reveal";
import type { ResearchModule } from "@/lib/modules";

export function ComingSoon({
  module: m,
  title,
  intro,
  planned,
}: {
  module: ResearchModule;
  title: string;
  intro: string;
  planned: { title: string; desc: string }[];
}) {
  return (
    <div className="relative isolate overflow-hidden">
      <div className="grid-bg absolute inset-x-0 top-0 -z-10 h-[420px] opacity-50" aria-hidden />
      <div className="mx-auto max-w-5xl px-6 py-16">
        <Reveal>
          <p className="eyebrow" style={{ color: m.accent }}>Module {m.number} · Planned for Phase {m.phase}</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted">{intro}</p>
          <p className="mt-5 inline-block rounded-full border border-line-strong px-3 py-1 font-mono text-[11px] uppercase tracking-wider text-muted">
            Not built yet — nothing on this page is functional
          </p>
        </Reveal>

        <div className="mt-12 grid gap-8 md:grid-cols-5">
          <Reveal className="md:col-span-3" delay={0.05}>
            <ul className="space-y-3">
              {planned.map((p) => (
                <li key={p.title} className="glass rounded-xl p-4">
                  <p className="text-sm font-medium">{p.title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted">{p.desc}</p>
                </li>
              ))}
            </ul>
          </Reveal>
          <Reveal className="md:col-span-2" delay={0.1}>
            <div className="group glass flex h-full min-h-48 items-center justify-center rounded-2xl p-6">
              <div className="h-36 w-full">
                <ModuleArt id={m.id} color={m.accent} />
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </div>
  );
}
