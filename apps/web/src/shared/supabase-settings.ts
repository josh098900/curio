// The Supabase values the web app holds and the session cookie's settings, shared by the data
// access layer (src/server) and src/proxy.ts. Both values are public (spec §13.3): anything
// secret belongs in an Edge Function.

export type SupabaseSettings = { url: string; publishableKey: string };

/** The project's address and publishable key, or null when either isn't set. */
export function supabaseSettings(): SupabaseSettings | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) return null;
  return { url, publishableKey };
}

/**
 * The session cookie (spec §13.2, decided on 15 November):
 * - HttpOnly, so page scripts can't read the session and a script injected into a page can't
 *   take the refresh token with it;
 * - Secure, except for the local stack: plain HTTP on a loopback address, whose cookie never
 *   leaves the machine. Anything else, a hosted project or an address that won't parse, gets it;
 * - SameSite=Lax, so a link from another site still arrives signed in, while another site's
 *   form posts don't carry it.
 */
/** How long the web server waits for Supabase: Auth, the Data API or an Edge Function (spec §14.4). */
export const SUPABASE_TIMEOUT_MS = 15_000;

/**
 * fetch for the Supabase clients, giving up after SUPABASE_TIMEOUT_MS, so a call that hangs
 * becomes UNAVAILABLE instead of holding the request. Supabase's libraries see the abort as a
 * network failure.
 */
export async function supabaseFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const timeout = new AbortController();
  const timer = setTimeout(
    () =>
      timeout.abort(
        new DOMException("Supabase didn't answer in time.", "TimeoutError"),
      ),
    SUPABASE_TIMEOUT_MS,
  );
  const signal = init?.signal
    ? AbortSignal.any([init.signal, timeout.signal])
    : timeout.signal;
  try {
    return await fetch(input, { ...init, signal });
  } finally {
    clearTimeout(timer);
  }
}

/** What withinSupabaseTimeout() gives back when the work took too long. */
export const TIMED_OUT = Symbol("timed out");

/**
 * Waits SUPABASE_TIMEOUT_MS in all for work that may make several calls to Supabase. getClaims()
 * is one: refreshing a session, supabase-js retries a failed refresh for up to 30 seconds, waiting
 * longer between each try, so supabaseFetch's timeout on each call doesn't bound it. The work
 * isn't cancelled, only no longer waited for.
 */
export async function withinSupabaseTimeout<T>(
  work: Promise<T>,
): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), SUPABASE_TIMEOUT_MS);
  });
  try {
    return await Promise.race([work, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

/** Whether this is the local stack: plain HTTP on a loopback address. */
export function isLocalStack(supabaseUrl: string): boolean {
  try {
    const { protocol, hostname } = new URL(supabaseUrl);
    return (
      protocol === "http:" &&
      ["127.0.0.1", "localhost", "[::1]"].includes(hostname)
    );
  } catch {
    return false;
  }
}

export function sessionCookieOptions(supabaseUrl: string) {
  return {
    httpOnly: true,
    secure: !isLocalStack(supabaseUrl),
    sameSite: "lax",
    path: "/",
  } as const;
}
