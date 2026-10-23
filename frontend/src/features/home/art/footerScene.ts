import { BAYER, isDark, reducedMotion, rng } from "./dither";

/**
 * The home footer (SPEC-projects-03 FR-16): the wordmark as dithered particles that scatter from the pointer and spring
 * back, and a heron drawn as a fine pixel mosaic in the logo's colours, standing in still water among reeds. It breathes,
 * blinks, now and then lowers its head to fish (a ripple spreads), turns to face the pointer and stretches up when you
 * come close. The wordmark, the reeds and the heron are reflected in the water; a dragonfly darts from the pointer.
 */

type Point = [number, number];
interface Pose { neck: number; body: number }
// Poses: how far the neck and head turn about the base of the neck, and how far the body tips forward.
const POSES: Record<"stand" | "alert" | "fish", Pose> = { stand: { neck: 0, body: 0 }, alert: { neck: 0.12, body: -0.06 }, fish: { neck: -1.42, body: -0.36 } };
const blendPose = (a: Pose, b: Pose, t: number): Pose => ({ neck: a.neck + (b.neck - a.neck) * t, body: a.body + (b.body - a.body) * t });
// A grey heron facing left, traced in px; the waterline is y 372. Drawn 90px in from the box's left so the head has room to dip.
const HERON = {
  hip: [220, 262] as Point, pivot: [156, 200] as Point,
  body: [[150, 200], [166, 186], [196, 178], [232, 182], [266, 196], [296, 222], [324, 258], [300, 257], [276, 263], [246, 269], [214, 267], [184, 257], [162, 238], [148, 220]] as Point[],
  neck: [[150, 208], [140, 188], [136, 168], [142, 150], [150, 132], [150, 112], [142, 96], [132, 86], [150, 72], [160, 92], [166, 112], [164, 132], [158, 150], [162, 168], [176, 184]] as Point[],
  plumes: [[150, 200], [138, 230], [146, 228], [156, 206]] as Point[],
  head: [141, 77, 16, 11] as [number, number, number, number], beakTop: [128, 71] as Point, beakBottom: [128, 83] as Point, tip: [64, 84] as Point,
  crest: [[[150, 70], [190, 62]], [[150, 74], [184, 73]]] as Array<[Point, Point]>,
  legs: [[[227, 262], [231, 318], [223, 376]], [[212, 262], [206, 320], [214, 376]]] as Point[][],
};
const ease = (t: number) => t * t * (3 - 2 * t);
const hex3 = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

interface Blade { x: number; h: number; lean: number; droop: number; phase: number; hue: number; front: boolean; cattail: boolean }
type Cell = [number, number, string];

