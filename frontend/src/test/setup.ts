import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

Object.defineProperties(Element.prototype, {
  hasPointerCapture: { configurable: true, value: () => false },
  releasePointerCapture: { configurable: true, value: () => undefined },
  scrollIntoView: { configurable: true, value: () => undefined },
  setPointerCapture: { configurable: true, value: () => undefined },
});

class TestResizeObserver {
  observe() { /* layout is not calculated by jsdom */ }
  unobserve() { /* layout is not calculated by jsdom */ }
  disconnect() { /* layout is not calculated by jsdom */ }
}

Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, value: TestResizeObserver });

// jsdom has no 2D canvas; the home page's dithered art draws nothing when a context is missing.
Object.defineProperty(HTMLCanvasElement.prototype, "getContext", { configurable: true, value: () => null });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
