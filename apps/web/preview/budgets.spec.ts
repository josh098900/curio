import { appendFile, readFile } from "node:fs/promises";
import { chromium, expect, test } from "@playwright/test";
import lighthouse from "lighthouse";
import { env, stateFile } from "./support";

// The performance budget (spec §14.2, NFR-PER-01). Lighthouse's default run is a mobile phone
// on a slow 4G connection, simulated, as NF-PERF-01 asks. The budget is meant for Discover's
// feed, which joins once it exists (T31), along with the build's chunk sizes.
const pages = ["/"];
const budgets = [
  { label: "LCP", audit: "largest-contentful-paint", most: 2500, unit: " ms" },
  { label: "TBT", audit: "total-blocking-time", most: 200, unit: " ms" },
  { label: "CLS", audit: "cumulative-layout-shift", most: 0.1, unit: "" },
] as const;
// Compressed JavaScript before the map opens.
const mostScriptKB = 200;
const runs = 3;
const port = 9222;

type Report = NonNullable<Awaited<ReturnType<typeof lighthouse>>>["lhr"];

function median(values: number[]) {
  return [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
}

function scriptKB(report: Report) {
  const details = report.audits["resource-summary"]?.details;
  const rows =
    details && "items" in details
      ? (details.items as Record<string, unknown>[])
      : [];
  const scripts = rows.find((row) => row.resourceType === "script");
  return typeof scripts?.transferSize === "number"
    ? scripts.transferSize / 1024
    : 0;
}

for (const path of pages) {
  test(`${path} keeps within the Lighthouse budgets`, async () => {
    test.setTimeout(240_000);
    // Lighthouse drives the browser through a debugging port. A persistent context is the
    // browser's default one, where Lighthouse opens its tab, so the bypass cookie reaches it.
    const context = await chromium.launchPersistentContext("", {
      channel: "chromium",
      viewport: null,
      args: [`--remote-debugging-port=${port}`],
    });
    try {
      const { cookies } = JSON.parse(await readFile(stateFile, "utf8"));
      await context.addCookies(cookies);
      // The median of three runs, as Lighthouse CI does, so one slow run doesn't fail the check.
      const reports: Report[] = [];
      for (let run = 0; run < runs; run++) {
        const result = await lighthouse(
          new URL(path, env("PREVIEW_URL")).href,
          {
            port,
            logLevel: "error",
            onlyCategories: ["performance"],
          },
        );
        expect(
          result?.lhr.runtimeError,
          "Lighthouse couldn't load the page.",
        ).toBeUndefined();
        reports.push(result!.lhr);
      }

      const measured = [
        ...budgets.map(({ label, audit, most, unit }) => ({
          label,
          most,
          unit,
          value: median(
            reports.map((report) => report.audits[audit]?.numericValue ?? NaN),
          ),
        })),
        {
          label: "JavaScript",
          most: mostScriptKB,
          unit: " KB",
          value: median(reports.map(scriptKB)),
        },
      ];
      const summary = measured
        .map(({ label, value, most, unit }) => {
          const shown = unit
            ? Math.round(value)
            : Math.round(value * 1000) / 1000;
          return `${label} ${shown}${unit} (at most ${most}${unit})`;
        })
        .join(", ");
      console.log(`${path}: ${summary}`);
      if (process.env.GITHUB_STEP_SUMMARY)
        await appendFile(
          process.env.GITHUB_STEP_SUMMARY,
          `**Lighthouse on \`${path}\`:** ${summary}\n\n`,
        );

      for (const { label, value, most } of measured)
        expect.soft(value, `${label} is over budget`).toBeLessThanOrEqual(most);
    } finally {
      await context.close();
    }
  });
}
