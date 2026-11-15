import "server-only";
import type { ErrorCode } from "@curio/contracts";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { createSupabase, type ServerSupabase } from "./supabase";

/** The signed-in user, as the rest of the app sees them: their id and nothing else. */
export type SessionUser = { id: string };

export type SessionCheck =
  { user: SessionUser } | { signedOut: true } | { unavailable: true };

/**
 * Who the session cookie belongs to, verified (spec §13.2). getClaims() checks the access token's
 * signature against the project's published keys, refreshing an expiring session first, so a
 * forged or tampered cookie, or one whose refresh token has expired or been revoked, counts as
 * signed out (WEB-ACT-02). getSession() would read the cookie without checking it, so it's never
 * called (WEB-ACT-03).
 *
 * A token stays valid until it expires, so a session signed out on another device keeps working
 * until then (spec §13.8). Suspension and deletion don't rely on ending sessions: the functions
 * that act, and the access rules, check the account's status in the database.
 */
export async function checkSession(
  supabase: ServerSupabase,
): Promise<SessionCheck> {
  try {
    const { data, error } = await supabase.auth.getClaims();
    // Auth couldn't be reached, or is refusing refreshes because too many arrived from the web
    // server's address (spec §13.8): neither is the same as being signed out.
    if (error && (isAuthRetryableFetchError(error) || error.status === 429))
      return { unavailable: true };
    const claims = data?.claims;
    // Anonymous sign-ins are off (T17), so an anonymous session never counts, should they ever be
    // switched on: it would get the authenticated role.
    if (
      error ||
      typeof claims?.sub !== "string" ||
      claims.role !== "authenticated" ||
      claims.is_anonymous === true
    )
      return { signedOut: true };
    return { user: { id: claims.sub } };
  } catch {
    // getClaims() throws, rather than returning an error, only for a token it can't read at all:
    // a payload that isn't JSON, or an algorithm that doesn't fit its key. Network failures come
    // back as retryable errors above, so this is a bad cookie, not an outage.
    return { signedOut: true };
  }
}

/**
 * The signed-in user for a server component, or null when nobody is. Every page and data access
 * function asks again, since src/proxy.ts never decides who's signed in (WEB-ACT-11).
 */
export async function currentUser(): Promise<SessionUser | null> {
  const session = await checkSession(await createSupabase());
  if ("unavailable" in session)
    throw new Error("UNAVAILABLE" satisfies ErrorCode);
  return "user" in session ? session.user : null;
}
