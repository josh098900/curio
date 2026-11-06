// The contract both clients share: generated database types, validation schemas
// and error codes (spec §11, D22). Each arrives with the task that needs it.
export type {
  CompositeTypes,
  Database,
  Enums,
  Json,
  Tables,
  TablesInsert,
  TablesUpdate,
} from "./database.types";
