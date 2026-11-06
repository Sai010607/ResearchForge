"use client";

import { motion, useMotionValue, useReducedMotion, useSpring } from "framer-motion";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const BASE =
  "inline-flex items-center gap-2 rounded-lg px-6 py-3 text-sm font-medium transition-colors";
const VARIANT = {
  primary:
    "bg-gradient-to-r from-azure to-[#3b82ff] active:scale-[0.97] text-white shadow-[0_0_0_1px_rgba(255,255,255,0.12)_inset,0_8px_30px_-8px_rgba(37,99,255,0.65)] hover:brightness-110",
  ghost: "border border-line-strong text-white hover:border-cyan/60 hover:bg-white/[0.04]",
};

export const buttonStyles = (variant: keyof typeof VARIANT = "primary", extra?: string) =>
  cn(BASE, VARIANT[variant], extra);

/** Link that is gently pulled toward the cursor (mouse only, disabled for reduced motion). */
export function MagneticButton({
  href,
  children,
  variant = "primary",
  className,
}: {
  href: string;
  children: ReactNode;
  variant?: keyof typeof VARIANT;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 220, damping: 18 });
  const sy = useSpring(y, { stiffness: 220, damping: 18 });

  return (
    <motion.div
      className="pointer-events-auto inline-block"
      style={{ x: sx, y: sy }}
      whileTap={{ scale: 0.97 }}
      onPointerMove={(e) => {
        if (reduce || e.pointerType !== "mouse") return;
        const r = e.currentTarget.getBoundingClientRect();
        x.set((e.clientX - (r.left + r.width / 2)) * 0.25);
        y.set((e.clientY - (r.top + r.height / 2)) * 0.25);
      }}
      onPointerLeave={() => {
        x.set(0);
        y.set(0);
      }}
    >
      <Link href={href} className={cn(BASE, VARIANT[variant], className)}>
        {children}
      </Link>
    </motion.div>
  );
}
