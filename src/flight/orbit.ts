import { Vec2, V } from "../types";
import { Body } from "./world";

// Pure 2-body Keplerian math (relative to a body). No rendering deps, so it's
// unit-testable on its own.

export interface Orbit {
  apo: number; // apoapsis radius (m); Infinity if unbound
  peri: number; // periapsis radius (m)
  ecc: number;
  bound: boolean;
}

export function orbit(pos: Vec2, vel: Vec2, body: Body): Orbit {
  const r = V.sub(pos, body.pos);
  const v = V.sub(vel, body.vel);
  const rl = V.len(r) || 1;
  const vl2 = V.len2(v);
  const GM = body.GM;
  const energy = vl2 / 2 - GM / rl;
  const h = r.x * v.y - r.y * v.x; // 2D specific angular momentum
  const ecc = Math.sqrt(Math.max(0, 1 + (2 * energy * h * h) / (GM * GM)));
  if (energy < 0) {
    const a = -GM / (2 * energy);
    return { apo: a * (1 + ecc), peri: a * (1 - ecc), ecc, bound: true };
  }
  const peri = (h * h) / GM / (1 + ecc);
  return { apo: Infinity, peri, ecc, bound: false };
}

// Sample the Keplerian conic (relative to `body`) into world-space points, plus
// apoapsis/periapsis markers. Returns null for degenerate/near-radial orbits.
export function conicPath(
  pos: Vec2,
  vel: Vec2,
  body: Body,
): { pts: Vec2[]; apo: Vec2 | null; peri: Vec2 | null } | null {
  const r = V.sub(pos, body.pos);
  const v = V.sub(vel, body.vel);
  const rl = V.len(r) || 1;
  const GM = body.GM;
  const h = r.x * v.y - r.y * v.x;
  if (Math.abs(h) < 1) return null; // radial / degenerate
  const energy = V.len2(v) / 2 - GM / rl;
  const p = (h * h) / GM; // semi-latus rectum
  // eccentricity vector
  const rv = r.x * v.x + r.y * v.y;
  const c = V.len2(v) - GM / rl;
  const ex = (c * r.x - rv * v.x) / GM;
  const ey = (c * r.y - rv * v.y) / GM;
  const ecc = Math.hypot(ex, ey);
  const omega = Math.atan2(ey, ex); // argument of periapsis
  const point = (theta: number): Vec2 => {
    const rr = p / (1 + ecc * Math.cos(theta));
    return { x: body.pos.x + rr * Math.cos(omega + theta), y: body.pos.y + rr * Math.sin(omega + theta) };
  };

  const pts: Vec2[] = [];
  const N = 160;
  if (energy < 0 && ecc < 1) {
    for (let i = 0; i <= N; i++) pts.push(point((i / N) * Math.PI * 2));
    const peri = point(0);
    const apo = point(Math.PI);
    return { pts, apo: V.len(V.sub(apo, body.pos)) < body.soi ? apo : null, peri };
  }
  // hyperbola/parabola: sweep the true-anomaly range that stays within the SOI
  const thetaMax = ecc > 1 ? Math.acos(Math.max(-0.999, -1 / ecc)) - 0.01 : Math.PI / 2;
  for (let i = -N; i <= N; i++) {
    const th = (i / N) * thetaMax;
    const pt = point(th);
    if (V.len(V.sub(pt, body.pos)) <= body.soi) pts.push(pt);
  }
  return { pts, apo: null, peri: point(0) };
}
