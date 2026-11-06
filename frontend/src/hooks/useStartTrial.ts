"use client";

import { useCallback, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { ApiError } from "@/lib/api";

/** Starts the guest trial on the server (signed cookie + DB row), then runs `onStarted`. */
export function useStartTrial(onStarted?: () => void) {
  const { startTrial } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const start = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      await startTrial();
      onStarted?.();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not start the free trial. Please try again.");
    } finally {
      setBusy(false);
    }
  }, [startTrial, onStarted]);

  return { start, busy, error };
}
