import { expect, test } from "@playwright/test";
import { FIXED_HEADERS } from "../src/shared/security-headers";
import { withoutCallLog } from "./support";

// WEB-ACT-12 on the preview (T14's Done when): each page's security headers, a CSP whose nonce
// the page's own scripts carry, and a page that keeps to its CSP. A 404 stands in for every page
// the app doesn't know, and one named like a file for the paths the proxy used to skip. Header
// values hold no secrets, so a failure can print them; violations are kept to their directive and
// origin, since a blocked URL could carry a token.
const pages = [
  "/",
  "/a-page-that-does-not-exist",
  "/a-page-that-does-not-exist.png",
];

// The only sources the deployed CSP may name: keywords, Mapbox's data: and blob:, the third
// parties in spec §13.5 A02, the staging project over HTTPS and WebSocket, and Sentry's ingest.
const allowedSource =
  /^('self'|'none'|'strict-dynamic'|'nonce-[A-Za-z0-9+/=]+'|data:|blob:|https:\/\/(js\.stripe\.com|api\.stripe\.com|challenges\.cloudflare\.com|api\.mapbox\.com|events\.mapbox\.com)|(https|wss):\/\/[a-z]{20}\.supabase\.co|https:\/\/o\d+\.ingest(\.[a-z]{2})?\.sentry\.io)$/;

function directives(policy: string): Record<string, string[]> {
  return Object.fromEntries(
    policy.split(";").map((directive) => {
      const [name, ...sources] = directive.trim().split(/\s+/);
      return [name, sources];
    }),
  );
}

function expectFixedHeaders(headers: Record<string, string>) {
  // Vercel may send its own HSTS as well, so it only has to last at least as long.
  const maxAge = Number(
    /max-age=(\d+)/.exec(headers["strict-transport-security"] ?? "")?.[1],
  );
  expect(maxAge, "HSTS for at least a year").toBeGreaterThanOrEqual(31_536_000);
  for (const { key, value } of FIXED_HEADERS)
    if (key !== "Strict-Transport-Security")
      expect(headers[key.toLowerCase()], key).toBe(value);
}

for (const path of pages) {
  test(`WEB-ACT-12 ${path} sends the security headers, and keeps to its CSP`, async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const seen: string[] = [];
      (window as unknown as { cspViolations: string[] }).cspViolations = seen;
      document.addEventListener("securitypolicyviolation", (event) => {
        let blocked = event.blockedURI;
        try {
          blocked = new URL(blocked).origin;
        } catch {}
        seen.push(`${event.violatedDirective} ${blocked}`);
      });
    });
    const response = await page.goto(path, { waitUntil: "networkidle" });
    const headers = response!.headers();
    const policy = headers["content-security-policy"] ?? "";
    const csp = directives(policy);
    const nonce = /'nonce-([^']+)'/.exec(policy)?.[1];

    expect(nonce, "a nonce in script-src").toBeTruthy();
    expect(csp["script-src"]).toEqual(
      expect.arrayContaining([`'nonce-${nonce}'`, "'strict-dynamic'"]),
    );
    expect(csp["style-src"]).toContain(`'nonce-${nonce}'`);
    expect(policy).not.toMatch(/unsafe-eval|unsafe-inline/);
    expect(csp["frame-ancestors"]).toEqual(["'none'"]);
    expect(csp["object-src"]).toEqual(["'none'"]);
    // Mapbox GL JS's workers and images.
    expect(csp["worker-src"]).toContain("blob:");
    expect(csp["img-src"]).toEqual(expect.arrayContaining(["data:", "blob:"]));
    expect(csp).toHaveProperty("upgrade-insecure-requests");
    const unexpected = Object.values(csp)
      .flat()
      .filter((source) => !allowedSource.test(source));
    expect(unexpected, "sources the CSP may not name").toEqual([]);
    expectFixedHeaders(headers);

    // Next stamps the response's nonce on the page's own scripts.
    const nonces = await page.evaluate(() =>
      [...document.scripts].map((script) => script.nonce).filter(Boolean),
    );
    expect(nonces.length).toBeGreaterThan(0);
    expect(new Set(nonces)).toEqual(new Set([nonce]));
    expect(
      await page.evaluate(
        () => (window as unknown as { cspViolations: string[] }).cspViolations,
      ),
    ).toEqual([]);
  });
}

test("WEB-ACT-12 every page load gets a new nonce", async ({ page }) => {
  const nonceOf = async () =>
    /'nonce-([^']+)'/.exec(
      (await page.goto("/"))!.headers()["content-security-policy"] ?? "",
    )?.[1];
  const first = await nonceOf();
  expect(first).toBeTruthy();
  expect(await nonceOf()).not.toBe(first);
});

test("WEB-ACT-12 static files and the health route get the fixed headers", async ({
  page,
}) => {
  await page.goto("/");
  const script = await page.evaluate(
    () =>
      [...document.scripts]
        .map((element) => element.src)
        .find((src) => src.includes("/_next/static/")) ?? null,
  );
  expect(script, "a script from /_next/static/").toBeTruthy();
  for (const url of [script!, "/api/health"]) {
    const response = await withoutCallLog(page.request.get(url));
    expect(response.ok(), url).toBe(true);
    expectFixedHeaders(response.headers());
  }
});
