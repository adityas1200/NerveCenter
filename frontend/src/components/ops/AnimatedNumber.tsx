import { useEffect, useRef, useState } from "react";

/**
 * A number that counts up from zero when it first appears and runs to its new value when it changes
 * (a filter, a refresh), so every figure in the app arrives the same way and the eye catches which
 * ones moved. Reduced motion, and the test DOM, get the value straight away.
 */

const DURATION_MS = 650;
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

function motionAllowed(): boolean {
  if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") return false;
  if (/jsdom/i.test(window.navigator.userAgent)) return false;
  return !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

const decimalsOf = (value: number) => (Number.isInteger(value) ? 0 : Math.min(2, (String(value).split(".")[1] ?? "").length));

function useAnimatedNumber(value: number): number {
  const startAt = () => (motionAllowed() && Number.isFinite(value) ? 0 : value);
  const [shown, setShown] = useState(startAt);
  const from = useRef<number | null>(null);
  if (from.current === null) from.current = startAt();
  const frame = useRef<number | null>(null);
  useEffect(() => {
    const start = from.current ?? value;
    if (start === value || !Number.isFinite(start) || !Number.isFinite(value) || !motionAllowed()) {
      from.current = value;
      setShown(value);
      return undefined;
    }
    const began = performance.now();
    const places = Math.max(decimalsOf(start), decimalsOf(value));
    const step = (now: number) => {
      const t = Math.min(1, (now - began) / DURATION_MS);
      const current = start + (value - start) * easeOutCubic(t);
      from.current = current;
      setShown(t >= 1 ? value : Number(current.toFixed(places)));
      if (t < 1) frame.current = window.requestAnimationFrame(step);
    };
    frame.current = window.requestAnimationFrame(step);
    return () => { if (frame.current !== null) window.cancelAnimationFrame(frame.current); };
  }, [value]);
  return shown;
}

/** Renders `format(value)` and animates between values. The accessible name stays on the parent, so screen readers hear only the final figure. */
export function AnimatedNumber({ value, format = (n) => n.toLocaleString() }: { value: number; format?: (value: number) => string }) {
  const shown = useAnimatedNumber(value);
  return <>{format(shown)}</>;
}

/** A figure that is a number with at most a currency sign or a percent ("89%", "$1.20", "1,204"): the number animates, the sign stays. Anything else (a date, "in 3h") renders as is. */
export function AnimatedFigure({ value }: { value: number | string }) {
  if (typeof value === "number") return <AnimatedNumber value={value} />;
  const match = /^([$€£]?)(-?\d{1,3}(?:,\d{3})*(?:\.\d+)?|-?\d+(?:\.\d+)?)(%?)$/.exec(value.trim());
  if (!match) return <>{value}</>;
  const [, before, digits, after] = match;
  const number = Number(digits.replace(/,/g, ""));
  if (!Number.isFinite(number)) return <>{value}</>;
  const places = (digits.split(".")[1] ?? "").length;
  const grouped = digits.includes(",");
  const format = (n: number) => (grouped ? n.toLocaleString(undefined, { minimumFractionDigits: places, maximumFractionDigits: places }) : n.toFixed(places));
  return <>{before}<AnimatedNumber value={number} format={format} />{after}</>;
}
