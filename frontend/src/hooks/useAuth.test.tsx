import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "./useAuth";
import { USER, trial } from "@/test/helpers";

const apiMock = vi.hoisted(() => ({
  session: vi.fn(),
  startGuest: vi.fn(),
  login: vi.fn(),
  register: vi.fn(),
  logout: vi.fn(),
}));
vi.mock("@/lib/api", async (orig) => ({ ...(await orig<typeof import("@/lib/api")>()), api: apiMock }));

const sess = (state: string, extra = {}) => ({ state, user: null, trial: null, claimed_projects: 0, verification_required: false, ...extra });

function Probe() {
  const a = useAuth();
  return (
    <div>
      <p data-testid="status">{a.status}</p>
      <p data-testid="who">{a.user?.full_name ?? "-"}</p>
      <p data-testid="trial">{a.trial ? `${a.trial.remaining}/${a.trial.limit}` : "-"}</p>
      <p data-testid="err">{a.error}</p>
      <button onClick={() => a.startTrial()}>start</button>
      <button onClick={() => a.login({ email: "a@b.co", password: "x", remember_me: false })}>login</button>
      <button onClick={() => a.logout()}>logout</button>
    </div>
  );
}
const mount = () => render(<AuthProvider><Probe /></AuthProvider>);

beforeEach(() => Object.values(apiMock).forEach((m) => m.mockReset()));

describe("AuthProvider reflects the SERVER session (never a client guess)", () => {
  it("starts in 'loading', then anonymous", async () => {
    apiMock.session.mockResolvedValue(sess("anonymous"));
    mount();
    expect(screen.getByTestId("status")).toHaveTextContent("loading");
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("anonymous"));
  });

  it("guest state carries the real trial counters", async () => {
    apiMock.session.mockResolvedValue(sess("guest", { trial: trial(false) }));
    mount();
    await waitFor(() => expect(screen.getByTestId("trial")).toHaveTextContent("1/1"));
    expect(screen.getByTestId("status")).toHaveTextContent("guest");
  });

  it("exhausted guest trial shows 0/1", async () => {
    apiMock.session.mockResolvedValue(sess("guest", { trial: trial(true) }));
    mount();
    await waitFor(() => expect(screen.getByTestId("trial")).toHaveTextContent("0/1"));
  });

  it("signed-in user", async () => {
    apiMock.session.mockResolvedValue(sess("user", { user: USER }));
    mount();
    await waitFor(() => expect(screen.getByTestId("who")).toHaveTextContent("Ada Lovelace"));
  });

  it("falls back to anonymous with an error when the backend is unreachable", async () => {
    const { ApiError } = await import("@/lib/api");
    apiMock.session.mockRejectedValue(new ApiError("Cannot reach the backend"));
    mount();
    await waitFor(() => expect(screen.getByTestId("err")).toHaveTextContent("Cannot reach the backend"));
    expect(screen.getByTestId("status")).toHaveTextContent("anonymous");
  });

  it("startTrial / login / logout move between states using server responses", async () => {
    apiMock.session.mockResolvedValue(sess("anonymous"));
    apiMock.startGuest.mockResolvedValue(sess("guest", { trial: trial(false) }));
    apiMock.login.mockResolvedValue(sess("user", { user: USER }));
    apiMock.logout.mockResolvedValue(undefined);
    mount();
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("anonymous"));
    await act(async () => screen.getByText("start").click());
    expect(screen.getByTestId("status")).toHaveTextContent("guest");
    await act(async () => screen.getByText("login").click());
    expect(screen.getByTestId("status")).toHaveTextContent("user");
    await act(async () => screen.getByText("logout").click());
    expect(screen.getByTestId("status")).toHaveTextContent("anonymous");
    expect(screen.getByTestId("who")).toHaveTextContent("-");
  });
});
