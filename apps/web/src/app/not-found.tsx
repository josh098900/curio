import Link from "next/link";

// S53 Not found, in the brief's words. Next's own page styles itself with inline styles, which the
// CSP refuses (WEB-ACT-12), so this one has none. T15 gives it the app shell and the theme.
export default function NotFound() {
  return (
    <main>
      <h1>We couldn&apos;t find that</h1>
      <p>
        <Link href="/">Back to Discover</Link>
      </p>
    </main>
  );
}
