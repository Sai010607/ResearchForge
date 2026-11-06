import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { authMock } from "@/test/helpers";
import { ForgotPasswordForm } from "./ForgotPasswordForm";
import { ResetPasswordForm } from "./ResetPasswordForm";
import { VerifyCallback } from "./VerifyCallback";

const nav = vi.hoisted(() => ({ router: { push: vi.fn(), replace: vi.fn() }, params: new URLSearchParams() }));
const apiMock = vi.hoisted(() => ({ forgotPassword: vi.fn(), resetPassword: vi.fn(), verifyEmail: vi.fn() }));
const auth = vi.hoisted(() => ({ current: {} as ReturnType<typeof import("@/test/helpers").authMock> }));
vi.mock("next/navigation", () => ({ useRouter: () => nav.router, useSearchParams: () => nav.params, usePathname: () => "/" }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth.current }));
vi.mock("@/lib/api", async (orig) => ({ ...(await orig<typeof import("@/lib/api")>()), api: apiMock }));
vi.mock("./NeuralBackdrop", () => ({ NeuralBackdrop: () => null }));

beforeEach(() => {
  auth.current = authMock();
  Object.values(apiMock).forEach((m) => m.mockReset());
});

describe("ForgotPasswordForm", () => {
  it("validates the email, then shows the same generic confirmation", async () => {
    apiMock.forgotPassword.mockResolvedValue({ message: "ok" });
    const user = userEvent.setup();
    render(<ForgotPasswordForm />);
    await user.click(screen.getByRole("button", { name: "Send reset link" }));
    expect(screen.getByText("Enter a valid email address.")).toBeInTheDocument();
    expect(apiMock.forgotPassword).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText("Email address"), "ada@example.com");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));
    expect(await screen.findByText(/If an account exists for that email/)).toBeInTheDocument();
    expect(apiMock.forgotPassword).toHaveBeenCalledWith("ada@example.com");
  });

  it("surfaces rate limiting", async () => {
    apiMock.forgotPassword.mockRejectedValue(new ApiError("Too many attempts. Please try again in 60 seconds.", 429, "rate_limited"));
    const user = userEvent.setup();
    render(<ForgotPasswordForm />);
    await user.type(screen.getByLabelText("Email address"), "ada@example.com");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many attempts");
  });
});

describe("ResetPasswordForm", () => {
  it("rejects a link without a token", () => {
    nav.params = new URLSearchParams();
    render(<ResetPasswordForm />);
    expect(screen.getByText("Link not valid")).toBeInTheDocument();
  });

  it("sets the new password and sends the user to login", async () => {
    nav.params = new URLSearchParams("token=abc123abc123");
    apiMock.resetPassword.mockResolvedValue({ message: "ok" });
    const user = userEvent.setup();
    render(<ResetPasswordForm />);
    await user.type(screen.getByLabelText("New password"), "brand-new-pass-77");
    await user.type(screen.getByLabelText("Confirm new password"), "brand-new-pass-77");
    await user.click(screen.getByRole("button", { name: "Update password" }));
    await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith("/login?reset=1"));
    expect(apiMock.resetPassword).toHaveBeenCalledWith("abc123abc123", "brand-new-pass-77");
  });

  it("shows an expired/used-link error with a way to request a new one", async () => {
    nav.params = new URLSearchParams("token=abc123abc123");
    apiMock.resetPassword.mockRejectedValue(new ApiError("This link is invalid or has expired.", 400, "invalid_token"));
    const user = userEvent.setup();
    render(<ResetPasswordForm />);
    await user.type(screen.getByLabelText("New password"), "brand-new-pass-77");
    await user.type(screen.getByLabelText("Confirm new password"), "brand-new-pass-77");
    await user.click(screen.getByRole("button", { name: "Update password" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("invalid or has expired");
    expect(screen.getByRole("link", { name: "Request a new link" })).toHaveAttribute("href", "/forgot-password");
  });
});

describe("VerifyCallback", () => {
  it("verifies exactly once even under React StrictMode (tokens are single-use)", async () => {
    nav.params = new URLSearchParams("type=verify&token=strict-mode-token-1");
    apiMock.verifyEmail.mockResolvedValue({ message: "Email verified." });
    render(
      <StrictMode>
        <VerifyCallback />
      </StrictMode>,
    );
    expect(await screen.findByRole("heading", { name: "Email verified" })).toBeInTheDocument();
    expect(apiMock.verifyEmail).toHaveBeenCalledTimes(1);
    expect(auth.current.reload).toHaveBeenCalled();
  });

  it("explains an invalid or expired link", async () => {
    nav.params = new URLSearchParams("type=verify&token=expired-token-0001");
    apiMock.verifyEmail.mockRejectedValue(new ApiError("This link is invalid or has expired. Please request a new one.", 400, "invalid_token"));
    render(<VerifyCallback />);
    expect(await screen.findByRole("heading", { name: "Verification failed" })).toBeInTheDocument();
    expect(screen.getByText(/invalid or has expired/)).toBeInTheDocument();
  });

  it("does not call the API for a malformed link", () => {
    nav.params = new URLSearchParams("foo=bar");
    render(<VerifyCallback />);
    expect(screen.getByRole("heading", { name: "Verification failed" })).toBeInTheDocument();
    expect(apiMock.verifyEmail).not.toHaveBeenCalled();
  });
});
