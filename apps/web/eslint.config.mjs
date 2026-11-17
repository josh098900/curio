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
        // Only the bare form counts: TypeScript drops `import {} from` and `import type`.
        const serverOnly =
          first?.type === "ImportDeclaration" &&
          first.source.value === "server-only" &&
          first.importKind !== "type" &&
          /^import\s*["']server-only["']/.test(
            context.sourceCode.getText(first),
          );
        if (!serverOnly)
          context.report({ node: first ?? program, messageId: "missing" });
      },
    };
  },
};

const supabaseMessage =
  "Reach Supabase through the data access layer in src/server.";
// Outside src/server, nothing reaches the Supabase client or the backend calls directly: a server
// action gets its one call from action(), and a page reads through a data access function in
// src/server (.claude/rules/web.md).
const dataAccessMessage =
  "Reach the backend through action() in a server action, or a data access function in src/server.";
const dataAccessInternals = [
  "@/server/supabase",
  "@/server/backend",
  "**/server/supabase",
  "**/server/backend",
];
const restrictedImportPatterns = [
  { group: ["@supabase/*"], message: supabaseMessage },
  { group: dataAccessInternals, message: dataAccessMessage },
];
const nextLinkImport = {
  name: "next/link",
  message: "Use Link from src/shared/ui/Link.tsx, which never prefetches.",
};
const supabaseSyntax = [
  {
    selector: "ImportExpression[source.value=/^@supabase\\//]",
    message: supabaseMessage,
  },
  {
    selector: "ImportExpression[source.value=/server\\/(supabase|backend)$/]",
    message: dataAccessMessage,
  },
  {
    selector: 'ImportExpression[source.type!="Literal"]',
    message: "Give import() a plain string, so lint can check what it loads.",
  },
];

// Text a person wrote is rendered escaped, never run (UT-VAL-13, .claude/rules/web.md). React
// escapes what it renders, so these are the ways round it: raw HTML in a prop, a frame's
// srcDoc, writing HTML into the page, and Mapbox's popup HTML. A safe use needs a reviewed
// exception here.
const rawHtmlMessage =
  "Render text a person wrote as text. Raw HTML would let it run (UT-VAL-13).";
const rawHtmlSelectors = [
  "JSXAttribute[name.name='dangerouslySetInnerHTML']",
  "Property[key.name='dangerouslySetInnerHTML']",
  "JSXAttribute[name.name=/^srcdoc$/i]",
  "AssignmentExpression[left.property.name=/^(innerHTML|outerHTML)$/]",
  "CallExpression[callee.property.name=/^(insertAdjacentHTML|setHTML|createContextualFragment)$/]",
  "CallExpression[callee.object.name='document'][callee.property.name=/^(write|writeln)$/]",
].map((selector) => ({ selector, message: rawHtmlMessage }));

// Server code checks the session with getClaims(), which verifies the token. getSession() reads
// the cookie without checking it, so it's refused everywhere in src, however it's reached:
// called, passed around, destructured or named by a string (spec §13.2, WEB-ACT-03). So is
// onAuthStateChange, whose callback gets the same unchecked session, and any computed name on
// .auth, which lint couldn't read. These catch mistakes; code written to get round them is for
// review to catch.
const getSessionMessage =
  "Check the session with getClaims(). getSession() reads the cookie without verifying it (WEB-ACT-03).";
const getSessionSelectors = [
  ...[
    "MemberExpression[property.name='getSession']",
    "MemberExpression[property.value='getSession']",
    "MemberExpression > TemplateLiteral.property[quasis.0.value.cooked='getSession']",
    "ObjectPattern > Property[key.name='getSession']",
    "ObjectPattern > Property[key.value='getSession']",
    "MemberExpression[property.name='onAuthStateChange']",
  ].map((selector) => ({ selector, message: getSessionMessage })),
  {
    selector: "MemberExpression[computed=true][object.property.name='auth']",
    message: "Name auth methods plainly, so lint can check them (WEB-ACT-03).",
  },
];

