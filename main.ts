// "Break time, Judge!": the judge has looked at thousands of pictures today, so a little robot brings it
// a mug of hot cocoa with a marshmallow heart, and says so in a speech bubble.
// Drawn from scratch with signed distance fields (no assets, no randomness), lettered with a small stroke font
// written below, and encoded as a PNG with node:zlib. Node 22, standard library only.
// Outside the grader, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const W = 1024;
const H = 1024;

// ---------- small math helpers ----------
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const mix = (a, b, t) => a + (b - a) * t;
const mixc = (c1, c2, t) => [mix(c1[0], c2[0], t), mix(c1[1], c2[1], t), mix(c1[2], c2[2], t)];
const len = (x, y) => Math.sqrt(x * x + y * y);
const smooth = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// ---------- signed distance primitives (pixel units, negative inside) ----------
const sdCircle = (x, y, cx, cy, r) => len(x - cx, y - cy) - r;

function sdEllipse(x, y, cx, cy, rx, ry, rot = 0) {
  let px = x - cx;
  let py = y - cy;
  if (rot) {
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const qx = c * px + s * py;
    py = -s * px + c * py;
    px = qx;
  }
  const k = len(px / rx, py / ry);
  return (k - 1) * Math.min(rx, ry);
}

function sdRoundBox(x, y, cx, cy, hx, hy, r) {
  const qx = Math.abs(x - cx) - hx + r;
  const qy = Math.abs(y - cy) - hy + r;
  return len(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

// distance to a segment (no radius): the base of capsules and of the stroke font
function dSeg(x, y, ax, ay, bx, by) {
  const pax = x - ax;
  const pay = y - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const h = clamp((pax * bax + pay * bay) / (bax * bax + bay * bay || 1), 0, 1);
  return len(pax - bax * h, pay - bay * h);
}
const sdSegment = (x, y, ax, ay, bx, by, r) => dSeg(x, y, ax, ay, bx, by) - r;

// Arc of a circle: the half above the centre (up = true, a happy closed eye) or below it (a smile).
function sdHalfArc(x, y, cx, cy, r, th, up) {
  const px = x - cx;
  const py = y - cy;
  const inside = up ? py <= 0 : py >= 0;
  if (inside) return Math.abs(len(px, py) - r) - th;
  return Math.min(len(px - r, py), len(px + r, py)) - th;
}

// Heart (Inigo Quilez), tip at the bottom; s is its height in pixels, (cx, cy) its middle.
function sdHeart(x, y, cx, cy, s) {
  const px = Math.abs((x - cx) / s);
  const py = (cy - y) / s + 0.5;
  let d;
  if (py + px > 1) d = len(px - 0.25, py - 0.75) - Math.SQRT2 / 4;
  else {
    const m = 0.5 * Math.max(px + py, 0);
    d = Math.sqrt(Math.min(px * px + (py - 1) * (py - 1), (px - m) * (px - m) + (py - m) * (py - m))) * Math.sign(px - py);
  }
  return d * s;
}

// Triangle (Inigo Quilez), for the speech bubble's tail.
function sdTriangle(x, y, ax, ay, bx, by, cx, cy) {
  const e0x = bx - ax, e0y = by - ay, e1x = cx - bx, e1y = cy - by, e2x = ax - cx, e2y = ay - cy;
  const v0x = x - ax, v0y = y - ay, v1x = x - bx, v1y = y - by, v2x = x - cx, v2y = y - cy;
  const proj = (vx, vy, ex, ey) => {
    const h = clamp((vx * ex + vy * ey) / (ex * ex + ey * ey), 0, 1);
    return [vx - ex * h, vy - ey * h];
  };
  const [q0x, q0y] = proj(v0x, v0y, e0x, e0y);
  const [q1x, q1y] = proj(v1x, v1y, e1x, e1y);
  const [q2x, q2y] = proj(v2x, v2y, e2x, e2y);
  const s = Math.sign(e0x * e2y - e0y * e2x);
  const d0 = [q0x * q0x + q0y * q0y, s * (v0x * e0y - v0y * e0x)];
  const d1 = [q1x * q1x + q1y * q1y, s * (v1x * e1y - v1y * e1x)];
  const d2 = [q2x * q2x + q2y * q2y, s * (v2x * e2y - v2y * e2x)];
  const dd = Math.min(d0[0], d1[0], d2[0]);
  const ss = Math.min(d0[1], d1[1], d2[1]);
  return -Math.sqrt(dd) * Math.sign(ss);
}

// Rhombus (Inigo Quilez) with half-diagonals bx, by: two of them make a four-point sparkle.
function sdRhombus(x, y, cx, cy, bx, by) {
  const px = Math.abs(x - cx);
  const py = Math.abs(y - cy);
  const h = clamp(((bx - 2 * px) * bx - (by - 2 * py) * by) / (bx * bx + by * by), -1, 1);
  const d = len(px - 0.5 * bx * (1 - h), py - 0.5 * by * (1 + h));
  return d * Math.sign(px * by + py * bx - bx * by);
}

// ---------- a tiny rounded stroke font, only the letters this picture says ----------
// Each glyph is in units of its height (x right, y down, 0..1) and is a list of polylines; arcs are
// sampled into short segments, so a glyph is just segments and the strokes come out round and clean.
function arc(cx, cy, rx, ry, a0, a1, n = 14) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = a0 + ((a1 - a0) * i) / n;
    pts.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]);
  }
  return pts;
}
const HALF = Math.PI / 2;
const GLYPHS = {
  A: { w: 0.62, lines: [[[0, 1], [0.31, 0], [0.62, 1]], [[0.13, 0.64], [0.49, 0.64]]] },
  B: { w: 0.56, lines: [[[0, 0], [0, 1]], [[0, 0], [0.3, 0], ...arc(0.3, 0.245, 0.22, 0.245, -HALF, HALF), [0, 0.49]], [[0, 0.49], [0.32, 0.49], ...arc(0.32, 0.745, 0.24, 0.255, -HALF, HALF), [0, 1]]] },
  D: { w: 0.62, lines: [[[0, 0], [0, 1]], [[0, 0], [0.16, 0], ...arc(0.16, 0.5, 0.46, 0.5, -HALF, HALF, 20), [0, 1]]] },
  E: { w: 0.5, lines: [[[0.5, 0], [0, 0], [0, 1], [0.5, 1]], [[0, 0.49], [0.42, 0.49]]] },
  G: { w: 0.66, lines: [[...arc(0.34, 0.5, 0.33, 0.5, -0.8, -2 * Math.PI, 26), [0.67, 0.56], [0.67, 0.5], [0.4, 0.5]]] },
  I: { w: 0.0, lines: [[[0, 0], [0, 1]]] },
  J: { w: 0.48, lines: [[[0.48, 0], [0.48, 0.74], ...arc(0.24, 0.74, 0.24, 0.26, 0, Math.PI, 12)]] },
  K: { w: 0.56, lines: [[[0, 0], [0, 1]], [[0.56, 0], [0, 0.6]], [[0.2, 0.4], [0.58, 1]]] },
  M: { w: 0.74, lines: [[[0, 1], [0, 0], [0.37, 0.62], [0.74, 0], [0.74, 1]]] },
  R: { w: 0.56, lines: [[[0, 1], [0, 0], [0.3, 0], ...arc(0.3, 0.25, 0.24, 0.25, -HALF, HALF), [0, 0.5]], [[0.26, 0.5], [0.58, 1]]] },
  T: { w: 0.6, lines: [[[0, 0], [0.6, 0]], [[0.3, 0], [0.3, 1]]] },
  U: { w: 0.58, lines: [[[0, 0], [0, 0.7], ...arc(0.29, 0.7, 0.29, 0.3, Math.PI, 0, 14), [0.58, 0]]] },
  ',': { w: 0.06, lines: [[[0.06, 0.9], [-0.02, 1.12]]] },
  '!': { w: 0.0, lines: [[[0, 0], [0, 0.66]], [[0, 0.97], [0, 0.97]]] },
  ' ': { w: 0.2, lines: [] },
};

