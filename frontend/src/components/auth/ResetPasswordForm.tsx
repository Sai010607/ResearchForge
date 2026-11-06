"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { ApiError, api } from "@/lib/api";
import { passwordValid } from "@/lib/validation";
import { AuthShell } from "./AuthShell";
import { FormAlert, PasswordField, SubmitButton } from "./fields";

export function ResetPasswordForm() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [touched, setTouched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const errors = {
    password: !passwordValid(password) ? "Use at least 10 characters with a letter and a number." : "",
    confirm: confirm !== password ? "Passwords do not match." : "",
  };

  if (!token)
    return (
      <AuthShell title="Link not valid">
        <p className="text-sm text-slate-300">This reset link is missing its token. Request a new one.</p>
        <Link href="/forgot-password" className="mt-4 inline-block text-sm font-medium text-cyan hover:underline">
          Request a new link
        </Link>
      </AuthShell>
    );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    setError("");
    if (errors.password || errors.confirm) return;
    setLoading(true);
    try {
      await api.resetPassword(token, password);
      router.replace("/login?reset=1");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  return (
    <AuthShell title="Choose a new password" subtitle="You'll be signed out on all devices.">
      <form onSubmit={submit} noValidate className="space-y-5">
        <PasswordField
          label="New password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={touched ? errors.password : ""}
          showRules
        />
        <PasswordField
          label="Confirm new password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={touched ? errors.confirm : ""}
        />
        {error && (
          <FormAlert>
            {error}{" "}
            <Link href="/forgot-password" className="underline">
              Request a new link
            </Link>
          </FormAlert>
        )}
        <SubmitButton loading={loading} loadingLabel="Updating…">
          Update password
        </SubmitButton>
      </form>
    </AuthShell>
  );
}
