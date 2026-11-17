"use client";

import { useEffect } from "react";

/**
 * Reports an error from the browser, loading Sentry's code first (browser-sentry.ts). If that code
 * can't load, as when the network is down, the report is given up: reporting the failed load
 * would only try the same load again.
 */
export function reportBrowserError(error: unknown) {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;
  import("./browser-sentry").then(
    ({ reportInBrowser }) => reportInBrowser(error),
    () => {},
  );
}

/** Reports errors nothing else caught. The root layout renders it once. */
export function BrowserErrorReporter() {
  useEffect(() => {
    // A script from another origin reports only "Script error.", with no error to send.
    const onError = (event: ErrorEvent) => {
      if (event.error) reportBrowserError(event.error);
    };
    const onRejection = (event: PromiseRejectionEvent) =>
      reportBrowserError(event.reason);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
