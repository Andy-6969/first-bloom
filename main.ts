// "First Bloom": a little robot cups the first flower it ever grew, the moment it opens.
// Drawn from scratch with signed distance fields (no assets, no randomness), encoded as a PNG with node:zlib.
// Node 22, standard library only. Outside the grader, MAKEFUN_OUTPUT_DIR stands in for /output:
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

function sdSegment(x, y, ax, ay, bx, by, r) {
  const pax = x - ax;
  const pay = y - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const h = clamp((pax * bax + pay * bay) / (bax * bax + bay * bay), 0, 1);
  return len(pax - bax * h, pay - bay * h) - r;
}

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
  let px = Math.abs((x - cx) / s);
  const py = (cy - y) / s + 0.5;
  let d;
  if (py + px > 1) d = len(px - 0.25, py - 0.75) - Math.SQRT2 / 4;
  else {
    const m = 0.5 * Math.max(px + py, 0);
    d = Math.sqrt(Math.min(px * px + (py - 1) * (py - 1), (px - m) * (px - m) + (py - m) * (py - m))) * Math.sign(px - py);
  }
  return d * s;
}

// Trapezoid (Inigo Quilez): rt half-width at the top, rb at the bottom, he half-height.
function sdTrapezoid(x, y, cx, cy, rb, rt, he) {
  const px = Math.abs(x - cx);
  const py = cy - y;
  const cax = px - Math.min(px, py < 0 ? rb : rt);
  const cay = Math.abs(py) - he;
  const k2x = rt - rb;
  const k2y = 2 * he;
  const t = clamp(((rt - px) * k2x + (he - py) * k2y) / (k2x * k2x + k2y * k2y), 0, 1);
  const cbx = px - rt + k2x * t;
  const cby = py - he + k2y * t;
  const s = cbx < 0 && cay < 0 ? -1 : 1;
  return s * Math.sqrt(Math.min(cax * cax + cay * cay, cbx * cbx + cby * cby));
}

// Rhombus (Inigo Quilez) with half-diagonals bx, by: two of them make a four-point sparkle.
function sdRhombus(x, y, cx, cy, bx, by) {
  const px = Math.abs(x - cx);
  const py = Math.abs(y - cy);
  const h = clamp(((bx - 2 * px) * bx - (by - 2 * py) * by) / (bx * bx + by * by), -1, 1);
  const d = len(px - 0.5 * bx * (1 - h), py - 0.5 * by * (1 + h));
  return d * Math.sign(px * by + py * bx - bx * by);
}

// ---------- palette ----------
const INK = [62, 48, 84];
const TEAL = [118, 208, 196];
const TEAL_LIGHT = [176, 238, 226];
const TEAL_DARK = [80, 168, 160];
const SCREEN = [36, 44, 78];
const GLOW = [128, 244, 255];
const BLUSH = [255, 128, 160];
const CORAL = [255, 150, 120];
const PETAL = [255, 214, 64];
const PETAL_DEEP = [255, 168, 44];
const POT = [226, 122, 82];
const POT_DARK = [196, 96, 64];
const LEAF = [92, 182, 92];
const HEART = [255, 96, 138];

// ---------- the scene, painted back to front ----------
// Each layer: bounding box, distance function, colour (constant or per pixel), optional outline and opacity.
const layers = [];
const add = (box, d, color, opts = {}) => layers.push({ box, d, color, outline: opts.outline ?? 0, alpha: opts.alpha ?? 1 });
const full = [0, 0, W, H];

// Sky, sun and rays are drawn per pixel in background(); everything else is a layer.
function background(x, y) {
  const t = y / H;
  let c = t < 0.55 ? mixc([255, 196, 168], [255, 232, 178], t / 0.55) : mixc([255, 232, 178], [255, 246, 214], (t - 0.55) / 0.45);
  // soft rays turning around the sun behind the robot's head
  const sx = 560;
  const sy = 430;
  const dx = x - sx;
  const dy = y - sy;
  const r = len(dx, dy);
  const ang = Math.atan2(dy, dx);
  const ray = 0.5 + 0.5 * Math.cos(ang * 14);
  const rayA = smooth(0.55, 0.85, ray) * 0.18 * (1 - smooth(120, 640, r));
  c = mixc(c, [255, 252, 236], rayA);
  // warm halo
  const halo = Math.exp(-((r / 300) ** 2));
  c = mixc(c, [255, 244, 190], halo * 0.75);
  return c;
}

// clouds
const cloud = (cx, cy, s) => (x, y) =>
  Math.min(
    sdCircle(x, y, cx, cy, 34 * s),
    sdCircle(x, y, cx - 40 * s, cy + 12 * s, 26 * s),
    sdCircle(x, y, cx + 42 * s, cy + 10 * s, 28 * s),
    sdRoundBox(x, y, cx, cy + 22 * s, 66 * s, 16 * s, 16 * s),
  );
