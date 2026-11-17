// Fakes for Supabase's Auth, Data API and Edge Functions, so the session and server action tests
// run the real @supabase/ssr and supabase-js code with nothing on the network. Tokens are signed
// here with WebCrypto, the way Supabase's asymmetric signing keys sign them.
import { vi } from "vitest";

export const SUPABASE_URL = "https://abcdefghijklmnopqrst.supabase.co";
export const PUBLISHABLE_KEY = "sb_publishable_test";
/** @supabase/ssr's cookie name for the project above. */
export const COOKIE_NAME = "sb-abcdefghijklmnopqrst-auth-token";
export const USER_ID = "4b1e2f0a-5c3d-4e6f-8a9b-0c1d2e3f4a5b";

/** The time every test pins (test specification §1): Sunday 10 January 2027, 12:00 UTC. */
export const NOW = new Date("2027-01-10T12:00:00Z");
const nowSeconds = Math.floor(NOW.getTime() / 1000);

export function pinTheClock() {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
}

export function useSupabaseSettings() {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", PUBLISHABLE_KEY);
}

const base64url = (value: string | ArrayBuffer) =>
  Buffer.from(
    typeof value === "string" ? value : new Uint8Array(value),
  ).toString("base64url");

export type SigningKey = {
  privateKey: CryptoKey;
  jwk: JsonWebKey & { kid: string };
};

/** A P-256 signing key with a fresh key id, so supabase-js's key cache never mixes up tests. */
export async function signingKey(): Promise<SigningKey> {
  const { privateKey, publicKey } = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const jwk = await crypto.subtle.exportKey("jwk", publicKey);
  return {
    privateKey,
    jwk: { ...jwk, kid: crypto.randomUUID(), alg: "ES256", use: "sig" },
  };
}

export function claims(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    iss: `${SUPABASE_URL}/auth/v1`,
    sub: USER_ID,
    aud: "authenticated",
    role: "authenticated",
    iat: nowSeconds - 60,
    exp: nowSeconds + 3600,
    session_id: "5d6e7f80-9a0b-4c1d-8e2f-3a4b5c6d7e8f",
    is_anonymous: false,
    ...overrides,
  };
}

/** An ES256 token, signed by `key` and naming `kid` as its key. */
export async function es256Token(
  key: SigningKey,
  payload: Record<string, unknown>,
  kid = key.jwk.kid,
): Promise<string> {
  const header = { alg: "ES256", typ: "JWT", kid };
  const signed = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key.privateKey,
    new TextEncoder().encode(signed),
  );
  return `${signed}.${base64url(signature)}`;
}

