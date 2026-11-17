import "server-only";
import {
  ERROR_MESSAGES,
  parseApiError,
  type ApiError,
  type Database,
} from "@curio/contracts";
import { FunctionsHttpError, type PostgrestError } from "@supabase/supabase-js";
import { reportFailure, unexplained, type FailureTags } from "./report";
import type { ServerSupabase } from "./supabase";

type Functions = Database["public"]["Functions"];
export type RpcName = keyof Functions;

/**
 * The Edge Function routes the web app calls as the user (spec §11). The rest take only Stripe's
 * signature or the cron key.
 */
export type EdgeFunctionName = "verification/start" | "export-data";

/** What a failed backend call becomes: a signed-out caller, or one of the contract's errors. */
export type BackendFailureOutcome = { signedOut: true } | { error: ApiError };

/** Thrown by a backend call that failed, for the action wrapper to turn into its result. */
export class BackendFailure extends Error {
  constructor(readonly outcome: BackendFailureOutcome) {
    super("A backend call failed.");
    this.name = "BackendFailure";
  }
}

/**
 * The backend, as a server action sees it: one call at most, to an RPC function or an Edge
 * Function, signed in as the caller so RLS and each function's own checks apply (spec §8.5).
 * Lint keeps the client itself inside src/server, so an action can't go round this.
 */
export type Backend = {
  rpc<Name extends RpcName>(
    name: Name,
    args: Functions[Name]["Args"],
  ): Promise<Functions[Name]["Returns"]>;
  edgeFunction(
    name: EdgeFunctionName,
    body?: Record<string, unknown>,
  ): Promise<unknown>;
};

// supabase-js can't infer the arguments of a function picked by a generic name, so the call is
// made untyped here. Backend's own signature keeps the names, arguments and results typed.
type UntypedRpc = (
  name: string,
  args: unknown,
) => PromiseLike<{
  data: unknown;
  error: PostgrestError | null;
  status: number;
}>;

const unavailable: BackendFailureOutcome = {
  error: { code: null, message: ERROR_MESSAGES.UNAVAILABLE, fields: {} },
};

/**
 * Turns a failed call's HTTP status and JSON body into its outcome. A 401 means the token was
 * refused, as an expired or revoked one is, so the caller is sent to sign in, whatever the body
 * says (T12's reviews). Otherwise only a Curio code counts: anything else, such as a Postgres
 * error, a gateway's page or an unreadable body, is UNAVAILABLE, and its text goes no further,
 * since it can repeat what was submitted (open question 38, decided on 15 November).
 */
export function failureOutcome(
  status: number,
  body: unknown,
): BackendFailureOutcome {
  if (status === 401) return { signedOut: true };
  return { error: parseApiError(body) };
}

/**
 * Throws a failed call's outcome, reporting it first when it isn't a Curio code or a 401: those
 * are answers, and anything else is a fault someone should look at (UT-ERR-02).
 */
async function fail(
  outcome: BackendFailureOutcome,
  error: unknown,
  tags: FailureTags,
): Promise<never> {
  if ("error" in outcome && outcome.error.code === null)
    await reportFailure(error, tags);
  throw new BackendFailure(outcome);
}

export function oneCallBackend(supabase: ServerSupabase): Backend {
  let called = false;
  function claimTheCall() {
    if (called)
      throw new Error("A server action makes exactly one backend call.");
    called = true;
  }

  return {
    async rpc(name, args) {
      claimTheCall();
      let result;
      try {
        result = await (supabase.rpc.bind(supabase) as UntypedRpc)(name, args);
      } catch (error) {
        return fail(unavailable, error, { backend_call: name });
      }
      if (!result.error)
        return result.data as Functions[typeof name]["Returns"];
      // A network failure comes back here too, with status 0.
      return fail(
        failureOutcome(result.status, result.error),
        unexplained("BackendError"),
        {
          backend_call: name,
          http_status: result.status,
          postgres_code: result.error.code || undefined,
        },
      );
    },

    async edgeFunction(name, body) {
      claimTheCall();
      let result;
      try {
        result = await supabase.functions.invoke(name, { body });
      } catch (error) {
        return fail(unavailable, error, { backend_call: name });
      }
      if (!result.error) return result.data;
      // A relay or network failure has no Curio body, so it's UNAVAILABLE.
      if (!(result.error instanceof FunctionsHttpError))
        return fail(unavailable, result.error, { backend_call: name });
      const response = result.error.context as Response;
      const errorBody = await response.json().catch(() => null);
      return fail(
        failureOutcome(response.status, errorBody),
        unexplained("EdgeFunctionError"),
        { backend_call: name, http_status: response.status },
      );
    },
  };
}
