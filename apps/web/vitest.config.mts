import path from "node:path";
import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // T03's lint rule starts every file in src/server with import "server-only", which throws
      // outside React Server Components.
      "server-only": path.resolve(import.meta.dirname, "test/server-only.ts"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    // Playwright runs these: the journeys, and the checks on preview deployments.
    exclude: [...configDefaults.exclude, "e2e/**", "preview/**/*.spec.ts"],
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      // NFR-MAI-01: 70% line coverage of TypeScript logic, so components (.tsx) aren't counted.
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.d.ts", "src/**/*.test.ts"],
      thresholds: { lines: 70 },
    },
  },
});
