// The shared Link never prefetches, whatever it's given.
import { render } from "@testing-library/react";
import NextLink from "next/link";
import { expect, it, vi } from "vitest";
import { Link } from "./Link";

vi.mock("next/link", () => ({
  default: vi.fn(({ href, children }) => <a href={href}>{children}</a>),
}));

it("passes prefetch={false} to Next's Link", () => {
  render(<Link href="/plans">Plans</Link>);
  expect(vi.mocked(NextLink).mock.calls[0][0]).toMatchObject({
    href: "/plans",
    prefetch: false,
  });
});
