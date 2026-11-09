"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { ApiError, api } from "@/lib/api";
import type { Paper } from "@/types/paper";

/** Papers saved in any of the caller's projects. Re-loads when the identity changes. */
export function useMyPapers() {
  const { status, user } = useAuth();
  const identityKey = status === "user" ? `u${user?.id}` : status;
  const [reload, setReload] = useState(0);
  const key = `${identityKey}:${reload}`;
  const [data, setData] = useState<{ key: string; list: Paper[]; error: string }>({ key: "", list: [], error: "" });

  useEffect(() => {
    if (status === "loading" || status === "anonymous") return;
    let alive = true;
    api
      .myPapers()
      .then((list) => alive && setData({ key, list, error: "" }))
      .catch((e: unknown) => alive && setData({ key, list: [], error: e instanceof ApiError ? e.message : "Failed to load papers." }));
    return () => {
      alive = false;
    };
  }, [key, status]);

  const anonymous = status === "anonymous";
  return {
    papers: anonymous || data.key !== key ? [] : data.list,
    loading: status === "loading" || (!anonymous && data.key !== key),
    error: anonymous ? "" : data.error,
    refresh: () => setReload((n) => n + 1),
  };
}
