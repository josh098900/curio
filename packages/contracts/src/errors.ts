// The error contract both clients share (spec §14.4, D22). The database raises these codes
// through private.raise_error, and the Edge Functions return them the same way: the code as the
// message, its HTTP status, and field errors in details. UT-ERR-01 checks this list against
// raise_error, so neither side can gain a code alone.

export const ERROR_CODES = [
  "NOT_VERIFIED",
  "VERIFICATION_FINAL",
  "ALREADY_VERIFIED",
  "FULL",
  "BLOCKED",
  "CLOSED",
  "SUSPENDED",
  "NOT_ALLOWED",
  "NOT_FOUND",
  "INVALID_INPUT",
  "RATE_LIMITED",
  "UNAVAILABLE",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const HTTP_STATUS = {
  NOT_VERIFIED: 403,
  VERIFICATION_FINAL: 403,
  ALREADY_VERIFIED: 409,
  FULL: 409,
  BLOCKED: 403,
  CLOSED: 409,
  SUSPENDED: 403,
  NOT_ALLOWED: 403,
  NOT_FOUND: 404,
  INVALID_INPUT: 422,
  RATE_LIMITED: 429,
  UNAVAILABLE: 503,
} as const satisfies Record<ErrorCode, number>;

// The web's message for each code, from the brief's copy table (section 8). A code without one
// is a type error, so it fails the build. Screens add what a code alone can't say: whether the
// check is still running for NOT_VERIFIED, why for VERIFICATION_FINAL, and the decision for
// SUSPENDED. BLOCKED gives no reason and names nobody.
export const ERROR_MESSAGES = {
  NOT_VERIFIED: "Verify your ID to join",
  VERIFICATION_FINAL: "In-person features aren't available on this account",
  ALREADY_VERIFIED: "Your ID is already verified",
  FULL: "This activity is full",
  BLOCKED: "You can't join this activity",
  CLOSED: "This activity is no longer open",
  SUSPENDED: "Your account is suspended",
  NOT_ALLOWED: "You can't do that",
  NOT_FOUND: "We couldn't find that",
  INVALID_INPUT: "Check the highlighted fields",
  RATE_LIMITED: "Please wait a moment and try again",
  UNAVAILABLE: "Something went wrong. Please try again later",
} as const satisfies Record<ErrorCode, string>;

// The rule ids INVALID_INPUT's details use, with the message shown next to the field. The
// database's backstop (private.raise_constraint_error) sends required and invalid; the text
// rules send the rest.
export const FIELD_RULE_MESSAGES = {
  required: "Enter this",
  too_short: "This is too short",
  too_long: "This is too long",
  hidden_characters: "Remove hidden characters, such as zero-width spaces",
  invalid: "Check this",
} as const;

export type FieldRule = keyof typeof FIELD_RULE_MESSAGES;

export interface ApiError {
  // null when the code isn't one of the contract's, which reads as UNAVAILABLE's message.
  code: ErrorCode | null;
  message: string;
  // Field name to message, for INVALID_INPUT only.
  fields: Record<string, string>;
}

// The same short lower-case ids private.raise_error accepts in details.
const ID = /^[a-z][a-z0-9_]{0,62}$/;

function isErrorCode(value: unknown): value is ErrorCode {
  return (
    typeof value === "string" &&
    (ERROR_CODES as readonly string[]).includes(value)
  );
}

function isFieldRule(value: string): value is FieldRule {
  return Object.hasOwn(FIELD_RULE_MESSAGES, value);
}

function readDetails(details: unknown): Record<string, unknown> | null {
  let value = details;
  // PostgREST returns details as a string holding the JSON, and the Edge Functions' helper sends
  // the same string (UT-ERR-05). An object is read too, in case one ever arrives that way.
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return null;
  return value as Record<string, unknown>;
}

// Reads the body of a failed RPC or Edge Function call: { code: "PT422", message: "INVALID_INPUT",
// details, hint }. Only INVALID_INPUT's details are read, as field names and rule ids; anything
// else that came with an error, hints included, is dropped, so nothing about another person can
// show (UT-ERR-04).
export function parseApiError(body: unknown): ApiError {
  const raw =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};
  // A Curio error has the code as its message and the matching PT status as its code, so a
  // Postgres or gateway error whose message happens to match a code isn't mistaken for one.
  const code =
    isErrorCode(raw.message) && raw.code === `PT${HTTP_STATUS[raw.message]}`
      ? raw.message
      : null;
  if (code === null) {
    return { code: null, message: ERROR_MESSAGES.UNAVAILABLE, fields: {} };
  }
  const fields: Record<string, string> = {};
  if (code === "INVALID_INPUT") {
    const details = readDetails(raw.details);
    const entries = details ? Object.entries(details) : [];
    // All or nothing: details that aren't all field names and rule ids are ignored.
    if (
      entries.every(
        ([field, rule]) =>
          ID.test(field) && typeof rule === "string" && ID.test(rule),
      )
    ) {
      for (const [field, rule] of entries as [string, string][]) {
        fields[field] = isFieldRule(rule)
          ? FIELD_RULE_MESSAGES[rule]
          : FIELD_RULE_MESSAGES.invalid;
      }
    }
  }
  return { code, message: ERROR_MESSAGES[code], fields };
}
