import "server-only";
import { REQUEST_ID_HEADER } from "@/shared/error-reporting";
import { supabaseSettings } from "@/shared/supabase-settings";
import { requestId } from "./report";

// Whether the database answers, asked through the Data API's public.health() (spec §14.3).
// It signs nobody in, so it runs as anon, the one role health() is granted to.
export async function databaseAnswers(): Promise<boolean> {
  const settings = supabaseSettings();
  if (!settings) return false;
  const { url, publishableKey } = settings;
  const id = await requestId();
  try {
    const response = await fetch(`${url}/rest/v1/rpc/health`, {
      method: "POST",
      headers: {
        apikey: publishableKey,
        "Content-Type": "application/json",
        ...(id && { [REQUEST_ID_HEADER]: id }),
      },
      body: "{}",
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    return response.ok && (await response.json()) === true;
  } catch {
    return false;
  }
}
