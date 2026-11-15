// @vitest-environment node
// WEB-ACT-05: each backend error code becomes its message from packages/contracts (UT-ERR-01),
// whether an RPC function or an Edge Function raised it, and nothing else a failure carries gets
// through (open question 38).
import {
  ERROR_CODES,
  ERROR_MESSAGES,
  HTTP_STATUS,
  type ErrorCode,
} from "@curio/contracts";
import { cookies } from "next/headers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cookieJar,
  fakeNetwork,
  pinTheClock,
  redirectTarget,
  signedIn,
  useSupabaseSettings,
} from "../../test/fake-supabase";
import { action, noInput, SIGN_IN_PATH } from "./action";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));

const callers = {
  "an RPC function": action({
    input: noInput,
    run: ({ backend }) => backend.rpc("health", {}),
  }),
  "an Edge Function": action({
    input: noInput,
    run: ({ backend }) => backend.edgeFunction("verification/start", {}),
  }),
};
type Via = keyof typeof callers;
const vias = Object.keys(callers) as Via[];

/** Calls the backend through `via`, which answers with `answer`. */
async function failWith(via: Via, answer: () => Response | Promise<Response>) {
  const session = await signedIn();
  vi.mocked(cookies).mockResolvedValue(cookieJar([session.cookie]) as never);
  const route = via === "an RPC function" ? "rpc" : "edgeFunction";
  fakeNetwork({ keys: session.keys, [route]: answer });
  try {
    return await callers[via]();
  } catch (error) {
    return { redirect: redirectTarget(error) };
  }
}

/** The body PostgREST and the Edge Functions' helper send for a Curio error (spec §14.4). */
function curioError(code: ErrorCode, details: string | null = null) {
  return Response.json(
    { code: `PT${HTTP_STATUS[code]}`, message: code, details, hint: null },
    { status: HTTP_STATUS[code] },
  );
}

describe("WEB-ACT-05 each backend error code", () => {
  beforeEach(() => {
    pinTheClock();
    useSupabaseSettings();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it.each(vias.flatMap((via) => ERROR_CODES.map((code) => [via, code])))(
    "WEB-ACT-05 %s raising %s shows its message",
    async (via, code) => {
      expect(
        await failWith(via as Via, () => curioError(code as ErrorCode)),
      ).toEqual({
        ok: false,
        code,
        message: ERROR_MESSAGES[code as ErrorCode],
        fields: {},
      });
    },
  );

  it.each(vias)(
    "WEB-ACT-05 INVALID_INPUT from %s puts each field's message next to it",
    async (via) => {
      const details = JSON.stringify({
        display_name: "too_long",
        bio: "invalid",
      });
      expect(
        await failWith(via, () => curioError("INVALID_INPUT", details)),
      ).toEqual({
        ok: false,
        code: "INVALID_INPUT",
        message: "Check the highlighted fields",
        fields: { display_name: "This is too long", bio: "Check this" },
      });
    },
  );

  it.each(vias)(
    "WEB-ACT-05 a 401 from %s sends the caller to sign in, whatever its body says",
    async (via) => {
      for (const body of [
        { code: "PGRST303", message: "JWT expired" },
        { code: "PT403", message: "NOT_VERIFIED" },
      ])
        expect(
          await failWith(via, () => Response.json(body, { status: 401 })),
        ).toEqual({ redirect: SIGN_IN_PATH });
    },
  );

  const unexpected: [string, () => Response | Promise<Response>, string][] = [
    [
      "a unique-key error, which repeats the value",
      () =>
        Response.json(
          {
            code: "23505",
            message: 'duplicate key value violates unique constraint "x"',
            details: "Key (email)=(ana@example.com) already exists.",
            hint: null,
          },
          { status: 409 },
        ),
      "ana@example.com",
    ],
    [
      "a value PostgREST can't convert, which it repeats",
      () =>
        Response.json(
          {
            code: "22P02",
            message: 'invalid input syntax for type uuid: "Ana Smith"',
            details: null,
            hint: null,
          },
          { status: 400 },
        ),
      "Ana Smith",
    ],
    [
      "a code's name without its status, as any message could say",
      () => Response.json({ code: "P0001", message: "FULL" }, { status: 400 }),
      "P0001",
    ],
    [
      "a gateway's HTML page",
      () => new Response("<html>Bad gateway at db-7</html>", { status: 502 }),
      "db-7",
    ],
    [
      "a network failure",
      () => {
        throw new TypeError("fetch failed: connect ECONNREFUSED 10.0.0.7");
      },
      "10.0.0.7",
    ],
  ];

  it.each(
    vias.flatMap((via) =>
      unexpected.map(([what, answer, leak]) => [via, what, answer, leak]),
    ),
  )(
    "WEB-ACT-05 %s failing with %s is UNAVAILABLE, and none of its text comes back",
    async (via, _what, answer, leak) => {
      const result = await failWith(
        via as Via,
        answer as () => Response | Promise<Response>,
      );
      expect(result).toEqual({
        ok: false,
        code: "UNAVAILABLE",
        message: ERROR_MESSAGES.UNAVAILABLE,
        fields: {},
      });
      expect(JSON.stringify(result)).not.toContain(leak as string);
    },
  );

  it("WEB-ACT-05 an Edge Function the relay couldn't reach is UNAVAILABLE", async () => {
    const result = await failWith(
      "an Edge Function",
      () =>
        new Response("relay failed", {
          status: 502,
          headers: { "x-relay-error": "true" },
        }),
    );
    expect(result).toMatchObject({ ok: false, code: "UNAVAILABLE" });
  });
});
