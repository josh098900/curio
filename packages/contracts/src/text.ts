// The text rules every validation schema shares (data dictionary conventions). Each matches the
// database's CHECK helpers in T07's migration exactly, so the package and the database give the
// same verdict (UT-VAL-18):
// - lengths count characters (code points, as Postgres's char_length does), after trimming the
//   whitespace String.prototype.trim() removes, which private.trimmed_length removes too;
// - text is stored in NFC form;
// - names and titles refuse control, zero-width and direction characters, as
//   private.has_no_hidden_characters does;
// - HTML is plain text: it's stored as typed and rendered escaped, never run (UT-VAL-13).
// Characters are written as code-point numbers, never as escapes or literals, so none can hide.

import type { FieldRule } from "./errors";

type Range = readonly [number, number];

// Refused anywhere: C0 and C1 controls; U+00AD; U+034F; U+061C; the Hangul fillers U+115F,
// U+1160, U+3164 and U+FFA0; U+17B4 and U+17B5; U+180E; U+200B; U+200E and U+200F; U+2028 and
// U+2029; U+202A to U+202E; U+2060 to U+206F; U+2800; U+FEFF; U+FFF0 to U+FFFB; U+1BCA0 to
// U+1BCA3; U+1D173 to U+1D17A. The database can't store U+0000 at all, so it's refused here too.
const REFUSED: readonly Range[] = [
  [0x0000, 0x001f],
  [0x007f, 0x009f],
  [0x00ad, 0x00ad],
  [0x034f, 0x034f],
  [0x061c, 0x061c],
  [0x115f, 0x1160],
  [0x17b4, 0x17b5],
  [0x180e, 0x180e],
  [0x200b, 0x200b],
  [0x200e, 0x200f],
  [0x2028, 0x2029],
  [0x202a, 0x202e],
  [0x2060, 0x206f],
  [0x2800, 0x2800],
  [0x3164, 0x3164],
  [0xfeff, 0xfeff],
  [0xffa0, 0xffa0],
  [0xfff0, 0xfffb],
  [0x1bca0, 0x1bca3],
  [0x1d173, 0x1d17a],
];

// The whitespace a joiner may not sit beside, as in the database's rule.
const WHITESPACE: readonly Range[] = [
  [0x0009, 0x000d],
  [0x0020, 0x0020],
  [0x00a0, 0x00a0],
  [0x1680, 0x1680],
  [0x2000, 0x200a],
  [0x202f, 0x202f],
  [0x205f, 0x205f],
  [0x3000, 0x3000],
];

// Variation selectors, allowed only straight after a visible character, as a red heart's is:
// U+FE00 to U+FE0F, U+E0100 to U+E01EF, and the Mongolian free variation selectors.
const SELECTORS: readonly Range[] = [
  [0xfe00, 0xfe0f],
  [0xe0100, 0xe01ef],
  [0x180b, 0x180d],
  [0x180f, 0x180f],
];

// What the database can't store at all: the null character, and a lone surrogate, which isn't
// a character. Refused in every field.
const UNSTORABLE: readonly Range[] = [
  [0x0000, 0x0000],
  [0xd800, 0xdfff],
];

const ZERO_WIDTH_NON_JOINER = 0x200c;
const ZERO_WIDTH_JOINER = 0x200d;
const WAVING_BLACK_FLAG = 0x1f3f4;
const TAG_FIRST = 0xe0020;
const TAG_LAST = 0xe007e;
const CANCEL_TAG = 0xe007f;
const TAG_BLOCK: Range = [0xe0000, 0xe007f];

function inRanges(point: number, ranges: readonly Range[]): boolean {
  return ranges.some(([first, last]) => point >= first && point <= last);
}

function isJoiner(point: number): boolean {
  return point === ZERO_WIDTH_NON_JOINER || point === ZERO_WIDTH_JOINER;
}

// The tag characters that spell a flag, such as England's: U+1F3F4, then one or more tags, then
// U+E007F. Returns the code points with each such flag's tags removed.
function withoutFlagTags(points: number[]): number[] {
  const kept: number[] = [];
  for (let i = 0; i < points.length; i++) {
    kept.push(points[i]);
    if (points[i] !== WAVING_BLACK_FLAG) continue;
    let end = i + 1;
    while (
      end < points.length &&
      points[end] >= TAG_FIRST &&
      points[end] <= TAG_LAST
    )
      end++;
    if (end > i + 1 && points[end] === CANCEL_TAG) i = end;
  }
  return kept;
}

// private.has_no_hidden_characters, in TypeScript.
export function hasNoHiddenCharacters(value: string): boolean {
  const points = Array.from(
    value,
    (character) => character.codePointAt(0) as number,
  );
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    if (inRanges(point, REFUSED)) return false;
    if (isJoiner(point)) {
      const before = i > 0 ? points[i - 1] : undefined;
      const after = i < points.length - 1 ? points[i + 1] : undefined;
      // Only between two visible characters: never at an end, beside whitespace or doubled.
      if (
        before === undefined ||
        isJoiner(before) ||
        inRanges(before, WHITESPACE)
      )
        return false;
      if (after === undefined || inRanges(after, WHITESPACE)) return false;
    }
    if (inRanges(point, SELECTORS)) {
      const before = i > 0 ? points[i - 1] : undefined;
      // Only straight after a visible character: never first, after whitespace, a joiner or
      // another selector.
      if (
        before === undefined ||
        isJoiner(before) ||
        inRanges(before, WHITESPACE) ||
        inRanges(before, SELECTORS)
      )
        return false;
    }
  }
  return !withoutFlagTags(points).some((point) => inRanges(point, [TAG_BLOCK]));
}

// Text as it's stored: NFC form, trimmed of the whitespace the database trims before counting.
// Functions store text the same way (data dictionary conventions), so the client and the
// database check the same value.
export function toStoredText(value: string): string {
  return value.normalize("NFC").trim();
}

// Characters as the database counts them: code points, not UTF-16 units or bytes.
export function countCharacters(value: string): number {
  return Array.from(value).length;
}

export interface TextRule {
  min: number;
  max: number;
  // Names and titles refuse control, zero-width and direction characters.
  refuseHidden?: boolean;
}

export type TextVerdict =
  | { value: string }
  | {
      rule: Extract<
        FieldRule,
        "required" | "too_short" | "too_long" | "hidden_characters" | "invalid"
      >;
    };

// Checks one text field. Gives the value to store, or the rule id it broke, which is the same id
// INVALID_INPUT's details use.
export function checkText(
  input: string,
  { min, max, refuseHidden = false }: TextRule,
): TextVerdict {
  const value = toStoredText(input);
  if (
    Array.from(value).some((character) =>
      inRanges(character.codePointAt(0) as number, UNSTORABLE),
    )
  )
    return { rule: "invalid" };
  const length = countCharacters(value);
  if (length === 0 && min > 0) return { rule: "required" };
  if (length < min) return { rule: "too_short" };
  if (length > max) return { rule: "too_long" };
  if (refuseHidden && !hasNoHiddenCharacters(value))
    return { rule: "hidden_characters" };
  return { value };
}
