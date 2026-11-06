import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // database.types.ts is generated from the schema and checked by CI's contract sync.
      exclude: ["src/**/*.d.ts", "src/**/*.test.ts", "src/database.types.ts"],
      thresholds: { lines: 70 },
    },
  },
});
