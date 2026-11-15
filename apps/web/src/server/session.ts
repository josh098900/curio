import "server-only";
import type { ErrorCode } from "@curio/contracts";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { safeNextPath, SIGN_IN_PATH } from "@/shared/navigation";
import {
  SESSION_COOKIE,
  TIMED_OUT,
  withinSupabaseTimeout,
} from "@/shared/supabase-settings";
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
    // A refresh and its retries get 15 seconds in all (spec §14.4).
    const answer = await withinSupabaseTimeout(supabase.auth.getClaims());
    if (answer === TIMED_OUT) return { unavailable: true };
    const { data, error } = answer;
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
 * function asks again, since src/proxy.ts never decides who's signed in (WEB-ACT-11). Asked once
 * per request: the layout and the page share the answer.
 */
export const currentUser = cache(async (): Promise<SessionUser | null> => {
  const session = await checkSession(await createSupabase());
  if ("unavailable" in session)
    throw new Error("UNAVAILABLE" satisfies ErrorCode);
  return "user" in session ? session.user : null;
});

/**
 * AuthGuard (spec §11, shared foundation; open question 9): a page only signed-in people may see
 * calls this with its own path. It returns the user, or sends the person away and never returns:
 * to S56 "You've been signed out" if they came with a session that no longer works, and straight
 * to sign-in if they came with none. Either way, `next` brings them back, if it's a path on
 * Curio itself.
 */
export async function requireUser(path: string): Promise<SessionUser> {
  const user = await currentUser();
  if (user) return user;
  const next = safeNextPath(path);
  const query = next ? `?next=${encodeURIComponent(next)}` : "";
  const hadSession = (await cookies())
    .getAll()
    .some(({ name }) => SESSION_COOKIE.test(name));
  redirect(`${hadSession ? "/signed-out" : SIGN_IN_PATH}${query}`);
}
