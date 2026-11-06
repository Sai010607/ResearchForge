"use client";

import { motion } from "framer-motion";
import { Lock, PartyPopper } from "lucide-react";
import Link from "next/link";
import { buttonStyles } from "@/components/ui/MagneticButton";

/**
 * `ready`     – shown right after the guest's first project is saved (celebration + upgrade).
 * `exhausted` – shown when the guest tries to create another: explains WHY it is blocked.
 * The guest's first project is never deleted in either case.
 */
export function UpgradePrompt({ variant }: { variant: "ready" | "exhausted" }) {
  const ready = variant === "ready";
  return (
    <motion.div
      role="status"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="relative overflow-hidden rounded-2xl border border-cyan/30 bg-gradient-to-br from-azure/10 via-transparent to-ice/10 p-6 sm:p-8"
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-full border border-cyan/50 bg-cyan/10 text-cyan">
        {ready ? <PartyPopper size={20} aria-hidden /> : <Lock size={20} aria-hidden />}
      </span>
      <h2 className="mt-5 text-xl font-semibold">
        {ready ? "Your first research project is ready!" : "Your free trial project has been used"}
      </h2>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-300">
        {ready
          ? "Enjoyed your ResearchForge experience? Create your free account to unlock your research workspace."
          : "Guest trials include one saved research project, so we can’t create another without an account. Create a free account or sign in to keep building."}
      </p>
      <p className="mt-2 max-w-xl text-xs text-muted">
        Your first project is saved and will move into your account when you register or sign in.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link href="/register" className={buttonStyles("primary")}>
          Create Free Account
        </Link>
        <Link href="/login" className={buttonStyles("ghost")}>
          Sign In
        </Link>
      </div>
    </motion.div>
  );
}
