// @vitest-environment node
// The session cookie's settings (spec §13.2): Secure everywhere but the local stack, so a typo in
// a hosted project's address can't drop it.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  sessionCookieOptions,
  SUPABASE_TIMEOUT_MS,
  supabaseFetch,
} from "./supabase-settings";

describe("sessionCookieOptions()", () => {
  it("is HttpOnly and SameSite=Lax for the whole site", () => {
    expect(
      sessionCookieOptions("https://abcdefghijklmnopqrst.supabase.co"),
    ).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
    });
  });

  it.each([
    "https://abcdefghijklmnopqrst.supabase.co",
    "HTTPS://abcdefghijklmnopqrst.supabase.co",
    " https://abcdefghijklmnopqrst.supabase.co",
    "http://abcdefghijklmnopqrst.supabase.co",
    "http://127.0.0.1.example.com:54321",
    "not a url",
  ])("is Secure for %j", (url) => {
    expect(sessionCookieOptions(url).secure).toBe(true);
  });

  it.each([
    "http://127.0.0.1:54321",
    "http://localhost:54321",
    "http://[::1]:54321",
    "HTTP://127.0.0.1:54321",
  ])("isn't Secure for the local stack at %j", (url) => {
    expect(sessionCookieOptions(url).secure).toBe(false);
  });
});

describe("supabaseFetch()", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** fetch that never answers until its request is aborted. */
  function hangingFetch() {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) =>
            init?.signal?.addEventListener("abort", () =>
              reject(init.signal!.reason),
            ),
          ),
      ),
    );
  }

  it("gives up on a call to Supabase after 15 seconds (spec §14.4)", async () => {
    vi.useFakeTimers();
    hangingFetch();
    expect(SUPABASE_TIMEOUT_MS).toBe(15_000);
    const call = supabaseFetch(
      "https://abcdefghijklmnopqrst.supabase.co/rest/v1/rpc/health",
    );
    const outcome = call.then(
      () => "answered",
      (error: DOMException) => error.name,
    );
    await vi.advanceTimersByTimeAsync(SUPABASE_TIMEOUT_MS - 1);
    expect(
      await Promise.race([outcome, Promise.resolve("still waiting")]),
    ).toBe("still waiting");
    await vi.advanceTimersByTimeAsync(1);
    expect(await outcome).toBe("TimeoutError");
  });

  it("leaves no timer behind once Supabase answers", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(true)),
    );
    expect(await (await supabaseFetch("https://x.supabase.co/")).json()).toBe(
      true,
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it("still stops when the caller's own signal does", async () => {
    hangingFetch();
    const caller = new AbortController();
    const call = supabaseFetch("https://x.supabase.co/", {
      signal: caller.signal,
    });
    caller.abort(new DOMException("Stopped.", "AbortError"));
    await expect(call).rejects.toMatchObject({ name: "AbortError" });
  });
});