// Lay a line of text out centred on cx with its cap height from top to top + h; returns its segments.
function layoutText(text, cx, top, h, track = 0.24) {
  let width = 0;
  for (const ch of text) width += GLYPHS[ch].w * h + track * h;
  width -= track * h;
  let x = cx - width / 2;
  const segs = [];
  for (const ch of text) {
    const g = GLYPHS[ch];
    for (const pl of g.lines) {
      for (let i = 0; i < pl.length - 1 || (pl.length === 1 && i === 0); i++) {
        const a = pl[i];
        const b = pl[Math.min(i + 1, pl.length - 1)];
        segs.push([x + a[0] * h, top + a[1] * h, x + b[0] * h, top + b[1] * h]);
      }
      if (pl.length === 2 && pl[0][0] === pl[1][0] && pl[0][1] === pl[1][1]) segs.push([x + pl[0][0] * h, top + pl[0][1] * h, x + pl[0][0] * h, top + pl[0][1] * h]);
    }
    x += g.w * h + track * h;
  }
  return { segs, x0: cx - width / 2, x1: cx + width / 2, right: x - track * h };
}
const textSdf = (segs, r) => (x, y) => {
  let d = 1e9;
  for (const s of segs) {
    const v = dSeg(x, y, s[0], s[1], s[2], s[3]);
    if (v < d) d = v;
  }
  return d - r;
};

