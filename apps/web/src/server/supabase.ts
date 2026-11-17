import "server-only";
import type { Database } from "@curio/contracts";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { REQUEST_ID_HEADER } from "@/shared/error-reporting";
import {
  sessionCookieOptions,
  supabaseFetch,
  supabaseSettings,
} from "@/shared/supabase-settings";
import { requestId } from "./report";

export type ServerSupabase = Awaited<ReturnType<typeof createSupabase>>;

/**
 * The Supabase client for one request, signed in as whoever the session cookie names. Make a new
 * one for each request, never share one. Nothing here trusts the cookie: checkSession() verifies
 * it with getClaims() (spec §13.2). Every call carries the request's id (spec §14.3).
 */
export async function createSupabase() {
  const settings = supabaseSettings();
  if (!settings) throw new Error("The Supabase settings aren't set.");
  const store = await cookies();
  const id = await requestId();
  return createServerClient<Database>(settings.url, settings.publishableKey, {
    cookieOptions: sessionCookieOptions(settings.url),
    global: {
      fetch: supabaseFetch,
      headers: { ...(id && { [REQUEST_ID_HEADER]: id }) },
    },
    cookies: {
      getAll: () => store.getAll(),
      setAll(cookiesToSet) {
        // Server actions and route handlers can write cookies; a server component can't, which
        // is why src/proxy.ts refreshes the session before any page renders.
        try {
          for (const { name, value, options } of cookiesToSet)
            store.set(name, value, options);
        } catch {}
      },
    },
  });
}
