export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export interface PasswordRule {
  id: string;
  label: string;
  ok: boolean;
}

/** Mirrors the backend policy (backend/app/schemas/auth.py); the server remains the authority. */
export function passwordRules(pw: string): PasswordRule[] {
  return [
    { id: "len", label: "10+ characters", ok: pw.length >= 10 },
    { id: "letter", label: "A letter", ok: /\p{L}/u.test(pw) },
    { id: "digit", label: "A number", ok: /\d/.test(pw) },
  ];
}

export const passwordValid = (pw: string) => passwordRules(pw).every((r) => r.ok) && pw.length <= 128;

/** Only same-site relative paths are allowed as post-login destinations (prevents open redirects). */
export function safeNext(next: string | null | undefined, fallback = "/dashboard"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return fallback;
  return next;
}
