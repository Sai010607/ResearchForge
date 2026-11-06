"use client";

import { MailCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { ApiError } from "@/lib/api";
import { EMAIL_RE, passwordValid } from "@/lib/validation";
import { AuthShell } from "./AuthShell";
import { Checkbox, FormAlert, PasswordField, SubmitButton, TextField } from "./fields";

export function RegisterForm() {
  const router = useRouter();
  const { status, register } = useAuth();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [terms, setTerms] = useState(false);
  const [touched, setTouched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState("");
  const [serverFields, setServerFields] = useState<Record<string, string>>({});
  const [checkInbox, setCheckInbox] = useState(false);

  useEffect(() => {
    if (status === "user") router.replace("/dashboard");
  }, [status, router]);

  const errors: Record<string, string> = {
    full_name: name.trim().length < 2 ? "Enter your full name." : "",
    email: !EMAIL_RE.test(email.trim()) ? "Enter a valid email address." : "",
    password: !passwordValid(password) ? "Use at least 10 characters with a letter and a number." : "",
    confirm_password: confirm !== password ? "Passwords do not match." : "",
    accept_terms: !terms ? "You must accept the terms to continue." : "",
  };
  const shown = (k: string) => (touched ? errors[k] : "") || serverFields[k] || "";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    setFormError("");
    setServerFields({});
    if (Object.values(errors).some(Boolean)) return;
    setLoading(true);
    try {
      const s = await register({
        full_name: name.trim(),
        email: email.trim(),
        password,
        confirm_password: confirm,
        accept_terms: terms,
      });
      if (s.verification_required) {
        setCheckInbox(true);
        setLoading(false);
      } else {
        router.replace("/dashboard");
      }
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === "email_taken") setServerFields({ email: err.message });
        else if (Object.keys(err.fields).length) setServerFields(err.fields);
        else setFormError(err.message);
      } else setFormError("Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  if (checkInbox)
    return (
      <AuthShell title="Check your inbox">
        <div role="status" className="space-y-4 text-sm text-slate-300">
          <span className="flex h-11 w-11 items-center justify-center rounded-full border border-cyan/50 bg-cyan/10 text-cyan">
            <MailCheck size={20} aria-hidden />
          </span>
          <p>
            We sent a verification link to <strong className="text-white">{email.trim()}</strong>. Open it to activate your
            account, then sign in.
          </p>
          <Link href="/login" className="inline-block font-medium text-cyan hover:underline">
            Go to sign in
          </Link>
        </div>
      </AuthShell>
    );

  return (
    <AuthShell
      guestCta
      title="Create your account"
      subtitle="Free. Your research projects, saved and private."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-cyan hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="space-y-5">
        <TextField label="Full name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} error={shown("full_name")} />
        <TextField
          label="Email address"
          type="email"
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={shown("email")}
          placeholder="you@university.edu"
        />
        <PasswordField
          label="Password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={shown("password")}
          showRules
        />
        <PasswordField
          label="Confirm password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={shown("confirm_password")}
        />
        <div className="space-y-2">
          <Checkbox
            checked={terms}
            onChange={(e) => setTerms(e.target.checked)}
            error={shown("accept_terms")}
            label="I accept the terms of use below."
          />
          <details className="rounded-lg border border-line bg-white/[0.02] px-3 py-2 text-xs text-muted">
            <summary className="cursor-pointer select-none text-slate-300">Read the terms</summary>
            <p className="mt-2 leading-relaxed">
              ResearchForge is a research-support tool, not a medical device: do not use its output for clinical decisions.
              Your projects are stored in this deployment&apos;s database and are only visible to your account. Do not upload
              identifiable patient data. You can delete your projects at any time.
            </p>
          </details>
        </div>
        {formError && <FormAlert>{formError}</FormAlert>}
        <SubmitButton loading={loading} loadingLabel="Creating account…">
          Create free account
        </SubmitButton>
      </form>
    </AuthShell>
  );
}
