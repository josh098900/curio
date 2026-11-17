import "server-only";
import {
  ERROR_MESSAGES,
  FIELD_RULE_MESSAGES,
  type ErrorCode,
  type FieldRule,
} from "@curio/contracts";
import { redirect, unstable_rethrow } from "next/navigation";
import { SIGN_IN_PATH } from "@/shared/navigation";
import { BackendFailure, oneCallBackend, type Backend } from "./backend";
import { reportFailure, unexplained } from "./report";
import { checkSession, type SessionUser } from "./session";
import { createSupabase } from "./supabase";

export type ActionFailure = {
  ok: false;
  code: ErrorCode;
  message: string;
  /** Field name to the message shown next to it, for INVALID_INPUT. */
  fields: Record<string, string>;
};

export type ActionResult<Output> = { ok: true; data: Output } | ActionFailure;

/**
 * Checks an action's input. T18 chooses the schema library, so any parser fits: it returns the
 * value, or each failing field with one of the rule ids in spec §14.4.
 */
export type InputParser<Input> = (
  raw: unknown,
) => { value: Input } | { fields: Record<string, FieldRule> };

/** For an action that takes nothing: anything given is refused. */
export const noInput: InputParser<undefined> = (raw) =>
  raw === undefined ? { value: undefined } : { fields: { input: "invalid" } };

export type ActionCall<Input> = {
  user: SessionUser;
  input: Input;
  backend: Backend;
};

const MARK = Symbol.for("curio.server-action");

export type ServerAction<Output> = ((
  input?: unknown,
) => Promise<ActionResult<Output>>) & { readonly [MARK]: true };

function failure(code: ErrorCode): ActionFailure {
  return { ok: false, code, message: ERROR_MESSAGES[code], fields: {} };
}

/**
 * Makes a server action. Every one is made this way (.claude/rules/web.md), and the tests find
 * each one in src/features/<feature>/actions.ts and check it (WEB-ACT-01, 02 and 04). A server
 * action is a public endpoint, so in order it:
 * 1. checks the session with getClaims(), sending anyone signed out to sign in;
 * 2. validates the input, refusing it with field messages before anything reaches the backend;
 * 3. runs `run`, which makes exactly one backend call and turns what it returns into a DTO;
 * 4. maps a failure to its code and message from packages/contracts (WEB-ACT-05), reporting
 *    anything that isn't a Curio code to Sentry without its text (UT-ERR-02).
 */
export function action<Input, Output>(definition: {
  input: InputParser<Input>;
  run: (call: ActionCall<Input>) => Promise<Output>;
}): ServerAction<Output> {
  async function serverAction(raw?: unknown): Promise<ActionResult<Output>> {
    let supabase;
    try {
      supabase = await createSupabase();
    } catch (error) {
      await reportFailure(error);
      return failure("UNAVAILABLE");
    }

    const session = await checkSession(supabase);
    if ("signedOut" in session) redirect(SIGN_IN_PATH);
    if ("unavailable" in session) {
      await reportFailure(unexplained("SessionCheckUnavailable"));
      return failure("UNAVAILABLE");
    }

    try {
      const parsed = definition.input(raw);
      if ("fields" in parsed) {
        const fields: Record<string, string> = {};
        for (const [field, rule] of Object.entries(parsed.fields))
          fields[field] = FIELD_RULE_MESSAGES[rule];
        return { ...failure("INVALID_INPUT"), fields };
      }
      const data = await definition.run({
        user: session.user,
        input: parsed.value,
        backend: oneCallBackend(supabase),
      });
      return { ok: true, data };
    } catch (error) {
      // Next's own redirects and not-found pass straight through.
      unstable_rethrow(error);
      // The backend has already reported anything that wasn't an answer.
      if (error instanceof BackendFailure) {
        if ("signedOut" in error.outcome) redirect(SIGN_IN_PATH);
        const { code, message, fields } = error.outcome.error;
        return { ok: false, code: code ?? "UNAVAILABLE", message, fields };
      }
      // A bug in the action.
      await reportFailure(error);
      return failure("UNAVAILABLE");
    }
  }
  return Object.assign(serverAction, { [MARK]: true as const });
}

/** Whether a value was made by action(), which the tests use to check every export. */
export function isServerAction(value: unknown): value is ServerAction<unknown> {
  return (
    typeof value === "function" &&
    (value as unknown as Record<symbol, unknown>)[MARK] === true
  );
}
