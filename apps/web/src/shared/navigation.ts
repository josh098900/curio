/** Where someone who isn't signed in is sent. T17 builds the page (S02). */
export const SIGN_IN_PATH = "/sign-in";

const ORIGIN = "https://curio.invalid";

/**
 * A `next` value is used only if it's a path on Curio itself: starting with one "/", and still a
 * path on Curio once the browser has read it. So "//evil.example", "/\evil.example", an absolute
 * address, one hidden behind a tab or newline, and one that only becomes "//…" once "." and ".."
 * are resolved (such as "/.//evil.example") are all refused (WEB-ACT-09). The path returned is
 * the browser's own reading, so checking it again gives the same answer. Anything else is null.
 */
export function safeNextPath(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("/")) return null;
  if (value.startsWith("//") || value.startsWith("/\\")) return null;
  const url = URL.parse(value, ORIGIN);
  if (url?.origin !== ORIGIN) return null;
  const path = url.pathname + url.search + url.hash;
  return path.startsWith("//") ? null : path;
}
