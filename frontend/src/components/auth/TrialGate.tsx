"use client";

import { LoaderCircle, Sparkles } from "lucide-react";
import Link from "next/link";
import { buttonStyles } from "@/components/ui/MagneticButton";
import { useStartTrial } from "@/hooks/useStartTrial";

/** Shown instead of the project form to visitors with no session at all. */
export function TrialGate() {
  const { start, busy, error } = useStartTrial();
  return (
    <div className="glass rounded-2xl p-6 sm:p-8">
      <span className="flex h-11 w-11 items-center justify-center rounded-full border border-cyan/50 bg-cyan/10 text-cyan">
        <Sparkles size={20} aria-hidden />
      </span>
      <h2 className="mt-5 text-xl font-semibold">Create your first research project — free</h2>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-300">
        No account needed to try ResearchForge. Guests get one saved research project; create a free account any time to
        keep it and add more.
      </p>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button type="button" onClick={start} disabled={busy} className={buttonStyles("primary", "disabled:opacity-70")}>
          {busy && <LoaderCircle size={16} className="animate-spin" aria-hidden />}
          Start free trial
        </button>
        <Link href="/login?next=/workspace" className={buttonStyles("ghost")}>
          Sign in
        </Link>
        <Link href="/register" className="px-2 text-sm text-cyan hover:underline">
          Create account
        </Link>
      </div>
      {error && (
        <p role="alert" className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
