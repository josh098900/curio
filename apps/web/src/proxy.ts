import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  sessionCookieOptions,
  supabaseFetch,
  supabaseSettings,
} from "@/shared/supabase-settings";

/**
 * Refreshes the session cookie, and nothing else (spec §13.2, WEB-ACT-11). It never allows,
 * redirects or blocks a request: CVE-2025-29927 showed a proxy can be skipped entirely, so every
 * page, server action and route handler checks the user itself. Server components can't write
 * cookies, so this is where an expiring session is refreshed before a page renders.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const settings = supabaseSettings();
  if (!settings) return response;

  // Refreshes an expiring session. The answer isn't used, and a failure, even settings that won't
  // make a client, changes nothing: who's signed in is decided by the page or action that runs
  // next.
  try {
    const supabase = createServerClient(settings.url, settings.publishableKey, {
      cookieOptions: sessionCookieOptions(settings.url),
      global: { fetch: supabaseFetch },
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet, headers) {
          // The page about to render reads the refreshed cookies from the request, and the
          // browser gets them on the response, with the headers that stop a CDN caching the
          // session.
          for (const { name, value } of cookiesToSet)
            request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet)
            response.cookies.set(name, value, options);
          for (const [header, value] of Object.entries(headers))
            response.headers.set(header, value);
        },
      },
    });
    await supabase.auth.getClaims();
  } catch {}
  return response;
}

// Static files skip the proxy: they carry no session.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|txt|xml|webmanifest)$).*)",
  ],
};
