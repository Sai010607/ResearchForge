import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { USER, authMock, trial } from "@/test/helpers";
import { Navbar } from "./Navbar";

const nav = vi.hoisted(() => ({ router: { push: vi.fn(), replace: vi.fn() } }));
const auth = vi.hoisted(() => ({ current: {} as ReturnType<typeof import("@/test/helpers").authMock> }));
vi.mock("next/navigation", () => ({ useRouter: () => nav.router, usePathname: () => "/" }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth.current }));
vi.mock("@/hooks/useProjects", () => ({ useProjects: () => ({ status: "online" }) }));

beforeEach(() => {
  auth.current = authMock();
});

const desktop = () => screen.getByRole("banner");

describe("Navbar renders the real auth state", () => {
  it("logged out: Login, Register and Try Free", () => {
    render(<Navbar />);
    expect(within(desktop()).getByRole("link", { name: "Login" })).toHaveAttribute("href", "/login");
    expect(within(desktop()).getByRole("link", { name: "Register" })).toHaveAttribute("href", "/register");
    expect(within(desktop()).getByRole("button", { name: "Try Free" })).toBeInTheDocument();
    expect(screen.queryByText(/Guest Trial/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Account menu/ })).not.toBeInTheDocument();
  });

  it("Try Free starts a server trial then opens the workspace", async () => {
    const user = userEvent.setup();
    render(<Navbar />);
    await user.click(within(desktop()).getByRole("button", { name: "Try Free" }));
    expect(auth.current.startTrial).toHaveBeenCalledTimes(1);
    expect(nav.router.push).toHaveBeenCalledWith("/workspace");
  });

  it("guest with trial left: 'Guest Trial: 1/1 remaining', Create Research Project, Register to unlock", () => {
    auth.current = authMock({ status: "guest", trial: trial(false) });
    render(<Navbar />);
    expect(within(desktop()).getByText("Guest Trial: 1/1 remaining")).toBeInTheDocument();
    expect(within(desktop()).getByRole("link", { name: "Create Research Project" })).toHaveAttribute("href", "/workspace");
    expect(within(desktop()).getByRole("link", { name: /Register/ })).toHaveAttribute("href", "/register");
    expect(within(desktop()).queryByRole("button", { name: "Try Free" })).not.toBeInTheDocument();
  });

  it("guest with trial used: '0/1 remaining'", () => {
    auth.current = authMock({ status: "guest", trial: trial(true) });
    render(<Navbar />);
    expect(within(desktop()).getByText("Guest Trial: 0/1 remaining")).toBeInTheDocument();
  });

  it("member: avatar with initials; menu has Dashboard and Log out; logout calls the server", async () => {
    auth.current = authMock({ status: "user", user: USER });
    const user = userEvent.setup();
    render(<Navbar />);
    const avatar = within(desktop()).getByRole("button", { name: "Account menu for Ada Lovelace" });
    expect(avatar).toHaveTextContent("AL");
    expect(avatar).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/Guest Trial/)).not.toBeInTheDocument();
    await user.click(avatar);
    expect(screen.getByRole("menuitem", { name: /Dashboard/ })).toHaveAttribute("href", "/dashboard");
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: /Log out/ }));
    expect(auth.current.logout).toHaveBeenCalledTimes(1);
    expect(nav.router.replace).toHaveBeenCalledWith("/");
  });

  it("account menu closes on Escape", async () => {
    auth.current = authMock({ status: "user", user: USER });
    const user = userEvent.setup();
    render(<Navbar />);
    await user.click(screen.getByRole("button", { name: /Account menu/ }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await vi.waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  });

  it("shows no auth controls while the session is still loading (no flash of wrong state)", () => {
    auth.current = authMock({ status: "loading" });
    render(<Navbar />);
    expect(screen.queryByRole("button", { name: "Try Free" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Account menu/ })).not.toBeInTheDocument();
  });
});
