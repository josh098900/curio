// @vitest-environment node
// How action() runs an action once the session is checked: the input, the one backend call, and
// what comes back. every-action.test.ts checks the session rules for every action in the app.
import { ERROR_MESSAGES } from "@curio/contracts";
import { getClient } from "@sentry/nextjs";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { SUPABASE_TIMEOUT_MS } from "@/shared/supabase-settings";
import {
  claims,
  cookieJar,
  es256Token,
  fakeNetwork,
  hangs,
  pinTheClock,
  redirectTarget,
  sessionCookie,
  signedIn,
  USER_ID,
  useSupabaseSettings,
} from "../../test/fake-supabase";
import {
  captureReports,
  REQUEST_ID,
  sentReports,
} from "../../test/fake-sentry";
import { action, noInput, type InputParser } from "./action";
import { SIGN_IN_PATH } from "@/shared/navigation";

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
  headers: vi.fn(async () => new Headers()),
}));

/** Runs the action signed in, and says where it went if it redirected. */
async function runSignedIn(
  serverAction: (input?: unknown) => Promise<unknown>,
  input?: unknown,
  routes: Parameters<typeof fakeNetwork>[0] = {},
) {
  const session = await signedIn();
  vi.mocked(cookies).mockResolvedValue(cookieJar([session.cookie]) as never);
  const network = fakeNetwork({ keys: session.keys, ...routes });
  try {
    return { result: await serverAction(input), network, session };
  } catch (error) {
    return { redirect: redirectTarget(error), error, network, session };
  }
}

const anId: InputParser<{ id: string }> = (raw) => {
  const id = (raw as { id?: unknown } | null)?.id;
  if (typeof id !== "string" || id === "")
    return { fields: { id: id === undefined ? "required" : "invalid" } };
  return { value: { id } };
};

beforeEach(() => {
  pinTheClock();
  useSupabaseSettings();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("action()", () => {
  it("runs with the signed-in user and the checked input, and returns what run returns", async () => {
    const run = vi.fn(async ({ user, input, backend }) => ({
      user: user.id,
      input,
      answer: await backend.rpc("health", {}),
    }));
    const { result } = await runSignedIn(action({ input: anId, run }), {
      id: "a1",
    });
    expect(result).toEqual({
      ok: true,
      data: { user: USER_ID, input: { id: "a1" }, answer: true },
    });
  });

  it("calls the backend as the signed-in user, so RLS and the function's checks apply", async () => {
    const { network, session } = await runSignedIn(
      action({
        input: noInput,
        run: ({ backend }) => backend.rpc("health", {}),
      }),
    );
    expect(network.backendCalls()).toEqual([
      expect.objectContaining({
        method: "POST",
        path: "/rest/v1/rpc/health",
        authorization: `Bearer ${session.accessToken}`,
      }),
    ]);
  });

  it("refuses invalid input with each field's message, without calling run", async () => {
    const run = vi.fn();
    const made = action({ input: anId, run });
    expect((await runSignedIn(made, {})).result).toEqual({
      ok: false,
      code: "INVALID_INPUT",
      message: "Check the highlighted fields",
      fields: { id: "Enter this" },
    });
    expect((await runSignedIn(made, { id: 7 })).result).toMatchObject({
      fields: { id: "Check this" },
    });
    expect(run).not.toHaveBeenCalled();
  });

  it("an action that takes nothing refuses anything it's given", async () => {
    const made = action({ input: noInput, run: async () => "done" });
    expect((await runSignedIn(made)).result).toEqual({
      ok: true,
      data: "done",
    });
    for (const given of [{}, "x", new FormData()])
      expect((await runSignedIn(made, given)).result).toMatchObject({
        code: "INVALID_INPUT",
        fields: { input: "Check this" },
      });
  });

  it("makes exactly one backend call: a second is refused before it's sent", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { result, network } = await runSignedIn(
      action({
        input: noInput,
        run: async ({ backend }) => {
          await backend.rpc("health", {});
          return backend.edgeFunction("verification/start");
        },
      }),
    );
    expect(result).toEqual({
      ok: false,
      code: "UNAVAILABLE",
      message: "Something went wrong. Please try again later",
      fields: {},
    });
    expect(network.backendCalls().map(({ path }) => path)).toEqual([
      "/rest/v1/rpc/health",
    ]);
  });

  it("a redirect from run goes through", async () => {
    const outcome = await runSignedIn(
      action({
        input: noInput,
        run: async () => redirect("/plans"),
      }),
    );
    expect(outcome.redirect).toBe("/plans");
  });

  it("a signed-out caller is sent to sign in, before the input is read", async () => {
    vi.mocked(cookies).mockResolvedValue(cookieJar() as never);
    fakeNetwork();
    const input = vi.fn(noInput);
    const outcome = await action({ input, run: async () => "done" })().catch(
      redirectTarget,
    );
    expect(outcome).toBe(SIGN_IN_PATH);
    expect(input).not.toHaveBeenCalled();
  });

  it("is UNAVAILABLE, not signed out, when Auth can't be reached", async () => {
    const session = await signedIn();
    vi.mocked(cookies).mockResolvedValue(cookieJar([session.cookie]) as never);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    const result = await action({ input: noInput, run: async () => "done" })();
    expect(result).toMatchObject({ ok: false, code: "UNAVAILABLE" });
  });

  it("is UNAVAILABLE when the backend doesn't answer within 15 seconds", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date("2027-01-10T12:00:00Z"));
    const session = await signedIn();
    vi.mocked(cookies).mockResolvedValue(cookieJar([session.cookie]) as never);
    const network = fakeNetwork({ keys: session.keys, rpc: hangs });
    const pending = action({
      input: noInput,
      run: ({ backend }) => backend.rpc("health", {}),
    })();
    await vi.waitFor(() => expect(network.backendCalls()).toHaveLength(1));
    await vi.advanceTimersByTimeAsync(SUPABASE_TIMEOUT_MS);
    expect(await pending).toMatchObject({ ok: false, code: "UNAVAILABLE" });
  });

  it.each([
    ["doesn't answer", hangs],
    [
      "keeps failing at once",
      () => new Response("Service unavailable", { status: 503 }),
    ],
  ])(
    "is UNAVAILABLE after 15 seconds in all, retries included, when Auth %s during a refresh",
    async (_, token) => {
      vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
      vi.setSystemTime(new Date("2027-01-10T12:00:00Z"));
      const session = await signedIn();
      const past = Math.floor(Date.now() / 1000) - 60;
      vi.mocked(cookies).mockResolvedValue(
        cookieJar([
          sessionCookie(await es256Token(session.key, claims({ exp: past })), {
            expiresAt: past,
          }),
        ]) as never,
      );
      fakeNetwork({ keys: session.keys, token });
      let result: unknown;
      const pending = action({
        input: noInput,
        run: async () => "done",
      })().then((answer) => (result = answer));
      // supabase-js would go on retrying for up to 30 seconds.
      await vi.advanceTimersByTimeAsync(SUPABASE_TIMEOUT_MS - 1);
      expect(result).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      await pending;
      expect(result).toMatchObject({ ok: false, code: "UNAVAILABLE" });
    },
  );

  it("is UNAVAILABLE without the Supabase settings", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.mocked(cookies).mockResolvedValue(cookieJar() as never);
    const result = await action({ input: noInput, run: async () => "done" })();
    expect(result).toMatchObject({ ok: false, code: "UNAVAILABLE" });
  });
});

