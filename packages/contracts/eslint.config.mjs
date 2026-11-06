import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig([
  js.configs.recommended,
  tseslint.configs.recommended,
  // database.types.ts is the CLI's output, kept exactly as generated for the contract sync.
  globalIgnores(["coverage/**", "src/database.types.ts"]),
]);
