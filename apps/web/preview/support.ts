// What the preview checks share: their settings, the files the sign-in step leaves for the
// other checks, and calls to staging's Auth API.
import path from "node:path";

/** The staging test account. It exists only on staging, with no password (spec §14.2). */
export const testAccount = "preview-checks@example.com";

/** The browser checks' starting cookies: Vercel's bypass cookie and the app's session cookie. */
export const stateFile = path.join(__dirname, ".auth", "state.json");
/** The app's session cookie, whole or in chunks: sb-<project ref>-auth-token. */
export const appSessionCookie = /^sb-[a-z0-9]+-auth-token(\.\d+)?$/;
/** The test account's session, kept for signing out. */
export const sessionFile = path.join(__dirname, ".auth", "session.json");

export function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`The preview checks need ${name}.`);
  return value;
}

/**
 * Runs a Playwright request, keeping only the first line of its error. A failed request's error
 * goes on to list every header it sent, cookies included, and the job's log is public.
 */
export async function withoutCallLog<T>(request: Promise<T>): Promise<T> {
  try {
    return await request;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(message.split("\n")[0]);
  }
}

// The `ci_preview` key goes only to a hosted project or the local stack.
const supabaseAddress =
  /^(https:\/\/[a-z]{20}\.supabase\.co|http:\/\/127\.0\.0\.1:54321)$/;

type AuthCall = {
  body?: object;
  /** A session's access token. */
  token?: string;
  /** Use staging's `ci_preview` secret key instead of the publishable key. */
  secret?: boolean;
  method?: "GET" | "POST";
};

/** Staging's address, checked to be a Supabase project's before anything is sent to it. */
export function supabaseUrl(): string {
  const url = env("SUPABASE_URL");
  if (!supabaseAddress.test(url))
    throw new Error("SUPABASE_URL isn't a Supabase project's address.");
  return url;
}

export function auth(
  route: string,
  { body, token, secret, method = "POST" }: AuthCall = {},
) {
  return fetch(`${supabaseUrl()}/auth/v1${route}`, {
    method,
    headers: {
      apikey: env(secret ? "SUPABASE_CI_KEY" : "SUPABASE_PUBLISHABLE_KEY"),
      ...(token && { Authorization: `Bearer ${token}` }),
      ...(body && { "Content-Type": "application/json" }),
    },
    body: body && JSON.stringify(body),
  });
}
