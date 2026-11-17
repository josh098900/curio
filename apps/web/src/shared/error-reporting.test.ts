// UT-ERR-02's last step: whatever an error report gathers, only what's needed to find the fault
// reaches Sentry (spec §14.3, NFR-OBS-01).
import type { ErrorEvent } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";
import { REQUEST_ID } from "../../test/fake-sentry";
import { REQUEST_ID_HEADER, scrubEvent } from "./error-reporting";

/** An event carrying every kind of personal data an SDK or a careless call could add. */
function everything(): ErrorEvent {
  return {
    type: undefined,
    event_id: "e1",
    timestamp: 1,
    level: "error",
    platform: "node",
    release: "5f6ba10",
    environment: "preview",
    server_name: "ip-10-0-0-7",
    message: "Ana Smith <ana@example.com> joined",
    transaction: "GET /auth/confirm?token_hash=pkce_secret",
    exception: {
      values: [
        {
          type: "TypeError",
          value: 'invalid input syntax for type uuid: "Ana Smith"',
          mechanism: {
            type: "onerror",
            handled: false,
            data: { input: "Ana Smith" },
          },
          stacktrace: {
            frames: [
              {
                filename: "app:///src/server/action.ts",
                function: "serverAction",
                lineno: 12,
                vars: { email: "ana@example.com" },
              },
              // A page's inline script is named after the page's full address.
              {
                filename:
                  "https://curio.example/auth/confirm?token_hash=pkce_secret",
                abs_path:
                  "https://curio.example/auth/confirm?token_hash=pkce_secret",
                lineno: 1,
              },
            ],
          },
        },
        { type: "Error", value: "UNAVAILABLE" },
      ],
    },
    request: {
      method: "POST",
      url: "https://curio.example/auth/confirm?token_hash=pkce_secret#top",
      query_string: "token_hash=pkce_secret",
      cookies: { "sb-abc-auth-token": "base64-session" },
      data: { displayName: "Ana Smith" },
      headers: {
        cookie: "sb-abc-auth-token=base64-session",
        "x-vercel-protection-bypass": "bypass-secret",
        "user-agent": "Mozilla/5.0",
        [REQUEST_ID_HEADER]: REQUEST_ID,
      },
    },
    user: {
      id: "4b1e2f0a",
      email: "ana@example.com",
      ip_address: "81.2.69.160",
    },
    breadcrumbs: [{ message: "console: signing in ana@example.com" }],
    extra: { form: { email: "ana@example.com" } },
    tags: { postgres_code: "23505", favourite: "ana@example.com" },
    contexts: {
      runtime: { name: "node", version: "v24.22.2" },
      culture: { timezone: "Europe/London" },
      signup: { email: "ana@example.com" },
    },
    modules: { next: "16.4.5" },
  };
}

describe("UT-ERR-02 an error report", () => {
  it("UT-ERR-02 reaches Sentry without personal data, keeping what finds the fault", () => {
    const scrubbed = scrubEvent(everything());
    const sent = JSON.stringify(scrubbed);

    for (const leak of [
      "ana@example.com",
      "Ana Smith",
      "pkce_secret",
      "base64-session",
      "bypass-secret",
      "Mozilla",
      "81.2.69.160",
      "Europe/London",
      "ip-10-0-0-7",
    ])
      expect(sent).not.toContain(leak);
    expect(scrubbed).not.toHaveProperty("user");
    expect(scrubbed).not.toHaveProperty("breadcrumbs");
    expect(scrubbed).not.toHaveProperty("extra");

    expect(scrubbed).toMatchObject({
      release: "5f6ba10",
      environment: "preview",
      transaction: "GET /auth/confirm",
      request: { method: "POST", url: "https://curio.example/auth/confirm" },
      tags: { request_id: REQUEST_ID, postgres_code: "23505" },
      contexts: { runtime: { name: "node" } },
    });
    const [first, second] = scrubbed.exception?.values ?? [];
    expect(first.type).toBe("TypeError");
    expect(first.value).toBeUndefined();
    expect(first.stacktrace?.frames?.[0]).toMatchObject({
      filename: "app:///src/server/action.ts",
      function: "serverAction",
      lineno: 12,
    });
    // A Curio code says nothing about anyone, and names the failure.
    expect(second.value).toBe("UNAVAILABLE");
  });

  it("UT-ERR-02 prefers the proxy's request id to a copy of the client's header", () => {
    const event = everything();
    event.tags = { request_id: REQUEST_ID };
    event.request!.headers![REQUEST_ID_HEADER] =
      "7d2c1b0a-9e8f-4a6b-8c5d-3e2f1a0b9c8d";
    expect(scrubEvent(event).tags).toEqual({ request_id: REQUEST_ID });
  });

  it("UT-ERR-02 keeps only a request id the proxy could have made", () => {
    const event = everything();
    event.request!.headers![REQUEST_ID_HEADER] = "ana@example.com";
    expect(scrubEvent(event).tags).not.toHaveProperty("request_id");
  });
});
