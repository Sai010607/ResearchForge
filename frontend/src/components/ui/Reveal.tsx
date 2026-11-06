"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { DUR, EASE, VIEWPORT } from "@/lib/motion";

export function Reveal({
  children,
  delay = 0,
  y = 18,
  className,
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={VIEWPORT}
      transition={{ duration: DUR.slow, delay, ease: EASE.out }}
    >
      {children}
    </motion.div>
  );
}
