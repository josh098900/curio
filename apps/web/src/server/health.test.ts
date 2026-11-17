// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { REQUEST_ID } from "../../test/fake-sentry";
import { databaseAnswers } from "./health";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ "x-request-id": REQUEST_ID })),
}));

const url = "https://project.supabase.co";
const key = "sb_publishable_test";

function answer(response: Response | Error) {
  const fetchMock = vi.fn<typeof fetch>(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("databaseAnswers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("asks public.health() through the Data API, with the publishable key only and the request id", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", key);
    const fetchMock = answer(Response.json(true));

    expect(await databaseAnswers()).toBe(true);
    const [target, init] = fetchMock.mock.calls[0];
    expect(target).toBe(`${url}/rest/v1/rpc/health`);
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("apikey")).toBe(key);
    expect(new Headers(init?.headers).has("authorization")).toBe(false);
    expect(new Headers(init?.headers).get("x-request-id")).toBe(REQUEST_ID);
  });

  it.each([
    [
      "an error status",
      Response.json({ message: "UNAVAILABLE" }, { status: 503 }),
    ],
    ["any answer but true", Response.json(false)],
    ["a network failure or timeout", new Error("timed out")],
  ])("is false on %s", async (_case, response) => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", key);
    answer(response);

    expect(await databaseAnswers()).toBe(false);
  });

  it("is false without the Supabase settings, and asks nothing", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    const fetchMock = answer(Response.json(true));

    expect(await databaseAnswers()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
