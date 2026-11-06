// @vitest-environment node
// The preview checks' logs are public, so a failed request mustn't print the cookies it sent.
import { request } from "@playwright/test";
import { expect, it } from "vitest";
import { withoutCallLog } from "./support";

it("a failed request's error leaves out the cookies it sent", async () => {
  const context = await request.newContext({
    storageState: {
      cookies: [
        {
          name: "bypass",
          value: "not-a-real-cookie",
          domain: "127.0.0.1",
          path: "/",
          expires: -1,
          httpOnly: true,
          secure: false,
          sameSite: "Lax",
        },
      ],
      origins: [],
    },
  });
  try {
    // Nothing listens on port 9, so the request fails before any answer.
    const failure = await withoutCallLog(
      context.get("http://127.0.0.1:9/"),
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).not.toContain("not-a-real-cookie");
    expect((failure as Error).message).toContain("127.0.0.1:9");
  } finally {
    await context.dispose();
  }
});
