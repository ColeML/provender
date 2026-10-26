// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useLongPress } from "./use-long-press";

function Target({ onLongPress }: { onLongPress: () => void }) {
  const press = useLongPress(onLongPress);

  return (
    <button type="button" {...press}>
      Use a rotisserie chicken
    </button>
  );
}

function setup() {
  const onLongPress = vi.fn();
  const view = render(<Target onLongPress={onLongPress} />);

  return { onLongPress, button: screen.getByRole("button"), view };
}

const touch = { button: 0, pointerType: "touch", clientX: 100, clientY: 100 };

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useLongPress", () => {
  it("fires once the press is held for the delay", () => {
    const { onLongPress, button } = setup();

    fireEvent.pointerDown(button, touch);
    vi.advanceTimersByTime(499);
    expect(onLongPress).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it("does not fire when released early", () => {
    const { onLongPress, button } = setup();

    fireEvent.pointerDown(button, touch);
    vi.advanceTimersByTime(300);
    fireEvent.pointerUp(button, touch);
    vi.advanceTimersByTime(500);

    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("does not fire when the finger moves past the tolerance, so a scroll never opens it", () => {
    const { onLongPress, button } = setup();

    fireEvent.pointerDown(button, touch);
    fireEvent.pointerMove(button, { ...touch, clientY: 111 });
    vi.advanceTimersByTime(500);

    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("still fires after a wobble inside the tolerance", () => {
    const { onLongPress, button } = setup();

    fireEvent.pointerDown(button, touch);
    fireEvent.pointerMove(button, { ...touch, clientX: 106, clientY: 106 });
    vi.advanceTimersByTime(500);

    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it("does not fire when the browser cancels the pointer", () => {
    const { onLongPress, button } = setup();

    fireEvent.pointerDown(button, touch);
    fireEvent.pointerCancel(button, touch);
    vi.advanceTimersByTime(500);

    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("ignores a secondary button", () => {
    const { onLongPress, button } = setup();

    fireEvent.pointerDown(button, { ...touch, button: 2, pointerType: "mouse" });
    vi.advanceTimersByTime(500);

    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("does nothing on a tap's click", () => {
    const { onLongPress, button } = setup();

    fireEvent.click(button, { detail: 1 });

    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("fires on a click from the keyboard or assistive technology", () => {
    const { onLongPress, button } = setup();

    fireEvent.click(button, { detail: 0 });

    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it("blocks the context menu after a touch press, so Android's menu stays shut", () => {
    const { button } = setup();

    fireEvent.pointerDown(button, touch);

    expect(fireEvent.contextMenu(button)).toBe(false);
  });

  it("clears the timer when the element unmounts", () => {
    const { onLongPress, button, view } = setup();

    fireEvent.pointerDown(button, touch);
    view.unmount();
    vi.advanceTimersByTime(500);

    expect(onLongPress).not.toHaveBeenCalled();
  });
});
