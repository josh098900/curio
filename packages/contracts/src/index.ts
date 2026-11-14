// The contract both clients share: generated database types, validation rules and error codes
// (spec §11, D22). Each arrives with the task that needs it.
export type {
  CompositeTypes,
  Database,
  Enums,
  Json,
  Tables,
  TablesInsert,
  TablesUpdate,
} from "./database.types";
export {
  ERROR_CODES,
  ERROR_MESSAGES,
  FIELD_RULE_MESSAGES,
  HTTP_STATUS,
  parseApiError,
} from "./errors";
export type { ApiError, ErrorCode, FieldRule } from "./errors";
export {
  checkText,
  countCharacters,
  hasNoHiddenCharacters,
  toStoredText,
} from "./text";
export type { TextRule, TextVerdict } from "./text";
