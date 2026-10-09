/**
 * Generates the built-in sample 360° tour (src/assets/sample-tour/): three simple box rooms
 * rendered by a tiny software ray caster straight into equirectangular (2:1) JPEGs, plus
 * 512×256 thumbnails and manifest.json with each room's doors (hotspot yaw/pitch).
 *
 *   node scripts/generate-sample-tour.mjs
 *
 * Pure Node (jpeg-js is plain JavaScript). Every pixel is a function of its view direction, so
 * the 0°/360° edge has no seam and walls stay straight in the panorama viewer.
 *
 * Conventions match Photo Sphere Viewer: yaw 0 is the image centre and grows to the right,
 * pitch grows upwards. Camera at the origin, 1.5 m above the floor; +Z is straight ahead
 * (yaw 0), +X is to the right (yaw π/2), +Y is up.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import jpeg from "jpeg-js";

const OUT_DIR = path.join(process.cwd(), "src", "assets", "sample-tour");
const WIDTH = 4096;
const HEIGHT = 2048;
const THUMB_W = 512;
const THUMB_H = 256;
const EYE = 1.5; // camera height above the floor (m)
const SS = 2; // supersampling per axis

/* ---------------- tiny 5×7 font (uppercase letters used by the signs) ---------------- */

const GLYPHS = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
};

/** Is (x, y) — in [0,1]² of a text box, y down — on a lit pixel of `text`? */
function textHit(text, x, y) {
  const cols = text.length * 6 - 1;
  const cx = Math.floor(x * cols);
  const cy = Math.floor(y * 7);
  if (cx < 0 || cy < 0 || cx >= cols || cy >= 7) return false;
  const ch = text[Math.floor(cx / 6)];
  const gx = cx % 6;
  if (gx === 5) return false;
  const g = GLYPHS[ch] ?? GLYPHS[" "];
  return g[cy][gx] === "1";
}

