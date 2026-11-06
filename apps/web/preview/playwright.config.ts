import { defineConfig, devices } from "@playwright/test";
import { stateFile } from "./support";

// The preview checks (spec §14.2), which .github/workflows/preview.yml runs against each pull
// request's Vercel preview, built against staging. The end-to-end journeys in e2e/ get their
// own config with the first one (T17).
export default defineConfig({
  testDir: ".",
  forbidOnly: true,
  // Only the list in the log: an HTML report or a trace would hold the session and Vercel's
  // bypass cookie, and anyone signed in to GitHub can download a public repo's artifacts.
  reporter: [["list"], ["github"]],
  use: { baseURL: process.env.PREVIEW_URL, trace: "off" },
  projects: [
    { name: "sign-in", testMatch: /sign-in\.setup\.ts/, teardown: "sign-out" },
    { name: "sign-out", testMatch: /sign-out\.teardown\.ts/ },
    {
      name: "smoke",
      testMatch: /smoke\.spec\.ts/,
      dependencies: ["sign-in"],
      use: { ...devices["Desktop Chrome"], storageState: stateFile },
    },
    {
      name: "budgets",
      testMatch: /budgets\.spec\.ts/,
      dependencies: ["sign-in"],
    },
  ],
});
