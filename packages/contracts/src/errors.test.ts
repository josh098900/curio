import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ERROR_CODES,
  ERROR_MESSAGES,
  FIELD_RULE_MESSAGES,
  HTTP_STATUS,
  parseApiError,
} from "./errors";

// private.raise_error's latest definition in the migrations: the database's own lists.
function latestRaiseError(): string {
  const migrations = path.join(
    import.meta.dirname,
    "..",
    "..",
    "..",
    "supabase",
    "migrations",
  );
  const definitions = readdirSync(migrations)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => readFileSync(path.join(migrations, name), "utf8"))
    .flatMap((sql) =>
      sql
        .split(/(?=create (?:or replace )?function )/i)
        .filter((part) =>
          /^create (or replace )?function private\.raise_error\(/i.test(part),
        ),
    );
  const latest = definitions.at(-1) ?? "";
  return latest.slice(0, latest.indexOf("$$;", latest.indexOf("$$") + 2));
}

// The codes and their statuses.
function raiseErrorCodes(): Record<string, number> {
  return Object.fromEntries(
    [...latestRaiseError().matchAll(/when '([A-Z_]+)' then '(\d{3})'/g)].map(
      (match) => [match[1], Number(match[2])],
    ),
  );
}

// The rule ids it accepts in INVALID_INPUT's details.
function raiseErrorRules(): string[] {
  const list =
    /#>> '\{\}'\) not in \(([^)]*)\)/.exec(latestRaiseError())?.[1] ?? "";
  return [...list.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
}

describe("UT-ERR-01 every error code has a message", () => {
  it("UT-ERR-01 every code in the contract has a web message", () => {
    expect(ERROR_CODES).toHaveLength(12);
    for (const code of ERROR_CODES) {
      expect(ERROR_MESSAGES[code].trim()).not.toBe("");
    }
  });

  it("UT-ERR-01 the codes and statuses match the database's raise_error, so neither can gain one alone", () => {
    expect(raiseErrorCodes()).toEqual(HTTP_STATUS);
  });

  it("UT-ERR-01 the rule ids match the ones the database's raise_error accepts", () => {
    expect(raiseErrorRules().sort()).toEqual(
      Object.keys(FIELD_RULE_MESSAGES).sort(),
    );
  });
});

// The message half of UT-ERR-02; reporting to Sentry comes with T16.
describe("UT-ERR-02 an unknown code", () => {
  it("UT-ERR-02 gives the generic message, with no fields", () => {
    const error = parseApiError({
      code: "PT418",
      message: "TEAPOT",
      details: null,
    });
    expect(error).toEqual({
      code: null,
      message: ERROR_MESSAGES.UNAVAILABLE,
      fields: {},
    });
  });

  it("UT-ERR-02 a known code without its own HTTP status isn't read as that code", () => {
    expect(
      parseApiError({ code: "42501", message: "NOT_FOUND", details: null })
        .code,
    ).toBeNull();
    expect(parseApiError({ message: "FULL" }).code).toBeNull();
  });
});

describe("UT-ERR-03 INVALID_INPUT with field details", () => {
  it("UT-ERR-03 PostgREST's details, a string holding JSON, give each field its message", () => {
    const error = parseApiError({
      code: "PT422",
      message: "INVALID_INPUT",
      details: '{"display_name": "too_long", "bio": "hidden_characters"}',
      hint: null,
    });
    expect(error.code).toBe("INVALID_INPUT");
    expect(error.message).toBe(ERROR_MESSAGES.INVALID_INPUT);
    expect(error.fields).toEqual({
      display_name: FIELD_RULE_MESSAGES.too_long,
      bio: FIELD_RULE_MESSAGES.hidden_characters,
    });
  });

  it("UT-ERR-03 details that arrive as an object read the same way, though the Edge Functions send the string", () => {
    const error = parseApiError({
      code: "PT422",
      message: "INVALID_INPUT",
      details: { title: "required" },
    });
    expect(error.fields).toEqual({ title: FIELD_RULE_MESSAGES.required });
  });

  it("UT-ERR-03 a rule the client doesn't know falls back to a general field message", () => {
    const error = parseApiError({
      code: "PT422",
      message: "INVALID_INPUT",
      details: '{"title": "some_new_rule"}',
    });
    expect(error.fields).toEqual({ title: FIELD_RULE_MESSAGES.invalid });
  });

  it("UT-ERR-03 details that aren't field names and rule ids are ignored", () => {
    for (const details of [
      "not json",
      "[]",
      '{"display_name": "Ana Smith is too long"}',
      '{"Display Name": "too_long"}',
      '{"display_name": 3}',
      42,
    ]) {
      expect(
        parseApiError({ code: "PT422", message: "INVALID_INPUT", details })
          .fields,
      ).toEqual({});
    }
  });
});

describe("UT-ERR-04 BLOCKED", () => {
  it("UT-ERR-04 the message gives no reason and names nobody", () => {
    expect(ERROR_MESSAGES.BLOCKED).toBe("You can't join this activity");
    expect(ERROR_MESSAGES.BLOCKED).not.toMatch(/[{}%$]|because|block/i);
  });

  it("UT-ERR-04 anything sent with it is dropped, so nothing about the other person can show", () => {
    const error = parseApiError({
      code: "PT403",
      message: "BLOCKED",
      details: '{"blocked_by": "hal"}',
      hint: "hal blocked you",
    });
    expect(error).toEqual({
      code: "BLOCKED",
      message: ERROR_MESSAGES.BLOCKED,
      fields: {},
    });
  });
});