// ---------- palette ----------
const INK = [62, 48, 84];
const TEAL = [118, 208, 196];
const TEAL_LIGHT = [176, 238, 226];
const TEAL_DARK = [80, 168, 160];
const SCREEN = [36, 44, 78];
const GLOW = [128, 244, 255];
const BLUSH = [255, 128, 160];
const CORAL = [255, 150, 120];
const MUG = [255, 186, 200];
const MUG_DARK = [240, 150, 172];
const COCOA = [146, 88, 60];
const HEART = [255, 96, 138];
const PINK_TEXT = [242, 72, 120];

// ---------- the scene, painted back to front ----------
// Each layer: bounding box, distance function, colour (constant or per pixel), optional outline and opacity.
const layers = [];
const add = (box, d, color, opts = {}) => layers.push({ box, d, color, outline: opts.outline ?? 0, alpha: opts.alpha ?? 1 });

const SUN_X = 512;
const SUN_Y = 470;
// Sky, sun and rays are drawn per pixel in background(); everything else is a layer.
function background(x, y) {
  const t = y / H;
  let c = t < 0.55 ? mixc([255, 196, 168], [255, 232, 178], t / 0.55) : mixc([255, 232, 178], [255, 246, 214], (t - 0.55) / 0.45);
  const dx = x - SUN_X;
  const dy = y - SUN_Y;
  const r = len(dx, dy);
  const ang = Math.atan2(dy, dx);
  const ray = 0.5 + 0.5 * Math.cos(ang * 14);
  const rayA = smooth(0.55, 0.85, ray) * 0.18 * (1 - smooth(120, 640, r));
  c = mixc(c, [255, 252, 236], rayA);
  const halo = Math.exp(-((r / 300) ** 2));
  c = mixc(c, [255, 244, 190], halo * 0.75);
  return c;
}

// hills
const backHill = (x) => 730 - 60 * Math.exp(-(((x - 180) / 240) ** 2)) - 40 * Math.exp(-(((x - 900) / 220) ** 2));
const frontHill = (x) => 830 + 60 * ((x - 512) / 560) ** 2;
add([0, 600, W, H], (x, y) => backHill(x) - y, (x, y) => mixc([190, 230, 130], [160, 214, 112], clamp((y - 660) / 200, 0, 1)));
add([0, 800, W, H], (x, y) => frontHill(x) - y, (x, y) => mixc([132, 204, 100], [98, 172, 82], clamp((y - 830) / 194, 0, 1)));

