// The shell's navigation and S55's offline notice.
import { act, render, screen, within } from "@testing-library/react";
import { usePathname } from "next/navigation";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BottomNav, TopNav } from "./Nav";
import { OfflineNotice } from "./online";

vi.mock("next/navigation", () => ({ usePathname: vi.fn() }));

describe("the navigation", () => {
  it.each([
    ["/", "Discover"],
    ["/plans", "Plans"],
    ["/plans/upcoming", "Plans"],
    ["/profile", "Profile"],
  ])(
    "on %s, %s is the current page, in words as well as colour",
    (path, current) => {
      vi.mocked(usePathname).mockReturnValue(path);
      render(<BottomNav />);
      const nav = screen.getByRole("navigation", { name: "Main" });
      const links = within(nav).getAllByRole("link");
      expect(links.map((link) => link.textContent)).toEqual([
        "Discover",
        "Create",
        "Plans",
        "Profile",
      ]);
      expect(
        links
          .filter((link) => link.getAttribute("aria-current") === "page")
          .map((link) => link.textContent),
      ).toEqual([current]);
    },
  );

  it("on desktop, the bell is named for screen readers", () => {
    vi.mocked(usePathname).mockReturnValue("/");
    render(<TopNav />);
    expect(screen.getByRole("link", { name: "Notifications" })).toHaveAttribute(
      "href",
      "/notifications",
    );
  });
});

describe("S55 the offline notice", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("appears in a live region already on the page when the device goes offline, and goes when it's back", () => {
    const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    const { container } = render(<OfflineNotice />);
    const region = container.querySelector("[aria-live='polite']")!;
    expect(region).toBeEmptyDOMElement();

    onLine.mockReturnValue(false);
    act(() => void window.dispatchEvent(new Event("offline")));
    expect(region).toHaveTextContent(
      "You're offline. What's loaded stays readable. Joining, messages and changes need a connection.",
    );

    onLine.mockReturnValue(true);
    act(() => void window.dispatchEvent(new Event("online")));
    expect(region).toBeEmptyDOMElement();
  });
});
