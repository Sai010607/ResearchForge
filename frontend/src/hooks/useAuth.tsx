"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiError, api } from "@/lib/api";
import type { LoginInput, RegisterInput, SessionInfo, Trial, User } from "@/types/auth";

export type AuthStatus = "loading" | "anonymous" | "guest" | "user";

interface AuthState {
  status: AuthStatus;
  user: User | null;
  trial: Trial | null;
  /** Set when the backend could not be reached while loading the session. */
  error: string;
  reload: () => Promise<void>;
  startTrial: () => Promise<SessionInfo>;
  login: (data: LoginInput) => Promise<SessionInfo>;
  register: (data: RegisterInput) => Promise<SessionInfo>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

type Snapshot = Pick<AuthState, "status" | "user" | "trial" | "error">;
const INITIAL: Snapshot = { status: "loading", user: null, trial: null, error: "" };

const fromSession = (s: SessionInfo): Snapshot => ({
  status: s.state,
  user: s.user,
  trial: s.trial,
  error: "",
});

/** Source of truth for "who am I": always the server's answer (HttpOnly cookies), never client guesses. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [snap, setSnap] = useState<Snapshot>(INITIAL);

  useEffect(() => {
    let alive = true;
    api
      .session()
      .then((s) => alive && setSnap(fromSession(s)))
      .catch((e: unknown) => {
        if (alive)
          setSnap({
            ...INITIAL,
            status: "anonymous",
            error: e instanceof ApiError ? e.message : "Could not load your session.",
          });
      });
    return () => {
      alive = false;
    };
  }, []);

  const reload = useCallback(async () => {
    try {
      setSnap(fromSession(await api.session()));
    } catch (e) {
      setSnap((prev) => ({ ...prev, error: e instanceof ApiError ? e.message : "Could not refresh your session." }));
    }
  }, []);

  const apply = useCallback((s: SessionInfo) => {
    setSnap(fromSession(s));
    return s;
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      ...snap,
      reload,
      startTrial: async () => apply(await api.startGuest()),
      login: async (d) => apply(await api.login(d)),
      register: async (d) => {
        const s = await api.register(d);
        return s.verification_required ? s : apply(s);
      },
      logout: async () => {
        await api.logout();
        setSnap({ ...INITIAL, status: "anonymous" });
      },
    }),
    [snap, reload, apply],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
