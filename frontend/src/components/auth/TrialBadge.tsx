"use client";

import { Sparkles } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

/** Real trial state from the backend, e.g. "Guest Trial: 1/1 remaining". Renders nothing for non-guests. */
export function TrialBadge({ className }: { className?: string }) {
  const { status, trial } = useAuth();
  if (status !== "guest" || !trial) return null;
  return (
    <span
      role="status"
      aria-live="polite"
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 font-mono text-[11px]",
        trial.exhausted ? "border-amber-400/40 text-amber-300" : "border-cyan/40 text-cyan",
        className,
      )}
    >
      <Sparkles size={12} aria-hidden />
      Guest Trial: {trial.remaining}/{trial.limit} remaining
    </span>
  );
}