// a sprinkle of meadow flowers (fixed positions, so every run draws the same image)
const meadow = [
  [70, 915, [255, 255, 255]], [150, 975, [255, 190, 210]], [250, 890, [255, 255, 255]], [330, 995, [255, 226, 120]],
  [800, 940, [255, 190, 210]], [900, 880, [255, 255, 255]], [960, 985, [255, 226, 120]], [700, 1000, [255, 255, 255]],
  [96, 800, [255, 255, 255]], [940, 790, [255, 190, 210]],
];
for (const [mx, my, col] of meadow) {
  const f = (x, y) => {
    let d = 1e9;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
      d = Math.min(d, sdCircle(x, y, mx + Math.cos(a) * 9, my + Math.sin(a) * 9, 7.5));
    }
    return d;
  };
  add([mx - 22, my - 22, mx + 22, my + 22], f, col);
  add([mx - 8, my - 8, mx + 8, my + 8], (x, y) => sdCircle(x, y, mx, my, 5), [255, 196, 60]);
}

// the robot's soft shadow on the grass
add([280, 880, 760, 960], (x, y) => sdEllipse(x, y, 512, 918, 210, 28), [60, 120, 60], { alpha: 0.22 });

// legs and feet
for (const lx of [452, 572]) {
  add([lx - 40, 830, lx + 40, 900], (x, y) => sdSegment(x, y, lx, 840, lx, 892, 16), TEAL_DARK, { outline: 5 });
  add([lx - 60, 870, lx + 60, 935], (x, y) => sdRoundBox(x, y, lx, 905, 42, 20, 18), TEAL, { outline: 5 });
}

// body with a soft top-left light
const shade = (base, light, cx, cy, r) => (x, y) => mixc(light, base, clamp(len(x - cx, y - cy) / r, 0, 1));
add([370, 630, 660, 870], (x, y) => sdRoundBox(x, y, 512, 750, 126, 102, 44), shade(TEAL, TEAL_LIGHT, 432, 670, 260), { outline: 6 });
add([476, 580, 548, 650], (x, y) => sdRoundBox(x, y, 512, 615, 26, 26, 10), TEAL_DARK, { outline: 5 });

// antenna with a heart bulb (drawn before the head, so the head covers its root)
add([492, 300, 532, 360], (x, y) => sdSegment(x, y, 512, 345, 512, 318, 6), [150, 160, 180], { outline: 4 });
add([462, 270, 562, 350], (x, y) => sdCircle(x, y, 512, 306, 36), [255, 140, 170], { alpha: 0.25 });
add([478, 280, 546, 334], (x, y) => sdHeart(x, y, 512, 306, 36), HEART, { outline: 5 });

// ears
add([300, 430, 380, 510], (x, y) => sdCircle(x, y, 338, 470, 30), CORAL, { outline: 6 });
add([644, 430, 724, 510], (x, y) => sdCircle(x, y, 686, 470, 30), CORAL, { outline: 6 });

// head
add([330, 340, 694, 600], (x, y) => sdRoundBox(x, y, 512, 470, 170, 124, 60), shade(TEAL, TEAL_LIGHT, 420, 370, 330), { outline: 7 });
add([370, 370, 654, 575], (x, y) => sdRoundBox(x, y, 512, 476, 136, 90, 40), (x, y) => mixc([52, 62, 104], SCREEN, clamp((y - 386) / 180, 0, 1)), { outline: 4 });
add([380, 384, 520, 436], (x, y) => sdRoundBox(x, y, 436, 404, 50, 11, 11), [255, 255, 255], { alpha: 0.16 });

// glowing happy eyes and a big open smile
const eyeL = (x, y) => sdHalfArc(x, y, 452, 474, 24, 7, true);
const eyeR = (x, y) => sdHalfArc(x, y, 572, 474, 24, 7, true);
const mouth = (x, y) => sdHalfArc(x, y, 512, 506, 24, 7, false);
const face = (x, y) => Math.min(eyeL(x, y), eyeR(x, y), mouth(x, y));
add([400, 430, 624, 560], (x, y) => face(x, y) - 9, GLOW, { alpha: 0.16 });
add([400, 430, 624, 560], face, GLOW);
add([396, 506, 456, 542], (x, y) => sdEllipse(x, y, 422, 524, 23, 11), BLUSH, { alpha: 0.85 });
add([568, 506, 628, 542], (x, y) => sdEllipse(x, y, 602, 524, 23, 11), BLUSH, { alpha: 0.85 });

