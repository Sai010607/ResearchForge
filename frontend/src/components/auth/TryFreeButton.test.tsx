import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { authMock, trial, USER } from "@/test/helpers";
import { TryFreeButton } from "./TryFreeButton";

const nav = vi.hoisted(() => ({ router: { push: vi.fn(), replace: vi.fn() } }));
const auth = vi.hoisted(() => ({ current: {} as ReturnType<typeof import("@/test/helpers").authMock> }));
vi.mock("next/navigation", () => ({ useRouter: () => nav.router }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth.current }));

beforeEach(() => {
  auth.current = authMock();
});

describe("TryFreeButton", () => {
  it("anonymous: starts the server-side trial, then redirects to /workspace", async () => {
    const user = userEvent.setup();
    render(<TryFreeButton />);
    await user.click(screen.getByRole("button", { name: "Try ResearchForge Free" }));
    expect(auth.current.startTrial).toHaveBeenCalledTimes(1);
    expect(nav.router.push).toHaveBeenCalledWith("/workspace");
  });

  it("does NOT redirect when the backend refuses (e.g. rate limited) and shows why", async () => {
    auth.current.startTrial.mockRejectedValue(new ApiError("Too many attempts. Please try again in 60 seconds.", 429, "rate_limited"));
    const user = userEvent.setup();
    render(<TryFreeButton />);
    await user.click(screen.getByRole("button", { name: "Try ResearchForge Free" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many attempts");
    expect(nav.router.push).not.toHaveBeenCalled();
  });

  it("guest: becomes a plain link to the workspace (no second session is created)", () => {
    auth.current = authMock({ status: "guest", trial: trial(false) });
    render(<TryFreeButton />);
    expect(screen.getByRole("link", { name: "Continue free trial" })).toHaveAttribute("href", "/workspace");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("member: 'Start Research Project' link", () => {
    auth.current = authMock({ status: "user", user: USER });
    render(<TryFreeButton />);
    expect(screen.getByRole("link", { name: "Start Research Project" })).toHaveAttribute("href", "/workspace");
  });
});
