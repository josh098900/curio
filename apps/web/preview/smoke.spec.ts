import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

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
