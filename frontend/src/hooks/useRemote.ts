"use client";

import { useEffect, useState } from "react";
import { ApiError } from "@/lib/api";

/** Load data with `load` (memoise it with useCallback) and reload when `load` or `version` changes.
 *  A reload caused only by `version` keeps showing the previous data (no flash to a skeleton after every edit). */
export function useRemote<T>(load: () => Promise<T>, version = 0) {
  const [state, setState] = useState<{ load: unknown; version: number; data: T | null; error: string }>({ load: null, version: -1, data: null, error: "" });

  useEffect(() => {
    let alive = true;
    load()
      .then((data) => alive && setState({ load, version, data, error: "" }))
      .catch((e: unknown) => alive && setState({ load, version, data: null, error: e instanceof ApiError ? e.message : "Something went wrong." }));
    return () => {
      alive = false;
    };
  }, [load, version]);

  return { data: state.data, error: state.error, loading: state.load !== load };
}

/** Run a mutation, expose its error, and call `onDone` after success. */
export function useAction(onDone: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError("");
    try {
      const out = await fn();
      onDone();
      return out;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong.");
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  return { run, busy, error };
}
