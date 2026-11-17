// Sentry on the web server (spec §14.3). Next runs register() once per server instance, and the
// proxy runs on Node.js too, so this is the only setup the server needs.
import { captureRequestError, init } from "@sentry/nextjs";
import { sentryOptions } from "@/shared/error-reporting";

export function register() {
  const options = sentryOptions();
  if (options.dsn) init(options);
}

/** Errors Next catches while rendering a page or running a route, scrubbed like any other. */
export const onRequestError = captureRequestError;
