// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const databaseAnswers = vi.hoisted(() => vi.fn<() => Promise<boolean>>());
vi.mock("@/server/health", () => ({ databaseAnswers }));

describe("GET /api/health", () => {
  it("answers ok when the database answers", async () => {
    databaseAnswers.mockResolvedValue(true);
    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("answers UNAVAILABLE when it doesn't", async () => {
    databaseAnswers.mockResolvedValue(false);
    const response = await GET();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ message: "UNAVAILABLE" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
