// WEB-UI-09: toasts and error messages are announced to screen readers. A toast lands in a live
// region that's on the page before it; an error is an alert, or tied to its field.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Banner } from "./Banner";
import { TextField } from "./fields";
import { ErrorState } from "./StateMessage";
import { TOAST_MS, ToastProvider, useToast } from "./Toast";

function Joins({ onUndo = () => {} }: { onUndo?: () => void }) {
  const showToast = useToast();
  return (
    <button
      onClick={() =>
        showToast({
          message: "Joined",
          action: { label: "Undo", onClick: onUndo },
        })
      }
    >
      Join
    </button>
  );
}

describe("WEB-UI-09 toasts", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("WEB-UI-09 a toast arrives in a polite live region that was already on the page", () => {
    render(
      <ToastProvider>
        <Joins />
      </ToastProvider>,
    );
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toBeEmptyDOMElement();

    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    expect(region).toHaveTextContent("Joined");
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
  });

  it("a toast leaves after five seconds, but waits while the pointer or focus is on it (WCAG 2.2.1)", () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <Joins />
      </ToastProvider>,
    );
    const region = screen.getByRole("status");

    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    fireEvent.mouseEnter(region);
    act(() => void vi.advanceTimersByTime(TOAST_MS * 3));
    expect(region).toHaveTextContent("Joined");

    fireEvent.mouseLeave(region);
    fireEvent.focus(screen.getByRole("button", { name: "Undo" }));
    act(() => void vi.advanceTimersByTime(TOAST_MS * 3));
    expect(region).toHaveTextContent("Joined");

    fireEvent.blur(screen.getByRole("button", { name: "Undo" }));
    act(() => void vi.advanceTimersByTime(TOAST_MS));
    expect(region).toBeEmptyDOMElement();
  });

  it("its action runs once and closes the toast", () => {
    const onUndo = vi.fn();
    render(
      <ToastProvider>
        <Joins onUndo={onUndo} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });
});

describe("WEB-UI-09 error messages", () => {
  it("WEB-UI-09 an error banner is an alert; info and warning banners aren't", () => {
    render(
      <>
        <Banner tone="error">Check the highlighted fields</Banner>
        <Banner tone="info">We&apos;ve also emailed you a sign-in link.</Banner>
        <Banner tone="warning">Time changed.</Banner>
      </>,
    );
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Check the highlighted fields",
    );
  });

  it("WEB-UI-09 an error page is an alert", () => {
    render(
      <ErrorState icon={null} title="Something went wrong">
        Please try again later.
      </ErrorState>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong");
  });

  it("WEB-UI-09 a field's error is tied to it, so it's read with the field", () => {
    render(
      <TextField
        label="Display name"
        hint="1–40 characters"
        error="This is too long"
      />,
    );
    const field = screen.getByRole("textbox", { name: "Display name" });
    expect(field).toBeInvalid();
    expect(field).toHaveAccessibleDescription(
      "1–40 characters This is too long",
    );
  });

  it("a field without an error isn't marked invalid", () => {
    render(<TextField label="Display name" hint="1–40 characters" />);
    const field = screen.getByRole("textbox", { name: "Display name" });
    expect(field).toBeValid();
    expect(field).toHaveAccessibleDescription("1–40 characters");
  });
});
