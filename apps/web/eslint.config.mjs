import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import boundaries from "eslint-plugin-boundaries";

const scripts = "{ts,tsx,mts,cts,js,jsx,mjs,cjs}";

// Every file in src/server starts with `import "server-only"`, so Next.js fails the build if
// client code imports one (.claude/rules/web.md).
const requireServerOnly = {
  meta: {
    type: "problem",
    messages: {
      missing: 'Files in src/server start with `import "server-only";`.',
    },
  },
  create(context) {
    return {
      Program(program) {
        const first = program.body[0];
        const serverOnly =
          first?.type === "ImportDeclaration" &&
          first.source.value === "server-only" &&
          first.specifiers.length === 0;
        if (!serverOnly)
          context.report({ node: first ?? program, messageId: "missing" });
      },
    };
  },
};

const supabaseMessage =
  "Reach Supabase through the data access layer in src/server.";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Import boundaries (spec §14.2): features stay separate, and server code stays on the server.
  {
    files: [`src/**/*.${scripts}`],
    plugins: { boundaries },
    settings: {
      "boundaries/root-path": import.meta.dirname,
      // An import the resolver can't place counts as a local file in no element, which
      // no-unknown-dependencies refuses, so a broken resolver fails the build instead of
      // switching the boundaries off. Workspace packages (@curio/*) count as external.
      "boundaries/flag-as-external": {
        unresolvableAlias: false,
        customSourcePatterns: ["@curio/*"],
      },
      "boundaries/elements": [
        { type: "app", pattern: "src/app", partialMatch: false },
        {
          type: "feature",
          pattern: "src/features/*",
          capture: ["feature"],
          partialMatch: false,
        },
        { type: "server", pattern: "src/server", partialMatch: false },
        { type: "shared", pattern: "src/shared", partialMatch: false },
      ],
    },
    rules: {
      "boundaries/dependencies": [
        "error",
        {
          default: "disallow",
          policies: [
            { allow: { dependency: { relationship: { to: "internal" } } } },
            {
              from: { element: { type: "app" } },
              allow: {
                to: { element: { types: ["feature", "server", "shared"] } },
              },
            },
            {
              from: { element: { type: "feature" } },
              allow: { to: { element: { types: ["server", "shared"] } } },
            },
            // Report, block and safety tips appear on several screens, so other features may use
            // the safety feature's public index, as on iOS (spec §12).
            {
              from: { element: { type: "feature" } },
              allow: {
                to: {
                  element: {
                    type: "feature",
                    captured: { feature: "safety" },
                    fileInternalPath: "index.ts",
                  },
                },
              },
            },
            {
              from: { element: { type: "server" } },
              allow: { to: { element: { type: "shared" } } },
            },
          ],
        },
      ],
      "boundaries/no-unknown-dependencies": "error",
    },
  },
  // Supabase is reached through the data access layer (.claude/rules/web.md). src/proxy.ts
  // refreshes the session with it (T13). The browser client, for Realtime and the chat insert,
  // gets its exemption in the task that adds it.
  {
    files: [`src/**/*.${scripts}`],
    ignores: ["src/server/**", "src/proxy.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [{ group: ["@supabase/*"], message: supabaseMessage }] },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "ImportExpression[source.value=/^@supabase\\//]",
          message: supabaseMessage,
        },
      ],
    },
  },
  {
    files: [`src/server/**/*.${scripts}`],
    ignores: ["src/server/**/*.test.*", "src/server/**/*.d.ts"],
    plugins: { curio: { rules: { "require-server-only": requireServerOnly } } },
    rules: { "curio/require-server-only": "error" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "coverage/**",
    // Files that break the rules on purpose, linted by eslint.config.test.ts.
    "eslint-fixtures/**",
  ]),
]);

export default eslintConfig;
