import { readFile, writeFile } from "node:fs/promises";
import { expect, test as setup } from "@playwright/test";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { sessionCookieOptions } from "../src/shared/supabase-settings";
import { env, sessionFile, stateFile, supabaseUrl } from "./support";

// The app's own session cookie, for the preview's host alone, so the browser checks run signed in
// (T13). ZAP gets the same cookie in the workflow. It runs as its own step after the sign-in, with
// neither staging's ci_preview key nor Vercel's bypass secret, so @supabase/ssr and its
// dependencies never run beside them: it needs only the publishable key and the saved session.
setup("give the browser the app's session cookie", async () => {
  const session = JSON.parse(await readFile(sessionFile, "utf8"));
  const host = new URL(env("PREVIEW_URL")).hostname;
  const state = JSON.parse(await readFile(stateFile, "utf8"));
  const expires = Math.floor(Date.now() / 1000) + 24 * 60 * 60;
  for (const { name, value, options } of await appCookies(session))
    state.cookies.push({
      name,
      value,
      domain: host,
      path: options.path ?? "/",
      expires,
      httpOnly: options.httpOnly ?? false,
      secure: options.secure ?? false,
      sameSite: "Lax",
    });
  await writeFile(stateFile, JSON.stringify(state), { mode: 0o600 });
});

// @supabase/ssr makes the cookie from the session, with the app's own settings, so it's exactly
// what the app reads: its name, its encoding and how it's split into chunks.
async function appCookies(session: {
  access_token: string;
  refresh_token: string;
}) {
  const url = supabaseUrl();
  const made: { name: string; value: string; options: CookieOptions }[] = [];
  const supabase = createServerClient(url, env("SUPABASE_PUBLISHABLE_KEY"), {
    cookieOptions: sessionCookieOptions(url),
    cookies: {
      getAll: () => [],
      setAll: (cookies) => void made.push(...cookies),
    },
  });
  const { error } = await supabase.auth.setSession(session);
  if (error)
    throw new Error(
      `The app's session cookie couldn't be made (${error.code ?? error.status}).`,
    );
  const cookies = made.filter(({ value }) => value !== "");
  expect(
    cookies.length,
    "@supabase/ssr made no session cookie.",
  ).toBeGreaterThan(0);
  return cookies;
}
