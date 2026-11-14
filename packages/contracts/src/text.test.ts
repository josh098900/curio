import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkText,
  countCharacters,
  hasNoHiddenCharacters,
  toStoredText,
} from "./text";

// Characters are written as code points, so none can hide in this file.
const cp = (...points: number[]) => String.fromCodePoint(...points);
const ZWNJ = cp(0x200c);
const ZWJ = cp(0x200d);

describe("UT-VAL-03 control, zero-width and direction characters", () => {
  // The same cases as DB-SCH-05's display-name checks, so the package and the database agree.
  const refused: [string, string][] = [
    ["a control character", "Ana" + cp(0x07)],
    ["a tab inside", "An" + cp(0x09) + "a"],
    ["a zero-width space", "An" + cp(0x200b) + "a"],
    ["a right-to-left override", "An" + cp(0x202e) + "a"],
    ["an Arabic letter mark", "An" + cp(0x061c) + "a"],
    ["a line separator inside", "An" + cp(0x2028) + "a"],
    ["an invisible format character", "An" + cp(0x206a) + "a"],
    ["an annotation character", "An" + cp(0xfff9) + "a"],
    ["only a Hangul filler, which looks blank", cp(0x3164)],
    ["only blank braille", cp(0x2800, 0x2800)],
    ["a zero-width joiner at the start", ZWJ + "Ana"],
    ["a zero-width non-joiner at the end", "Ana" + ZWNJ],
    ["a zero-width joiner before a space", "An" + ZWJ + " a"],
    ["a zero-width joiner beside a space", "An " + ZWJ + "a"],
    ["two zero-width joiners together", "An" + ZWJ + ZWJ + "a"],
    ["a variation selector on its own, which looks blank", cp(0xfe0f)],
    ["a variation selector after a space", "Ana " + cp(0xfe0f)],
    ["two variation selectors together", "Ana" + cp(0xfe0f, 0xfe0f)],
    ["a Khmer inherent vowel, which shows as nothing", "An" + cp(0x17b4) + "a"],
    ["a shorthand format control", "An" + cp(0x1bca0) + "a"],
    ["an unassigned special", "An" + cp(0xfff0) + "a"],
    ["an invisible operator", "An" + cp(0x2065) + "a"],
    ["a tag character outside a flag", "Ana" + cp(0xe0067)],
    [
      "a flag's tag characters without its closing tag",
      "Ana " + cp(0x1f3f4, 0xe0067, 0xe0062),
    ],
  ];
  const accepted: [string, string][] = [
    ["a plain name", "Ana Lima"],
    [
      "a non-joiner between letters, as in the Persian name Alireza",
      "علی" + ZWNJ + "رضا",
    ],
    [
      "a joiner inside a Sinhala word",
      cp(0x0dc1, 0x0dca) + ZWJ + cp(0x0dbb, 0x0dd3),
    ],
    [
      "an emoji joined by a joiner (woman technologist)",
      "Ana " + cp(0x1f469) + ZWJ + cp(0x1f4bb),
    ],
    [
      "the rainbow flag, joined after a variation selector",
      "Ana " + cp(0x1f3f3, 0xfe0f) + ZWJ + cp(0x1f308),
    ],
    [
      "a red heart, whose variation selector follows it",
      "Ana " + cp(0x2764, 0xfe0f),
    ],
    [
      "the flag of England, made of tag characters",
      "Ana " +
        cp(0x1f3f4, 0xe0067, 0xe0062, 0xe0065, 0xe006e, 0xe0067, 0xe007f),
    ],
  ];

  it.each(refused)("UT-VAL-03 refused in a name: %s", (_, value) => {
    expect(hasNoHiddenCharacters(value)).toBe(false);
    expect(checkText(value, { min: 1, max: 40, refuseHidden: true })).toEqual({
      rule: "hidden_characters",
    });
  });

  it.each(accepted)("UT-VAL-03 accepted in a name: %s", (_, value) => {
    expect(hasNoHiddenCharacters(value)).toBe(true);
    expect(checkText(value, { min: 1, max: 40, refuseHidden: true })).toEqual({
      value,
    });
  });

  it("UT-VAL-03 titles follow the same rule", () => {
    expect(
      checkText("Quiz" + cp(0x200b) + " night", {
        min: 3,
        max: 80,
        refuseHidden: true,
      }),
    ).toEqual({
      rule: "hidden_characters",
    });
    expect(
      checkText("Quiz night " + cp(0x1f3f3, 0xfe0f) + ZWJ + cp(0x1f308), {
        min: 3,
        max: 80,
        refuseHidden: true,
      }),
    ).toEqual({
      value: "Quiz night " + cp(0x1f3f3, 0xfe0f) + ZWJ + cp(0x1f308),
    });
  });
});