add([60, 120, 300, 260], cloud(170, 190, 1.2), [255, 255, 255], { alpha: 0.9 });
add([780, 170, 1000, 290], cloud(890, 225, 1.0), [255, 255, 255], { alpha: 0.85 });

// hills
const backHill = (x) => 712 - 70 * Math.exp(-(((x - 230) / 260) ** 2)) - 40 * Math.exp(-(((x - 900) / 220) ** 2));
const frontHill = (x) => 800 + 70 * ((x - 560) / 560) ** 2;
add([0, 600, W, H], (x, y) => backHill(x) - y, (x, y) => mixc([190, 230, 130], [160, 214, 112], clamp((y - 640) / 200, 0, 1)));
add([0, 780, W, H], (x, y) => frontHill(x) - y, (x, y) => mixc([132, 204, 100], [98, 172, 82], clamp((y - 800) / 224, 0, 1)));

// a sprinkle of meadow flowers (fixed positions, so every run draws the same image)
const meadow = [
  [70, 905, [255, 255, 255]], [150, 965, [255, 190, 210]], [250, 880, [255, 255, 255]], [330, 990, [255, 226, 120]],
  [820, 930, [255, 190, 210]], [900, 870, [255, 255, 255]], [960, 980, [255, 226, 120]], [760, 1000, [255, 255, 255]],
  [110, 790, [255, 255, 255]], [930, 760, [255, 190, 210]],
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
add([300, 840, 820, 930], (x, y) => sdEllipse(x, y, 560, 884, 220, 30), [60, 120, 60], { alpha: 0.22 });

// legs and feet
for (const lx of [500, 620]) {
  add([lx - 40, 800, lx + 40, 880], (x, y) => sdSegment(x, y, lx, 810, lx, 862, 16), TEAL_DARK, { outline: 5 });
  add([lx - 60, 840, lx + 60, 905], (x, y) => sdRoundBox(x, y, lx, 875, 42, 20, 18), TEAL, { outline: 5 });
}

// body with a soft top-left light
const shade = (base, light, cx, cy, r) => (x, y) => mixc(light, base, clamp(len(x - cx, y - cy) / r, 0, 1));
add([410, 600, 710, 840], (x, y) => sdRoundBox(x, y, 560, 720, 128, 104, 44), shade(TEAL, TEAL_LIGHT, 480, 640, 260), { outline: 6 });
// neck
add([520, 560, 600, 630], (x, y) => sdRoundBox(x, y, 560, 595, 28, 26, 10), TEAL_DARK, { outline: 5 });

// antenna with a heart bulb (drawn before the head, so the head covers its root)
add([540, 250, 580, 320], (x, y) => sdSegment(x, y, 560, 300, 560, 262, 6), [150, 160, 180], { outline: 4 });
add([500, 190, 620, 290], (x, y) => sdCircle(x, y, 560, 238, 46), [255, 140, 170], { alpha: 0.25 });
add([520, 200, 600, 280], (x, y) => sdHeart(x, y, 560, 238, 46), HEART, { outline: 5 });

// ears
add([340, 390, 420, 470], (x, y) => sdCircle(x, y, 380, 430, 30), CORAL, { outline: 6 });
add([700, 390, 780, 470], (x, y) => sdCircle(x, y, 740, 430, 30), CORAL, { outline: 6 });

// head
add([370, 280, 750, 580], (x, y) => sdRoundBox(x, y, 560, 430, 176, 132, 62), shade(TEAL, TEAL_LIGHT, 470, 330, 330), { outline: 7 });
// face screen with a gentle gradient and a glossy corner
add([410, 330, 710, 540], (x, y) => sdRoundBox(x, y, 560, 437, 142, 96, 42), (x, y) => mixc([52, 62, 104], SCREEN, clamp((y - 345) / 190, 0, 1)), { outline: 4 });
add([420, 345, 560, 400], (x, y) => sdRoundBox(x, y, 480, 368, 52, 12, 12), [255, 255, 255], { alpha: 0.16 });

// glowing happy eyes (closed arcs, the way you smile when something is just right) and a big smile
const eyeL = (x, y) => sdHalfArc(x, y, 498, 436, 25, 7, true);
const eyeR = (x, y) => sdHalfArc(x, y, 622, 436, 25, 7, true);
const mouth = (x, y) => sdHalfArc(x, y, 560, 478, 26, 7, false);
const face = (x, y) => Math.min(eyeL(x, y), eyeR(x, y), mouth(x, y));
add([440, 390, 680, 530], (x, y) => face(x, y) - 9, GLOW, { alpha: 0.16 });
add([440, 390, 680, 530], face, GLOW);
// blush
add([440, 470, 500, 510], (x, y) => sdEllipse(x, y, 466, 490, 24, 12), BLUSH, { alpha: 0.85 });
add([620, 470, 680, 510], (x, y) => sdEllipse(x, y, 654, 490, 24, 12), BLUSH, { alpha: 0.85 });

// a ladybug has landed on the robot's head to see the flower too
add([640, 270, 730, 330], (x, y) => sdCircle(x, y, 708, 300, 13), [50, 44, 60], { outline: 3 });
add([640, 270, 730, 340], (x, y) => sdEllipse(x, y, 684, 306, 26, 21, -0.25), [234, 58, 60], { outline: 4 });
add([660, 284, 710, 330], (x, y) => Math.min(sdCircle(x, y, 676, 300, 5), sdCircle(x, y, 692, 296, 4.5), sdCircle(x, y, 684, 316, 5)), [50, 44, 60]);
add([660, 286, 690, 300], (x, y) => sdEllipse(x, y, 674, 293, 7, 4, -0.25), [255, 255, 255], { alpha: 0.6 });

// arms reaching around the pot
add([420, 640, 520, 820], (x, y) => sdSegment(x, y, 448, 670, 476, 770, 21), TEAL_DARK, { outline: 5 });
add([600, 640, 700, 820], (x, y) => sdSegment(x, y, 672, 670, 644, 770, 21), TEAL_DARK, { outline: 5 });

// the stem and leaves, behind the pot rim
add([520, 590, 600, 760], (x, y) => sdSegment(x, y, 560, 745, 560, 612, 7), LEAF, { outline: 4 });
add([500, 650, 570, 710], (x, y) => sdEllipse(x, y, 534, 682, 28, 13, 0.5), LEAF, { outline: 4 });
add([550, 630, 620, 690], (x, y) => sdEllipse(x, y, 588, 662, 28, 13, -0.55), LEAF, { outline: 4 });

// terracotta pot
add([470, 720, 650, 850], (x, y) => sdTrapezoid(x, y, 560, 790, 54, 72, 50), (x, y) => mixc(POT, POT_DARK, clamp((x - 520) / 120, 0, 1)), { outline: 6 });
add([460, 710, 660, 770], (x, y) => sdRoundBox(x, y, 560, 742, 88, 18, 10), POT, { outline: 6 });
add([530, 780, 590, 820], (x, y) => sdHeart(x, y, 560, 800, 26), [255, 222, 200]);

// mitten hands holding it
add([430, 730, 520, 820], (x, y) => sdCircle(x, y, 474, 776, 32), TEAL, { outline: 6 });
add([600, 730, 690, 820], (x, y) => sdCircle(x, y, 646, 776, 32), TEAL, { outline: 6 });

// the flower: eight petals and a smiling middle
const fx = 560;
const fy = 600;
const petals = (x, y) => {
  let d = 1e9;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    d = Math.min(d, sdEllipse(x, y, fx + Math.cos(a) * 40, fy + Math.sin(a) * 40, 30, 17, a));
  }
  return d;
};
add([480, 520, 640, 680], petals, (x, y) => mixc(PETAL_DEEP, PETAL, clamp(len(x - fx, y - fy) / 70, 0, 1)), { outline: 5 });
add([520, 560, 600, 640], (x, y) => sdCircle(x, y, fx, fy, 27), [240, 140, 52], { outline: 5 });
add([530, 576, 590, 620], (x, y) => Math.min(sdHalfArc(x, y, 550, 598, 6, 2.6, true), sdHalfArc(x, y, 570, 598, 6, 2.6, true), sdHalfArc(x, y, 560, 604, 9, 2.6, false)), INK);

// little hearts drifting up between them, and sparkles
const hearts = [
  [432, 590, 40, 1],
  [398, 520, 28, 0.9],
  [700, 566, 34, 1],
  [738, 498, 22, 0.85],
  [660, 230, 26, 0.8],
];
for (const [hx, hy, hs, ha] of hearts) {
  add([hx - hs, hy - hs, hx + hs, hy + hs], (x, y) => sdHeart(x, y, hx, hy, hs), HEART, { outline: 4, alpha: ha });
}
const sparkles = [
  [486, 548, 14],
  [640, 540, 12],
  [470, 650, 9],
  [312, 340, 16],
  [812, 380, 14],
  [430, 236, 11],
];
for (const [sx, sy, ss] of sparkles) {
  const f = (x, y) => Math.min(sdRhombus(x, y, sx, sy, ss, ss * 0.28), sdRhombus(x, y, sx, sy, ss * 0.28, ss));
  add([sx - ss - 2, sy - ss - 2, sx + ss + 2, sy + ss + 2], f, [255, 255, 236]);
}

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
