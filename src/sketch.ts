import { Graphics } from "pixi.js";

// Hand-drawn "rough" style helpers that render onto a PixiJS Graphics.
// We jitter vertices and double-stroke to fake a sketchy, doodled look.

// Small seeded RNG so a given shape looks the same each time it's drawn
// (avoids shimmer on parts that are redrawn, while still looking wobbly).
export function makeRng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0xffffffff;
  };
}

type Pt = [number, number];

function jitterPoints(pts: Pt[], amount: number, rng: () => number): Pt[] {
  return pts.map(([x, y]) => [
    x + (rng() - 0.5) * amount,
    y + (rng() - 0.5) * amount,
  ]);
}

export interface SketchStyle {
  stroke?: number;
  fill?: number;
  fillAlpha?: number;
  lineWidth?: number;
  jitter?: number;
  seed?: number;
  roughness?: number; // number of overlapping stroke passes
}

// Draw a closed sketchy polygon.
export function sketchPoly(g: Graphics, points: Pt[], style: SketchStyle = {}) {
  const {
    stroke = 0x2a2118,
    fill,
    fillAlpha = 1,
    lineWidth = 2,
    jitter = 1.5,
    seed = 1,
    roughness = 2,
  } = style;
  const rng = makeRng(seed);

  if (fill !== undefined) {
    g.poly(points.flat());
    g.fill({ color: fill, alpha: fillAlpha });
  }
  for (let pass = 0; pass < roughness; pass++) {
    const jp = jitterPoints(points, jitter, rng);
    g.poly(jp.flat());
    g.stroke({ color: stroke, width: lineWidth, alpha: pass === 0 ? 1 : 0.5, cap: "round", join: "round" });
  }
}

// Draw a sketchy open polyline.
export function sketchLine(g: Graphics, points: Pt[], style: SketchStyle = {}) {
  const { stroke = 0x2a2118, lineWidth = 2, jitter = 1.2, seed = 1, roughness = 2 } = style;
  const rng = makeRng(seed);
  for (let pass = 0; pass < roughness; pass++) {
    const jp = jitterPoints(points, jitter, rng);
    g.moveTo(jp[0][0], jp[0][1]);
    for (let i = 1; i < jp.length; i++) g.lineTo(jp[i][0], jp[i][1]);
    g.stroke({ color: stroke, width: lineWidth, alpha: pass === 0 ? 1 : 0.45, cap: "round", join: "round" });
  }
}

// Approximate a circle as a jittered polygon so it looks hand-drawn.
export function sketchCircle(g: Graphics, cx: number, cy: number, r: number, style: SketchStyle = {}) {
  // Cap segments: without this, large on-screen radii produce thousands of
  // segments per frame and tank the CPU.
  const segs = Math.max(10, Math.min(48, Math.round(r * 0.5)));
  const pts: Pt[] = [];
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  sketchPoly(g, pts, { jitter: Math.max(1, r * 0.02), ...style });
}

// A sketchy rectangle centered at (0,0) with given half-extents.
export function sketchBox(g: Graphics, hw: number, hh: number, style: SketchStyle = {}) {
  sketchPoly(g, [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ], style);
}
