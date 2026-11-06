"use client";

import { motion, useMotionValueEvent, useScroll, useSpring } from "framer-motion";
import { useRef, useState } from "react";
import { Reveal } from "@/components/ui/Reveal";
import { PIPELINE } from "@/lib/modules";
import { SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";

/** Scroll-driven lifecycle: the line fills and stages light up as the reader scrolls through. */
export function Pipeline() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 85%", "end 55%"] });
  const smooth = useSpring(scrollYProgress, { stiffness: 120, damping: 28, mass: 0.4 });
  const [reached, setReached] = useState(0);
  useMotionValueEvent(smooth, "change", (v) => {
    const n = Math.min(PIPELINE.length, Math.floor(v * PIPELINE.length + 0.35));
    setReached((prev) => (prev === n ? prev : n));
  });

  return (
    <section className="mx-auto max-w-7xl px-6 py-24">
      <Reveal>
        <p className="eyebrow">The research lifecycle</p>
        <h2 className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
          One continuous pipeline, from first idea to publication plan.
        </h2>
      </Reveal>

      <div ref={ref} className="relative mt-14">
        <div className="absolute left-0 right-0 top-[11px] hidden h-px bg-line lg:block" aria-hidden />
        <motion.div
          className="absolute left-0 right-0 top-[11px] hidden h-px origin-left bg-gradient-to-r from-azure via-cyan to-ice lg:block"
          style={{ scaleX: smooth }}
          aria-hidden
        />
        <ol className="grid gap-6 sm:grid-cols-2 lg:grid-cols-7 lg:gap-4">
          {PIPELINE.map((stage, i) => {
            const lit = i < reached;
            return (
              <li key={stage.id} className="list-none">
                <motion.span
                  animate={{ scale: lit ? 1.12 : 1 }}
                  transition={SPRING.snappy}
                  className={cn(
                    "relative flex h-[23px] w-[23px] items-center justify-center rounded-full border font-mono text-[10px] transition-colors duration-500",
                    lit ? "border-cyan bg-cyan/20 text-cyan shadow-[0_0_22px_-4px_rgba(0,207,255,0.8)]" : "border-line-strong bg-ink-900 text-muted",
                  )}
                >
                  {i + 1}
                </motion.span>
                <p className={cn("mt-3 text-sm font-medium transition-colors duration-500", lit ? "text-white" : "text-slate-400")}>
                  {stage.label}
                </p>
                <p className={cn("mt-1 font-mono text-[10px] uppercase tracking-wider", stage.live ? "text-cyan" : "text-muted")}>
                  {stage.live ? "Available" : "Planned"}
                </p>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
