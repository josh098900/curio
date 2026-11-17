// The browser reports what nothing else caught, loading Sentry only then (spec §14.3).
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserErrorReporter } from "./browser-errors";
import { reportInBrowser } from "./browser-sentry";

vi.mock("./browser-sentry", () => ({ reportInBrowser: vi.fn() }));

describe("BrowserErrorReporter", () => {
  beforeEach(() =>
    vi.stubEnv(
      "NEXT_PUBLIC_SENTRY_DSN",
      "https://public@o0.ingest.de.sentry.io/1",
    ),
  );
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("UT-ERR-02 reports an uncaught error and an unhandled rejection", async () => {
    render(<BrowserErrorReporter />);
    const error = new Error("uncaught");
    const reason = new Error("rejected");
    window.dispatchEvent(new ErrorEvent("error", { error }));
    window.dispatchEvent(
      Object.assign(new Event("unhandledrejection"), { reason }),
    );
    await vi.waitFor(() => expect(reportInBrowser).toHaveBeenCalledTimes(2));
    expect(reportInBrowser).toHaveBeenCalledWith(error);
    expect(reportInBrowser).toHaveBeenCalledWith(reason);
  });

  it("UT-ERR-02 sends nothing without a DSN, and doesn't load Sentry", async () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "");
    render(<BrowserErrorReporter />);
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("x") }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(reportInBrowser).not.toHaveBeenCalled();
  });
});
