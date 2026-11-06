import { describe, expect, it } from "vitest";
import { EMAIL_RE, passwordRules, passwordValid, safeNext } from "./validation";

describe("password rules (mirror the backend policy)", () => {
  it("requires 10+ chars, a letter and a number", () => {
    expect(passwordValid("short1")).toBe(false);
    expect(passwordValid("onlyletterspassword")).toBe(false);
    expect(passwordValid("1234567890123")).toBe(false);
    expect(passwordValid("correct-horse-42")).toBe(true);
  });
  it("reports each rule separately", () => {
    expect(passwordRules("abc").map((r) => r.ok)).toEqual([false, true, false]);
  });
  it("rejects absurdly long passwords", () => {
    expect(passwordValid("a1".repeat(80))).toBe(false);
  });
});

describe("safeNext (open-redirect guard)", () => {
  it.each([
    ["/workspace", "/workspace"],
    ["/dashboard?x=1", "/dashboard?x=1"],
  ])("allows same-site path %s", (input, out) => expect(safeNext(input)).toBe(out));

  it.each(["https://evil.example", "//evil.example", "javascript:alert(1)", "/\\evil.example", "", null, undefined])(
    "falls back for %s",
    (input) => expect(safeNext(input as string | null)).toBe("/dashboard"),
  );
});

describe("email check", () => {
  it("accepts normal and rejects malformed addresses", () => {
    expect(EMAIL_RE.test("a@b.co")).toBe(true);
    for (const bad of ["a", "a@b", "a b@c.com", "@x.com"]) expect(EMAIL_RE.test(bad)).toBe(false);
  });
});
