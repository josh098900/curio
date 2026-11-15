// @vitest-environment node
// A `next` value is kept only if it's a path on Curio itself (WEB-ACT-09's cases; T17 owns the ID).
import { describe, expect, it } from "vitest";
import { safeNextPath } from "./navigation";

describe("safeNextPath()", () => {
  it.each([
    ["/plans", "/plans"],
    ["/activities/5c3d?from=feed#chat", "/activities/5c3d?from=feed#chat"],
    ["/%2F%2Fevil.example", "/%2F%2Fevil.example"],
  ])("keeps %s", (value, kept) => {
    expect(safeNextPath(value)).toBe(kept);
  });

  it.each([
    "//evil.example",
    "/\\evil.example",
    "https://evil.example",
    "/\t/evil.example",
    "/\n/evil.example",
    // Each becomes "//evil.example" once "." and ".." are resolved (T15's security review).
    "/.//evil.example",
    "/..//evil.example",
    "/%2e%2e//evil.example",
    "/a/..//evil.example",
    "/./\\evil.example",
    "/.\t/\\evil.example",
    "plans",
    "",
    undefined,
    ["/plans"],
  ])("refuses %j", (value) => {
    expect(safeNextPath(value)).toBeNull();
  });

  it("a path it keeps stays on Curio, and gives the same answer checked again", () => {
    const candidates = [
      "/plans",
      "/a/../b",
      "/./x",
      "/%2e/x",
      "/x/%2e%2e/%2e%2e//y",
      "/x?next=//evil.example",
      "/x#//evil.example",
      "/\u3000/x",
    ];
    for (const value of candidates) {
      const kept = safeNextPath(value);
      if (kept === null) continue;
      expect(new URL(kept, "https://a.example").origin, value).toBe(
        "https://a.example",
      );
      expect(safeNextPath(kept), value).toBe(kept);
    }
  });
});
