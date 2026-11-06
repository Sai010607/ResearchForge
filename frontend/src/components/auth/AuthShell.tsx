"use client";

import { motion } from "framer-motion";
import dynamic from "next/dynamic";
import type { ReactNode } from "react";
import { TryFreeButton } from "./TryFreeButton";
import { NeuralBackdrop } from "./NeuralBackdrop";
import { WebGLBoundary } from "@/components/ui/WebGLBoundary";
import { DUR, EASE, SPRING } from "@/lib/motion";

// 3D loads only on wide screens (the left panel is hidden below lg) and only when WebGL works.
const AuthScene = dynamic(() => import("./AuthScene"), { ssr: false, loading: () => <NeuralBackdrop className="h-full w-full opacity-60" /> });

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
  guestCta = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Show the "free first project" trial entry (login / register only). */
  guestCta?: boolean;
}) {
  return (
    <section className="relative isolate min-h-[calc(100svh-4rem)] overflow-hidden lg:grid lg:grid-cols-[1.05fr_1fr]">
      {/* Mobile / tablet: lightweight 2D backdrop behind the form */}
      <NeuralBackdrop className="absolute inset-0 -z-20 h-full w-full opacity-60 lg:hidden" />

      {/* Left: brand + 3D network */}
      <aside className="relative hidden overflow-hidden border-r border-line lg:block">
        <div
          className="absolute inset-0"
          aria-hidden
          style={{ background: "radial-gradient(70% 60% at 50% 45%, rgba(37,99,255,.22), transparent 70%), linear-gradient(180deg, #050b18, #0b1730)" }}
        />
        <div className="absolute inset-0">
          <WebGLBoundary fallback={<NeuralBackdrop className="h-full w-full opacity-80" />}>
            <AuthScene />
          </WebGLBoundary>
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-64 bg-gradient-to-t from-ink-950 via-ink-950/80 to-transparent" aria-hidden />
        <div className="pointer-events-none relative z-10 flex h-full flex-col justify-between p-12">
          <p className="font-mono text-sm tracking-[0.2em] text-ice">RESEARCHFORGE</p>
          <div>
            <motion.h2
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: DUR.slow, delay: 0.2, ease: EASE.out }}
              className="max-w-md text-4xl font-semibold leading-tight tracking-tight"
            >
              Enter the <span className="text-gradient">research intelligence</span> environment.
            </motion.h2>
            <motion.p
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: DUR.slow, delay: 0.35, ease: EASE.out }}
              className="mt-4 max-w-sm text-sm leading-relaxed text-muted"
            >
              A private workspace for neuroimaging and computational neuroscience. Every project you create stays yours.
            </motion.p>
          </div>
        </div>
      </aside>

      {/* Right: form */}
      <div className="relative flex items-center justify-center px-6 py-12 lg:py-16">
        <div
          className="pointer-events-none absolute inset-0 -z-10"
          aria-hidden
          style={{ background: "radial-gradient(60% 50% at 80% 90%, rgba(0,207,255,.08), transparent 70%)" }}
        />
        <motion.div
          initial={{ opacity: 0, y: 18, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={SPRING.soft}
          className="glass w-full max-w-md rounded-2xl p-7 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.8)] sm:p-9"
        >
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-2 text-sm text-muted">{subtitle}</p>}
          <div className="mt-7">{children}</div>
          {guestCta && (
            <div className="mt-6">
              <div className="flex items-center gap-3 text-[11px] uppercase tracking-wider text-muted" aria-hidden>
                <span className="h-px flex-1 bg-line" />
                or
                <span className="h-px flex-1 bg-line" />
              </div>
              <div className="mt-4 flex justify-center">
                <TryFreeButton variant="ghost" signedInLabel="Open your workspace">
                  Experience ResearchForge — Free First Project
                </TryFreeButton>
              </div>
              <p className="mt-2 text-center text-[11px] text-muted">No account needed. One real research project.</p>
            </div>
          )}
          {footer && <div className="mt-7 border-t border-line pt-5 text-center text-sm text-muted">{footer}</div>}
        </motion.div>
      </div>
    </section>
  );
}
