"use client";

import { motion, useScroll, useTransform } from "framer-motion";
import { useRef } from "react";
import { SplitHeadline } from "@/components/ui/SplitHeadline";
import { DUR, EASE } from "@/lib/motion";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { HeroCanvas } from "@/components/hero/HeroCanvas";
import { TryFreeButton } from "@/components/auth/TryFreeButton";
import { MagneticButton } from "@/components/ui/MagneticButton";
import { useAuth } from "@/hooks/useAuth";

export function Hero() {
  const { status } = useAuth();
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const textY = useTransform(scrollYProgress, [0, 1], [0, -70]);
  const textOpacity = useTransform(scrollYProgress, [0, 0.7], [1, 0]);
  const sceneY = useTransform(scrollYProgress, [0, 1], [0, 90]);
  const fade = (i: number) => ({
    initial: { opacity: 0, y: 18 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: DUR.slow, delay: 0.55 + i * 0.12, ease: EASE.out },
  });
  return (
    <section ref={ref} className="relative isolate overflow-hidden border-b border-line">
      <div className="grid-bg absolute inset-0 -z-10 opacity-70" aria-hidden />
      <div
        className="absolute inset-0 -z-10"
        aria-hidden
        style={{
          background:
            "radial-gradient(55% 55% at 72% 42%, rgba(37,99,255,.2), transparent 70%), radial-gradient(35% 40% at 88% 78%, rgba(0,207,255,.1), transparent 70%)",
        }}
      />

      <div className="relative z-10 mx-auto flex max-w-7xl flex-col px-6 pt-16 lg:min-h-[calc(100svh-4rem)] lg:justify-center lg:pt-0">
        <motion.div style={{ y: textY, opacity: textOpacity }} className="pointer-events-none max-w-xl lg:py-24">
          <motion.p {...fade(-3)} className="eyebrow">
            AI Research Intelligence
          </motion.p>
          <SplitHeadline
            lines={["Research Intelligence.", "Reimagined."]}
            highlight={["Reimagined."]}
            className="mt-5 text-[2.6rem] font-semibold leading-[1.05] tracking-tight sm:text-6xl"
          />
          <motion.p {...fade(0)} className="mt-6 max-w-lg text-base leading-relaxed text-muted">
            Discover connections. Identify research gaps. Accelerate scientific discovery with AI.
          </motion.p>
          <motion.div {...fade(1)} className="mt-9 flex flex-wrap gap-3">
            <TryFreeButton signedInLabel={<>Start Researching <ArrowRight size={16} /></>}>
              Start Researching <ArrowRight size={16} aria-hidden />
            </TryFreeButton>
            <MagneticButton href="#modules" variant="ghost">
              Explore the Platform
            </MagneticButton>
          </motion.div>
          {(status === "anonymous" || status === "loading") && (
            <motion.p {...fade(2)} className="mt-4 text-xs text-muted">
              No account needed: one free research project. Already a member?{" "}
              <Link href="/login" className="pointer-events-auto text-cyan hover:underline">
                Sign in
              </Link>
            </motion.p>
          )}
        </motion.div>
      </div>

      {/* 3D network: full-bleed on desktop, its own band on mobile */}
      <motion.div style={{ y: sceneY }} className="relative h-[380px] w-full lg:absolute lg:inset-0 lg:z-0 lg:h-auto">
        <HeroCanvas />
      </motion.div>
    </section>
  );
}
