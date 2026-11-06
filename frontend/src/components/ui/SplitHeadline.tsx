"use client";

import { motion } from "framer-motion";
import { DUR, EASE } from "@/lib/motion";

/** Word-by-word masked reveal. Text stays a single heading for screen readers. */
export function SplitHeadline({
  lines,
  className,
  delay = 0.1,
  highlight,
}: {
  lines: string[];
  className?: string;
  delay?: number;
  /** Words (case-sensitive, punctuation included) rendered with the brand gradient. */
  highlight?: string[];
}) {
  let n = 0;
  return (
    <h1 className={className} aria-label={lines.join(" ")}>
      {lines.map((line, li) => (
        <span key={li} className="block" aria-hidden>
          {line.split(" ").map((w) => {
            const i = n++;
            return (
              <span key={i} className="inline-block overflow-hidden pb-[0.12em] align-top">
                <motion.span
                  className={"inline-block " + (highlight?.includes(w) ? "text-gradient" : "")}
                  initial={{ y: "110%", opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ duration: DUR.slow + 0.1, delay: delay + i * 0.07, ease: EASE.out }}
                >
                  {w}
                </motion.span>
                {" "}
              </span>
            );
          })}
        </span>
      ))}
    </h1>
  );
}
