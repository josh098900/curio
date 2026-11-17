// S54 reports the error it shows, unless the server has already reported it.
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reportBrowserError } from "@/shared/browser-errors";
import SomethingWentWrong from "./error";

vi.mock("@/shared/browser-errors", () => ({ reportBrowserError: vi.fn() }));

describe("S54 Something went wrong", () => {
  beforeEach(() => vi.clearAllMocks());

  it("UT-ERR-02 reports an error the browser hit, once", () => {
    const error = new Error("render failed");
    const { rerender } = render(
      <SomethingWentWrong error={error} reset={() => {}} />,
    );
    rerender(<SomethingWentWrong error={error} reset={() => {}} />);
    expect(reportBrowserError).toHaveBeenCalledTimes(1);
    expect(reportBrowserError).toHaveBeenCalledWith(error);
  });

  it("UT-ERR-02 leaves an error from the server alone, since the server reported it", () => {
    const error = Object.assign(new Error("server"), { digest: "1234" });
    render(<SomethingWentWrong error={error} reset={() => {}} />);
    expect(reportBrowserError).not.toHaveBeenCalled();
  });
});
