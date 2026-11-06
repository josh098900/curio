import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, request, test as setup } from "@playwright/test";
import {
  auth,
  env,
  sessionFile,
  stateFile,
  testAccount,
  withoutCallLog,
} from "./support";

// Vercel's deployment protection, when it's on for previews. The bypass secret goes to the
// preview once, and Vercel answers with a cookie for the preview's own host, so the browser
// checks never send the secret anywhere else. Not following the redirect matters: Playwright
// would send the secret on to wherever it led.
setup("get past Vercel's deployment protection", async () => {
  const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  const context = await request.newContext();
  try {
    if (secret) {
      await withoutCallLog(
        context.get(env("PREVIEW_URL"), {
          headers: {
            "x-vercel-protection-bypass": secret,
            "x-vercel-set-bypass-cookie": "true",
          },
          maxRedirects: 0,
        }),
      );
    }
    const response = await withoutCallLog(context.get(env("PREVIEW_URL")));
    expect(
      response.status(),
      "Vercel refused the preview checks. Check the bypass secret.",
    ).toBe(200);
    await mkdir(path.dirname(stateFile), { recursive: true });
    await context.storageState({ path: stateFile });
  } finally {
    await context.dispose();
  }
});

// Signing in without an email or a password (spec §14.2): the Auth admin API makes a one-time
// code with staging's `ci_preview` key, and the code is exchanged for a session.
setup("sign in as the staging test account", async () => {
  // The first run creates the account. After that, Auth says it exists.
  const created = await auth("/admin/users", {
    secret: true,
    body: { email: testAccount, email_confirm: true },
  });
  if (!created.ok) {
    const { error_code } = await created.json();
    expect(
      error_code,
      `Auth didn't create the test account (HTTP ${created.status}).`,
    ).toBe("email_exists");
  }

  // Each new code replaces the last, so another job signing in at the same moment can spoil
  // this one's. Then it waits a moment and tries again.
  let session: { access_token: string; user: { id: string } } | undefined;
  for (let attempt = 1; !session; attempt++) {
    const link = await auth("/admin/generate_link", {
      secret: true,
      body: { type: "magiclink", email: testAccount },
    });
    expect(link.status, "Auth didn't make a one-time code.").toBe(200);
    const { email_otp } = await link.json();
    const verified = await auth("/verify", {
      body: { type: "email", email: testAccount, token: email_otp },
    });
    if (verified.ok) session = await verified.json();
    else if (attempt === 3)
      throw new Error(
        `Auth refused the one-time code (HTTP ${verified.status}).`,
      );
    else
      await new Promise((resolve) =>
        setTimeout(resolve, 1000 + Math.random() * 2000),
      );
  }

  // The session is real if Auth answers to it.
  const user = await auth("/user", {
    method: "GET",
    token: session.access_token,
  });
  expect(user.status, "Auth didn't accept the session.").toBe(200);
  const { id } = await user.json();
  expect(id).toBe(session.user.id);
  console.log(
    `Signed in as the staging test account (user ${id}), with no email or password.`,
  );
  await writeFile(sessionFile, JSON.stringify(session), { mode: 0o600 });
});
