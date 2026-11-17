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

  // A server action gets its one backend call from action(), and a page reads through a data
  // access function, so nothing outside src/server reaches the client or the calls directly.
  it("the Supabase client and the backend calls stay inside src/server", async () => {
    for (const [code, filePath] of [
      [
        'import { createSupabase } from "@/server/supabase";\nexport const c = createSupabase;\n',
        "src/features/demo/actions.ts",
      ],
      [
        'import { oneCallBackend } from "@/server/backend";\nexport const b = oneCallBackend;\n',
        "src/features/demo/queries.ts",
      ],
      [
        'import { createSupabase } from "../../server/supabase";\nexport const c = createSupabase;\n',
        "src/features/demo/queries.ts",
      ],
      [
        'import { createSupabase } from "@/server/supabase";\nexport const c = createSupabase;\n',
        "src/app/plans/page.tsx",
      ],
    ])
      expect(await rulesBroken(code, filePath), filePath).toContain(
        "no-restricted-imports",
      );
    for (const [code, filePath] of [
      [
        'export const load = () => import("@/server/backend");\n',
        "src/features/demo/lazy.ts",
      ],
      [
        '"use server";\nexport async function load() { return import("@supabase/supabase-js"); }\n',
        "src/features/demo/actions.ts",
      ],
    ])
      expect(await rulesBroken(code, filePath), filePath).toContain(
        "no-restricted-syntax",
      );
    expect(
      await rulesBroken(
        '"use server";\nimport { action, noInput } from "@/server/action";\nexport const save = action({ input: noInput, run: async () => null });\n',
        "src/features/demo/actions.ts",
      ),
    ).not.toContain("no-restricted-imports");
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
      "raw HTML in a feature's actions file",
      "src/features/demo/actions.ts",
      '"use server";\nexport async function show(el: HTMLElement, text: string) { el.innerHTML = text; }\n',
      "no-restricted-syntax",
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

describe("every link is the shared Link, which never prefetches", () => {
  const code =
    'import Link from "next/link";\nexport const A = () => <Link href="/plans">Plans</Link>;\n';

  // Button.tsx sits beside the shared Link, so the exemption can't cover its whole folder.
  it.each(["src/app/page.tsx", "src/shared/ui/Button.tsx"])(
    "next/link is refused in %s",
    async (filePath) => {
      expect(await rulesBroken(code, filePath)).toContain(
        "no-restricted-imports",
      );
    },
  );

  it("the shared Link may use it", async () => {
    expect(await rulesBroken(code, "src/shared/ui/Link.tsx")).not.toContain(
      "no-restricted-imports",
    );
  });
});

describe("no inline styles, which the CSP refuses", () => {
  it.each([
    [
      "src/app/page.tsx",
      'export default function Page() { return <p style={{ color: "red" }}>x</p>; }\n',
    ],
    [
      "src/shared/ui/Box.test.tsx",
      "export const Box = () => <div style={{ padding: 4 }} />;\n",
    ],
  ])("refused in %s", async (filePath, code) => {
    expect(await rulesBroken(code, filePath)).toContain("no-restricted-syntax");
  });

  it("a class is fine", async () => {
    expect(
      await rulesBroken(
        'export const Box = () => <div className="box" />;\n',
        "src/shared/ui/Box.tsx",
      ),
    ).not.toContain("no-restricted-syntax");
  });
});

describe("the shared fakes in test/ are for tests alone", () => {
  const code =
    'import { signedIn } from "../../test/fake-supabase";\nexport const s = signedIn;\n';

  it.each([
    "src/server/user.ts",
    "src/features/demo/queries.ts",
    "src/proxy.ts",
  ])("refused in %s", async (filePath) => {
    expect(await rulesBroken(code, filePath)).toContain("no-restricted-syntax");
  });

  it("a test may use them", async () => {
    expect(await rulesBroken(code, "src/server/user.test.ts")).not.toContain(
      "no-restricted-syntax",
    );
  });
});

describe("WEB-ACT-03 the server code never calls getSession()", () => {
  // getSession() reads the cookie without verifying it (spec §13.2), however it's reached.
  const refused: [string, string, string][] = [
    [
      "a call in the data access layer",
      "src/server/user.ts",
      'import "server-only";\nexport const user = (supabase: any) => supabase.auth.getSession();\n',
    ],
    [
      "a call in a route handler",
      "src/app/api/me/route.ts",
      "export async function GET(supabase: any) { return Response.json(await supabase.auth.getSession()); }\n",
    ],
    [
      "a call in a server component",
      "src/app/plans/page.tsx",
      "export default async function Page({ supabase }: { supabase: any }) { await supabase.auth.getSession(); return null; }\n",
    ],
    [
      "a call in the proxy",
      "src/proxy.ts",
      "export async function proxy(supabase: any) { await supabase.auth.getSession(); }\n",
    ],
    [
      "passing it around",
      "src/features/demo/queries.ts",
      "export const read = (supabase: any) => supabase.auth.getSession;\n",
    ],
    [
      "destructuring it",
      "src/features/demo/queries.ts",
      "export const read = (supabase: any) => { const { getSession } = supabase.auth; return getSession(); };\n",
    ],
    [
      "naming it with a string",
      "src/features/demo/queries.ts",
      "export const read = (supabase: any) => supabase.auth['getSession']();\n",
    ],
    [
      "naming it with a template",
      "src/features/demo/queries.ts",
      "export const read = (supabase: any) => supabase.auth[`getSession`]();\n",
    ],
    [
      "its unchecked session through onAuthStateChange",
      "src/server/user.ts",
      'import "server-only";\nexport const watch = (supabase: any) => supabase.auth.onAuthStateChange(() => {});\n',
    ],
    [
      "a name worked out when it runs",
      "src/features/demo/queries.ts",
      "export const read = (supabase: any, name: string) => supabase.auth[name]();\n",
    ],
    [
      "a call in a feature's actions file",
      "src/features/demo/actions.ts",
      '"use server";\nexport async function save(supabase: any) { await supabase.auth.getSession(); }\n',
    ],
  ];

  it.each(refused)("WEB-ACT-03 refused: %s", async (_, filePath, code) => {
    expect(await rulesBroken(code, filePath)).toContain("no-restricted-syntax");
  });

  it("WEB-ACT-03 getClaims() is fine", async () => {
    expect(
      await rulesBroken(
        'import "server-only";\nexport const user = (supabase: any) => supabase.auth.getClaims();\n',
        "src/server/user.ts",
      ),
    ).not.toContain("no-restricted-syntax");
  });
});

describe('"use server" only starts a feature\'s actions.ts', () => {
  // So the tests that find every server action miss none (WEB-ACT-01, 02 and 04).
  const refused: [string, string, string][] = [
    [
      "an action inside a component",
      "src/app/plans/page.tsx",
      'export default function Page() { async function save() { "use server"; } return <form action={save} />; }\n',
    ],
    [
      "an action inside a function in actions.ts",
      "src/features/demo/actions.ts",
      '"use server";\nexport async function save() { "use server"; }\n',
    ],
    [
      "a feature file that isn't actions.ts",
      "src/features/demo/save.ts",
      '"use server";\nexport async function save() {}\n',
    ],
    [
      "a file in src/server",
      "src/server/save.ts",
      '"use server";\nimport "server-only";\nexport async function save() {}\n',
    ],
    [
      "a directive written with an escape",
      "src/app/plans/page.tsx",
      'export default function Page() { async function save() { "use\\x20server"; } return <form action={save} />; }\n',
    ],
    [
      "a file outside src",
      "test/helpers.ts",
      '"use server";\nexport async function save() {}\n',
    ],
    [
      "an actions file the tests don't look for",
      "src/features/demo/actions.tsx",
      '"use server";\nexport async function save() {}\n',
    ],
  ];

  it.each(refused)("refused: %s", async (_, filePath, code) => {
    expect(await rulesBroken(code, filePath)).toContain("no-restricted-syntax");
  });

  it("the first line of a feature's actions.ts is fine", async () => {
    expect(
      await rulesBroken(
        '"use server";\nexport async function save() {}\n',
        "src/features/demo/actions.ts",
      ),
    ).not.toContain("no-restricted-syntax");
  });
});
