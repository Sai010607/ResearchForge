"use client";

import { MailWarning } from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { ApiError, api } from "@/lib/api";

export function VerifyBanner() {
  const { status, user } = useAuth();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  if (status !== "user" || !user || user.is_verified) return null;

  async function resend() {
    setBusy(true);
    try {
      setNote((await api.resendVerification()).message);
    } catch (e) {
      setNote(e instanceof ApiError ? e.message : "Could not send the email.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div role="status" className="border-b border-amber-400/20 bg-amber-400/[0.07] px-6 py-2 text-center text-xs text-amber-200">
      <MailWarning size={13} className="mr-1.5 inline -translate-y-px" aria-hidden />
      Please verify your email address ({user.email}).{" "}
      {note ? (
        <span className="text-amber-100">{note}</span>
      ) : (
        <button type="button" onClick={resend} disabled={busy} className="font-medium underline disabled:opacity-60">
          Resend verification link
        </button>
      )}
    </div>
  );
}
