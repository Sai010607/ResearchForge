export interface User {
  id: number;
  full_name: string;
  email: string;
  is_verified: boolean;
  created_at: string;
}

export interface Trial {
  limit: number;
  used: number;
  remaining: number;
  exhausted: boolean;
}

/** Mirrors the backend `SessionRead`. The UI only ever renders from this — never from guesses. */
export interface SessionInfo {
  state: "anonymous" | "guest" | "user";
  user: User | null;
  trial: Trial | null;
  claimed_projects: number;
  verification_required: boolean;
}

export interface RegisterInput {
  full_name: string;
  email: string;
  password: string;
  confirm_password: string;
  accept_terms: boolean;
}

export interface LoginInput {
  email: string;
  password: string;
  remember_me: boolean;
}