describe("UT-VAL-04 emoji, accents and right-to-left text", () => {
  it("UT-VAL-04 accepted", () => {
    const value = "Zo" + cp(0x00eb) + " " + cp(0x1f30d) + " سارة";
    expect(checkText(value, { min: 1, max: 40, refuseHidden: true })).toEqual({
      value,
    });
  });

  it("UT-VAL-04 stored in NFC form", () => {
    const decomposed = "Jose" + cp(0x0301);
    const composed = "Jos" + cp(0x00e9);
    expect(toStoredText(decomposed)).toBe(composed);
    expect(checkText(decomposed, { min: 1, max: 40 })).toEqual({
      value: composed,
    });
  });

  it("UT-VAL-04 counted in characters, as the database counts them, not in bytes or UTF-16 units", () => {
    const globe = cp(0x1f30d);
    expect(countCharacters("Zo" + cp(0x00eb) + " " + globe)).toBe(5);
    expect(("Zo" + cp(0x00eb) + " " + globe).length).toBe(6);
    expect(checkText(globe.repeat(40), { min: 1, max: 40 })).toEqual({
      value: globe.repeat(40),
    });
    expect(checkText(globe.repeat(41), { min: 1, max: 40 })).toEqual({
      rule: "too_long",
    });
  });

  it("UT-VAL-04 trimmed of the same whitespace the database trims before counting", () => {
    const padded =
      cp(0x3000, 0x00a0, 0xfeff) + "Ana" + cp(0x2028, 0x0009, 0x0020);
    expect(checkText(padded, { min: 1, max: 3 })).toEqual({ value: "Ana" });
    expect(checkText(cp(0x3000, 0x00a0), { min: 1, max: 40 })).toEqual({
      rule: "required",
    });
    expect(checkText("Al", { min: 3, max: 80 })).toEqual({ rule: "too_short" });
  });
});

describe("UT-VAL-04 text the database can't store", () => {
  it.each([
    ["the null character", "An" + cp(0x0000) + "a"],
    [
      "a lone surrogate, which isn't a character",
      "Ana" + String.fromCharCode(0xd800),
    ],
  ])("UT-VAL-04 refused in any field: %s", (_, value) => {
    expect(checkText(value, { min: 1, max: 1000 })).toEqual({
      rule: "invalid",
    });
  });
});

// The whitespace private.trimmed_length trims, read from its btrim in T07's migration.
function databaseTrimSet(): number[] {
  const sql = readFileSync(
    path.join(
      import.meta.dirname,
      "..",
      "..",
      "..",
      "supabase",
      "migrations",
      "20261114011310_schema.sql",
    ),
    "utf8",
  );
  const definition = sql.slice(
    sql.indexOf("create function private.trimmed_length"),
  );
  const literal = /btrim\(value,\s*E'([^']*)'\)/.exec(definition)?.[1] ?? "";
  const named: Record<string, number> = { t: 0x09, n: 0x0a, f: 0x0c, r: 0x0d };
  return [
    ...literal.matchAll(/\\u([0-9a-f]{4})|\\x([0-9a-f]{2})|\\([tnfr])|( )/g),
  ].map(([, unicode, hex, letter]) =>
    unicode
      ? parseInt(unicode, 16)
      : hex
        ? parseInt(hex, 16)
        : letter
          ? named[letter]
          : 0x20,
  );
}

describe("UT-VAL-04 trimming", () => {
  it("UT-VAL-04 trims exactly the whitespace the database trims, so lengths agree", () => {
    const trimmed = databaseTrimSet();
    expect(trimmed).toHaveLength(25);
    for (const point of trimmed) {
      expect(
        checkText(cp(point) + "Ana" + cp(point), { min: 1, max: 3 }),
      ).toEqual({ value: "Ana" });
    }
    // And nothing else: these look like spaces but aren't trimmed, on either side.
    for (const point of [0x0085, 0x180e, 0x200b]) {
      expect(trimmed).not.toContain(point);
      expect(toStoredText(cp(point) + "Ana")).toBe(cp(point) + "Ana");
    }
  });
});

describe("UT-VAL-13 HTML or a script tag in a text field", () => {
  it.each([
    "<script>alert(1)</script>",
    "<b>Bold</b> & <i>brave</i>",
    '<img src=x onerror="alert(1)">',
  ])("UT-VAL-13 accepted as plain text, unchanged: %s", (value) => {
    expect(checkText(value, { min: 1, max: 1000 })).toEqual({ value });
  });
});
