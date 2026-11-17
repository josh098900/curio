// UT-ERR-02 in the browser: Sentry's real browser client, with the app's settings, sends a report
// that says nothing about the person, and tells Sentry not to store their IP address.
import { createRequire } from "node:module";
import { expect, it, vi } from "vitest";
import { reportInBrowser } from "./browser-sentry";

// Vitest resolves @sentry/nextjs to its server build. In the browser, it re-exports
// @sentry/react, whose browser client decides what the report carries, so use that here.
vi.mock("@sentry/nextjs", () => {
  const nextjs = createRequire(import.meta.url).resolve(
    "@sentry/nextjs/package.json",
  );
  return import(createRequire(nextjs).resolve("@sentry/react"));
});

it("UT-ERR-02 a browser report carries no user, no error text, and no leave to store the IP address", async () => {
  vi.stubEnv(
    "NEXT_PUBLIC_SENTRY_DSN",
    "https://public@o0.ingest.de.sentry.io/1",
  );
  const send = vi.fn<typeof fetch>(async () => new Response("{}"));
  vi.stubGlobal("fetch", send);

  reportInBrowser(new Error("Ana Smith <ana@example.com>"));

  await vi.waitFor(() => expect(send).toHaveBeenCalled());
  const envelope = String(send.mock.calls[0][1]?.body);
  const event = envelope
    .split("\n")
    .map((line) => JSON.parse(line))
    .find((item) => item.exception);
  expect(event.sdk.settings).toMatchObject({ infer_ip: "never" });
  expect(event).not.toHaveProperty("user");
  expect(event.exception.values[0].type).toBe("Error");
  expect(envelope).not.toContain("Ana");
});
