"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "@/hooks/useAuth";
import { ApiError, api } from "@/lib/api";
import type { Project, ProjectInput } from "@/types/project";

export type BackendStatus = "checking" | "online" | "degraded" | "offline";

interface ProjectsState {
  projects: Project[];
  loading: boolean;
  error: string;
  status: BackendStatus;
  /** When the project list was last loaded (null until the first load). */
  loadedAt: Date | null;
  refresh: () => void;
  addProject: (p: Project) => void;
  updateProject: (id: number, data: ProjectInput) => Promise<Project>;
  removeProject: (id: number) => Promise<void>;
}

const Ctx = createContext<ProjectsState | null>(null);

export function ProjectsProvider({ children }: { children: ReactNode }) {
  const { status: authStatus, user } = useAuth();
  // Re-load whenever the identity changes (login, logout, guest start) so one person's list can
  // never linger in memory for the next.
  const identityKey = authStatus === "user" ? `u${user?.id}` : authStatus;

  const [data, setData] = useState<{ key: string; list: Project[] }>({ key: "", list: [] });
  const [error, setError] = useState("");
  const [status, setStatus] = useState<BackendStatus>("checking");
  const [reloadKey, setReloadKey] = useState(0);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);

  const fetchKey = `${identityKey}:${reloadKey}`;
  const loading = authStatus === "loading" || data.key !== fetchKey;

  useEffect(() => {
    if (authStatus === "loading") return;
    let alive = true;
    const list = authStatus === "anonymous" ? Promise.resolve<Project[]>([]) : api.listProjects();
    Promise.all([list, api.health()])
      .then(([items, health]) => {
        if (!alive) return;
        setData({ key: fetchKey, list: items });
        setLoadedAt(new Date());
        setError("");
        setStatus(health.database === "connected" ? "online" : "degraded");
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setData({ key: fetchKey, list: [] });
        setStatus("offline");
        setError(e instanceof ApiError ? e.message : "Failed to load projects.");
      });
    return () => {
      alive = false;
    };
  }, [fetchKey, authStatus]);

  // Live status: poll health; if we recover from an error, reload the data.
  const hadError = error !== "";
  useEffect(() => {
    const id = setInterval(() => {
      api
        .health()
        .then((h) => {
          setStatus(h.database === "connected" ? "online" : "degraded");
          if (hadError) setReloadKey((k) => k + 1);
        })
        .catch(() => setStatus("offline"));
    }, 20000);
    return () => clearInterval(id);
  }, [hadError]);

  const value = useMemo<ProjectsState>(
    () => ({
      projects: data.list,
      loading,
      error,
      status,
      loadedAt,
      refresh: () => {
        setError("");
        setStatus("checking");
        setReloadKey((k) => k + 1);
      },
      addProject: (p) => setData((prev) => ({ ...prev, list: [p, ...prev.list] })),
      updateProject: async (id, input) => {
        const updated = await api.updateProject(id, input);
        setData((prev) => ({ ...prev, list: prev.list.map((p) => (p.id === id ? updated : p)) }));
        return updated;
      },
      removeProject: async (id) => {
        await api.deleteProject(id);
        setData((prev) => ({ ...prev, list: prev.list.filter((p) => p.id !== id) }));
      },
    }),
    [data.list, loading, error, status, loadedAt],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useProjects(): ProjectsState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useProjects must be used within <ProjectsProvider>");
  return ctx;
}
