"use client";

import { type MouseEvent, type PointerEvent, useEffect, useRef } from "react";

interface Options {
  delay?: number;
  tolerance?: number;
}

/**
 * A press held for `delay` ms calls `onLongPress`. A tap does nothing, but a click with `detail`
 * 0 (Enter, Space, or a screen reader's activate) does, so the action is never touch-only.
 */
export function useLongPress(
  onLongPress: () => void,
  { delay = 500, tolerance = 10 }: Options = {},
) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const touched = useRef(false);
  const latest = useRef(onLongPress);

  useEffect(() => {
    latest.current = onLongPress;
  });

  function cancel() {
    if (timer.current !== null) {
      clearTimeout(timer.current);
    }

    timer.current = null;
    origin.current = null;
  }

  useEffect(() => cancel, []);

  return {
    // iOS would otherwise select the text and raise its callout under a resting finger.
    className: "select-none [-webkit-touch-callout:none]",
    onPointerDown(event: PointerEvent) {
      if (event.button !== 0) {
        return;
      }

      cancel();
      touched.current = event.pointerType === "touch";
      origin.current = { x: event.clientX, y: event.clientY };
      timer.current = setTimeout(() => {
        timer.current = null;
        origin.current = null;

        if ("vibrate" in navigator) {
          navigator.vibrate(10);
        }

        latest.current();
      }, delay);
    },
    onPointerMove(event: PointerEvent) {
      const start = origin.current;

      if (
        start !== null &&
        Math.hypot(event.clientX - start.x, event.clientY - start.y) > tolerance
      ) {
        cancel();
      }
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onClick(event: MouseEvent) {
      if (event.detail === 0) {
        latest.current();
      }
    },
    onContextMenu(event: MouseEvent) {
      if (touched.current) {
        event.preventDefault();
      }
    },
  };
}
