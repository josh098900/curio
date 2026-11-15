import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { appSessionCookie } from "./support";

// The key pages, each checked by axe in both themes. Each joins as it's built, Discover first
// once it exists (T31).
const keyPages = ["/"];

test("the home page loads", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

// A navigation rather than page.request, whose errors would list the cookies it sent.
test("the health route reaches staging's database", async ({ page }) => {
  const response = await page.goto("/api/health");
  expect(response?.status()).toBe(200);
  expect(await response?.json()).toEqual({ status: "ok" });
});

// The sign-in step's session cookie reaches the preview alone, and page scripts can't read it
// (T13). The values aren't compared, so a failure can't print them. T15's app shell, the first
// page that shows who's signed in, checks the app reads it.
test("the browser holds the app's session cookie, for the preview alone", async ({
  context,
  baseURL,
}) => {
  const session = (await context.cookies()).filter(({ name }) =>
    appSessionCookie.test(name),
  );
  expect(session.length).toBeGreaterThan(0);
  for (const { domain, httpOnly, secure, sameSite } of session)
    expect({ domain, httpOnly, secure, sameSite }).toEqual({
      domain: new URL(baseURL!).hostname,
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    });
});

// Vercel's toolbar is its own script, not Curio's, and would skew axe, Lighthouse and ZAP.
test("previews have no Vercel toolbar", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.locator('script[src*="vercel.live"]'),
    "Turn the Vercel Toolbar off for previews (Project Settings → General).",
  ).toHaveCount(0);
});

// The accessibility budget (spec §14.2, NFR-ACS-01): no critical or serious issue.
for (const path of keyPages) {
  for (const colorScheme of ["light", "dark"] as const) {
    test(`axe finds no critical or serious issues on ${path} (${colorScheme})`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme });
      await page.goto(path);
      const { violations } = await new AxeBuilder({ page }).analyze();
      const blocking = violations.filter(
        ({ impact }) => impact === "critical" || impact === "serious",
      );
      expect(
        blocking.map(
          ({ id, help, nodes }) => `${id}: ${help} (${nodes.length})`,
        ),
      ).toEqual([]);
    });
  }
}
