// @vitest-environment node
// currentUser(), which server components and data access functions use to check the user again,
// and requireUser(), the AuthGuard for pages only signed-in people may see.
import { cookies } from "next/headers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  claims,
  cookieJar,
  es256Token,
  fakeNetwork,
  pinTheClock,
  redirectTarget,
  sessionCookie,
  signedIn,
  USER_ID,
  useSupabaseSettings,
} from "../../test/fake-supabase";
import { currentUser, requireUser } from "./session";

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
  headers: vi.fn(async () => new Headers()),
}));

beforeEach(() => {
  pinTheClock();
  useSupabaseSettings();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("currentUser()", () => {
  it("is the user, as a DTO holding their id only", async () => {
    const session = await signedIn();
    vi.mocked(cookies).mockResolvedValue(cookieJar([session.cookie]) as never);
    fakeNetwork({ keys: session.keys });
    expect(await currentUser()).toEqual({ id: USER_ID });
  });

  it("is null with no session, or one that isn't a signed-in user's", async () => {
    vi.mocked(cookies).mockResolvedValue(cookieJar() as never);
    fakeNetwork();
    expect(await currentUser()).toBeNull();

    const session = await signedIn();
    for (const odd of [
      claims({ role: "anon" }),
      claims({ sub: undefined }),
      claims({ is_anonymous: true }),
    ]) {
      vi.mocked(cookies).mockResolvedValue(
        cookieJar([sessionCookie(await es256Token(session.key, odd))]) as never,
      );
      fakeNetwork({ keys: session.keys });
      expect(await currentUser()).toBeNull();
    }
  });

  it("throws UNAVAILABLE when Auth can't be reached, rather than counting as signed out", async () => {
    const session = await signedIn();
    vi.mocked(cookies).mockResolvedValue(cookieJar([session.cookie]) as never);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    await expect(currentUser()).rejects.toThrow("UNAVAILABLE");
  });
});

describe("requireUser(), the AuthGuard", () => {
  async function whereTo(
    cookie: { name: string; value: string } | null,
    path: string,
  ) {
    vi.mocked(cookies).mockResolvedValue(
      cookieJar(cookie ? [cookie] : []) as never,
    );
    try {
      return { user: await requireUser(path) };
    } catch (error) {
      return { redirect: redirectTarget(error) };
    }
  }

  it("gives back the signed-in user", async () => {
    const session = await signedIn();
    fakeNetwork({ keys: session.keys });
    expect(await whereTo(session.cookie, "/plans")).toEqual({
      user: { id: USER_ID },
    });
  });

  it("sends someone with no session to sign in, to come back to where they were", async () => {
    fakeNetwork();
    expect(await whereTo(null, "/plans?tab=past")).toEqual({
      redirect: "/sign-in?next=%2Fplans%3Ftab%3Dpast",
    });
  });

  it("sends someone whose session stopped working to S56", async () => {
    const session = await signedIn();
    fakeNetwork({ keys: session.keys });
    const forged = sessionCookie(
      await es256Token((await signedIn()).key, claims(), session.key.jwk.kid),
    );
    expect(await whereTo(forged, "/plans")).toEqual({
      redirect: "/signed-out?next=%2Fplans",
    });
    expect(await whereTo({ name: forged.name, value: "" }, "/plans")).toEqual({
      redirect: "/signed-out?next=%2Fplans",
    });
  });

  it.each(["//evil.example", "/.//evil.example"])(
    "drops %s, which isn't a path on Curio itself",
    async (path) => {
      fakeNetwork();
      expect(await whereTo(null, path)).toEqual({ redirect: "/sign-in" });
    },
  );

  it("is UNAVAILABLE, not a redirect to sign in, when Auth can't be reached", async () => {
    const session = await signedIn();
    vi.mocked(cookies).mockResolvedValue(cookieJar([session.cookie]) as never);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    await expect(requireUser("/plans")).rejects.toThrow("UNAVAILABLE");
  });
});
