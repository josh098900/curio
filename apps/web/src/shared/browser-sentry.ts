// Sentry in the browser. browser-errors.tsx loads this only once an error happens, so no page
// carries it up front (spec §14.3).
import {
  captureException,
  dedupeIntegration,
  httpContextIntegration,
  init,
  linkedErrorsIntegration,
} from "@sentry/nextjs";
import { sentryOptions } from "./error-reporting";

let started = false;

export function reportInBrowser(error: unknown) {
  if (!started) {
    // Only what a report needs: the page it happened on, which the scrubber cuts to its path, and
    // an error's causes. browser-errors.tsx listens for uncaught errors itself, and the default
    // integrations would gather breadcrumbs the scrubber drops anyway.
    init({
      ...sentryOptions(),
      defaultIntegrations: false,
      integrations: [
        httpContextIntegration(),
        linkedErrorsIntegration(),
        dedupeIntegration(),
      ],
    });
    started = true;
  }
  captureException(error);
}
