import type { LoginInput, RegisterInput, SessionInfo } from "@/types/auth";
import type { Project, ProjectInput } from "@/types/project";

// NEXT_PUBLIC_API_URL=same-origin makes the browser call /api/... on the site itself (used on Netlify,
// where a rewrite proxies /api/* to the backend so login cookies stay first-party).
const RAW_API_URL = process.env.NEXT_PUBLIC_API_URL;
export const API_URL = RAW_API_URL === "same-origin" ? "" : (RAW_API_URL ?? "http://localhost:8000");

/** Backend error with the machine-readable `code` (e.g. "trial_exhausted") and per-field messages. */
export class ApiError extends Error {
  constructor(
    message: string,
    public status?: number,
    public code?: string,
    public fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

// Cookie-based auth => CSRF defence: every call carries this custom header (the API rejects
// state-changing requests without it) and the browser attaches the HttpOnly cookies.
const CSRF_HEADERS = { "X-Requested-With": "ResearchForge" };

function parseError(status: number, body: unknown): ApiError {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (typeof detail === "string") return new ApiError(detail, status);
  if (Array.isArray(detail)) {
    const fields: Record<string, string> = {};
    const messages: string[] = [];
    for (const d of detail as { loc?: unknown[]; msg?: string }[]) {
      const msg = (d.msg ?? "Invalid value").replace(/^Value error, /, "");
      messages.push(msg);
      const key = [...(d.loc ?? [])].reverse().find((p) => typeof p === "string" && p !== "body");
      if (typeof key === "string" && !fields[key]) fields[key] = msg;
    }
    return new ApiError(messages.join(" "), status, "validation_error", fields);
  }
  if (detail && typeof detail === "object") {
    const { code, message } = detail as { code?: string; message?: string };
    return new ApiError(message ?? `Request failed (${status})`, status, code);
  }
  return new ApiError(`Request failed (${status})`, status);
}

let refreshing: Promise<boolean> | null = null;

/** Single-flight: concurrent 401s share ONE refresh call (refresh tokens rotate, so two would race). */
function refreshSession(): Promise<boolean> {
  refreshing ??= fetch(`${API_URL}/api/auth/refresh`, {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: CSRF_HEADERS,
  })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

async function request<T>(path: string, init?: RequestInit, canRetry = true): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      cache: "no-store",
      credentials: "include",
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...CSRF_HEADERS,
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError(`Cannot reach the backend at ${API_URL}. Is FastAPI running?`);
  }

  if (res.status === 401 && canRetry && !path.startsWith("/api/auth/") && !path.startsWith("/api/guest/")) {
    // Access token (15 min) probably expired: rotate via the refresh cookie and retry once.
    if (await refreshSession()) return request<T>(path, init, false);
  }

  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {}
    throw parseError(res.status, body);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

export const api = {
  health: () => request<{ status: string; database: string }>("/api/health"),

  // --- auth / session ---
  session: () => request<SessionInfo>("/api/auth/session"),
  startGuest: () => post<SessionInfo>("/api/guest/session"),
  register: (data: RegisterInput) => post<SessionInfo>("/api/auth/register", data),
  login: (data: LoginInput) => post<SessionInfo>("/api/auth/login", data),
  logout: () => post<void>("/api/auth/logout"),
  forgotPassword: (email: string) => post<{ message: string }>("/api/auth/forgot-password", { email }),
  resetPassword: (token: string, password: string) =>
    post<{ message: string }>("/api/auth/reset-password", { token, password }),
  verifyEmail: (token: string) => post<{ message: string }>("/api/auth/verify-email", { token }),
  resendVerification: () => post<{ message: string }>("/api/auth/resend-verification"),

  // --- projects (owner-scoped on the server) ---
  listProjects: () => request<Project[]>("/api/projects"),
  createProject: (data: ProjectInput) => post<Project>("/api/projects", data),
  updateProject: (id: number, data: ProjectInput) =>
    request<Project>(`/api/projects/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteProject: (id: number) => request<void>(`/api/projects/${id}`, { method: "DELETE" }),
};