// a ladybug hitched a ride on the robot's head
add([600, 310, 690, 370], (x, y) => sdCircle(x, y, 662, 340, 12), [50, 44, 60], { outline: 3 });
add([596, 310, 690, 380], (x, y) => sdEllipse(x, y, 640, 346, 25, 20, -0.25), [234, 58, 60], { outline: 4 });
add([616, 326, 666, 370], (x, y) => Math.min(sdCircle(x, y, 632, 341, 5), sdCircle(x, y, 648, 337, 4.5), sdCircle(x, y, 640, 356, 5)), [50, 44, 60]);
add([616, 326, 646, 340], (x, y) => sdEllipse(x, y, 630, 333, 7, 4, -0.25), [255, 255, 255], { alpha: 0.6 });

// arms reaching forward to hold the mug out
add([372, 660, 460, 820], (x, y) => sdSegment(x, y, 400, 690, 418, 770, 21), TEAL_DARK, { outline: 5 });
add([564, 660, 652, 820], (x, y) => sdSegment(x, y, 624, 690, 606, 770, 21), TEAL_DARK, { outline: 5 });

// steam curling up into a heart
const steam = (x, y) =>
  Math.min(
    sdSegment(x, y, 486, 668, 478, 646, 6),
    sdSegment(x, y, 478, 646, 488, 628, 6),
    sdSegment(x, y, 538, 668, 546, 646, 6),
    sdSegment(x, y, 546, 646, 536, 628, 6),
  );
add([460, 610, 564, 680], steam, [255, 255, 255], { alpha: 0.95 });
add([478, 570, 546, 630], (x, y) => sdHeart(x, y, 512, 600, 44), [255, 255, 255], { outline: 3, alpha: 0.95 });

// the mug: pink, a white heart on its side, a handle, cocoa and a marshmallow heart on top
add([574, 700, 650, 800], (x, y) => Math.abs(sdCircle(x, y, 596, 748, 30)) - 10, MUG_DARK, { outline: 5 });
add([420, 660, 604, 830], (x, y) => sdRoundBox(x, y, 512, 748, 84, 76, 20), (x, y) => mixc(MUG, MUG_DARK, clamp((x - 450) / 150, 0, 1)), { outline: 6 });
add([430, 660, 594, 700], (x, y) => sdEllipse(x, y, 512, 680, 74, 13), COCOA, { outline: 4 });
add([494, 666, 530, 694], (x, y) => sdHeart(x, y, 512, 680, 22), [255, 248, 240]);
add([476, 730, 548, 800], (x, y) => sdHeart(x, y, 512, 764, 52), [255, 248, 244], { outline: 4 });

// mitten hands holding it
add([390, 740, 470, 820], (x, y) => sdCircle(x, y, 428, 780, 32), TEAL, { outline: 6 });
add([556, 740, 636, 820], (x, y) => sdCircle(x, y, 596, 780, 32), TEAL, { outline: 6 });

// a few hearts drifting about, and sparkles
const hearts = [
  [300, 600, 40, 1],
  [262, 530, 26, 0.85],
  [730, 600, 36, 1],
  [770, 530, 24, 0.85],
];
for (const [hx, hy, hs, ha] of hearts) {
  add([hx - hs, hy - hs, hx + hs, hy + hs], (x, y) => sdHeart(x, y, hx, hy, hs), HEART, { outline: 4, alpha: ha });
}
const sparkles = [
  [360, 640, 14],
  [672, 650, 12],
  [250, 380, 16],
  [780, 400, 14],
  [880, 330, 11],
  [150, 330, 11],
];
for (const [sx, sy, ss] of sparkles) {
  const f = (x, y) => Math.min(sdRhombus(x, y, sx, sy, ss, ss * 0.28), sdRhombus(x, y, sx, sy, ss * 0.28, ss));
  add([sx - ss - 2, sy - ss - 2, sx + ss + 2, sy + ss + 2], f, [255, 255, 236]);
}

