// @vitest-environment node
// WEB-ACT-11: proxy.ts refreshes the session cookie, never allows or blocks a page by itself,
// and skips static files (proxy-matcher.test.ts). WEB-ACT-12: it gives every page a CSP with a new
// nonce, which the page sees too.
import { NextRequest, type NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  claims,
  COOKIE_NAME,
  es256Token,
  fakeNetwork,
  hangs,
  pinTheClock,
  refreshedSession,
  refreshRefused,
  sessionCookie,
  signedIn,
  signingKey,
  useSupabaseSettings,
} from "../test/fake-supabase";
import { proxy } from "./proxy";
import { SUPABASE_TIMEOUT_MS } from "./shared/supabase-settings";

function requestWith(cookie?: { name: string; value: string }) {
  return new NextRequest("https://curio.example/plans", {
    headers: cookie ? { cookie: `${cookie.name}=${cookie.value}` } : {},
  });
}

/** The request goes on to its page, unchanged: no redirect, rewrite or error. */
function expectPassedOn(response: NextResponse) {
  expect(response.status).toBe(200);
  expect(response.headers.get("x-middleware-next")).toBe("1");
  expect(response.headers.has("location")).toBe(false);
  expect(response.headers.has("x-middleware-rewrite")).toBe(false);
}

function decodeSession(value: string) {
  return JSON.parse(
    Buffer.from(value.replace(/^base64-/, ""), "base64url").toString(),
  );
}

describe("WEB-ACT-11 proxy.ts", () => {
  beforeEach(() => {
    pinTheClock();
    useSupabaseSettings();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("WEB-ACT-11 refreshes an expiring session, for the page and the browser", async () => {
    const key = await signingKey();
    const past = Math.floor(Date.now() / 1000) - 60;
    const old = sessionCookie(await es256Token(key, claims({ exp: past })), {
      expiresAt: past,
    });
    const fresh = await es256Token(key, claims());
    fakeNetwork({
      keys: [key.jwk],
      token: () => Response.json(refreshedSession(fresh)),
    });

    const request = requestWith(old);
    const response = await proxy(request);

    expectPassedOn(response);
    const cookie = response.cookies.get(COOKIE_NAME);
    expect(decodeSession(cookie!.value).access_token).toBe(fresh);
    expect(cookie).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
    });
    // The page about to render sees the new session too, in the request headers Next passes on.
    const forwarded = new NextRequest("https://curio.example/", {
      headers: { cookie: response.headers.get("x-middleware-request-cookie")! },
    });
    expect(
      decodeSession(forwarded.cookies.get(COOKIE_NAME)!.value).access_token,
    ).toBe(fresh);
    // So no CDN keeps one person's session for another.
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("WEB-ACT-11 never allows or blocks a page by itself", async () => {
    const session = await signedIn();
    const past = Math.floor(Date.now() / 1000) - 60;
    const cases: [
      string,
      { name: string; value: string } | undefined,
      Parameters<typeof fakeNetwork>[0],
    ][] = [
      ["signed out", undefined, {}],
      ["signed in", session.cookie, { keys: session.keys }],
      [
        "a forged session",
        sessionCookie(
          await es256Token(await signingKey(), claims(), session.key.jwk.kid),
        ),
        { keys: session.keys },
      ],
      [
        "a session whose refresh is refused",
        sessionCookie(await es256Token(session.key, claims({ exp: past })), {
          expiresAt: past,
        }),
        {
          keys: session.keys,
          token: refreshRefused("refresh_token_not_found"),
        },
      ],
    ];
    for (const [, cookie, routes] of cases) {
      fakeNetwork(routes);
      expectPassedOn(await proxy(requestWith(cookie)));
    }

    // Nor when Auth can't be reached at all.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    expectPassedOn(await proxy(requestWith(session.cookie)));
  });

  it("WEB-ACT-11 passes the request on after 15 seconds in all when a refresh hangs, retries included", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date("2027-01-10T12:00:00Z"));
    const key = await signingKey();
    const past = Math.floor(Date.now() / 1000) - 60;
    fakeNetwork({ keys: [key.jwk], token: hangs });
    let response: NextResponse | undefined;
    const pending = proxy(
      requestWith(
        sessionCookie(await es256Token(key, claims({ exp: past })), {
          expiresAt: past,
        }),
      ),
    ).then((answer) => (response = answer));
    await vi.advanceTimersByTimeAsync(SUPABASE_TIMEOUT_MS - 1);
    expect(response).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expectPassedOn(response!);
  });

  it("WEB-ACT-11 passes requests on without the Supabase settings, or with ones that won't work", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    expectPassedOn(await proxy(requestWith()));

    const session = await signedIn();
    useSupabaseSettings();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "not-a-url");
    expectPassedOn(await proxy(requestWith(session.cookie)));
  });
});

describe("WEB-ACT-12 proxy.ts's Content Security Policy", () => {
  beforeEach(() => {
    pinTheClock();
    useSupabaseSettings();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  function nonceOf(policy: string | null) {
    return /'nonce-([^']+)'/.exec(policy ?? "")?.[1];
  }

  it("WEB-ACT-12 every page gets a CSP with a new nonce, which the page sees too, so Next can stamp it", async () => {
    fakeNetwork();
    const first = await proxy(requestWith());
    const second = await proxy(requestWith());
    const policy = first.headers.get("content-security-policy");
    expect(nonceOf(policy)).toBeTruthy();
    expect(nonceOf(second.headers.get("content-security-policy"))).not.toBe(
      nonceOf(policy),
    );
    // Next reads the nonce from the CSP on the request, and pages can read it as x-nonce.
    expect(
      first.headers.get("x-middleware-request-content-security-policy"),
    ).toBe(policy);
    expect(first.headers.get("x-middleware-request-x-nonce")).toBe(
      nonceOf(policy),
    );
    expectPassedOn(first);
  });

  it("WEB-ACT-12 a client's own CSP or nonce headers never reach the page", async () => {
    fakeNetwork();
    const response = await proxy(
      new NextRequest("https://curio.example/plans", {
        headers: {
          "content-security-policy": "script-src 'nonce-attacker'",
          "content-security-policy-report-only": "script-src 'nonce-attacker'",
          "x-nonce": "attacker",
        },
      }),
    );
    const policy = response.headers.get("content-security-policy");
    expect(
      response.headers.get("x-middleware-request-content-security-policy"),
    ).toBe(policy);
    expect(response.headers.get("x-middleware-request-x-nonce")).toBe(
      nonceOf(policy),
    );
    expect(nonceOf(policy)).not.toBe("attacker");
    expect(
      response.headers.has(
        "x-middleware-request-content-security-policy-report-only",
      ),
    ).toBe(false);
    // Next passes the page only the headers this list names, so the report-only one is dropped.
    expect(
      response.headers.get("x-middleware-override-headers")!.split(","),
    ).not.toContain("content-security-policy-report-only");
  });

  it("WEB-ACT-12 the CSP is there whatever happens to the session", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    expect(
      nonceOf(
        (await proxy(requestWith())).headers.get("content-security-policy"),
      ),
    ).toBeTruthy();

    useSupabaseSettings();
    const session = await signedIn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    expect(
      nonceOf(
        (await proxy(requestWith(session.cookie))).headers.get(
          "content-security-policy",
        ),
      ),
    ).toBeTruthy();
  });
});
