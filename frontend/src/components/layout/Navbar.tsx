"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { AccountMenu, initials } from "@/components/auth/AccountMenu";
import { TrialBadge } from "@/components/auth/TrialBadge";
import { useAuth } from "@/hooks/useAuth";
import { useProjects, type BackendStatus } from "@/hooks/useProjects";
import { useStartTrial } from "@/hooks/useStartTrial";
import { buttonStyles } from "@/components/ui/MagneticButton";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/literature", label: "Literature" },
  { href: "/knowledge-graph", label: "Knowledge Graph" },
  { href: "/experiments", label: "Experiments" },
  { href: "/workspace", label: "Research Workspace" },
];

const STATUS: Record<BackendStatus, { label: string; dot: string; text: string }> = {
  checking: { label: "Connecting", dot: "bg-slate-400", text: "text-slate-400" },
  online: { label: "API + DB online", dot: "bg-emerald-400", text: "text-emerald-300" },
  degraded: { label: "Database unreachable", dot: "bg-amber-400", text: "text-amber-300" },
  offline: { label: "Backend offline", dot: "bg-red-400", text: "text-red-300" },
};

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5" aria-label="ResearchForge home">
      <svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden>
        <path d="M13 2l9.5 5.5v11L13 24 3.5 18.5v-11L13 2z" stroke="url(#lg)" strokeWidth="1.4" />
        <circle cx="13" cy="13" r="2.6" fill="#00cfff" />
        <path d="M13 13L13 2M13 13l9.5 5.5M13 13L3.5 18.5" stroke="#2563ff" strokeWidth="1" opacity=".7" />
        <defs>
          <linearGradient id="lg" x1="3" y1="2" x2="22" y2="24">
            <stop stopColor="#2563ff" />
            <stop offset="1" stopColor="#8b5cf6" />
          </linearGradient>
        </defs>
      </svg>
      <span className="text-[15px] font-semibold tracking-tight">
        Research<span className="text-gradient">Forge</span>
      </span>
    </Link>
  );
}

