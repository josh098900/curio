import "server-only";

// Whether the database answers, asked through the Data API's public.health() (spec §14.3).
// It signs nobody in, so it runs as anon, the one role health() is granted to.
export async function databaseAnswers(): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) return false;
  try {
    const response = await fetch(`${url}/rest/v1/rpc/health`, {
      method: "POST",
      headers: { apikey: publishableKey, "Content-Type": "application/json" },
      body: "{}",
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    return response.ok && (await response.json()) === true;
  } catch {
    return false;
  }
}
