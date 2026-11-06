// @vitest-environment node
// The import-boundary fitness function's own rules (spec §14.2).
import path from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const eslint = new ESLint({ cwd: import.meta.dirname });

async function rulesBroken(code: string, filePath: string) {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.map((message) => message.ruleId);
}

describe("import boundaries", () => {
  // The boundaries resolve real files, so they run over eslint-fixtures/boundaries, a copy of
  // the src layout whose files break the rules on purpose.
  it("features stay separate, and server and shared code don't import features", async () => {
    const fixtures = path.join(
      import.meta.dirname,
      "eslint-fixtures",
      "boundaries",
    );
    const fixtureLint = new ESLint({
      cwd: fixtures,
      overrideConfigFile: path.join(import.meta.dirname, "eslint.config.mjs"),
      overrideConfig: { settings: { "boundaries/root-path": fixtures } },
    });
    const refused = (await fixtureLint.lintFiles(["src"])).flatMap((result) =>
      result.messages
        .filter((message) => message.ruleId?.startsWith("boundaries/"))
        .map(
          (message) =>
            `${path.relative(fixtures, result.filePath)}:${message.line} ${message.ruleId}`,
        ),
    );
    expect(refused.sort()).toEqual([
      // another feature
      "src/features/alpha/a.ts:1 boundaries/dependencies",
      // the safety feature's internals, not its index
      "src/features/alpha/a.ts:3 boundaries/dependencies",
      // an import the resolver can't place
      "src/features/alpha/a.ts:7 boundaries/no-unknown-dependencies",
      // server code importing a feature
      "src/server/uses-feature.ts:2 boundaries/dependencies",
      // shared code importing a feature
      "src/shared/bad.ts:1 boundaries/dependencies",
    ]);
  });

  it("files in src/server start with import 'server-only'", async () => {
    expect(
      await rulesBroken("export const db = 1;\n", "src/server/db.ts"),
    ).toContain("curio/require-server-only");
    expect(
      await rulesBroken(
        "export const Row = () => null;\n",
        "src/server/row.tsx",
      ),
    ).toContain("curio/require-server-only");
    // TypeScript drops both of these, so neither keeps the file off the client.
    for (const dropped of [
      'import {} from "server-only";\n',
      'import type {} from "server-only";\n',
    ]) {
      expect(
        await rulesBroken(
          `${dropped}export const db = 1;\n`,
          "src/server/db.ts",
        ),
      ).toContain("curio/require-server-only");
    }
    expect(
      await rulesBroken(
        'import "server-only";\nexport const db = 1;\n',
        "src/server/db.ts",
      ),
    ).toEqual([]);
  });

  // Supabase isn't installed yet, so these check only the Supabase rules: until T13 adds it, the
  // unresolved import also counts as unknown.
  it("Supabase is imported only in src/server and src/proxy.ts", async () => {
    const code =
      'import { createClient } from "@supabase/supabase-js";\nexport const client = createClient;\n';
    expect(await rulesBroken(code, "src/features/demo/client.ts")).toContain(
      "no-restricted-imports",
    );
    expect(
      await rulesBroken(
        'export const load = () => import("@supabase/supabase-js");\n',
        "src/features/demo/lazy.ts",
      ),
    ).toContain("no-restricted-syntax");
    expect(
      await rulesBroken(
        "export const load = () => import(`@supabase/supabase-js`);\n",
        "src/features/demo/lazy.ts",
      ),
    ).toContain("no-restricted-syntax");
    expect(
      await rulesBroken(
        `import "server-only";\n${code}`,
        "src/server/client.ts",
      ),
    ).not.toContain("no-restricted-imports");
    expect(await rulesBroken(code, "src/proxy.ts")).not.toContain(
      "no-restricted-imports",
    );
  });
});