const LINK = "whitespace-nowrap rounded-md px-3 py-2 text-sm text-muted transition-colors hover:text-white";
const SMALL_BTN =
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-gradient-to-r from-azure to-[#3b82ff] px-4 py-2 text-sm font-medium text-white shadow-[0_6px_24px_-8px_rgba(37,99,255,0.7)] transition hover:brightness-110 disabled:opacity-60";

function TryFreeSmall({ onDone }: { onDone?: () => void }) {
  const router = useRouter();
  const go = useCallback(() => {
    router.push("/workspace");
    onDone?.();
  }, [router, onDone]);
  const { start, busy, error } = useStartTrial(go);
  return (
    <>
      <button type="button" onClick={start} disabled={busy} className={SMALL_BTN} title={error || undefined}>
        Try Free
      </button>
      {error && <span role="alert" className="sr-only">{error}</span>}
    </>
  );
}

/** Desktop auth controls — rendered strictly from the server-provided session state. */
function AuthControls() {
  const { status } = useAuth();
  if (status === "loading") return <div className="h-9 w-24" aria-hidden />;
  if (status === "user") return <AccountMenu />;
  if (status === "guest")
    return (
      <div className="hidden items-center gap-2 xl:flex">
        <TrialBadge />
        <Link href="/workspace" className={SMALL_BTN}>
          Create Research Project
        </Link>
        <Link href="/register" className="whitespace-nowrap px-1 text-sm text-cyan hover:underline">
          <span className="min-[1700px]:hidden">Register</span>
          <span className="hidden min-[1700px]:inline">Register to unlock full access</span>
        </Link>
        <Link href="/login" className={cn(LINK, "hidden min-[1700px]:inline-block")}>
          Login
        </Link>
      </div>
    );
  return (
    <div className="hidden items-center gap-1 xl:flex">
      <Link href="/login" className={LINK}>
        Login
      </Link>
      <Link href="/register" className={cn(LINK, "text-slate-200")}>
        Register
      </Link>
      <TryFreeSmall />
    </div>
  );
}

function MobileAuth({ close }: { close: () => void }) {
  const { status, user, logout } = useAuth();
  const router = useRouter();
  if (status === "loading") return null;
  const row = "border-b border-line/60 py-3 text-sm text-muted last:border-0";
  if (status === "user" && user)
    return (
      <div className="border-t border-line pt-3">
        <div className="flex items-center gap-3 py-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-azure to-[#3b82ff] text-xs font-semibold">
            {initials(user.full_name)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{user.full_name}</p>
            <p className="truncate text-xs text-muted">{user.email}</p>
          </div>
        </div>
        <Link href="/dashboard" onClick={close} className={cn(row, "block")}>
          Dashboard
        </Link>
        <button
          type="button"
          className={cn(row, "block w-full text-left")}
          onClick={async () => {
            await logout();
            close();
            router.replace("/");
          }}
        >
          Log out
        </button>
      </div>
    );
  if (status === "guest")
    return (
      <div className="flex flex-col gap-3 border-t border-line pt-3">
        <TrialBadge className="self-start" />
        <Link href="/workspace" onClick={close} className={cn(SMALL_BTN, "justify-center")}>
          Create Research Project
        </Link>
        <Link href="/register" onClick={close} className="text-sm text-cyan">
          Register to unlock full access
        </Link>
        <Link href="/login" onClick={close} className="text-sm text-muted">
          Login
        </Link>
      </div>
    );
  return (
    <div className="flex flex-col gap-3 border-t border-line pt-3">
      <Link href="/login" onClick={close} className={buttonStyles("ghost", "justify-center")}>
        Login
      </Link>
      <Link href="/register" onClick={close} className={buttonStyles("ghost", "justify-center")}>
        Register
      </Link>
      <TryFreeSmall onDone={close} />
    </div>
  );
}

export function Navbar() {
  const pathname = usePathname();
  const { status } = useProjects();
  const [open, setOpen] = useState(false);
  const s = STATUS[status];

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-ink-950/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[110rem] items-center justify-between gap-3 px-6">
        <Logo />

        <nav aria-label="Primary" className="hidden items-center gap-1 xl:flex">
          {NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative whitespace-nowrap rounded-md px-2.5 py-2 text-sm transition-colors",
                  active ? "text-white" : "text-muted hover:text-white",
                )}
              >
                {active && (
                  <motion.span
                    layoutId="nav-indicator"
                    className="absolute inset-0 -z-10 rounded-md border border-line-strong bg-white/[0.04]"
                    transition={{ type: "spring", stiffness: 420, damping: 36 }}
                  />
                )}
                {active && (
                  <motion.span
                    layoutId="nav-underline"
                    className="absolute inset-x-3 -bottom-px h-px bg-gradient-to-r from-azure via-cyan to-[#3b82ff]"
                    transition={{ type: "spring", stiffness: 420, damping: 36 }}
                  />
                )}
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-3">
          <div
            role="status"
            title={s.label}
            className={cn("hidden items-center gap-2 rounded-full border border-line px-2.5 py-1.5 font-mono text-[11px] sm:flex min-[1700px]:px-3", s.text)}
          >
            <span className={cn("h-1.5 w-1.5 rounded-full", s.dot, status === "online" && "pulse-dot")} />
            <span className="hidden min-[1700px]:inline">{s.label}</span>
            <span className="sr-only min-[1700px]:hidden">{s.label}</span>
          </div>
          <AuthControls />
          <button
            type="button"
            className="rounded-md border border-line p-2 text-muted hover:text-white xl:hidden"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {open && (
          <motion.nav
            aria-label="Mobile"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden border-t border-line bg-ink-950/95 xl:hidden"
          >
            <div className="flex flex-col px-6 py-3">
              {NAV.map((item) => {
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "border-b border-line/60 py-3 text-sm last:border-0",
                      active ? "text-white" : "text-muted",
                    )}
                  >
                    {item.label}
                  </Link>
                );
              })}
              <MobileAuth close={() => setOpen(false)} />
              <div className={cn("flex items-center gap-2 py-3 font-mono text-[11px]", s.text)}>
                <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} />
                {s.label}
              </div>
            </div>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  );
}
