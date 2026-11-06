"use client";

import { CircleAlert, CircleCheck, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { ApiError, api } from "@/lib/api";
import { AuthShell } from "./AuthShell";

type Result = { token: string; ok: boolean; message: string };

// Verification tokens are single-use. React StrictMode runs effects twice in development, so the
// in-flight request is shared per token — otherwise the 2nd call would fail and mask the success.
const inflight = new Map<string, Promise<Result>>();
function verifyOnce(token: string): Promise<Result> {
  let p = inflight.get(token);
  if (!p) {
    p = api
      .verifyEmail(token)
      .then((r) => ({ token, ok: true, message: r.message }))
      .catch((e: unknown) => ({
        token,
        ok: false,
        message: e instanceof ApiError ? e.message : "Could not reach the server. Try again.",
      }));
    inflight.set(token, p);
  }
  return p;
}

export function VerifyCallback() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const kind = params.get("type");
  const { status, reload } = useAuth();
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    if (kind !== "verify" || !token) return;
    let alive = true;
    verifyOnce(token).then((r) => {
      if (!alive) return;
      setResult(r);
      if (r.ok) void reload();
    });
    return () => {
      alive = false;
    };
  }, [kind, token, reload]);

  const invalid = kind !== "verify" || !token;
  const pending = !invalid && result?.token !== token;
  const ok = !invalid && result?.ok;

  return (
    <AuthShell title={pending ? "Verifying your email…" : ok ? "Email verified" : "Verification failed"}>
      <div role="status" className="space-y-5 text-sm text-slate-300">
        {pending ? (
          <LoaderCircle className="animate-spin text-cyan" aria-label="Verifying" />
        ) : ok ? (
          <>
            <CircleCheck className="text-emerald-300" size={28} aria-hidden />
            <p>Thanks! Your email address is confirmed.</p>
            <Link
              href={status === "user" ? "/dashboard" : "/login"}
              className="inline-block rounded-lg bg-gradient-to-r from-azure to-[#3b82ff] px-5 py-2.5 font-medium text-white"
            >
              {status === "user" ? "Go to dashboard" : "Sign in"}
            </Link>
          </>
        ) : (
          <>
            <CircleAlert className="text-red-300" size={28} aria-hidden />
            <p>{invalid ? "This link is missing information." : result?.message}</p>
            <Link href={status === "user" ? "/dashboard" : "/login"} className="inline-block font-medium text-cyan hover:underline">
              {status === "user" ? "Go to dashboard to resend the link" : "Sign in to request a new link"}
            </Link>
          </>
        )}
      </div>
    </AuthShell>
  );
}