/* ---------------- colour helpers ---------------- */

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const scale = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
function hash(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/* ---------------- room definitions ---------------- */

/**
 * Walls: front (+Z), back (-Z), left (-X), right (+X). On each wall `u` runs left→right as seen
 * from inside the room (centred on the wall), `v` is height above the floor.
 * Features are rectangles on a wall: window, door (with a sign naming its target room), art, plaque.
 */
const ROOMS = [
  {
    key: "living",
    name: "Living room",
    file: "living-room",
    size: { w: 6.4, d: 5.2, h: 2.9 },
    walls: { front: "#e9dcc4", back: "#c9d8cf", left: "#e4cfc2", right: "#d6dbe8" },
    floor: { a: "#a7774d", b: "#8d6240", plank: 0.2 },
    rug: { x0: -1.4, x1: 1.4, z0: -1.6, z1: 0.4, color: "#7b8fb3", border: "#e8e1d0" },
    features: [
      { wall: "front", kind: "window", u0: -1.4, u1: 1.4, v0: 0.9, v1: 2.3 },
      { wall: "front", kind: "plaque", u0: -0.9, u1: 0.9, v0: 2.42, v1: 2.72, text: "LIVING ROOM" },
      { wall: "right", kind: "door", u0: -0.95, u1: -0.05, v0: 0, v1: 2.1, to: "bedroom", sign: "BEDROOM", color: "#8a5a3b" },
      { wall: "left", kind: "door", u0: 0.6, u1: 1.5, v0: 0, v1: 2.1, to: "kitchen", sign: "KITCHEN", color: "#6f4b33" },
      { wall: "back", kind: "art", u0: -1.0, u1: 0.2, v0: 1.25, v1: 1.95, palette: ["#f2c14e", "#f78154", "#4d9078"] },
      { wall: "back", kind: "art", u0: 0.45, u1: 1.15, v0: 1.25, v1: 1.95, palette: ["#5b8def", "#e0e0e0", "#2b2d42"] },
      { wall: "right", kind: "art", u0: 0.6, u1: 1.6, v0: 1.2, v1: 1.8, palette: ["#9b5de5", "#f15bb5", "#fee440"] },
    ],
    // Furniture: axis-aligned boxes in room coordinates (y from the floor).
    boxes: [
      { min: [-1.5, 0, -2.6], max: [1.5, 0.45, -1.75], color: "#4f6d7a" }, // sofa seat
      { min: [-1.5, 0.45, -2.6], max: [1.5, 0.9, -2.35], color: "#46626e" }, // sofa back
      { min: [-1.5, 0.45, -2.35], max: [-1.25, 0.65, -1.75], color: "#46626e" }, // arm
      { min: [1.25, 0.45, -2.35], max: [1.5, 0.65, -1.75], color: "#46626e" }, // arm
      { min: [-0.6, 0, -1.2], max: [0.6, 0.4, -0.6], color: "#6b4f3a" }, // coffee table
      { min: [-1.1, 0, 2.2], max: [1.1, 0.5, 2.6], color: "#3f3f46" }, // TV unit under the window
      { min: [-2.9, 0, -2.4], max: [-2.5, 1.6, -2.0], color: "#2f6f4f" }, // plant / shelf
    ],
  },
  {
    key: "bedroom",
    name: "Bedroom",
    file: "bedroom",
    size: { w: 4.6, d: 4.2, h: 2.9 },
    walls: { front: "#d9e4ee", back: "#e8e0f0", left: "#efe6d8", right: "#dcead9" },
    floor: { a: "#b48a63", b: "#9c7452", plank: 0.18 },
    rug: { x0: -0.9, x1: 0.9, z0: 0.2, z1: 1.0, color: "#c97b63", border: "#f3e9dc" },
    features: [
      { wall: "front", kind: "plaque", u0: -0.65, u1: 0.65, v0: 2.35, v1: 2.65, text: "BEDROOM" },
      { wall: "front", kind: "art", u0: -0.8, u1: 0.8, v0: 1.3, v1: 2.0, palette: ["#90be6d", "#43aa8b", "#f9c74f"] },
      { wall: "right", kind: "window", u0: -1.0, u1: 1.0, v0: 0.9, v1: 2.2 },
      { wall: "left", kind: "door", u0: -0.45, u1: 0.45, v0: 0, v1: 2.1, to: "living", sign: "LIVING ROOM", color: "#8a5a3b" },
      { wall: "back", kind: "art", u0: -0.4, u1: 0.4, v0: 1.3, v1: 1.9, palette: ["#277da1", "#f94144", "#f8f9fa"] },
    ],
    boxes: [
      { min: [-0.9, 0, 1.0], max: [0.9, 0.5, 2.1], color: "#f1f1f1" }, // mattress
      { min: [-0.95, 0, 1.95], max: [0.95, 1.1, 2.1], color: "#6b4f3a" }, // headboard
      { min: [-0.85, 0.5, 1.55], max: [0.85, 0.6, 1.9], color: "#9fb8d6" }, // pillows
      { min: [-0.9, 0.5, 0.95], max: [0.9, 0.55, 1.5], color: "#4a6fa5" }, // blanket
      { min: [1.25, 0, 1.6], max: [1.65, 0.55, 2.0], color: "#7a5a43" }, // night stand
      { min: [-2.3, 0, -2.0], max: [-1.7, 2.1, -0.9], color: "#a68a6d" }, // wardrobe
    ],
  },
  {
    key: "kitchen",
    name: "Kitchen",
    file: "kitchen",
    size: { w: 4.2, d: 3.8, h: 2.9 },
    walls: { front: "#f3ecd6", back: "#dfeee9", left: "#f0dfd3", right: "#e3e6ea" },
    floor: { a: "#c9c3b8", b: "#b3ada2", plank: 0.4, tiles: true },
    features: [
      { wall: "front", kind: "window", u0: -0.8, u1: 0.8, v0: 1.15, v1: 2.15 },
      { wall: "left", kind: "plaque", u0: -0.55, u1: 0.55, v0: 2.3, v1: 2.6, text: "KITCHEN" },
      { wall: "right", kind: "door", u0: -0.45, u1: 0.45, v0: 0, v1: 2.1, to: "living", sign: "LIVING ROOM", color: "#6f4b33" },
      { wall: "back", kind: "art", u0: -0.35, u1: 0.35, v0: 1.4, v1: 1.95, palette: ["#e76f51", "#f4a261", "#2a9d8f"] },
    ],
    boxes: [
      { min: [-2.1, 0, 1.3], max: [1.4, 0.88, 1.9], color: "#5c7c8a" }, // counter (front wall)
      { min: [-2.1, 0.88, 1.28], max: [1.4, 0.93, 1.9], color: "#e8e4dc" }, // worktop
      { min: [-2.1, 1.55, 1.55], max: [-0.95, 2.2, 1.9], color: "#6d8d9a" }, // wall cabinet
      { min: [0.95, 1.55, 1.55], max: [1.4, 2.2, 1.9], color: "#6d8d9a" }, // wall cabinet
      { min: [1.45, 0, 1.2], max: [2.1, 1.9, 1.9], color: "#d9dde1" }, // fridge
      { min: [-0.6, 0, -0.9], max: [0.6, 0.76, -0.2], color: "#8b6b4a" }, // dining table
    ],
  },
];

/* ---------------- geometry ---------------- */

/** Room-space point for wall coordinates (u, v); returns [x, y, z] with y relative to the eye. */
function wallPoint(room, wall, u, v) {
  const { w, d } = room.size;
  const y = v - EYE;
  switch (wall) {
    case "front":
      return [u, y, d / 2];
    case "back":
      return [-u, y, -d / 2];
    case "right":
      return [w / 2, y, -u];
    case "left":
      return [-w / 2, y, u];
  }
}

function yawPitchOf([x, y, z]) {
  return { yaw: Math.atan2(x, z), pitch: Math.atan2(y, Math.hypot(x, z)) };
}

/** Ray–AABB (slab) test; boxes are given with y from the floor. Returns { t, axis, sign } or null. */
function hitBox(o, dir, box) {
  let tmin = -Infinity;
  let tmax = Infinity;
  let axis = 0;
  for (let i = 0; i < 3; i++) {
    const lo = i === 1 ? box.min[i] - EYE : box.min[i];
    const hi = i === 1 ? box.max[i] - EYE : box.max[i];
    if (Math.abs(dir[i]) < 1e-9) {
      if (o[i] < lo || o[i] > hi) return null;
      continue;
    }
    let t1 = (lo - o[i]) / dir[i];
    let t2 = (hi - o[i]) / dir[i];
    if (t1 > t2) [t1, t2] = [t2, t1];
    if (t1 > tmin) {
      tmin = t1;
      axis = i;
    }
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  if (tmin <= 1e-6) return null;
  return { t: tmin, axis, sign: -Math.sign(dir[axis]) };
}

/* ---------------- shading ---------------- */

function lightAt(room, p, normal) {
  // A ceiling light in the middle of the room plus ambient.
  const lp = [0, room.size.h - EYE - 0.15, 0];
  const L = [lp[0] - p[0], lp[1] - p[1], lp[2] - p[2]];
  const dist = Math.hypot(L[0], L[1], L[2]) || 1;
  const lambert = Math.max(0, (L[0] * normal[0] + L[1] * normal[1] + L[2] * normal[2]) / dist);
  return 0.62 + 0.5 * lambert / (1 + 0.035 * dist * dist);
}

/** Soft darkening near the room's edges (fake ambient occlusion). */
function occlusion(room, p) {
  const { w, d, h } = room.size;
  const y = p[1] + EYE;
  const edges = [];
  const onX = Math.abs(Math.abs(p[0]) - w / 2) < 1e-3;
  const onZ = Math.abs(Math.abs(p[2]) - d / 2) < 1e-3;
  const onFloor = Math.abs(y) < 1e-3;
  const onCeil = Math.abs(y - h) < 1e-3;
  if (!onX) edges.push(w / 2 - Math.abs(p[0]));
  if (!onZ) edges.push(d / 2 - Math.abs(p[2]));
  if (!onFloor) edges.push(y);
  if (!onCeil) edges.push(h - y);
  const e = Math.max(0, Math.min(...edges));
  return 1 - 0.28 * Math.exp(-e / 0.22);
}

function frameRect(u, v, f, frame) {
  return u < f.u0 + frame || u > f.u1 - frame || v < f.v0 + frame || v > f.v1 - frame;
}

function shadeFeature(f, u, v) {
  const fu = (u - f.u0) / (f.u1 - f.u0);
  const fv = (v - f.v0) / (f.v1 - f.v0);
  switch (f.kind) {
    case "window": {
      if (frameRect(u, v, f, 0.07)) return hex("#f7f7f2");
      if (Math.abs(fu - 0.5) * (f.u1 - f.u0) < 0.025) return hex("#f7f7f2"); // mullion
      const sky = mix(hex("#b9dcf5"), hex("#5ea5df"), fv);
      if (fv < 0.22) return mix(hex("#7fae6a"), hex("#6a9a5a"), hash(Math.floor(fu * 30))); // trees outside
      return sky;
    }
    case "door": {
      if (u < f.u0 + 0.06 || u > f.u1 - 0.06 || v > f.v1 - 0.06) return hex("#efe9df"); // frame (no sill)
      const base = hex(f.color);
      const knobU = f.u1 - 0.12;
      if (Math.hypot(u - knobU, v - 1.0) < 0.035) return hex("#d4b26a");
      // two recessed panels
      const inPanel = fu > 0.18 && fu < 0.82 && ((fv > 0.08 && fv < 0.45) || (fv > 0.55 && fv < 0.92));
      return inPanel ? scale(base, 0.86) : base;
    }
    case "art": {
      if (frameRect(u, v, f, 0.035)) return hex("#2b2b2b");
      const [a, b, c] = f.palette.map(hex);
      if (Math.hypot(fu - 0.35, fv - 0.55) < 0.22) return a;
      if (fu > 0.55 && fv < 0.6 && fv > 0.15) return b;
      return mix(c, hex("#ffffff"), 0.15);
    }
    case "plaque": {
      if (frameRect(u, v, f, 0.02)) return hex("#34495e");
      // text box inset inside the plaque; v grows upwards, text rows grow downwards
      const tx = (fu - 0.08) / 0.84;
      const ty = 1 - (fv - 0.2) / 0.6;
      return textHit(f.text, tx, ty) ? hex("#1f2937") : hex("#fbfaf6");
    }
    case "sign": {
      const tx = (fu - 0.06) / 0.88;
      const ty = 1 - (fv - 0.18) / 0.64;
      return textHit(f.text, tx, ty) ? hex("#ffffff") : hex("#2563eb");
    }
  }
  return null;
}

function shadeWall(room, wall, u, v) {
  for (const f of room.features) {
    if (f.wall !== wall) continue;
    if (u >= f.u0 && u <= f.u1 && v >= f.v0 && v <= f.v1) {
      const c = shadeFeature(f, u, v);
      if (c) return c;
    }
  }
  if (v < 0.1) return hex("#f4f1ea"); // skirting board
  return hex(room.walls[wall]);
}

function shadeFloor(room, x, z) {
  const { floor, rug } = room;
  if (rug && x > rug.x0 && x < rug.x1 && z > rug.z0 && z < rug.z1) {
    const edge = Math.min(x - rug.x0, rug.x1 - x, z - rug.z0, rug.z1 - z);
    return edge < 0.08 ? hex(rug.border) : hex(rug.color);
  }
  if (floor.tiles) {
    const gx = Math.floor(x / floor.plank);
    const gz = Math.floor(z / floor.plank);
    const fx = x / floor.plank - gx;
    const fz = z / floor.plank - gz;
    if (fx < 0.02 || fz < 0.02) return hex("#8f8a82");
    return (gx + gz) % 2 === 0 ? hex(floor.a) : hex(floor.b);
  }
  const row = Math.floor(z / floor.plank);
  const f = z / floor.plank - row;
  const seam = Math.floor((x + hash(row) * 3) / 1.6);
  const fx = (x + hash(row) * 3) / 1.6 - seam;
  if (f < 0.04 || fx < 0.006) return scale(hex(floor.b), 0.75);
  return mix(hex(floor.a), hex(floor.b), hash(row * 13 + seam * 7) * 0.8);
}

function shadeCeiling(x, z) {
  const r = Math.hypot(x, z);
  if (r < 0.22) return [255, 252, 238];
  if (r < 0.26) return [220, 220, 215];
  return [244, 243, 239];
}

/** Colour seen along direction `dir` (unit vector) from the camera. */
function trace(room, dir) {
  const { w, d, h } = room.size;
  const o = [0, 0, 0];
  // Room interior: the nearest wall/floor/ceiling plane ahead.
  const tx = dir[0] !== 0 ? (Math.sign(dir[0]) * w) / 2 / dir[0] : Infinity;
  const tz = dir[2] !== 0 ? (Math.sign(dir[2]) * d) / 2 / dir[2] : Infinity;
  const ty = dir[1] > 0 ? (h - EYE) / dir[1] : dir[1] < 0 ? -EYE / dir[1] : Infinity;
  let t = Math.min(tx, ty, tz);

  let best = null;
  for (const b of room.boxes) {
    const hit = hitBox(o, dir, b);
    if (hit && hit.t < t) {
      t = hit.t;
      best = { b, hit };
    }
  }
  const p = [dir[0] * t, dir[1] * t, dir[2] * t];

  if (best) {
    const n = [0, 0, 0];
    n[best.hit.axis] = best.hit.sign;
    const face = best.hit.axis === 1 ? (best.hit.sign > 0 ? 1.08 : 0.6) : best.hit.axis === 0 ? 0.86 : 0.78;
    // Slight darkening towards the bottom of furniture (contact shadow).
    const y = p[1] + EYE;
    const contact = 1 - 0.25 * Math.exp(-y / 0.12);
    return scale(hex(best.b.color), face * contact * lightAt(room, p, n) * 0.95);
  }

  let color;
  let n;
  if (t === ty) {
    if (dir[1] > 0) {
      color = shadeCeiling(p[0], p[2]);
      n = [0, -1, 0];
    } else {
      color = shadeFloor(room, p[0], p[2]);
      n = [0, 1, 0];
      // soft shadows under furniture
      for (const b of room.boxes) {
        const dx = Math.max(b.min[0] - p[0], 0, p[0] - b.max[0]);
        const dz = Math.max(b.min[2] - p[2], 0, p[2] - b.max[2]);
        const dd = Math.hypot(dx, dz);
        if (b.min[1] < 0.05 && dd < 0.25) color = scale(color, 0.72 + 0.28 * (dd / 0.25));
      }
    }
  } else if (t === tz) {
    const wall = dir[2] > 0 ? "front" : "back";
    const u = wall === "front" ? p[0] : -p[0];
    color = shadeWall(room, wall, u, p[1] + EYE);
    n = [0, 0, -Math.sign(dir[2])];
  } else {
    const wall = dir[0] > 0 ? "right" : "left";
    const u = wall === "right" ? -p[2] : p[2];
    color = shadeWall(room, wall, u, p[1] + EYE);
    n = [-Math.sign(dir[0]), 0, 0];
  }
  return scale(color, lightAt(room, p, n) * occlusion(room, p));
}

/* ---------------- rendering ---------------- */

function addDoorSigns(room) {
  for (const f of [...room.features]) {
    if (f.kind !== "door") continue;
    const mid = (f.u0 + f.u1) / 2;
    const half = Math.max(0.35, f.sign.length * 0.055);
    room.features.unshift({ wall: f.wall, kind: "sign", u0: mid - half, u1: mid + half, v0: 2.2, v1: 2.42, text: f.sign });
  }
}

function render(room) {
  const data = Buffer.alloc(WIDTH * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const yaw = ((x + (sx + 0.5) / SS) / WIDTH) * 2 * Math.PI - Math.PI;
          const pitch = Math.PI / 2 - ((y + (sy + 0.5) / SS) / HEIGHT) * Math.PI;
          const cp = Math.cos(pitch);
          const c = trace(room, [Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp]);
          r += c[0];
          g += c[1];
          b += c[2];
        }
      }
      const i = (y * WIDTH + x) * 4;
      const n = SS * SS;
      data[i] = Math.min(255, Math.round(r / n));
      data[i + 1] = Math.min(255, Math.round(g / n));
      data[i + 2] = Math.min(255, Math.round(b / n));
      data[i + 3] = 255;
    }
  }
  return data;
}

