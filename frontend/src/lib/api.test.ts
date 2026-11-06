import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "./api";

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("api client", () => {
  it("sends cookies and the CSRF header on every request", async () => {
    fetchMock.mockResolvedValue(json(200, { state: "anonymous" }));
    await api.session();
    const [, init] = fetchMock.mock.calls[0];
    expect(init.credentials).toBe("include");
    expect(init.headers["X-Requested-With"]).toBe("ResearchForge");
  });

  it("parses coded errors", async () => {
    fetchMock.mockResolvedValue(json(403, { detail: { code: "trial_exhausted", message: "Used up." } }));
    const err = await api.createProject({} as never).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 403, code: "trial_exhausted", message: "Used up." });
  });

  it("maps FastAPI validation errors to per-field messages", async () => {
    fetchMock.mockResolvedValue(
      json(422, { detail: [{ loc: ["body", "email"], msg: "value is not a valid email address" }, { loc: ["body"], msg: "Value error, Passwords do not match." }] }),
    );
    const err = (await api.login({} as never).catch((e) => e)) as ApiError;
    expect(err.code).toBe("validation_error");
    expect(err.fields.email).toBe("value is not a valid email address");
    expect(err.message).toContain("Passwords do not match.");
  });

  it("reports an unreachable backend in plain words", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    await expect(api.health()).rejects.toThrow(/Cannot reach the backend/);
  });

  it("returns undefined for 204 responses", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(api.deleteProject(1)).resolves.toBeUndefined();
  });
});

describe("silent token refresh", () => {
  it("on 401 refreshes once and retries the original request", async () => {
    fetchMock
      .mockResolvedValueOnce(json(401, { detail: { code: "not_authenticated", message: "x" } }))
      .mockResolvedValueOnce(json(200, { state: "user" })) // /api/auth/refresh
      .mockResolvedValueOnce(json(200, []));
    await expect(api.listProjects()).resolves.toEqual([]);
    expect(fetchMock.mock.calls.map((c) => c[0].replace("http://localhost:8000", ""))).toEqual([
      "/api/projects",
      "/api/auth/refresh",
      "/api/projects",
    ]);
  });

  it("gives up (no loop) when the refresh fails", async () => {
    fetchMock
      .mockResolvedValueOnce(json(401, { detail: { code: "not_authenticated", message: "Please sign in" } }))
      .mockResolvedValueOnce(json(401, { detail: { code: "session_expired", message: "x" } }));
    await expect(api.listProjects()).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("concurrent 401s share ONE refresh call (refresh tokens rotate)", async () => {
    let refreshCalls = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/api/auth/refresh")) {
        refreshCalls++;
        await new Promise((r) => setTimeout(r, 10));
        return json(200, {});
      }
      const retried = fetchMock.mock.calls.filter((c) => c[0] === url).length > 1;
      return retried ? json(200, []) : json(401, { detail: { code: "not_authenticated", message: "x" } });
    });
    await Promise.all([api.listProjects(), api.listProjects()]);
    expect(refreshCalls).toBe(1);
  });

  it("never tries to refresh for auth endpoints themselves", async () => {
    fetchMock.mockResolvedValue(json(401, { detail: { code: "invalid_credentials", message: "Incorrect email or password." } }));
    await expect(api.login({ email: "a@b.co", password: "x", remember_me: false })).rejects.toMatchObject({ code: "invalid_credentials" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
