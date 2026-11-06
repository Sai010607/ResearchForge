import { cn } from "@/lib/utils";

/** Shimmering placeholder. Pass the same dimensions as the content it stands in for to avoid layout shift. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("skeleton rounded-lg", className)} />;
}
