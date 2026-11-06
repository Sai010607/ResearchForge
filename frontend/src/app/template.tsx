"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { DUR, EASE } from "@/lib/motion";

/** Re-mounts on every navigation, giving a short fade/slide page transition. */
export default function Template({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10, filter: "blur(4px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ duration: DUR.base + 0.1, ease: EASE.out }}
    >
      {children}
    </motion.div>
  );
}
