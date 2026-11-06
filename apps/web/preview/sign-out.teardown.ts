import { readFile, rm } from "node:fs/promises";
import { expect, test as teardown } from "@playwright/test";
import { auth, sessionFile } from "./support";

// Ends the session once the checks are done, so no sign-in outlives its run.
teardown("sign the test account out", async () => {
  const saved = await readFile(sessionFile, "utf8").catch(() => undefined);
  teardown.skip(
    !saved,
    "The sign-in didn't finish, so there's no session to end.",
  );
  const { access_token } = JSON.parse(saved!);
  const response = await auth("/logout?scope=local", { token: access_token });
  expect(response.status, "Auth didn't end the session.").toBe(204);
  await rm(sessionFile);
});
