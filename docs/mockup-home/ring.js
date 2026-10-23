/* The hero: NerveCenter's mark in 3D, ordered-dithered. The ring carries the logo's blue-to-violet
   gradient, the light fold sits on its lower left as in the logo, and one small sphere per project
   orbits it. It turns on its own; the light follows the pointer. */

const LOGO = {
  ring: ["#2FA8FF", "#2563EB", "#3D42E8", "#5A2DD8"],
  fold: ["#A9D6FF", "#7DB8FA", "#4E8DEB"],
};
const R_MAIN = 0.9;
const R_TUBE = 0.215;
// The fold, traced from nervecenter-logo.svg (centre 583,543; ring radius 316px) into ring units.
const FOLD = [[286,733],[388,632],[399,624],[411,618],[424,617],[437,618],[450,623],[461,631],[571,741],[582,750],[596,756],[610,759],[624,758],[638,755],[651,748],[623,776],[590,799],[555,817],[518,830],[479,837],[438,838],[407,835],[377,829],[349,819],[322,807],[297,791],[275,773],[269,766],[267,760],[267,753],[270,747],[277,740]]
  .map(([x, y]) => [((x - 583) / 316) * R_MAIN, (-(y - 543) / 316) * R_MAIN]);
const FOLD_BOX = FOLD.reduce((b, [x, z]) => [Math.min(b[0], x), Math.max(b[1], x), Math.min(b[2], z), Math.max(b[3], z)], [9, -9, 9, -9]);
const FOLD_Y = R_TUBE + 0.03; // in front of the ring, like the logo's flap
const FOLD_H = 0.022;

const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const rgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const RING_STOPS = LOGO.ring.map(rgb);
const FOLD_STOPS = LOGO.fold.map(rgb);
function gradient(stops, t) { const s = Math.max(0, Math.min(0.9999, t)) * (stops.length - 1); const i = Math.floor(s); return mix(stops[i], stops[i + 1], s - i); }
/** Four tones of one colour, deep to highlight; the dither picks between neighbours. */
function tones(base) { return [mix(base, [10, 10, 30], 0.42), base, mix(base, [255, 255, 255], 0.38), mix(base, [255, 255, 255], 0.78)]; }

function polySdf(px, pz) { // signed distance to the fold outline in the ring plane (iq's polygon sdf)
  let d = (px - FOLD[0][0]) ** 2 + (pz - FOLD[0][1]) ** 2; let s = 1;
  for (let i = 0, j = FOLD.length - 1; i < FOLD.length; j = i, i++) {
    const [ax, az] = FOLD[i]; const [bx, bz] = FOLD[j];
    const ex = bx - ax, ez = bz - az, wx = px - ax, wz = pz - az;
    const t = Math.max(0, Math.min(1, (wx * ex + wz * ez) / (ex * ex + ez * ez)));
    const qx = wx - ex * t, qz = wz - ez * t; d = Math.min(d, qx * qx + qz * qz);
    const c1 = pz >= az, c2 = pz < bz, c3 = ex * wz > ez * wx;
    if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
  }
  return s * Math.sqrt(d);
}

const hero = { light: [0.45, 0.6], target: [0.45, 0.6], frame: 0, born: 0, projects: [] };

