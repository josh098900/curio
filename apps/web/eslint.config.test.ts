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

describe("UT-VAL-13 HTML or a script tag in any text field", () => {
  // The contracts package accepts it as plain text. React escapes text it renders, so it could
  // only run through raw HTML, which these rules refuse everywhere in the app.
  const refused: [string, string, string, string][] = [
    [
      "raw HTML on an element",
      "src/features/demo/bio.tsx",
      "export const Bio = ({ bio }: { bio: string }) => <p dangerouslySetInnerHTML={{ __html: bio }} />;\n",
      "react/no-danger",
    ],
    [
      "raw HTML passed to a component",
      "src/features/demo/bio.tsx",
      "const Box = (props: object) => <div {...props} />;\nexport const Bio = ({ bio }: { bio: string }) => <Box dangerouslySetInnerHTML={{ __html: bio }} />;\n",
      "react/no-danger",
    ],
    [
      "raw HTML spread from an object",
      "src/features/demo/bio.tsx",
      "export const Bio = ({ bio }: { bio: string }) => <p {...{ dangerouslySetInnerHTML: { __html: bio } }} />;\n",
      "no-restricted-syntax",
    ],
    [
      "raw HTML through createElement",
      "src/features/demo/bio.ts",
      'import { createElement } from "react";\nexport const bio = (text: string) => createElement("p", { dangerouslySetInnerHTML: { __html: text } });\n',
      "no-restricted-syntax",
    ],
    [
      "a frame's srcDoc",
      "src/features/demo/frame.tsx",
      'export const Frame = ({ html }: { html: string }) => <iframe title="x" srcDoc={html} />;\n',
      "no-restricted-syntax",
    ],
    [
      "innerHTML",
      "src/features/demo/dom.ts",
      "export const show = (el: HTMLElement, text: string) => { el.innerHTML = text; };\n",
      "no-restricted-syntax",
    ],
    [
      "outerHTML",
      "src/features/demo/dom.ts",
      "export const show = (el: HTMLElement, text: string) => { el.outerHTML = text; };\n",
      "no-restricted-syntax",
    ],
    [
      "insertAdjacentHTML",
      "src/features/demo/dom.ts",
      'export const show = (el: HTMLElement, text: string) => el.insertAdjacentHTML("beforeend", text);\n',
      "no-restricted-syntax",
    ],
    [
      "Mapbox's popup HTML",
      "src/features/demo/map.ts",
      "export const show = (popup: { setHTML(html: string): void }, text: string) => popup.setHTML(text);\n",
      "no-restricted-syntax",
    ],
    [
      "document.write",
      "src/features/demo/dom.ts",
      "export const show = (text: string) => document.write(text);\n",
      "no-restricted-syntax",
    ],
    [
      "createContextualFragment",
      "src/features/demo/dom.ts",
      "export const show = (range: Range, text: string) => range.createContextualFragment(text);\n",
      "no-restricted-syntax",
    ],
    [
      "eval",
      "src/features/demo/run.ts",
      "export const run = (text: string) => eval(text);\n",
      "no-eval",
    ],
    [
      "a string run as code (the rule sees strings, not a bare variable, which needs type information)",
      "src/features/demo/run.ts",
      "export const run = (text: string) => setTimeout('show(' + text + ')', 0);\n",
      "no-implied-eval",
    ],
    [
      "new Function",
      "src/features/demo/run.ts",
      "export const run = (text: string) => new Function(text);\n",
      "no-new-func",
    ],
    [
      "raw HTML in server code",
      "src/server/page.ts",
      'import "server-only";\nexport const show = (el: HTMLElement, text: string) => { el.innerHTML = text; };\n',
      "no-restricted-syntax",
    ],
  ];

  it.each(refused)(
    "UT-VAL-13 is never run: %s is refused",
    async (_, filePath, code, rule) => {
      expect(await rulesBroken(code, filePath)).toContain(rule);
    },
  );

  it("UT-VAL-13 text rendered as text is fine", async () => {
    const broken = await rulesBroken(
      "export const Bio = ({ bio }: { bio: string }) => <p>{bio}</p>;\n",
      "src/features/demo/bio.tsx",
    );
    for (const rule of ["react/no-danger", "no-restricted-syntax"]) {
      expect(broken).not.toContain(rule);
    }
  });
});
