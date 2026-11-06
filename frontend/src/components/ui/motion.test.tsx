import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DUR, EASE, SPRING, fadeUp, stagger } from "@/lib/motion";
import { SplitHeadline } from "./SplitHeadline";
import { Skeleton } from "./Skeleton";

describe("motion system", () => {
  it("exposes consistent timing and easing tokens", () => {
    expect(EASE.out).toHaveLength(4);
    expect(DUR.fast).toBeLessThan(DUR.base);
    expect(DUR.base).toBeLessThan(DUR.slow);
    expect(SPRING.snappy).toMatchObject({ type: "spring" });
    expect(Object.keys(fadeUp(10))).toEqual(["hidden", "show"]);
    expect(stagger()).toHaveProperty("show");
  });

  it("SplitHeadline keeps one accessible heading with the full text", () => {
    render(<SplitHeadline lines={["Research Intelligence.", "Reimagined."]} highlight={["Reimagined."]} />);
    expect(screen.getByRole("heading", { level: 1, name: "Research Intelligence. Reimagined." })).toBeInTheDocument();
  });

  it("Skeleton is hidden from assistive tech", () => {
    const { container } = render(<Skeleton className="h-4 w-4" />);
    expect(container.firstChild).toHaveAttribute("aria-hidden", "true");
  });
});
