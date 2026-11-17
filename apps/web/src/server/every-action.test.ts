// @vitest-environment node
// WEB-ACT-01, 02 and 04, for every server action. The actions are found, not listed: each
// src/features/<feature>/actions.ts is imported, every export must be made by action(), and each
// one is checked, so a new action is covered with no new test code (T13's Done when). Lint keeps
// "use server" to those files, so no action can sit anywhere else.
import { existsSync, globSync } from "node:fs";
import path from "node:path";
import { cookies } from "next/headers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  claims,
  cookieJar,
  es256Token,
  fakeNetwork,
  hs256Token,
  pinTheClock,
  redirectTarget,
  refreshRefused,
  refused,
  sessionCookie,
  signedIn,
  signingKey,
  SUPABASE_URL,
  tampered,
  unsignedToken,
  useSupabaseSettings,
} from "../../test/fake-supabase";
import { action, isServerAction, noInput, type ServerAction } from "./action";
import { SIGN_IN_PATH } from "@/shared/navigation";

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
  headers: vi.fn(async () => new Headers()),
}));

const webRoot = path.resolve(import.meta.dirname, "../..");

/** Every export of every src/features/<feature>/actions.ts under `root`. */
async function findServerActions(root: string) {
  const found: { name: string; value: unknown }[] = [];
  for (const file of globSync("src/features/*/actions.ts", {
    cwd: root,
  }).sort()) {
    const exports = await import(path.join(root, file));
    for (const [name, value] of Object.entries(exports))
      found.push({ name: `${file} ${name}`, value });
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

type Cookie = { name: string; value: string };
type Routes = Parameters<typeof fakeNetwork>[0];

/** Calls the action with this cookie and input, and reports where it went and what it called. */
async function attempt(
  serverAction: ServerAction<unknown>,
  cookie: Cookie | null,
  input: unknown,
  routes: Routes,
) {
  vi.mocked(cookies).mockResolvedValue(
    cookieJar(cookie ? [cookie] : []) as never,
  );
  const network = fakeNetwork(routes);
  try {
    const result = await serverAction(input);
    return { redirect: null, result, backendCalls: network.backendCalls() };
  } catch (error) {
    const target = redirectTarget(error);
    if (target === null) throw error;
    return { redirect: target, backendCalls: network.backendCalls() };
  }
}

/** What WEB-ACT-01, 02 and 04 find wrong with an action, as one line each. */
async function problemsWith(serverAction: ServerAction<unknown>) {
  const problems: string[] = [];
  const session = await signedIn();
  const attacker = await signingKey();
  const expired = claims({ exp: Math.floor(Date.now() / 1000) - 60 });
  const expiredCookie = sessionCookie(await es256Token(session.key, expired), {
    expiresAt: expired.exp as number,
  });

  // WEB-ACT-01: no session at all.
  const signedOut = await attempt(serverAction, null, undefined, {
    keys: session.keys,
  });
  if (signedOut.redirect !== SIGN_IN_PATH)
    problems.push("WEB-ACT-01 no session: not sent to sign in");
  if (signedOut.backendCalls.length)
    problems.push("WEB-ACT-01 no session: called the backend");

  // WEB-ACT-02: a session that getClaims() refuses.
  const deadSessions: [string, Cookie, Routes][] = [
    [
      "a token signed by another key",
      sessionCookie(await es256Token(attacker, claims(), session.key.jwk.kid)),
      { keys: session.keys },
    ],
    [
      "a token whose claims were changed",
      sessionCookie(
        tampered(session.accessToken, claims({ sub: crypto.randomUUID() })),
      ),
      { keys: session.keys },
    ],
    [
      "an HS256 token Auth doesn't recognise",
      sessionCookie(await hs256Token(claims())),
      { keys: session.keys, user: refused },
    ],
    [
      "a token whose payload isn't JSON",
      sessionCookie(
        unsignedToken(
          { alg: "ES256", typ: "JWT", kid: session.key.jwk.kid },
          "not json",
        ),
      ),
      { keys: session.keys },
    ],
    [
      "a token claiming no algorithm",
      sessionCookie(
        unsignedToken(
          { alg: "none", typ: "JWT", kid: session.key.jwk.kid },
          JSON.stringify(claims()),
        ),
      ),
      { keys: session.keys },
    ],
    [
      "a token claiming an algorithm its key doesn't fit",
      sessionCookie(
        unsignedToken(
          { alg: "RS256", typ: "JWT", kid: session.key.jwk.kid },
          JSON.stringify(claims()),
        ),
      ),
      { keys: session.keys },
    ],
    [
      "an expired token whose refresh token was revoked",
      expiredCookie,
      { keys: session.keys, token: refreshRefused("refresh_token_not_found") },
    ],
    [
      "an expired token whose session has timed out",
      expiredCookie,
      { keys: session.keys, token: refreshRefused("session_expired") },
    ],
  ];
  for (const [description, cookie, routes] of deadSessions) {
    const dead = await attempt(serverAction, cookie, undefined, routes);
    if (dead.redirect !== SIGN_IN_PATH)
      problems.push(`WEB-ACT-02 ${description}: not refused`);
    if (dead.backendCalls.length)
      problems.push(`WEB-ACT-02 ${description}: called the backend`);
  }

  // WEB-ACT-04: a real session, and input no action accepts.
  const invalid = await attempt(serverAction, session.cookie, 42, {
    keys: session.keys,
  });
  const result = invalid.result as
    { ok: boolean; code?: string; fields?: object } | undefined;
  if (
    result?.ok !== false ||
    result.code !== "INVALID_INPUT" ||
    Object.keys(result.fields ?? {}).length === 0
  )
    problems.push("WEB-ACT-04 invalid input: not refused with field errors");
  if (invalid.backendCalls.length)
    problems.push("WEB-ACT-04 invalid input: called the backend");
  return problems;
}

/** An action that skips every check, to show the checks catch it. */
const careless = (async () => {
  await fetch(`${SUPABASE_URL}/rest/v1/rpc/health`, { method: "POST" });
  return { ok: true, data: true };
}) as unknown as ServerAction<unknown>;

const everyProblem = [
  "WEB-ACT-01 no session: not sent to sign in",
  "WEB-ACT-01 no session: called the backend",
  "WEB-ACT-02 a token signed by another key: not refused",
  "WEB-ACT-02 a token signed by another key: called the backend",
  "WEB-ACT-02 a token whose claims were changed: not refused",
  "WEB-ACT-02 a token whose claims were changed: called the backend",
  "WEB-ACT-02 an HS256 token Auth doesn't recognise: not refused",
  "WEB-ACT-02 an HS256 token Auth doesn't recognise: called the backend",
  "WEB-ACT-02 a token whose payload isn't JSON: not refused",
  "WEB-ACT-02 a token whose payload isn't JSON: called the backend",
  "WEB-ACT-02 a token claiming no algorithm: not refused",
  "WEB-ACT-02 a token claiming no algorithm: called the backend",
  "WEB-ACT-02 a token claiming an algorithm its key doesn't fit: not refused",
  "WEB-ACT-02 a token claiming an algorithm its key doesn't fit: called the backend",
  "WEB-ACT-02 an expired token whose refresh token was revoked: not refused",
  "WEB-ACT-02 an expired token whose refresh token was revoked: called the backend",
  "WEB-ACT-02 an expired token whose session has timed out: not refused",
  "WEB-ACT-02 an expired token whose session has timed out: called the backend",
  "WEB-ACT-04 invalid input: not refused with field errors",
  "WEB-ACT-04 invalid input: called the backend",
];

describe("every server action", () => {
  beforeEach(() => {
    pinTheClock();
    useSupabaseSettings();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("finds the actions files and their exports on its own", async () => {
    const found = await findServerActions(
      path.join(webRoot, "test/fixtures/actions"),
    );
    expect(
      found.map(({ name, value }) => `${name}: ${isServerAction(value)}`),
    ).toEqual([
      "src/features/demo/actions.ts unwrapped: false",
      "src/features/demo/actions.ts wrapped: true",
    ]);
  });

  it("every export of every actions file is made by action()", async () => {
    // The app's own features folder, so the search can't pass by looking in the wrong place.
    expect(existsSync(path.join(webRoot, "src/features"))).toBe(true);
    const found = await findServerActions(webRoot);
    expect(
      found
        .filter(({ value }) => !isServerAction(value))
        .map(({ name }) => name),
    ).toEqual([]);
  });

  // Each ID gets its own tests, so a failure points straight back to the specification.
  describe.each(["WEB-ACT-01", "WEB-ACT-02", "WEB-ACT-04"])("%s", (id) => {
    const lines = (problems: string[]) =>
      problems.filter((line) => line.startsWith(`${id} `));

    it(`${id} catches an action that skips the checks`, async () => {
      expect(lines(await problemsWith(careless))).toEqual(lines(everyProblem));
    });

    it(`${id} passes an action made by action()`, async () => {
      const made = action({
        input: noInput,
        run: ({ backend }) => backend.rpc("health", {}),
      });
      expect(lines(await problemsWith(made))).toEqual([]);
    });

    it(`${id} holds for every server action in the app`, async () => {
      const problems: Record<string, string[]> = {};
      for (const { name, value } of await findServerActions(webRoot)) {
        if (!isServerAction(value)) continue;
        const found = lines(await problemsWith(value));
        if (found.length) problems[name] = found;
      }
      expect(problems).toEqual({});
    });
  });
});
