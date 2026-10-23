import { useEffect, useRef } from "react";
import { rgbOf, toneAt } from "@/features/home/art/dither";

// Size of one dither pixel in CSS px; the comet's head radius as a share of the short side, its edge falloff and how long a tail point lives (ms).
const CELL = 4;
const TRAIL = { radius: 0.07, exponent: 1.6, life: 520 };
// Tone ramps from nothing to full light, in the NerveCenter logo's blue-to-violet.
const RAMPS = {
  dark: [null, "#251b6b", "#5a2dd8", "#2563eb", "#9fd4ff"],
  light: [null, "#d9dcfa", "#9aa6f3", "#3d42e8", "#1d1f8a"],
};

/** A dithered comet that follows the pointer over the sign-in hero: thick and bright at the head, tapering to nothing at the tail, in the logo's colours. */
export function LoginParticles({ isDark }: { isDark: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    // Reduced motion gets no trail at all.
    if (!canvas || !ctx || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const ramp = RAMPS[isDark ? "dark" : "light"].map((hex) => (hex ? rgbOf(hex) : null));
    let trail = new Float32Array(0);
    let points: Array<{ x: number; y: number; at: number }> = [];
    let last: { x: number; y: number } | null = null;
    let raf = 0;
    let w = 0; // in dither pixels
    let h = 0;

    const resize = () => {
      w = Math.max(1, Math.ceil(canvas.offsetWidth / CELL));
      h = Math.max(1, Math.ceil(canvas.offsetHeight / CELL));
      canvas.width = w;
      canvas.height = h;
      trail = new Float32Array(w * h);
    };
    // One disc of the comet: `k` (1 at the head, 0 at the tail end) scales both its size and its light, so the tail tapers.
    const stamp = (cx: number, cy: number, k: number) => {
      const reach = TRAIL.radius * Math.min(w, h) * k;
      for (let y = Math.max(0, Math.floor(cy - reach)); y < Math.min(h, cy + reach); y++) {
        for (let x = Math.max(0, Math.floor(cx - reach)); x < Math.min(w, cx + reach); x++) {
          const d = Math.hypot(x - cx, y - cy) / reach;
          if (d < 1) trail[y * w + x] = Math.max(trail[y * w + x], (1 - d) ** TRAIL.exponent * (0.35 + 0.65 * k));
        }
      }
    };
    const onMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) / CELL;
      const y = (e.clientY - rect.top) / CELL;
      // Fill in between events so a fast flick is one unbroken tail.
      const now = performance.now();
      const steps = last ? Math.max(1, Math.ceil(Math.hypot(x - last.x, y - last.y) / 2)) : 1;
      for (let s = 1; s <= steps; s++) points.push({ x: last ? last.x + ((x - last.x) * s) / steps : x, y: last ? last.y + ((y - last.y) * s) / steps : y, at: now });
      last = { x, y };
    };
    const onLeave = () => { last = null; };

    const draw = () => {
      const now = performance.now();
      points = points.filter((p) => now - p.at < TRAIL.life);
      trail.fill(0);
      for (const p of points) stamp(p.x, p.y, (1 - (now - p.at) / TRAIL.life) ** 1.4);
      const out = ctx.createImageData(w, h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          const v = trail[i];
          if (v < 0.01) continue;
          const tone = ramp[toneAt(v, x, y, ramp.length)];
          if (!tone) continue;
          out.data[i * 4] = tone[0];
          out.data[i * 4 + 1] = tone[1];
          out.data[i * 4 + 2] = tone[2];
          out.data[i * 4 + 3] = 255;
        }
      }
      ctx.putImageData(out, 0, 0);
      raf = requestAnimationFrame(draw);
    };

    resize();
    raf = requestAnimationFrame(draw);
    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mouseleave", onLeave);
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("mouseleave", onLeave);
      window.removeEventListener("resize", resize);
    };
  }, [isDark]);

  return <canvas ref={canvasRef} aria-hidden="true" className="absolute inset-0 h-full w-full [image-rendering:pixelated]" />;
}
