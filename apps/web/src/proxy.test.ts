// @vitest-environment node
// WEB-ACT-11: proxy.ts refreshes the session cookie, never allows or blocks a page by itself,
// and skips static files (proxy-matcher.test.ts).
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
    // The page about to render sees the new session too.
    expect(
      decodeSession(request.cookies.get(COOKIE_NAME)!.value).access_token,
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

  it("WEB-ACT-11 passes requests on untouched without the Supabase settings, or with ones that won't work", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    expectPassedOn(await proxy(requestWith()));

    const session = await signedIn();
    useSupabaseSettings();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "not-a-url");
    expectPassedOn(await proxy(requestWith(session.cookie)));
  });
});
