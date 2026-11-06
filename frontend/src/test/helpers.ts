import { vi } from "vitest";
import type { Trial, User } from "@/types/auth";

export const USER: User = {
  id: 7,
  full_name: "Ada Lovelace",
  email: "ada@example.com",
  is_verified: true,
  created_at: "2026-01-01T00:00:00Z",
};

export const trial = (used: boolean): Trial => ({ limit: 1, used: used ? 1 : 0, remaining: used ? 0 : 1, exhausted: used });

/** A controllable stand-in for useAuth(), used with vi.mock("@/hooks/useAuth"). */
export function authMock(over: Record<string, unknown> = {}) {
  return {
    status: "anonymous",
    user: null,
    trial: null,
    error: "",
    reload: vi.fn().mockResolvedValue(undefined),
    startTrial: vi.fn().mockResolvedValue({}),
    login: vi.fn().mockResolvedValue({}),
    register: vi.fn().mockResolvedValue({ verification_required: false }),
    logout: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

export const project = {
  id: 1,
  research_question: "Can T1-weighted MRI improve early Alzheimer's detection?",
  modality: "T1-weighted MRI" as const,
  disease: "Alzheimer's Disease" as const,
  objectives: ["Early Detection" as const],
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};
