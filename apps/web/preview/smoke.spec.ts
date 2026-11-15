import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { SESSION_COOKIE } from "../src/shared/supabase-settings";

// The key pages, each checked by axe in both themes: the shell signed in, S53 and S56. Each
// joins as it's built, Discover first once it exists (T31).
const keyPages = ["/", "/a-page-that-does-not-exist", "/signed-out"];

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
    SESSION_COOKIE.test(name),
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

// The app reads the sign-in step's cookie: the shell is only for people signed in (T13, T15).
test("the preview reads the session cookie: / shows the signed-in shell", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
});

test("without the session cookie, / has no shell", async ({
  page,
  context,
}) => {
  await context.clearCookies({ name: SESSION_COOKIE });
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(0);
});

// T15's Done when: the shell works at 360 and 1440 pixels wide, with nothing scrolling sideways,
// the tab bar on a phone and the top bar on desktop.
for (const width of [360, 1440]) {
  test(`the shell works at ${width} pixels wide`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav).toBeVisible();
    const box = (await nav.boundingBox())!;
    if (width < 900) expect(box.y + box.height).toBeCloseTo(800, 0);
    else expect(box.y).toBeLessThan(100);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    ).toBeLessThanOrEqual(0);
  });
}

// Both themes match S00's tokens, following the device's setting (FR-ACC-08, D29).
for (const [colorScheme, background] of [
  ["light", "rgb(247, 246, 242)"],
  ["dark", "rgb(17, 18, 20)"],
] as const) {
  test(`the ${colorScheme} device setting gives the ${colorScheme === "light" ? "day" : "night"} theme`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto("/");
    expect(
      await page.evaluate(
        () => getComputedStyle(document.body).backgroundColor,
      ),
    ).toBe(background);
  });
}

// Vercel's toolbar is its own script, not Curio's, and would skew axe, Lighthouse and ZAP.
test("previews have no Vercel toolbar", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.locator('script[src*="vercel.live"]'),
    "Turn the Vercel Toolbar off for previews (Project Settings → General).",
  ).toHaveCount(0);
});

// The accessibility budget (spec §14.2, NFR-ACS-01): no critical or serious issue, on each key
// page in both themes, on a phone (the tab bar) and on desktop (the top bar), signed in and, for
// the pages people reach signed out, signed out too.
const signedOutPages = ["/a-page-that-does-not-exist", "/signed-out"];
for (const [path, signedIn] of [
  ...keyPages.map((path) => [path, true] as const),
  ...signedOutPages.map((path) => [path, false] as const),
]) {
  for (const colorScheme of ["light", "dark"] as const) {
    for (const width of [360, 1440]) {
      test(`axe finds no critical or serious issues on ${path} (${colorScheme}, ${width} px, ${signedIn ? "signed in" : "signed out"})`, async ({
        page,
        context,
      }) => {
        if (!signedIn) await context.clearCookies({ name: SESSION_COOKIE });
        await page.setViewportSize({ width, height: 800 });
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
}
