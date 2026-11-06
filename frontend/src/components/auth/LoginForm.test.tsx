import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { authMock } from "@/test/helpers";
import { LoginForm } from "./LoginForm";

const nav = vi.hoisted(() => ({ router: { push: vi.fn(), replace: vi.fn() }, params: new URLSearchParams() }));
const auth = vi.hoisted(() => ({ current: {} as ReturnType<typeof import("@/test/helpers").authMock> }));
vi.mock("next/navigation", () => ({ useRouter: () => nav.router, useSearchParams: () => nav.params, usePathname: () => "/login" }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth.current }));
vi.mock("./NeuralBackdrop", () => ({ NeuralBackdrop: () => null }));

beforeEach(() => {
  auth.current = authMock();
  nav.params = new URLSearchParams();
});

const fill = async (email: string, password: string) => {
  const user = userEvent.setup();
  if (email) await user.type(screen.getByLabelText("Email address"), email);
  if (password) await user.type(screen.getByLabelText("Password"), password);
  return user;
};

describe("LoginForm", () => {
  it("offers the real guest-trial entry point", () => {
    render(<LoginForm />);
    expect(screen.getByRole("button", { name: "Experience ResearchForge — Free First Project" })).toBeInTheDocument();
  });

  it("shows validation errors and does not call the API", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByText("Enter a valid email address.")).toBeInTheDocument();
    expect(screen.getByText("Enter your password.")).toBeInTheDocument();
    expect(auth.current.login).not.toHaveBeenCalled();
  });

  it("logs in and goes to /dashboard", async () => {
    render(<LoginForm />);
    const user = await fill("ada@example.com", "correct-horse-42");
    await user.click(screen.getByLabelText("Remember me"));
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith("/dashboard"));
    expect(auth.current.login).toHaveBeenCalledWith({ email: "ada@example.com", password: "correct-horse-42", remember_me: true });
  });

  it("honours a same-site ?next= but ignores an external one", async () => {
    nav.params = new URLSearchParams("next=/workspace");
    const { unmount } = render(<LoginForm />);
    let user = await fill("a@b.co", "pw");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith("/workspace"));
    unmount();
    nav.router.replace.mockClear();
    nav.params = new URLSearchParams("next=https://evil.example");
    render(<LoginForm />);
    user = await fill("a@b.co", "pw");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith("/dashboard"));
  });

  it("shows the server's error for wrong credentials and stays on the page", async () => {
    auth.current.login.mockRejectedValue(new ApiError("Incorrect email or password.", 401, "invalid_credentials"));
    render(<LoginForm />);
    const user = await fill("ada@example.com", "wrong");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Incorrect email or password.");
    expect(nav.router.replace).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });

  it("toggles password visibility", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);
    const input = screen.getByLabelText("Password");
    expect(input).toHaveAttribute("type", "password");
    await user.click(screen.getByRole("button", { name: "Show password" }));
    expect(input).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "Hide password" })).toHaveAttribute("aria-pressed", "true");
  });

  it("links to forgot-password and register", () => {
    render(<LoginForm />);
    expect(screen.getByRole("link", { name: "Forgot password?" })).toHaveAttribute("href", "/forgot-password");
    expect(screen.getByRole("link", { name: "Create a free account" })).toHaveAttribute("href", "/register");
  });

  it("redirects away if already signed in", async () => {
    auth.current = authMock({ status: "user" });
    render(<LoginForm />);
    await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith("/dashboard"));
  });
});
