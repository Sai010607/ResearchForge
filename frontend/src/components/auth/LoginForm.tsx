"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { ApiError } from "@/lib/api";
import { EMAIL_RE, safeNext } from "@/lib/validation";
import { AuthShell } from "./AuthShell";
import { Checkbox, FormAlert, FormNotice, PasswordField, SubmitButton, TextField } from "./fields";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { status, login } = useAuth();
  const next = safeNext(params.get("next"));

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [touched, setTouched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState("");

  // Already signed in (e.g. opened /login in a second tab) -> go straight to the app.
  useEffect(() => {
    if (status === "user") router.replace(next);
  }, [status, next, router]);

  const errors = {
    email: !EMAIL_RE.test(email.trim()) ? "Enter a valid email address." : "",
    password: password.length === 0 ? "Enter your password." : "",
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    setFormError("");
    if (errors.email || errors.password) return;
    setLoading(true);
    try {
      await login({ email: email.trim(), password, remember_me: remember });
      router.replace(next);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  return (
    <AuthShell
      guestCta
      title="Welcome back"
      subtitle="Sign in to continue your research."
      footer={
        <>
          New to ResearchForge?{" "}
          <Link href="/register" className="font-medium text-cyan hover:underline">
            Create a free account
          </Link>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="space-y-5">
        {params.get("reset") === "1" && <FormNotice>Password updated. Sign in with your new password.</FormNotice>}
        <TextField
          label="Email address"
          type="email"
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={touched ? errors.email : ""}
          placeholder="you@university.edu"
        />
        <PasswordField
          label="Password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={touched ? errors.password : ""}
        />
        <div className="flex items-center justify-between gap-4">
          <Checkbox label="Remember me" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          <Link href="/forgot-password" className="text-sm text-cyan hover:underline">
            Forgot password?
          </Link>
        </div>
        {formError && <FormAlert>{formError}</FormAlert>}
        <SubmitButton loading={loading} loadingLabel="Signing in…">
          Sign in
        </SubmitButton>
      </form>
    </AuthShell>
  );
}