function setupRing(canvas, projectHues) {
  hero.projects = projectHues;
  hero.born = performance.now();
  const id = ++hero.frame;
  canvas.closest(".hero").addEventListener("pointermove", (e) => {
    const r = canvas.getBoundingClientRect();
    hero.target = [Math.max(-1.3, Math.min(1.3, ((e.clientX - r.left) / r.width) * 2 - 1)), Math.max(-1.3, Math.min(1.3, -(((e.clientY - r.top) / r.height) * 2 - 1)))];
  });
  let skip = false;
  const loop = (now) => {
    if (id !== hero.frame || !document.body.contains(canvas)) return;
    hero.light[0] += (hero.target[0] - hero.light[0]) * 0.07; hero.light[1] += (hero.target[1] - hero.light[1]) * 0.07;
    skip = !skip; if (!skip) paintHero(canvas, matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : now);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

function paintHero(canvas, time) {
  const N = canvas.width; const ctx = canvas.getContext("2d"); const img = ctx.createImageData(N, N); const data = img.data;
  const dark = document.documentElement.dataset.theme === "dark";
  const shadowTone = dark ? [34, 34, 52] : [222, 221, 236];
  const appear = Math.min(1, (performance.now() - hero.born) / 1100); // dissolve in on arrival
  // Orientation: tilted toward you and turning on its own; the light follows the pointer.
  const pitch = -(1.12 + Math.sin(time * 0.00031) * 0.16);
  const yaw = time * 0.00024;
  const cp = Math.cos(pitch), sp = Math.sin(pitch), cy = Math.cos(yaw), sy = Math.sin(yaw);
  // world -> local = Rx(-pitch) . Ry(-yaw)
  const toLocal = (x, y, z) => { const x1 = cy * x - sy * z; const z1 = sy * x + cy * z; return [x1, cp * y + sp * z1, -sp * y + cp * z1]; };
  const toWorld = (x, y, z) => { const y1 = cp * y - sp * z; const z1 = sp * y + cp * z; return [cy * x + sy * z1, y1, -sy * x + cy * z1]; };
  let [lx, ly, lz] = [hero.light[0] * 1.7, hero.light[1] * 1.7 + 0.5, -1.2]; const ll = Math.hypot(lx, ly, lz); lx /= ll; ly /= ll; lz /= ll;
  // Orbiting projects, in world space, on a tilted orbit.
  const sats = hero.projects.map((hue, i) => {
    const a = time * 0.00035 * (1 + i * 0.13) + (i * Math.PI * 2) / hero.projects.length;
    const ox = Math.cos(a) * 1.46, oz = Math.sin(a) * 1.46;
    return { x: ox, y: oz * 0.32 + Math.sin(a * 2) * 0.05, z: oz * 0.94, r: 0.075, hue };
  });
  const cam = [0, 0, -3.4]; const fov = 0.56; const bound = 1.6;
  const sceneD = (wx, wy, wz) => {
    const [x, y, z] = toLocal(wx, wy, wz);
    const q = Math.hypot(x, z) - R_MAIN; let d = Math.hypot(q, y) - R_TUBE; let hit = 0;
    // fold plate (cheap box test first)
    const bx = Math.max(FOLD_BOX[0] - x, x - FOLD_BOX[1], FOLD_BOX[2] - z, z - FOLD_BOX[3], 0);
    let fd = Math.max(bx, Math.abs(y - FOLD_Y) - FOLD_H);
    if (bx < 0.06) fd = Math.max(polySdf(x, z), Math.abs(y - FOLD_Y) - FOLD_H); // exact near the plate, so its edge never reads as a hit
    if (fd < d) { d = fd; hit = 1; }
    for (let i = 0; i < sats.length; i++) { const s = sats[i]; const sd = Math.hypot(wx - s.x, wy - s.y, wz - s.z) - s.r; if (sd < d) { d = sd; hit = 2 + i; } }
    return [d, hit];
  };
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const o = (j * N + i) * 4; const th = BAYER[j & 7][i & 7];
    const u = ((i + 0.5) / N) * 2 - 1; const v = -(((j + 0.5) / N) * 2 - 1);
    let dx = u * fov, dy = v * fov, dz = 1; const dl = Math.hypot(dx, dy, dz); dx /= dl; dy /= dl; dz /= dl;
    const b = cam[0] * dx + cam[1] * dy + cam[2] * dz; const c = cam[0] ** 2 + cam[1] ** 2 + cam[2] ** 2 - bound * bound; const disc = b * b - c;
    let col = null;
    if (disc > 0 && th < appear) {
      let t = -b - Math.sqrt(disc); const tFar = -b + Math.sqrt(disc);
      for (let s = 0; s < 64 && t < tFar; s++) {
        const px = cam[0] + dx * t, py = cam[1] + dy * t, pz = cam[2] + dz * t;
        const [d, hit] = sceneD(px, py, pz);
        if (d < 0.0025) {
          // normal by central differences
          const e = 0.003;
          let nx = sceneD(px + e, py, pz)[0] - sceneD(px - e, py, pz)[0];
          let ny = sceneD(px, py + e, pz)[0] - sceneD(px, py - e, pz)[0];
          let nz = sceneD(px, py, pz + e)[0] - sceneD(px, py, pz - e)[0];
          const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
          const diff = Math.max(0, nx * lx + ny * ly + nz * lz);
          const hx = lx - dx, hy = ly - dy, hz = lz - dz; const hl = Math.hypot(hx, hy, hz);
          const spec = Math.pow(Math.max(0, (nx * hx + ny * hy + nz * hz) / hl), 30);
          const rim = Math.pow(1 - Math.max(0, -(nx * dx + ny * dy + nz * dz)), 3) * 0.35;
          const lit = Math.min(1, 0.16 + diff * 0.7 + spec * 0.6 + rim);
          let palette;
          if (hit === 0) { const [x, , z] = toLocal(px, py, pz); palette = tones(gradient(RING_STOPS, ((x - z) / (2 * (R_MAIN + R_TUBE))) * 0.5 + 0.5)); }
          else if (hit === 1) { const [x, , z] = toLocal(px, py, pz); palette = tones(gradient(FOLD_STOPS, ((x - z) / 1.8) * 0.5 + 0.62)); }
          else palette = tones(rgb(HUE_INK[sats[hit - 2].hue]));
          const level = lit * (palette.length - 1); const k = Math.floor(level);
          col = palette[Math.min(palette.length - 1, level - k > th ? k + 1 : k)];
          break;
        }
        t += d * 0.9;
      }
    }
    if (!col) { // dithered shadow under the ring
      const e = 1 - ((i - N * 0.5) / (N * 0.29)) ** 2 - ((j - N * 0.9) / (N * 0.028)) ** 2;
      col = e > 0 && e * 0.9 > th ? shadowTone : null;
    }
    if (!col) { data[o + 3] = 0; continue; }
    data[o] = col[0]; data[o + 1] = col[1]; data[o + 2] = col[2]; data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}
