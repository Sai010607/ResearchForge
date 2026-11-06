import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { authMock } from "@/test/helpers";
import { RegisterForm } from "./RegisterForm";

const nav = vi.hoisted(() => ({ router: { push: vi.fn(), replace: vi.fn() } }));
const auth = vi.hoisted(() => ({ current: {} as ReturnType<typeof import("@/test/helpers").authMock> }));
vi.mock("next/navigation", () => ({ useRouter: () => nav.router, usePathname: () => "/register" }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth.current }));
vi.mock("./NeuralBackdrop", () => ({ NeuralBackdrop: () => null }));

beforeEach(() => {
  auth.current = authMock();
});

async function fillAll(over: Partial<Record<"name" | "email" | "pw" | "confirm", string>> = {}, terms = true) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Full name"), over.name ?? "Ada Lovelace");
  await user.type(screen.getByLabelText("Email address"), over.email ?? "ada@example.com");
  await user.type(screen.getByLabelText("Password"), over.pw ?? "correct-horse-42");
  await user.type(screen.getByLabelText("Confirm password"), over.confirm ?? over.pw ?? "correct-horse-42");
  if (terms) await user.click(screen.getByLabelText("I accept the terms of use below."));
  return user;
}

describe("RegisterForm", () => {
  it("validates every field before calling the API", async () => {
    const user = userEvent.setup();
    render(<RegisterForm />);
    await user.click(screen.getByRole("button", { name: "Create free account" }));
    for (const msg of ["Enter your full name.", "Enter a valid email address.", "Use at least 10 characters with a letter and a number.", "You must accept the terms to continue."])
      expect(screen.getByText(msg)).toBeInTheDocument();
    expect(auth.current.register).not.toHaveBeenCalled();
  });

  it("flags mismatched passwords", async () => {
    render(<RegisterForm />);
    const user = await fillAll({ confirm: "different-pass-99" });
    await user.click(screen.getByRole("button", { name: "Create free account" }));
    expect(screen.getByText("Passwords do not match.")).toBeInTheDocument();
    expect(auth.current.register).not.toHaveBeenCalled();
  });

  it("requires accepting the terms", async () => {
    render(<RegisterForm />);
    const user = await fillAll({}, false);
    await user.click(screen.getByRole("button", { name: "Create free account" }));
    expect(screen.getByText("You must accept the terms to continue.")).toBeInTheDocument();
  });

  it("live password checklist updates as you type", async () => {
    const user = userEvent.setup();
    render(<RegisterForm />);
    const list = screen.getByRole("list", { name: "Password requirements" });
    expect(list).toHaveTextContent("not met yet");
    await user.type(screen.getByLabelText("Password"), "correct-horse-42");
    expect(list).not.toHaveTextContent("not met yet");
  });

  it("registers and goes to /dashboard", async () => {
    render(<RegisterForm />);
    const user = await fillAll();
    await user.click(screen.getByRole("button", { name: "Create free account" }));
    await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith("/dashboard"));
    expect(auth.current.register).toHaveBeenCalledWith({
      full_name: "Ada Lovelace",
      email: "ada@example.com",
      password: "correct-horse-42",
      confirm_password: "correct-horse-42",
      accept_terms: true,
    });
  });

  it("shows the duplicate-email error on the email field", async () => {
    auth.current.register.mockRejectedValue(new ApiError("An account with this email already exists.", 409, "email_taken"));
    render(<RegisterForm />);
    const user = await fillAll();
    await user.click(screen.getByRole("button", { name: "Create free account" }));
    expect(await screen.findByText("An account with this email already exists.")).toBeInTheDocument();
    expect(screen.getByLabelText("Email address")).toHaveAttribute("aria-invalid", "true");
    expect(nav.router.replace).not.toHaveBeenCalled();
  });

  it("maps server validation errors to their fields", async () => {
    auth.current.register.mockRejectedValue(new ApiError("bad", 422, "validation_error", { password: "That password is too common." }));
    render(<RegisterForm />);
    const user = await fillAll();
    await user.click(screen.getByRole("button", { name: "Create free account" }));
    expect(await screen.findByText("That password is too common.")).toBeInTheDocument();
  });

  it("when verification is required, asks the user to check their inbox instead of signing in", async () => {
    auth.current.register.mockResolvedValue({ verification_required: true });
    render(<RegisterForm />);
    const user = await fillAll();
    await user.click(screen.getByRole("button", { name: "Create free account" }));
    expect(await screen.findByText("Check your inbox")).toBeInTheDocument();
    expect(nav.router.replace).not.toHaveBeenCalled();
  });
});
