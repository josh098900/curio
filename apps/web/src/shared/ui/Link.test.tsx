import { render } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { Link } from "./Link";

const NextLink = vi.hoisted(() => vi.fn<(props: object) => null>(() => null));
vi.mock("next/link", () => ({ default: NextLink }));

it("passes prefetch={false} to Next's Link", () => {
  render(<Link href="/plans">Plans</Link>);
  expect(NextLink.mock.calls[0][0]).toMatchObject({
    href: "/plans",
    prefetch: false,
  });
});
