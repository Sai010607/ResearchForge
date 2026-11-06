"use client";

import { Check, Eye, EyeOff, LoaderCircle } from "lucide-react";
import { useId, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { passwordRules } from "@/lib/validation";
import { cn } from "@/lib/utils";

const INPUT =
  "block w-full rounded-xl border bg-ink-900/70 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-cyan/70 focus:shadow-[0_0_32px_-14px_rgba(0,207,255,0.7)] disabled:opacity-60";

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  hint?: ReactNode;
}

export function TextField({ label, error, hint, className, ...rest }: FieldProps) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={!!error}
        aria-describedby={error || hint ? `${id}-d` : undefined}
        className={cn(INPUT, error ? "border-red-500/60" : "border-line-strong", className)}
        {...rest}
      />
      {(error || hint) && (
        <p id={`${id}-d`} className={cn("mt-1.5 text-xs", error ? "text-red-300" : "text-muted")}>
          {error || hint}
        </p>
      )}
    </div>
  );
}

export function PasswordField({
  label,
  error,
  hint,
  showRules = false,
  ...rest
}: FieldProps & { showRules?: boolean }) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const value = String(rest.value ?? "");
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={visible ? "text" : "password"}
          aria-invalid={!!error}
          aria-describedby={error || hint || showRules ? `${id}-d` : undefined}
          className={cn(INPUT, "pr-12", error ? "border-red-500/60" : "border-line-strong")}
          {...rest}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-xl text-muted hover:text-white"
        >
          {visible ? <EyeOff size={17} /> : <Eye size={17} />}
        </button>
      </div>
      <div id={`${id}-d`}>
        {error && <p className="mt-1.5 text-xs text-red-300">{error}</p>}
        {!error && hint && <p className="mt-1.5 text-xs text-muted">{hint}</p>}
        {showRules && (
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1" aria-label="Password requirements">
            {passwordRules(value).map((r) => (
              <li key={r.id} className={cn("flex items-center gap-1 text-xs", r.ok ? "text-emerald-300" : "text-muted")}>
                <Check size={12} className={r.ok ? "opacity-100" : "opacity-30"} aria-hidden />
                {r.label}
                <span className="sr-only">{r.ok ? " (met)" : " (not met yet)"}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function Checkbox({ label, error, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label: ReactNode; error?: string }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="flex cursor-pointer items-start gap-3 text-sm text-slate-300">
        <input
          id={id}
          type="checkbox"
          aria-invalid={!!error}
          className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-cyan"
          {...rest}
        />
        <span>{label}</span>
      </label>
      {error && <p className="mt-1.5 text-xs text-red-300">{error}</p>}
    </div>
  );
}

export function FormAlert({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
      {children}
    </div>
  );
}

export function FormNotice({ children }: { children: ReactNode }) {
  return (
    <div role="status" className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 p-3 text-sm text-emerald-200">
      {children}
    </div>
  );
}

export function SubmitButton({ loading, loadingLabel, children }: { loading: boolean; loadingLabel: string; children: ReactNode }) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-azure to-[#3b82ff] px-6 py-3.5 text-sm font-medium shadow-[0_8px_30px_-10px_rgba(37,99,255,0.7)] transition hover:brightness-110 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
    >
      {loading ? (
        <>
          <LoaderCircle size={16} className="animate-spin" aria-hidden /> {loadingLabel}
        </>
      ) : (
        children
      )}
    </button>
  );
}