/** Starts the scene in `area` (its width sets the layout); returns a stop function. */
export async function startFooterScene(area: HTMLElement, word: HTMLCanvasElement, scene: HTMLCanvasElement): Promise<() => void> {
  let running = true; let frame = 0;
  const stop = () => { running = false; cancelAnimationFrame(frame); };
  try { await document.fonts?.load('400 200px "Instrument Serif"'); } catch { /* falls back to Georgia */ }
  if (!running) return stop;
  const wctx = word.getContext("2d"); const ctx = scene.getContext("2d");
  const probe = document.createElement("canvas").getContext("2d");
  const mask = document.createElement("canvas"); const mctx = mask.getContext("2d", { willReadFrequently: true });
  if (!wctx || !ctx || !probe || !mctx) return stop;

  const mouse = { x: -9999, y: -9999 };
  const AW = Math.max(640, area.clientWidth); const WATER = 84; const SCALE = 1.3; const BOX_W = 560, BOX_H = 484; const AH = BOX_H + WATER + 8;
  // On a narrow screen the wordmark takes the width and the heron stays out of the way.
  const heron = AW >= 900;
  area.style.height = `${AH}px`;
  const LINE = AH - WATER; // waterline

  // --- wordmark particles, left two thirds, standing on the waterline
  const W = Math.round(AW * 0.68); const text = "NerveCenter";
  probe.font = '400 100px "Instrument Serif", Georgia, serif';
  const size = Math.floor(((100 * W) / probe.measureText(text).width) * 0.99);
  const H = Math.round(size * 0.86); const base = Math.round(H * 0.8);
  word.width = W; word.height = H; word.style.width = `${W}px`; word.style.height = `${H}px`; word.style.top = `${LINE - base}px`;
  const off = document.createElement("canvas"); off.width = W; off.height = H; const octx = off.getContext("2d");
  if (!octx) return stop;
  octx.font = `400 ${size}px "Instrument Serif", Georgia, serif`; octx.fillText(text, 0, base);
  const alpha = octx.getImageData(0, 0, W, H).data;
  const STEP = 4; const dots: Array<{ hx: number; hy: number; x: number; y: number; vx: number; vy: number }> = [];
  for (let y = 0; y < base + 2; y += STEP) for (let x = 0; x < W; x += STEP) if (alpha[(y * W + x) * 4 + 3] >= 128) dots.push({ hx: x, hy: y, x, y, vx: 0, vy: 0 });
  const wimg = wctx.createImageData(W, H); const wbuf = new Uint32Array(wimg.data.buffer);
  const pack = ([r, g, b]: number[]) => ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
  const stops = ["#2FA8FF", "#2563EB", "#3D42E8", "#5A2DD8"].map(hex3);
  const grad = (t: number) => { const s = Math.max(0, Math.min(0.999, t)) * 3; const i = Math.floor(s); const f = s - i; return stops[i].map((v, k) => Math.round(v + (stops[i + 1][k] - v) * f)); };
  const gradPacked = Array.from({ length: 64 }, (_, i) => pack(grad(i / 63)));

  // --- the heron, as cells
  scene.width = AW; scene.height = AH; scene.style.width = `${AW}px`; scene.style.height = `${AH}px`;
  const C = 4; const CW = Math.floor(BOX_W / C), CH = Math.floor(BOX_H / C); // cells
  const boxX = AW - BOX_W + 4, boxY = LINE - BOX_H;
  mask.width = CW; mask.height = CH;
  const rand = rng(91);
  const seeds = new Float32Array(CW * CH).map(() => rand());
  const palette = () => (isDark()
    ? { blues: ["#6cc4ff", "#4c8dff", "#6d70ff", "#8a63ff", "#a9d6ff", "#c4c2ff"], flecks: ["#ff9fd0", "#ffc46b", "#6fe0cc"], eye: "#f4f4f6" }
    : { blues: ["#2FA8FF", "#2563EB", "#3D42E8", "#5A2DD8", "#5B9DF7", "#7B7FF0"], flecks: ["#e494c4", "#f3b860", "#82d0c3"], eye: "#16161a" });
  const state = { pose: { ...POSES.stand }, facing: -1, turnFrom: -1, turnStart: -9999, fishStart: 0, nextFish: performance.now() + 3500, blinkUntil: 0, nextBlink: 0, ripples: [] as Array<{ x: number; born: number }>, lastStrike: 0 };

  function drawHeron(pose: Pose, facing: number, breathe: number) {
    const m = mctx as CanvasRenderingContext2D;
    const mid = (p: Point, q: Point): Point => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    const poly = (pts: Point[]) => { // smooth closed outline through the midpoints
      m.beginPath(); const n = pts.length; const start = mid(pts[n - 1], pts[0]); m.moveTo(start[0], start[1]);
      for (let i = 0; i < n; i += 1) { const to = mid(pts[i], pts[(i + 1) % n]); m.quadraticCurveTo(pts[i][0], pts[i][1], to[0], to[1]); }
      m.closePath(); m.fill();
    };
    m.setTransform(1, 0, 0, 1, 0, 0); m.clearRect(0, 0, CW, CH);
    m.setTransform(facing < 0 ? SCALE / C : -SCALE / C, 0, 0, SCALE / C, facing < 0 ? 0 : CW, 0); m.translate(90, 0);
    m.fillStyle = "#000"; m.strokeStyle = "#000"; m.lineCap = "round"; m.lineJoin = "round";
    m.lineWidth = 5; for (const leg of HERON.legs) { m.beginPath(); leg.forEach(([x, y], i) => (i ? m.lineTo(x, y) : m.moveTo(x, y))); m.stroke(); }
    const [hx, hy] = HERON.hip; m.translate(hx, hy + breathe); m.rotate(pose.body); m.translate(-hx, -hy);
    poly(HERON.body);
    const [px, py] = HERON.pivot; m.translate(px, py); m.rotate(pose.neck); m.translate(-px, -py);
    poly(HERON.neck); poly(HERON.plumes);
    const [cx, cy, rx, ry] = HERON.head; m.beginPath(); m.ellipse(cx, cy, rx, ry, -0.12, 0, Math.PI * 2); m.fill();
    poly([HERON.beakTop, HERON.tip, HERON.beakBottom]);
    m.lineWidth = 3.5; for (const [from, to] of HERON.crest) { m.beginPath(); m.moveTo(from[0], from[1]); m.lineTo(to[0], to[1]); m.stroke(); }
    const t = m.getTransform(); const at = ([x, y]: Point): Point => { const q = t.transformPoint(new DOMPoint(x, y)); return [q.x, q.y]; };
    const eye = at([136, 74]); const tip = at(HERON.tip);
    return { a: m.getImageData(0, 0, CW, CH).data, eye, tip: [tip[0] * C, tip[1] * C] as Point };
  }

  // --- the shore, in the same cells: reed clumps with cattails, grass tufts, lily pads and a dragonfly
  const shore = rng(23);
  const greens = () => (isDark() ? ["#3f8f6a", "#58a87f", "#2f7a5c", "#7cc39a", "#3cc3ae", "#8fd1a8"] : ["#3f7f62", "#5f9e7a", "#2f6b52", "#86b893", "#1f9e8c", "#9cc7a4"]);
  const blades: Blade[] = [];
  const clump = (cx: number, spread: number, n: number, minH: number, maxH: number, front: boolean, cattails: boolean) => {
    for (let i = 0; i < n; i += 1) {
      const h = minH + shore() * (maxH - minH);
      const leaf = !cattails || shore() < 0.55; // leaves arc over; stems with cattails stay upright
      blades.push({ x: cx + (shore() - 0.5) * spread, h, lean: (shore() - 0.5) * h * (leaf ? 0.9 : 0.25), droop: leaf ? shore() * 0.35 : 0, phase: shore() * 6, hue: Math.floor(shore() * 6), front, cattail: cattails && !leaf && h > maxH * 0.55 });
    }
  };
  const legsX = boxX + (90 + 220) * SCALE; // the heron's feet
  if (heron) {
    clump(AW - 24, 60, 9, 60, 180, false, true); // behind the heron, right edge
    clump(legsX - 80, 80, 8, 40, 150, false, true); // behind, left of the legs
    clump(legsX + 6, 60, 7, 20, 80, true, false); // in front of the legs
  }
  clump(W + 70, 100, 11, 40, 200, true, true); // between the wordmark and the heron
  clump(-6, 40, 6, 30, 120, true, true); // the far left edge
  for (let x = 30; x < W; x += 40 + shore() * 60) clump(x, 12, 3, 8, 24, true, false); // short grass along the shore
  const pads = [{ x: Math.round(W * 0.42), y: 30, r: 26, flower: true }, { x: Math.round(W * 0.58), y: 52, r: 18, flower: false }, { x: Math.round(AW * 0.8), y: 40, r: 22, flower: true }];
  const fly = { x: W + 70, y: LINE - 150, vx: 0, vy: 0, home: [W + 70, LINE - 150] as Point };
  const bladeCells = (b: Blade, now: number, out: Cell[]) => {
    const sway = Math.sin(now * 0.0011 + b.phase + b.x * 0.01) * (b.h * 0.07) + Math.sin(now * 0.0029 + b.phase) * 2;
    const steps = Math.ceil(b.h / C); let last = "";
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps; const x = b.x + (b.lean + sway) * t * t; const y = LINE - b.h * t + b.droop * b.h * t * t * t * 1.4;
      const gx = Math.round(x / C) * C, gy = Math.round(y / C) * C; const key = `${gx},${gy}`; if (key === last) continue; last = key;
      const pal = greens(); const color = pal[(b.hue + (t > 0.7 ? 3 : 0)) % pal.length];
      out.push([gx, gy, color]); if (t < 0.3 && b.h > 70) out.push([gx + C, gy, color]); // thicker at the base
    }
    if (b.cattail) { const t = 0.86; const x = Math.round((b.x + (b.lean + sway) * t * t) / C) * C; const y = Math.round((LINE - b.h * t) / C) * C; for (let k = 0; k < 4; k += 1) out.push([x, y - k * C, isDark() ? "#b07a4a" : "#7a4a2a"], [x + C, y - k * C, isDark() ? "#c58b55" : "#8e5730"]); }
  };
  const onMove = (event: PointerEvent) => { const r = area.getBoundingClientRect(); mouse.x = event.clientX - r.left; mouse.y = event.clientY - r.top; };
  const onLeave = () => { mouse.x = -9999; mouse.y = -9999; };
  area.addEventListener("pointermove", onMove); area.addEventListener("pointerleave", onLeave);
  // Off screen, the scene does not draw.
  let visible = true;
  const observer = typeof IntersectionObserver === "function" ? new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; }) : null;
  observer?.observe(area);

  const loop = (now: number) => {
    if (!running) return;
    frame = requestAnimationFrame(loop);
    if (!visible) return;
    const still = reducedMotion();
    const pal = palette();

    // wordmark
    const ink = pack(isDark() ? [236, 234, 228] : [26, 25, 22]); wbuf.fill(0);
    const wx = mouse.x - word.offsetLeft, wy = mouse.y - word.offsetTop;
    for (const p of dots) {
      const dx = p.x - wx, dy = p.y - wy; const d2 = dx * dx + dy * dy;
      if (d2 < 96 * 96) { const d = Math.sqrt(d2) || 1; const f = (1 - d / 96) * 3.2; p.vx += (dx / d) * f; p.vy += (dy / d) * f; }
      p.vx += (p.hx - p.x) * 0.06; p.vy += (p.hy - p.y) * 0.06; p.vx *= 0.84; p.vy *= 0.84; p.x += p.vx; p.y += p.vy;
      const c = (p.x - p.hx) ** 2 + (p.y - p.hy) ** 2 > 4 ? gradPacked[Math.min(63, Math.round((p.hx / W) * 63))] : ink;
      const x0 = Math.round(p.x), y0 = Math.round(p.y);
      for (let yy = 0; yy < 3; yy += 1) { const y = y0 + yy; if (y < 0 || y >= H) continue; for (let xx = 0; xx < 3; xx += 1) { const x = x0 + xx; if (x >= 0 && x < W) wbuf[y * W + x] = c; } }
    }
    wctx.putImageData(wimg, 0, 0);

    // behaviour: face the pointer, stretch up when it is close, otherwise fish now and then
    const mx = mouse.x, my = mouse.y; const cx = boxX + 420;
    const near = mx > -9000 && Math.hypot(mx - cx, my - (boxY + 200)) < 230;
    if (mx > -9000 && Math.abs(mx - cx) > 60) { const want = mx > cx ? 1 : -1; if (want !== state.facing && now - state.turnStart > 600) { state.turnFrom = state.facing; state.facing = want; state.turnStart = now; } }
    let pose = POSES.stand;
    if (!still) {
      if (near) { state.nextFish = now + 2500; pose = POSES.alert; }
      else {
        if (now > state.nextFish && !state.fishStart) state.fishStart = now;
        if (state.fishStart) {
          const t = (now - state.fishStart) / 3200; // down 1.1s, hold, up
          const k = t < 0.34 ? ease(t / 0.34) : t < 0.55 ? 1 : t < 1 ? 1 - ease((t - 0.55) / 0.45) : 0;
          pose = blendPose(POSES.stand, POSES.fish, k);
          if (t > 0.36 && !state.lastStrike) state.lastStrike = 1;
          if (t >= 1) { state.fishStart = 0; state.lastStrike = 0; state.nextFish = now + 6000 + Math.random() * 4000; }
        }
      }
    }
    state.pose = { neck: state.pose.neck + (pose.neck - state.pose.neck) * 0.2, body: state.pose.body + (pose.body - state.pose.body) * 0.2 };
    const breathe = still ? 0 : Math.sin(now * 0.0021) * 1.6;
    const empty = { a: new Uint8ClampedArray(CW * CH * 4), eye: [0, 0] as Point, tip: [0, 0] as Point };
    const cur = heron ? drawHeron(state.pose, state.facing, breathe) : empty;
    const turnP = Math.min(1, (now - state.turnStart) / 420);
    const prev = heron && turnP < 1 ? drawHeron(state.pose, state.turnFrom, breathe) : null;
    if (heron && state.lastStrike === 1) { state.lastStrike = 2; state.ripples.push({ x: boxX + cur.tip[0], born: now }); }
    if (now > state.nextBlink) { state.blinkUntil = now + 130; state.nextBlink = now + 2400 + Math.random() * 3500; }

    // draw: reeds behind, the heron (its cells boil a little so it never sits perfectly still), reeds in front
    ctx.clearRect(0, 0, AW, AH);
    const back: Cell[] = [], front: Cell[] = [];
    for (const b of blades) bladeCells(b, still ? 0 : now, b.front ? front : back);
    for (const [x, y, color] of back) { ctx.fillStyle = color; ctx.fillRect(x, y, C - 1, C - 1); }
    if (!still) for (let i = 0; i < 40; i += 1) seeds[Math.floor(Math.random() * seeds.length)] = Math.random();
    const cells: Cell[] = [];
    for (let y = 0; y < CH; y += 1) for (let x = 0; x < CW; x += 1) {
      const th = BAYER[y & 7][x & 7]; const k = y * CW + x;
      const on = (src: Uint8ClampedArray) => src[k * 4 + 3] / 255 > th * 0.9 + 0.05;
      const show = prev ? (th < turnP ? on(cur.a) : on(prev.a)) : on(cur.a);
      if (!show) continue;
      const s = seeds[k];
      const color = s < 0.14 ? pal.flecks[Math.floor((s / 0.14) * pal.flecks.length)] : pal.blues[Math.min(pal.blues.length - 1, Math.floor(((x / CW) * 0.6 + (s - 0.14) * 0.9) * pal.blues.length))];
      cells.push([x, y, color]);
    }
    for (const [x, y, color] of cells) { ctx.fillStyle = color; ctx.fillRect(boxX + x * C, boxY + y * C, C - 1, C - 1); }
    if (heron && now > state.blinkUntil && turnP >= 1) { ctx.fillStyle = pal.eye; ctx.fillRect(boxX + Math.round(cur.eye[0]) * C, boxY + Math.round(cur.eye[1]) * C, C - 1, C - 1); }
    for (const [x, y, color] of front) { ctx.fillStyle = color; ctx.fillRect(x, y, C - 1, C - 1); }

    // water: drifting streaks, the reflections, ripples
    const wlight = isDark() ? ["#1f2a48", "#262f55", "#1a2140"] : ["#dfe6fa", "#cfd9f6", "#e8ecfb"];
    for (let r = 0, y = LINE + 6; y < AH; r += 1, y += 7) {
      const drift = (now * 0.012 * (r % 2 ? 1 : -0.7)) % 120;
      for (let x = -120 + drift + ((r * 37) % 60); x < AW; x += 64 + ((r * 13) % 40)) { ctx.fillStyle = wlight[r % 3]; ctx.fillRect(Math.round(x), y, 22 + ((r * 7) % 26), 2); }
    }
    ctx.save(); ctx.globalAlpha = isDark() ? 0.3 : 0.2;
    for (let k = 0; k < WATER - 4; k += 2) { // wordmark reflection, row by row with a slow wave
      const srcY = base - 2 - Math.floor(k * 1.25); if (srcY < 0) break;
      const dx = still ? 0 : Math.sin(now * 0.002 + k * 0.35) * 3;
      ctx.drawImage(word, 0, srcY, W, 2, word.offsetLeft + dx, LINE + 4 + k, W, 2);
    }
    for (const [x, y, color] of back.concat(front)) { // reed reflections
      const ry = LINE + 4 + Math.round((LINE - y) * 0.62); if (ry >= AH) continue;
      const dx = still ? 0 : Math.round(Math.sin(now * 0.002 + ry * 0.12) * 2.5);
      ctx.fillStyle = color; ctx.fillRect(x + dx, ry, C - 1, 2);
    }
    for (const [x, y, color] of cells) { // heron reflection
      const ry = LINE + 4 + Math.round((BOX_H - (y + 1) * C) * 0.62);
      if (ry >= AH || y * C < BOX_H - (WATER - 4) / 0.62) continue;
      const dx = still ? 0 : Math.round(Math.sin(now * 0.002 + ry * 0.12) * 2.5);
      ctx.fillStyle = color; ctx.fillRect(boxX + x * C + dx, ry, C - 1, 2);
    }
    ctx.restore();
    state.ripples = state.ripples.filter((ripple) => now - ripple.born < 1800);
    for (const ripple of state.ripples) {
      const t = (now - ripple.born) / 1800; const rx = 10 + t * 120; const ry = rx * 0.16;
      ctx.fillStyle = isDark() ? `rgba(177,172,255,${0.75 * (1 - t)})` : `rgba(61,66,232,${0.55 * (1 - t)})`;
      for (let a = 0; a < Math.PI * 2; a += 0.16) { const px = ripple.x + Math.cos(a) * rx, py = LINE + 8 + Math.sin(a) * ry; if (py >= LINE + 2) ctx.fillRect(Math.round(px / 2) * 2, Math.round(py), 3, 2); }
    }
    for (const pad of pads) { // lily pads bob on the water
      const bob = still ? 0 : Math.round(Math.sin(now * 0.0015 + pad.x) * 1.2);
      const leaves = greens();
      for (let y = -2; y <= 2; y += 1) for (let x = -pad.r; x <= pad.r; x += C) {
        if ((x / pad.r) ** 2 + (y / 2.6) ** 2 > 1 || (x > 0 && Math.abs(y) < 1 && x < pad.r * 0.5)) continue;
        ctx.fillStyle = leaves[(Math.abs(x + y * 3) / C) % 3 | 0]; ctx.fillRect(pad.x + x, LINE + pad.y + y * 3 + bob, C - 1, 2);
      }
      if (pad.flower) { ctx.fillStyle = isDark() ? "#ff9fd0" : "#e494c4"; ctx.fillRect(pad.x - 4, LINE + pad.y - 8 + bob, C - 1, C - 1); ctx.fillRect(pad.x, LINE + pad.y - 12 + bob, C - 1, C - 1); ctx.fillRect(pad.x + 4, LINE + pad.y - 8 + bob, C - 1, C - 1); ctx.fillStyle = isDark() ? "#ffd27a" : "#f3b860"; ctx.fillRect(pad.x, LINE + pad.y - 8 + bob, C - 1, C - 1); }
    }
    if (!still) { // a dragonfly hovers over the reeds and darts away from the pointer
      const dxm = fly.x - mx, dym = fly.y - my; const dm = Math.hypot(dxm, dym);
      if (dm < 110) { fly.vx += (dxm / dm) * 1.6; fly.vy += (dym / dm) * 1.6; }
      const tx = fly.home[0] + Math.sin(now * 0.0009) * 140 + Math.sin(now * 0.0031) * 30, ty = fly.home[1] + Math.sin(now * 0.0013) * 40 + Math.sin(now * 0.0047) * 12;
      fly.vx += (tx - fly.x) * 0.004; fly.vy += (ty - fly.y) * 0.004; fly.vx *= 0.9; fly.vy *= 0.9; fly.x += fly.vx; fly.y += fly.vy;
      const fx = Math.round(fly.x / 2) * 2, fy = Math.round(fly.y / 2) * 2; const flap = Math.floor(now / 40) % 2;
      ctx.fillStyle = isDark() ? "#6cc4ff" : "#2563EB"; for (let k = 0; k < 5; k += 1) ctx.fillRect(fx + k * 3, fy, 3, 2);
      ctx.fillStyle = isDark() ? "rgba(200,215,255,.7)" : "rgba(91,91,214,.45)";
      ctx.fillRect(fx + 3, fy - (flap ? 5 : 3), 3, flap ? 4 : 2); ctx.fillRect(fx + 7, fy - (flap ? 5 : 3), 3, flap ? 4 : 2);
      ctx.fillRect(fx + 3, fy + 2, 3, flap ? 2 : 4); ctx.fillRect(fx + 7, fy + 2, 3, flap ? 2 : 4);
    }
  };
  frame = requestAnimationFrame(loop);
  return () => { stop(); observer?.disconnect(); area.removeEventListener("pointermove", onMove); area.removeEventListener("pointerleave", onLeave); };
}
