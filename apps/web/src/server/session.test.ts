// @vitest-environment node
// currentUser(), which server components and data access functions use to check the user again.
import { cookies } from "next/headers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  claims,
  cookieJar,
  es256Token,
  fakeNetwork,
  pinTheClock,
  sessionCookie,
  signedIn,
  USER_ID,
  useSupabaseSettings,
} from "../../test/fake-supabase";
import { currentUser } from "./session";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));

describe("currentUser()", () => {
  beforeEach(() => {
    pinTheClock();
    useSupabaseSettings();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

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
