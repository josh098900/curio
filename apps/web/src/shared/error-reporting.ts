// What an error report may carry to Sentry (spec §14.3, NFR-OBS-01), for the server
// (src/instrumentation.ts) and the browser (browser-sentry.ts) alike.
import { isErrorCode } from "@curio/contracts";
import type { ErrorEvent, Exception, init } from "@sentry/nextjs";

/** The id src/proxy.ts gives each request, which follows it to Supabase and into reports. */
export const REQUEST_ID_HEADER = "x-request-id";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether a value is an id the proxy could have made, rather than text a client sent. */
export function isRequestId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** The tags src/server/report.ts sets, besides the request id. */
const TAGS = ["backend_call", "http_status", "postgres_code"];
/** The software the error ran on, not the person it ran for. */
const CONTEXTS = ["runtime", "os"];

/**
 * Sentry's settings, off without a DSN. The SDK collects nothing about the person: no user, so
 * Sentry doesn't store their IP address either, and no cookies, bodies, queries, local variables
 * or headers but the request id. The scrubber then rebuilds every report as a second layer.
 */
export function sentryOptions() {
  return {
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? "development",
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: { request: { allow: [REQUEST_ID_HEADER] }, response: false },
      httpBodies: [],
      urlQueryParams: false,
      stackFrameVariables: false,
    },
    beforeSend: scrubEvent,
  } satisfies Parameters<typeof init>[0];
}

/**
 * Builds the report afresh from what finds a fault: the error's type and stack, where and when it
 * ran, the release and the request id. Everything else is left behind, so a field an SDK adds
 * later can't carry personal data out. An error's message goes only when it's one of Curio's
 * codes, since any other can repeat what was submitted (open question 38), and an address loses
 * its query, which can hold a sign-in token.
 */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  // reportFailure's tag first: the header copy may be the one the client sent, before the proxy
  // replaced it.
  const requestId =
    event.tags?.request_id ?? event.request?.headers?.[REQUEST_ID_HEADER];
  const tags = Object.fromEntries(
    Object.entries(event.tags ?? {}).filter(([name]) => TAGS.includes(name)),
  );
  if (isRequestId(requestId)) tags.request_id = requestId;
  return {
    type: event.type,
    event_id: event.event_id,
    timestamp: event.timestamp,
    level: event.level,
    platform: event.platform,
    release: event.release,
    dist: event.dist,
    environment: event.environment,
    sdk: event.sdk,
    fingerprint: event.fingerprint,
    debug_meta: event.debug_meta,
    transaction: withoutQuery(event.transaction),
    exception: event.exception && {
      values: event.exception.values?.map(scrubException),
    },
    request: event.request && {
      method: event.request.method,
      url: withoutQuery(event.request.url),
    },
    contexts: Object.fromEntries(
      Object.entries(event.contexts ?? {}).filter(([name]) =>
        CONTEXTS.includes(name),
      ),
    ),
    tags,
  };
}

function scrubException({ value, mechanism, stacktrace, ...rest }: Exception) {
  return {
    ...rest,
    value: isErrorCode(value) ? value : undefined,
    mechanism: mechanism && { ...mechanism, data: undefined },
    stacktrace: stacktrace && {
      ...stacktrace,
      // A frame in a page's inline script is named after the page's full address.
      frames: stacktrace.frames?.map((frame) => ({
        ...frame,
        filename: withoutQuery(frame.filename),
        abs_path: withoutQuery(frame.abs_path),
        vars: undefined,
      })),
    },
  };
}

function withoutQuery(address: string | undefined) {
  return address?.split(/[?#]/)[0];
}
