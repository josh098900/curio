// S56 carries `next` on to sign-in only once it's checked to be a path on Curio.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import SignedOut from "./page";

async function signInLink(next: string | string[] | undefined) {
  render(
    await SignedOut({
      params: Promise.resolve({}),
      searchParams: Promise.resolve({ next }),
    }),
  );
  return screen.getByRole("link", { name: "Sign in again" });
}

describe("S56 Signed out", () => {
  it("takes someone back to where they were, encoded", async () => {
    expect(await signInLink("/plans?tab=past")).toHaveAttribute(
      "href",
      "/sign-in?next=%2Fplans%3Ftab%3Dpast",
    );
  });

  it.each([
    ["no next", undefined],
    ["another site", "//evil.example"],
    ["a path that resolves to another site", "/.//evil.example"],
    ["more than one next", ["/plans", "//evil.example"]],
  ])("drops %s", async (_, next) => {
    expect(await signInLink(next)).toHaveAttribute("href", "/sign-in");
  });
});