/** An HS256 token signed with a secret nobody else has. */
export async function hs256Token(
  payload: Record<string, unknown>,
): Promise<string> {
  const secret = await crypto.subtle.generateKey(
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = `${base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${base64url(JSON.stringify(payload))}`;
  const signature = await crypto.subtle.sign(
    "HMAC",
    secret,
    new TextEncoder().encode(signed),
  );
  return `${signed}.${base64url(signature)}`;
}

/** A token with any header and payload text and a meaningless signature. */
export function unsignedToken(
  header: Record<string, unknown>,
  payload: string,
): string {
  return `${base64url(JSON.stringify(header))}.${base64url(payload)}.${base64url("signature")}`;
}

/** Swaps a signed token's payload, keeping its header and signature. */
export function tampered(
  token: string,
  payload: Record<string, unknown>,
): string {
  const [header, , signature] = token.split(".");
  return `${header}.${base64url(JSON.stringify(payload))}.${signature}`;
}

/** The session cookie @supabase/ssr writes, for a session holding these tokens. */
export function sessionCookie(
  accessToken: string,
  { refreshToken = "refresh-token-1", expiresAt = nowSeconds + 3600 } = {},
): { name: string; value: string } {
  const session = {
    access_token: accessToken,
    token_type: "bearer",
    expires_in: expiresAt - nowSeconds,
    expires_at: expiresAt,
    refresh_token: refreshToken,
    user: { id: USER_ID, aud: "authenticated", role: "authenticated" },
  };
  return {
    name: COOKIE_NAME,
    value: `base64-${base64url(JSON.stringify(session))}`,
  };
}

/** A signed-in session: its key, its access token, its cookie and the key set Auth publishes. */
export async function signedIn() {
  const key = await signingKey();
  const accessToken = await es256Token(key, claims());
  return {
    key,
    accessToken,
    cookie: sessionCookie(accessToken),
    keys: [key.jwk],
  };
}

/** A fresh session from Auth's token endpoint, as a refresh returns it. */
export function refreshedSession(accessToken: string) {
  return {
    access_token: accessToken,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: nowSeconds + 3600,
    refresh_token: "refresh-token-2",
    user: { id: USER_ID, aud: "authenticated", role: "authenticated" },
  };
}

export type FakeCall = {
  method: string;
  path: string;
  authorization: string | null;
  /** The x-request-id it carried (spec §14.3). */
  requestId: string | null;
  body: string;
};

type Responder = (
  call: FakeCall,
  request: Request,
  /** The caller's own signal. A Request's copy can miss the abort once garbage is collected. */
  signal: AbortSignal | undefined,
) => Response | Promise<Response>;

/** A route that never answers, until the request is aborted. */
export const hangs: Responder = (_call, request, signal = request.signal) =>
  new Promise((_resolve, reject) =>
    signal.addEventListener("abort", () => reject(signal.reason)),
  );

export type FakeNetwork = {
  calls: FakeCall[];
  /** Calls to the Data API or an Edge Function: the backend calls a server action makes. */
  backendCalls(): FakeCall[];
};

/**
 * Replaces fetch for the test. Auth's key set, token endpoint and user endpoint answer as given;
 * the Data API and Edge Functions answer through `rpc` and `edgeFunction`, by default 200.
 */
export function fakeNetwork(
  routes: {
    keys?: JsonWebKey[];
    token?: Responder;
    user?: Responder;
    rpc?: Responder;
    edgeFunction?: Responder;
  } = {},
): FakeNetwork {
  const calls: FakeCall[] = [];
  const ok = () => Response.json(true);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      const call: FakeCall = {
        method: request.method,
        path: url.pathname + url.search,
        authorization: request.headers.get("authorization"),
        requestId: request.headers.get("x-request-id"),
        body: request.body ? await request.text() : "",
      };
      calls.push(call);
      if (url.origin !== SUPABASE_URL)
        throw new Error(`Unexpected request to ${url.origin}`);
      if (url.pathname === "/auth/v1/.well-known/jwks.json")
        return Response.json({ keys: routes.keys ?? [] });
      if (url.pathname === "/auth/v1/token")
        return (routes.token ?? refused)(
          call,
          request,
          init?.signal ?? undefined,
        );
      if (url.pathname === "/auth/v1/user")
        return (routes.user ?? refused)(
          call,
          request,
          init?.signal ?? undefined,
        );
      if (url.pathname.startsWith("/rest/v1/"))
        return (routes.rpc ?? ok)(call, request, init?.signal ?? undefined);
      if (url.pathname.startsWith("/functions/v1/"))
        return (routes.edgeFunction ?? ok)(
          call,
          request,
          init?.signal ?? undefined,
        );
      throw new Error(`Unexpected request to ${url.pathname}`);
    }),
  );
  return {
    calls,
    backendCalls: () =>
      calls.filter(
        ({ path }) =>
          path.startsWith("/rest/v1/") || path.startsWith("/functions/v1/"),
      ),
  };
}

/** Auth refusing a token or refresh token, as it does a forged, expired or revoked one. */
export function refused(): Response {
  return Response.json(
    {
      code: 403,
      error_code: "bad_jwt",
      msg: "invalid JWT: unable to parse or verify signature",
    },
    { status: 403 },
  );
}

export function refreshRefused(errorCode: string): Responder {
  return () =>
    Response.json(
      { code: 400, error_code: errorCode, msg: "Invalid Refresh Token" },
      { status: 400 },
    );
}

export type CookieJar = {
  getAll(): { name: string; value: string }[];
  set(name: string, value: string, options?: Record<string, unknown>): void;
  written: { name: string; value: string; options?: Record<string, unknown> }[];
};

/** What next/headers' cookies() returns, for a request carrying these cookies. */
export function cookieJar(
  initial: { name: string; value: string }[] = [],
): CookieJar {
  const jar = new Map(initial.map(({ name, value }) => [name, value]));
  const written: CookieJar["written"] = [];
  return {
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    set(name, value, options) {
      written.push({ name, value, options });
      if (value) jar.set(name, value);
      else jar.delete(name);
    },
    written,
  };
}

/** Where a redirect thrown by next/navigation sends the browser, or null for any other error. */
export function redirectTarget(error: unknown): string | null {
  const digest = (error as { digest?: unknown } | null)?.digest;
  if (typeof digest !== "string" || !digest.startsWith("NEXT_REDIRECT"))
    return null;
  return digest.split(";")[2] ?? null;
}
