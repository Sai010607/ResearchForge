"use client";

import { AnimatePresence, motion } from "framer-motion";
import { LayoutDashboard, LogOut, ShieldCheck, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { useAuth } from "@/hooks/useAuth";

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export function AccountMenu() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  if (!user) return null;

  async function signOut() {
    setBusy(true);
    try {
      await logout();
      setOpen(false);
      router.replace("/");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={root} className="relative">
      <button
        ref={trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        aria-label={`Account menu for ${user.full_name}`}
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-azure to-[#3b82ff] text-xs font-semibold text-white ring-1 ring-white/20 transition hover:brightness-110"
      >
        {initials(user.full_name)}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            id={id}
            role="menu"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.16 }}
            className="glass absolute right-0 top-11 z-50 w-64 rounded-xl p-2 shadow-2xl"
          >
            <div className="border-b border-line px-3 pb-3 pt-2">
              <p className="truncate text-sm font-medium">{user.full_name}</p>
              <p className="truncate text-xs text-muted">{user.email}</p>
              <p className={`mt-2 inline-flex items-center gap-1 text-[11px] ${user.is_verified ? "text-emerald-300" : "text-amber-300"}`}>
                {user.is_verified ? <ShieldCheck size={12} aria-hidden /> : <ShieldAlert size={12} aria-hidden />}
                {user.is_verified ? "Email verified" : "Email not verified"}
              </p>
            </div>
            <Link
              role="menuitem"
              href="/dashboard"
              onClick={() => setOpen(false)}
              className="mt-1 flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-200 hover:bg-white/[0.06]"
            >
              <LayoutDashboard size={15} aria-hidden /> Dashboard
            </Link>
            <button
              role="menuitem"
              type="button"
              onClick={signOut}
              disabled={busy}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-200 hover:bg-white/[0.06] disabled:opacity-60"
            >
              <LogOut size={15} aria-hidden /> {busy ? "Signing out…" : "Log out"}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
