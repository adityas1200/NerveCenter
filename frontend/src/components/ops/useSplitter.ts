import { useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";

/**
 * Drag handling for a pane splitter: press on the handle and move along `axis`; `resize` is called with
 * the pane's size at the start of the drag plus how far the pointer has travelled. `dragging` is true
 * until the pointer is released, for the handle's highlight and the page cursor.
 */
export function useSplitterDrag(axis: "x" | "y", startSize: () => number, resize: (size: number) => void) {
  const [dragging, setDragging] = useState(false);
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const from = axis === "x" ? event.clientX : event.clientY;
    const start = startSize();
    const handle = event.currentTarget;
    handle.setPointerCapture?.(event.pointerId);
    setDragging(true);
    const onMove = (move: PointerEvent) => resize(start + (axis === "x" ? move.clientX : move.clientY) - from);
    const onUp = () => {
      setDragging(false);
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  };
  return { dragging, onPointerDown };
}

/**
 * The window-splitter keys: `shrink`/`grow` keys step by 16 (48 with Shift), Home goes to the minimum,
 * End to the maximum. Enter does whatever the pane wants (reset, or fold it away).
 */
export function splitterKeys(event: ReactKeyboardEvent<HTMLDivElement>, { shrink, grow, size, set, min, max, onEnter }: { shrink: string; grow: string; size: number; set: (size: number) => void; min: number; max: () => number; onEnter: () => void }) {
  const step = event.shiftKey ? 48 : 16;
  if (event.key === shrink) set(size - step);
  else if (event.key === grow) set(size + step);
  else if (event.key === "Home") set(min);
  else if (event.key === "End") set(max());
  else if (event.key === "Enter") onEnter();
  else return;
  event.preventDefault();
}