function downsample(src, sw, sh, dw, dh) {
  const out = Buffer.alloc(dw * dh * 4);
  const fx = sw / dw;
  const fy = sh / dh;
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let yy = Math.floor(y * fy); yy < Math.floor((y + 1) * fy); yy++) {
        for (let xx = Math.floor(x * fx); xx < Math.floor((x + 1) * fx); xx++) {
          const i = (yy * sw + xx) * 4;
          r += src[i];
          g += src[i + 1];
          b += src[i + 2];
          n++;
        }
      }
      const o = (y * dw + x) * 4;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
      out[o + 3] = 255;
    }
  }
  return out;
}

const round = (n) => Math.round(n * 10000) / 10000;

mkdirSync(OUT_DIR, { recursive: true });
const manifest = { version: 1, width: WIDTH, height: HEIGHT, start: "living", rooms: [] };

for (const room of ROOMS) {
  addDoorSigns(room);
  const started = Date.now();
  const pixels = render(room);
  const image = jpeg.encode({ data: pixels, width: WIDTH, height: HEIGHT }, 85).data;
  const thumb = jpeg.encode({ data: downsample(pixels, WIDTH, HEIGHT, THUMB_W, THUMB_H), width: THUMB_W, height: THUMB_H }, 80).data;
  writeFileSync(path.join(OUT_DIR, `${room.file}.jpg`), image);
  writeFileSync(path.join(OUT_DIR, `${room.file}-thumb.jpg`), thumb);

  const links = room.features
    .filter((f) => f.kind === "door")
    .map((f) => {
      // Hotspot at the middle of the door, about a metre up.
      const pos = yawPitchOf(wallPoint(room, f.wall, (f.u0 + f.u1) / 2, 1.0));
      return { to: f.to, yaw: round(pos.yaw), pitch: round(pos.pitch) };
    });
  manifest.rooms.push({
    key: room.key,
    name: room.name,
    image: `${room.file}.jpg`,
    thumbnail: `${room.file}-thumb.jpg`,
    width: WIDTH,
    height: HEIGHT,
    initialYaw: 0,
    links,
  });
  console.log(
    `${room.name}: ${(image.length / 1024).toFixed(0)} KB image, ${(thumb.length / 1024).toFixed(0)} KB thumb (${((Date.now() - started) / 1000).toFixed(1)} s)`,
  );
}

writeFileSync(path.join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`Wrote ${OUT_DIR}`);
