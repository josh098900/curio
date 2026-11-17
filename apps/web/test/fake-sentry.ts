// A real Sentry client, with the app's own settings and scrubber, whose reports stay in memory,
// so a test sees exactly what would reach Sentry (UT-ERR-02).
import { createTransport, flush, init, type ErrorEvent } from "@sentry/nextjs";
import { sentryOptions } from "@/shared/error-reporting";

const sent: ErrorEvent[] = [];

/** A request id as src/proxy.ts makes them, for tests whose request has one. */
export const REQUEST_ID = "0f8b3a52-6d1e-4c7a-9b2f-5e4d3c2b1a09";

export function captureReports() {
  init({
    ...sentryOptions(),
    dsn: "https://public@o0.ingest.de.sentry.io/1",
    // No integrations, so nothing wraps the fetch the Supabase fakes replace.
    defaultIntegrations: false,
    transport: (options: Parameters<typeof createTransport>[0]) =>
      createTransport(options, async ({ body }) => {
        const envelope =
          typeof body === "string" ? body : new TextDecoder().decode(body);
        for (const line of envelope.split("\n").filter(Boolean)) {
          const item = JSON.parse(line);
          if (item.exception) sent.push(item);
        }
        return { statusCode: 200 };
      }),
  });
}

/** The reports sent since the last call, as Sentry would receive them. */
export async function sentReports(): Promise<ErrorEvent[]> {
  await flush(2000);
  return sent.splice(0);
}
