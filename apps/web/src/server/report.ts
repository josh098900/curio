import "server-only";
import type { ErrorCode } from "@curio/contracts";
import { captureException } from "@sentry/nextjs";
import { headers } from "next/headers";
import { isRequestId, REQUEST_ID_HEADER } from "@/shared/error-reporting";

/** What a report may say about the failed call. None of it is anything a person wrote. */
export type FailureTags = {
  /** The RPC or Edge Function called. */
  backend_call?: string;
  http_status?: number;
  /** PostgREST's or Postgres's own code, such as 23505, never its message. */
  postgres_code?: string;
};

/**
 * This request's id, from src/proxy.ts. A request that skipped the proxy could carry any text
 * here, so only an id the proxy could have made is used.
 */
export async function requestId(): Promise<string | undefined> {
  const id = (await headers()).get(REQUEST_ID_HEADER);
  return isRequestId(id) ? id : undefined;
}

/**
 * A failure with no error to show for it: a backend answer that isn't a Curio code, or a session
 * check that couldn't finish. Its message is a code, so the scrubber keeps it.
 */
export function unexplained(kind: string): Error {
  return Object.assign(new Error("UNAVAILABLE" satisfies ErrorCode), {
    name: kind,
  });
}

/**
 * Reports a failure the person saw as UNAVAILABLE (spec §14.3, §14.4): to Sentry, whose scrubber
 * keeps the error's type and stack but not its text, and as one JSON log line holding only its
 * kind. Either could otherwise repeat what was submitted (open question 38).
 */
export async function reportFailure(error: unknown, tags: FailureTags = {}) {
  const request_id = await requestId();
  captureException(error, { tags: { request_id, ...tags } });
  console.error(
    JSON.stringify({
      level: "error",
      message: "A request failed",
      kind: error instanceof Error ? error.name : typeof error,
      request_id,
      ...tags,
    }),
  );
}
