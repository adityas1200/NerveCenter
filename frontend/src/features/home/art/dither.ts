import type { ProjectColor } from "@/api/projects";

/**
 * Ordered dithering for the home page's art (SPEC-projects-03 FR-16, FR-17): an 8x8 Bayer matrix picks between two
 * neighbouring tones per pixel, so a few flat colours read as gradients, the way the design references are drawn.
 */

export const BAYER: number[][] = (() => {
  let m = [[0]];
  while (m.length < 8) {
    const s = m.length; const next: number[][] = [];
    for (let y = 0; y < 2 * s; y += 1) { next.push([]); for (let x = 0; x < 2 * s; x += 1) next[y].push(m[y % s][x % s] * 4 + [[0, 2], [3, 1]][Math.floor(y / s)][Math.floor(x / s)]); }
    m = next;
  }
  return m.map((row) => row.map((value) => (value + 0.5) / 64));
})();

/** Index into a ramp of `steps` tones for value v (0..1) at pixel x,y, dithered between neighbours. */
export function toneAt(v: number, x: number, y: number, steps: number): number {
  const t = Math.max(0, Math.min(1, v)) * (steps - 1); const i = Math.floor(t);
  return Math.min(steps - 1, t - i > BAYER[y & 7][x & 7] ? i + 1 : i);
}

/** A small seeded generator (mulberry32), so a project's landscape is the same on every visit. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** FNV-1a: a stable number from a project id. */
export function hash(text: string): number {
  let h = 2166136261;
  for (const ch of text) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const COLORS: readonly ProjectColor[] = ["indigo", "teal", "amber", "rose", "sky", "green"];
/** The project's card colour: its own, or one picked from its id (FR-17). */
export const colorOf = (id: string, color?: ProjectColor | null): ProjectColor => color ?? COLORS[hash(id) % COLORS.length];

// The frame colour (surface-base) first, so the art has no edge on the page, then light to deep. In dark mode the ramp runs toward light, so lit surfaces glow.
const RAMPS: Record<"light" | "dark", Record<ProjectColor | "stone", string[]>> = {
  light: {
    indigo: ["#f3f3f5", "#dcdcf6", "#a3a5ee", "#5b5bd6", "#2b2c7e"],
    teal: ["#f3f3f5", "#cfece6", "#82d0c3", "#1f9e8c", "#0e5a51"],
    amber: ["#f3f3f5", "#fbe4c1", "#f3b860", "#d6801a", "#83490a"],
    rose: ["#f3f3f5", "#f5d5e8", "#e494c4", "#c2408f", "#741d53"],
    sky: ["#f3f3f5", "#d5e8f8", "#8fc3ef", "#2b84d6", "#164c7e"],
    green: ["#f3f3f5", "#d7ecd6", "#93cf96", "#2f9e4a", "#185c29"],
    stone: ["#f3f3f5", "#e7e7eb", "#c4c4cc", "#8b8b95", "#4b4b54"],
  },
  dark: {
    indigo: ["#09090b", "#1e1f3d", "#34357f", "#7876f0", "#d6d4ff"],
    teal: ["#09090b", "#112a27", "#1b5c53", "#3cc3ae", "#c4f3ea"],
    amber: ["#09090b", "#2c2111", "#6a4614", "#f0a43a", "#ffe6bb"],
    rose: ["#09090b", "#2c1625", "#6a2a55", "#e869b5", "#ffd3ec"],
    sky: ["#09090b", "#12233a", "#1f4f80", "#5aaaf0", "#d3eaff"],
    green: ["#09090b", "#132616", "#245a2f", "#5cc874", "#d3f5d9"],
    stone: ["#09090b", "#1c1c20", "#34343a", "#6b6b75", "#b8b8c0"],
  },
};
/** The mid tone of each colour: the swatch in the create flow and the hero's orbiting spheres. */
export const COLOR_INK: Record<ProjectColor, string> = { indigo: "#5b5bd6", teal: "#1f9e8c", amber: "#d6801a", rose: "#c2408f", sky: "#2b84d6", green: "#2f9e4a" };

export const isDark = () => document.documentElement.dataset.theme === "dark";
export const rgbOf = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

/** A dithered landscape unique to a project: sky, a sun and three ridgelines. `t` drifts the ridges (on hover). */
export function paintLandscape(canvas: HTMLCanvasElement, project: { id: string; color?: ProjectColor | null }, t = 0) {
  const ctx = canvas.getContext("2d"); if (!ctx) return;
  const w = canvas.width; const h = canvas.height;
  const img = ctx.createImageData(w, h);
  const tones = RAMPS[isDark() ? "dark" : "light"][colorOf(project.id, project.color)].map(rgbOf);
  const r = rng((hash(project.id) % 9973) * 97 + 13);
  const sun = { x: w * (0.18 + r() * 0.64), y: h * (0.2 + r() * 0.16), r: h * (0.13 + r() * 0.05) };
  const layers = [0, 1, 2].map((k) => ({ base: h * (0.42 + k * 0.15), amp: h * (0.17 - k * 0.035), f: [0.03 + r() * 0.04, 0.07 + r() * 0.06, 0.16 + r() * 0.1], ph: [r() * 6, r() * 6, r() * 6], v: [0.4, 0.62, 0.86][k], drift: (k + 1) * 0.6 }));
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    let v = 0.2 - (y / h) * 0.16;
    if (Math.hypot(x - sun.x, (y - sun.y) * 1.05) < sun.r) v = 0.42;
    for (const layer of layers) {
      const X = x + t * layer.drift;
      const ridge = layer.base - (layer.amp * (Math.sin(X * layer.f[0] + layer.ph[0]) + 0.55 * Math.sin(X * layer.f[1] + layer.ph[1]) + 0.22 * Math.sin(X * layer.f[2] + layer.ph[2]))) / 1.77;
      if (y >= ridge) v = layer.v + ((y - ridge) / h) * 0.22;
    }
    const c = tones[toneAt(v, x, y, tones.length)]; const o = (y * w + x) * 4;
    img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

export const reducedMotion = () => typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
