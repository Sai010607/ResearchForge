"use client";

import { ArrowRight } from "lucide-react";
import { TryFreeButton } from "@/components/auth/TryFreeButton";
import { Reveal } from "@/components/ui/Reveal";

export function FinalCta() {
  return (
    <section className="relative isolate overflow-hidden border-t border-line">
      <div
        className="absolute inset-0 -z-10"
        aria-hidden
        style={{ background: "radial-gradient(50% 80% at 50% 100%, rgba(79,140,255,.18), transparent 70%)" }}
      />
      <Reveal className="mx-auto max-w-3xl px-6 py-24 text-center">
        <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Begin with a research question.</h2>
        <p className="mx-auto mt-4 max-w-lg text-sm text-muted">
          Define your question, imaging modality, domain and objectives. Try it free as a guest, or create an
          account to keep every project in your own research history.
        </p>
        <div className="mt-8">
          <TryFreeButton signedInLabel={<>Start Research Project <ArrowRight size={16} /></>} />
        </div>
      </Reveal>
    </section>
  );
}
