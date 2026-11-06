// @vitest-environment node
// The production gate (spec §14.2): Vercel never deploys main by itself, so production changes
// only through the approved Deploy workflow.
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

it("vercel.json keeps Git deployments from main off", () => {
  const config = JSON.parse(
    readFileSync(path.join(import.meta.dirname, "vercel.json"), "utf8"),
  );
  expect(config.git?.deploymentEnabled?.main).toBe(false);
});
