"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { buttonStyles } from "@/components/ui/MagneticButton";
import { useAuth } from "@/hooks/useAuth";

/** Renders children for guests and members; asks anonymous visitors to sign in. */
export function IdentityGate({ children, next }: { children: ReactNode; next: string }) {
  const { status, error } = useAuth();
  if (status === "loading")
    return <div className="mx-auto max-w-7xl px-6 py-14" aria-busy="true"><div className="h-64 animate-pulse rounded-2xl bg-white/[0.03]" /></div>;
  if (status === "anonymous")
    return (
      <div className="mx-auto max-w-xl px-6 py-24 text-center">
        <h1 className="text-2xl font-semibold">Sign in to see your dashboard</h1>
        <p className="mt-3 text-sm text-muted">
          Your research projects and analytics live in your account. {error && <span className="text-red-300">{error}</span>}
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link href={`/login?next=${encodeURIComponent(next)}`} className={buttonStyles("primary")}>
            Sign in
          </Link>
          <Link href="/register" className={buttonStyles("ghost")}>
            Create free account
          </Link>
        </div>
      </div>
    );
  return <>{children}</>;
}
