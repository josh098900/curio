import { b } from "../beta/b";
import { tip } from "../safety";
import { inner } from "../safety/inner";
import { own } from "./own";
import { s } from "../../shared/s";
import { db } from "../../server/db";
import { unresolved } from "@/features/beta/b";
import type { Database } from "@curio/contracts";

export const a = [b, tip, inner, own, s, db, unresolved];
export type Contract = Database;