describe("UT-ERR-02 a failure inside action()", () => {
  beforeAll(captureReports);
  beforeEach(() => {
    vi.mocked(headers).mockResolvedValue(
      new Headers({ "x-request-id": REQUEST_ID }) as never,
    );
  });

  it("UT-ERR-02 the server's Sentry collects nothing about the person", () => {
    expect(getClient()?.getDataCollectionOptions()).toMatchObject({
      userInfo: false,
      cookies: false,
      httpBodies: [],
      urlQueryParams: false,
      stackFrameVariables: false,
    });
  });

  it("UT-ERR-02 every Supabase call carries the request id", async () => {
    const { network } = await runSignedIn(
      action({
        input: noInput,
        run: ({ backend }) => backend.rpc("health", {}),
      }),
    );
    expect(network.calls.length).toBeGreaterThan(1);
    for (const call of network.calls) expect(call.requestId).toBe(REQUEST_ID);
  });

  it("UT-ERR-02 a bug in an action shows the generic message, and reaches Sentry with its type and stack, not its text", async () => {
    const { result } = await runSignedIn(
      action({
        input: noInput,
        run: async () => {
          throw new TypeError("Ana Smith's bio was too long");
        },
      }),
    );
    expect(result).toMatchObject({
      ok: false,
      code: "UNAVAILABLE",
      message: ERROR_MESSAGES.UNAVAILABLE,
    });
    const reports = await sentReports();
    expect(reports).toHaveLength(1);
    const [exception] = reports[0].exception?.values ?? [];
    expect(exception.type).toBe("TypeError");
    expect(exception.stacktrace?.frames?.length).toBeGreaterThan(0);
    expect(reports[0].tags).toMatchObject({ request_id: REQUEST_ID });
    // The log holds one line, with the error's kind but not its text.
    const logged = vi.mocked(console.error).mock.calls;
    expect(logged).toHaveLength(1);
    expect(JSON.parse(logged[0][0])).toMatchObject({
      level: "error",
      kind: "TypeError",
      request_id: REQUEST_ID,
    });
    expect(JSON.stringify([result, reports, logged])).not.toContain("Ana");
  });

  it("UT-ERR-02 a request id the proxy couldn't have made goes nowhere", async () => {
    vi.mocked(headers).mockResolvedValue(
      new Headers({ "x-request-id": "ana@example.com" }) as never,
    );
    const { network } = await runSignedIn(
      action({
        input: noInput,
        run: async () => {
          throw new TypeError("bug");
        },
      }),
    );
    const reports = await sentReports();
    expect(network.calls.every(({ requestId }) => requestId === null)).toBe(
      true,
    );
    expect(
      JSON.stringify([reports, vi.mocked(console.error).mock.calls]),
    ).not.toContain("ana@example.com");
  });

  it("UT-ERR-02 is UNAVAILABLE, not signed out, when Auth refuses a refresh for too many requests, and is reported", async () => {
    const session = await signedIn();
    const past = Math.floor(Date.now() / 1000) - 60;
    vi.mocked(cookies).mockResolvedValue(
      cookieJar([
        sessionCookie(await es256Token(session.key, claims({ exp: past })), {
          expiresAt: past,
        }),
      ]) as never,
    );
    fakeNetwork({
      keys: session.keys,
      token: () =>
        Response.json(
          { code: 429, error_code: "over_request_rate_limit", msg: "Too many" },
          { status: 429 },
        ),
    });
    const result = await action({ input: noInput, run: async () => "done" })();
    expect(result).toMatchObject({ ok: false, code: "UNAVAILABLE" });
    const reports = await sentReports();
    expect(reports).toHaveLength(1);
    expect(reports[0].exception?.values?.[0]).toMatchObject({
      type: "SessionCheckUnavailable",
      value: "UNAVAILABLE",
    });
  });
});