// The tests' shared fakes in test/ are for tests alone.
const testSupportMessage = "Only tests import the shared fakes in test/.";
const testSupportSelectors = [
  "ImportDeclaration",
  "ImportExpression",
  "ExportAllDeclaration",
  "ExportNamedDeclaration",
].map((node) => ({
  selector: `${node}[source.value=/^(\\.\\.?\\/)+test\\//]`,
  message: testSupportMessage,
}));

// Server actions live only in src/features/<feature>/actions.ts, each made with action() from
// src/server/action.ts, where the tests find and check every one (WEB-ACT-01, 02 and 04). So
// "use server" is refused anywhere else, inside a function even there, and in every other file
// lint sees, outside src too. The selectors read the string's value, not its source text, so an
// escape such as "use\x20server" can't hide one.
const useServerMessage =
  'Server actions go in src/features/<feature>/actions.ts, with "use server" as its first line, each made with action() (WEB-ACT-01).';
const useServerAnywhere = {
  selector: "ExpressionStatement[expression.value='use server']",
  message: useServerMessage,
};
const useServerInFunctions = {
  selector: ":function ExpressionStatement[expression.value='use server']",
  message: useServerMessage,
};
// The CSP runs styles only with its nonce, so a style attribute in server-rendered HTML is
// refused (T14). Style with a CSS Module class instead.
const inlineStyle = {
  selector: "JSXAttribute[name.name='style']",
  message:
    "Use a CSS Module class: the CSP refuses inline styles in server-rendered HTML (WEB-ACT-12).",
};
const restrictedInTests = [
  ...rawHtmlSelectors,
  ...getSessionSelectors,
  inlineStyle,
];
const restrictedEverywhere = [...restrictedInTests, ...testSupportSelectors];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Every file lint sees, outside src included; the blocks below give src its full lists.
  {
    files: [`**/*.${scripts}`],
    rules: { "no-restricted-syntax": ["error", useServerAnywhere] },
  },
  // Import boundaries (spec §14.2): features stay separate, and server code stays on the server.
  {
    files: [`src/**/*.${scripts}`],
    plugins: { boundaries },
    settings: {
      "boundaries/root-path": import.meta.dirname,
      // The tests' shared fakes (test/), which only tests may import (testSupportSelectors).
      "boundaries/ignore": ["test/**"],
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
        { paths: [nextLinkImport], patterns: restrictedImportPatterns },
      ],
      "no-restricted-syntax": [
        "error",
        ...supabaseSyntax,
        ...restrictedEverywhere,
        useServerAnywhere,
      ],
    },
  },
  // The shared Link may import next/link. A later no-restricted-imports replaces an earlier one, so
  // this keeps the other patterns.
  {
    files: ["src/shared/ui/Link.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: restrictedImportPatterns },
      ],
    },
  },
  // The one place "use server" may start a file. A later no-restricted-syntax replaces an earlier
  // one rather than adding to it, so each block repeats the full list.
  {
    files: ["src/features/*/actions.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...supabaseSyntax,
        ...restrictedEverywhere,
        useServerInFunctions,
      ],
    },
  },
  // Raw HTML and getSession() everywhere in the app, src/server and src/proxy.ts included
  // (UT-VAL-13, WEB-ACT-03). The other files get the same selectors in the blocks above, since a
  // later no-restricted-syntax would replace an earlier one rather than add to it.
  {
    files: [`src/**/*.${scripts}`],
    rules: {
      "react/no-danger": ["error", { customComponentNames: ["*"] }],
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
    },
  },
  {
    files: [`src/server/**/*.${scripts}`, `src/proxy.${scripts}`],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...restrictedEverywhere,
        useServerAnywhere,
      ],
    },
  },
  // Tests may use the shared fakes.
  {
    files: ["src/**/*.test.*"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...restrictedInTests,
        useServerAnywhere,
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
