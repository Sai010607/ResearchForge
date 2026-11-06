"use client";

import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, type ReactNode } from "react";
import { MagneticButton, buttonStyles } from "@/components/ui/MagneticButton";
import { useAuth } from "@/hooks/useAuth";
import { useStartTrial } from "@/hooks/useStartTrial";

/**
 * "Try ResearchForge Free": starts a real server-side guest session, then opens /workspace.
 * Signed-in users and returning guests get a plain link instead (their state comes from the server).
 */
export function TryFreeButton({
  children = "Try ResearchForge Free",
  signedInLabel = "Start Research Project",
  variant = "primary",
}: {
  children?: ReactNode;
  signedInLabel?: ReactNode;
  variant?: "primary" | "ghost";
}) {
  const router = useRouter();
  const { status, trial } = useAuth();
  const go = useCallback(() => router.push("/workspace"), [router]);
  const { start, busy, error } = useStartTrial(go);

  if (status === "user") return <MagneticButton href="/workspace" variant={variant}>{signedInLabel}</MagneticButton>;
  if (status === "guest")
    return <MagneticButton href="/workspace" variant={variant}>{trial?.exhausted ? "View your project" : "Continue free trial"}</MagneticButton>;

  return (
    <div className="pointer-events-auto">
      <button type="button" onClick={start} disabled={busy} className={buttonStyles(variant, "disabled:opacity-70")}>
        {busy && <LoaderCircle size={16} className="animate-spin" aria-hidden />}
        {children}
      </button>
      {error && (
        <p role="alert" className="mt-2 max-w-xs text-xs text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
