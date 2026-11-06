import type { Transition, Variants } from "framer-motion";

/** ResearchForge motion language. One place for timing so every screen moves the same way. */
export const EASE = {
  /** Apple-style decelerate: fast start, long soft landing. Default for entrances. */
  out: [0.22, 1, 0.36, 1] as const,
  /** Symmetric, for things that move across the screen. */
  inOut: [0.65, 0, 0.35, 1] as const,
};

export const DUR = { fast: 0.18, base: 0.4, slow: 0.7, cinematic: 1.1 } as const;

export const SPRING = {
  /** Buttons, toggles, indicators: responsive, almost no overshoot. */
  snappy: { type: "spring", stiffness: 420, damping: 34 } as Transition,
  /** Cards, panels, modals: slightly softer. */
  soft: { type: "spring", stiffness: 260, damping: 28 } as Transition,
  /** Magnetic pull / parallax follow. */
  follow: { stiffness: 180, damping: 18, mass: 0.4 },
};

export const VIEWPORT = { once: true, margin: "-80px" } as const;

export const fadeUp = (y = 18, delay = 0): Variants => ({
  hidden: { opacity: 0, y },
  show: { opacity: 1, y: 0, transition: { duration: DUR.slow, delay, ease: EASE.out } },
});

/** Parent that staggers its children; children use fadeUp()/item. */
export const stagger = (gap = 0.08, delayChildren = 0): Variants => ({
  hidden: {},
  show: { transition: { staggerChildren: gap, delayChildren } },
});

export const item: Variants = fadeUp(16);

export const modal: Variants = {
  hidden: { opacity: 0, scale: 0.96, y: 8 },
  show: { opacity: 1, scale: 1, y: 0, transition: SPRING.soft },
  exit: { opacity: 0, scale: 0.98, y: 4, transition: { duration: DUR.fast, ease: EASE.inOut } },
};
