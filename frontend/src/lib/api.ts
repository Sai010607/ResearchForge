import type { LoginInput, RegisterInput, SessionInfo } from "@/types/auth";
import type { IdentifierCheck, LiteratureSearch, Paper, ProviderInfo } from "@/types/paper";
import type { Claim, ClaimType, Decision, DecisionType, EvidenceRelationship, Gap, GapCategory, MemoryEntry, MemoryEvent, MemoryOverview, MemoryType, Page, RebuildResult, Verification } from "@/types/memory";
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

const patch = <T>(path: string, body: unknown) => request<T>(path, { method: "PATCH", body: JSON.stringify(body) });
const qs = (o: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};
const mem = (projectId: number, tail = "") => `/api/projects/${projectId}/memory${tail}`;

export interface EvidenceInput {
  paper_id: number;
  relationship: EvidenceRelationship;
  evidence_kind?: "quote" | "paraphrase";
  quoted_text: string;
  section_name?: string;
  page_number?: number;
  source_url?: string;
}

/** Project research memory (every call is scoped to a project the caller owns). */
const memory = {
  overview: (pid: number) => request<MemoryOverview>(mem(pid)),
  rebuild: (pid: number) => post<RebuildResult>(mem(pid, "/rebuild")),
  audit: (pid: number, limit = 50, offset = 0) => request<Page<MemoryEvent>>(mem(pid, `/audit${qs({ limit, offset })}`)),
  entries: (pid: number, f: { memory_type?: MemoryType; verification_status?: Verification; limit?: number; offset?: number } = {}) =>
    request<Page<MemoryEntry>>(mem(pid, `/entries${qs({ limit: 100, ...f })}`)),
  createEntry: (pid: number, body: { memory_type: MemoryType; field: string; content: string; paper_id?: number }) => post<MemoryEntry>(mem(pid), body),
  patchEntry: (pid: number, id: number, body: { verification_status?: "confirmed" | "rejected" | "unverified"; content?: string }) =>
    patch<MemoryEntry>(mem(pid, `/entries/${id}`), body),
  claims: (pid: number) => request<Page<Claim>>(mem(pid, `/claims${qs({ limit: 100 })}`)),
  createClaim: (pid: number, body: { claim_text: string; claim_type: ClaimType; evidence: EvidenceInput[] }) => post<Claim>(mem(pid, "/claims"), body),
  addEvidence: (pid: number, claimId: number, body: EvidenceInput) => post<Claim>(mem(pid, `/claims/${claimId}/evidence`), body),
  patchClaim: (pid: number, id: number, status: "active" | "retracted") => patch<Claim>(mem(pid, `/claims/${id}`), { status }),
  gaps: (pid: number) => request<Page<Gap>>(mem(pid, `/gaps${qs({ limit: 100 })}`)),
  createGap: (pid: number, body: { title: string; description: string; gap_category: GapCategory; evidence_summary?: string }) => post<Gap>(mem(pid, "/gaps"), body),
  patchGap: (pid: number, id: number, body: { status?: Gap["status"]; researcher_comment?: string }) => patch<Gap>(mem(pid, `/gaps/${id}`), body),
  decisions: (pid: number) => request<Page<Decision>>(mem(pid, `/decisions${qs({ limit: 100 })}`)),
  createDecision: (pid: number, body: { decision_type: DecisionType; description: string; rationale?: string; supersedes_id?: number }) =>
    post<Decision>(mem(pid, "/decisions"), body),
  patchDecision: (pid: number, id: number, status: "active" | "rejected") => patch<Decision>(mem(pid, `/decisions/${id}`), { status }),
};

export const api = {
  memory,
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
  // --- literature (search is read-only; saving is authorised through project ownership) ---
  literatureProviders: () => request<ProviderInfo[]>("/api/literature/providers"),
  searchLiterature: (q: string, providers: string[], page = 1) =>
    request<LiteratureSearch>(`/api/literature/search?${new URLSearchParams({ q, providers: providers.join(","), page: String(page) })}`),
  verifyPaper: (source: string, externalId: string) =>
    request<IdentifierCheck>(`/api/literature/verify?${new URLSearchParams({ source, external_id: externalId })}`),
  savePaper: (projectId: number, paper: { source: string; external_id: string }) =>
    post<Paper>(`/api/projects/${projectId}/papers`, paper),
  listProjectPapers: (projectId: number) => request<Paper[]>(`/api/projects/${projectId}/papers`),
  removePaper: (projectId: number, paperId: number) =>
    request<void>(`/api/projects/${projectId}/papers/${paperId}`, { method: "DELETE" }),
  myPapers: () => request<Paper[]>("/api/papers/mine"),

  listProjects: () => request<Project[]>("/api/projects"),
  createProject: (data: ProjectInput) => post<Project>("/api/projects", data),
  updateProject: (id: number, data: ProjectInput) =>
    request<Project>(`/api/projects/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteProject: (id: number) => request<void>(`/api/projects/${id}`, { method: "DELETE" }),
};
