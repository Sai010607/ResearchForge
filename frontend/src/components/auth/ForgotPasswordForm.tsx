"use client";

import { MailCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ApiError, api } from "@/lib/api";
import { EMAIL_RE } from "@/lib/validation";
import { AuthShell } from "./AuthShell";
import { FormAlert, SubmitButton, TextField } from "./fields";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [touched, setTouched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const invalid = !EMAIL_RE.test(email.trim());

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    setError("");
    if (invalid) return;
    setLoading(true);
    try {
      await api.forgotPassword(email.trim());
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle="We'll email you a link to choose a new one."
      footer={
        <Link href="/login" className="font-medium text-cyan hover:underline">
          Back to sign in
        </Link>
      }
    >
      {sent ? (
        <div role="status" className="space-y-4 text-sm text-slate-300">
          <span className="flex h-11 w-11 items-center justify-center rounded-full border border-cyan/50 bg-cyan/10 text-cyan">
            <MailCheck size={20} aria-hidden />
          </span>
          <p>If an account exists for that email, a reset link is on its way. The link works once and expires in 30 minutes.</p>
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="space-y-5">
          <TextField
            label="Email address"
            type="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={touched && invalid ? "Enter a valid email address." : ""}
            placeholder="you@university.edu"
          />
          {error && <FormAlert>{error}</FormAlert>}
          <SubmitButton loading={loading} loadingLabel="Sending…">
            Send reset link
          </SubmitButton>
        </form>
      )}
    </AuthShell>
  );
}