// the speech bubble and what the robot says
const BX = 512;
const BY = 158;
const bubble = (x, y) => Math.min(sdRoundBox(x, y, BX, BY, 330, 116, 64), sdTriangle(x, y, 392, 250, 456, 250, 410, 318) - 2);
add([170, 30, 860, 330], (x, y) => bubble(x, y) - 10, [190, 120, 100], { alpha: 0.12 });
add([170, 30, 860, 330], bubble, [255, 255, 255], { outline: 6 });
const line1 = layoutText('BREAK TIME,', BX, 74, 64);
const line2 = layoutText('JUDGE!', BX - 34, 160, 84);
add([line1.x0 - 12, 62, line1.x1 + 16, 160], textSdf(line1.segs, 6.5), INK);
add([line2.x0 - 14, 148, line2.x1 + 14, 262], textSdf(line2.segs, 8.5), PINK_TEXT);
const hx2 = line2.x1 + 62;
add([hx2 - 34, 172, hx2 + 34, 240], (x, y) => sdHeart(x, y, hx2, 205, 56), HEART, { outline: 4 });

// ---------- render ----------
const px = new Uint8Array(W * H * 3);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const sx = x + 0.5;
    const sy = y + 0.5;
    let c = background(sx, sy);
    for (const L of layers) {
      const b = L.box;
      if (sx < b[0] - 8 || sx > b[2] + 8 || sy < b[1] - 8 || sy > b[3] + 8) continue;
      const d = L.d(sx, sy);
      if (d > 0.5 + L.outline) continue;
      const fill = typeof L.color === 'function' ? L.color(sx, sy) : L.color;
      if (L.outline > 0) {
        const co = clamp(0.5 - (d - L.outline), 0, 1) * L.alpha;
        c = mixc(c, INK, co);
      }
      const cf = clamp(0.5 - d, 0, 1) * L.alpha;
      if (cf > 0) c = mixc(c, fill, cf);
    }
    const i = (y * W + x) * 3;
    px[i] = Math.round(clamp(c[0], 0, 255));
    px[i + 1] = Math.round(clamp(c[1], 0, 255));
    px[i + 2] = Math.round(clamp(c[2], 0, 255));
  }
}

// ---------- PNG encoding (RGB, per-row filter chosen by smallest absolute sum) ----------
const CRC = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC[n] = c >>> 0;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
const stride = W * 3;
const raw = Buffer.alloc((stride + 1) * H);
const cand = [0, 1, 2, 3, 4].map(() => Buffer.alloc(stride));
for (let y = 0; y < H; y++) {
  const row = px.subarray(y * stride, (y + 1) * stride);
  const up = y > 0 ? px.subarray((y - 1) * stride, y * stride) : null;
  let best = 0;
  let bestSum = Infinity;
  for (let f = 0; f < 5; f++) {
    const o = cand[f];
    let sum = 0;
    for (let i = 0; i < stride; i++) {
      const a = i >= 3 ? row[i - 3] : 0;
      const b = up ? up[i] : 0;
      const cc = up && i >= 3 ? up[i - 3] : 0;
      let pred = 0;
      if (f === 1) pred = a;
      else if (f === 2) pred = b;
      else if (f === 3) pred = (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - cc;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - cc);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : cc;
      }
      const v = (row[i] - pred) & 0xff;
      o[i] = v;
      sum += v < 128 ? v : 256 - v;
    }
    if (sum < bestSum) {
      bestSum = sum;
      best = f;
    }
  }
  raw[y * (stride + 1)] = best;
  cand[best].copy(raw, y * (stride + 1) + 1);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 2; // colour type: RGB
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

writeFileSync(join(process.env.MAKEFUN_OUTPUT_DIR ?? '/output', 'entry.png'), png);
