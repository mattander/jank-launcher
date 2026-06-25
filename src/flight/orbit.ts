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

const TAU = Math.PI * 2;
const mod2pi = (x: number) => ((x % TAU) + TAU) % TAU;

// Time (seconds) until the craft next reaches apoapsis / periapsis, and the
// orbital period. Null for unbound or near-circular orbits (no meaningful apsis).
export function orbitTiming(
  pos: Vec2,
  vel: Vec2,
  body: Body,
): { toApo: number | null; toPeri: number | null; period: number | null } {
  const r = V.sub(pos, body.pos);
  const v = V.sub(vel, body.vel);
  const rl = V.len(r) || 1;
  const GM = body.GM;
  const energy = V.len2(v) / 2 - GM / rl;
  if (energy >= 0) return { toApo: null, toPeri: null, period: null }; // unbound
  const a = -GM / (2 * energy);
  const rv = r.x * v.x + r.y * v.y;
  const c = V.len2(v) - GM / rl;
  const ex = (c * r.x - rv * v.x) / GM;
  const ey = (c * r.y - rv * v.y) / GM;
  const e = Math.hypot(ex, ey);
  const n = Math.sqrt(GM / (a * a * a)); // mean motion
  const period = TAU / n;
  if (e < 1e-4) return { toApo: null, toPeri: null, period }; // circular

  // true anomaly -> eccentric -> mean anomaly
  let nu = Math.acos(Math.max(-1, Math.min(1, (ex * r.x + ey * r.y) / (e * rl))));
  if (rv < 0) nu = TAU - nu; // descending toward periapsis
  const E = Math.atan2(Math.sqrt(1 - e * e) * Math.sin(nu), e + Math.cos(nu));
  const M = mod2pi(E - e * Math.sin(E));
  return {
    toApo: mod2pi(Math.PI - M) / n,
    toPeri: mod2pi(-M) / n,
    period,
  };
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

// Forward-sample the near-term path for trajectories that will hit terrain.
// Unlike the full conic sampler, this is anchored at the craft and terminates at
// the exact segment/surface intersection, so map impact previews do not detach
// from the planet as sampling phases shift frame to frame.
export function impactPreview(pos: Vec2, vel: Vec2, body: Body): Vec2[] {
  let relPos = V.sub(pos, body.pos);
  let relVel = V.sub(vel, body.vel);
  const pts: Vec2[] = [V.add(body.pos, relPos)];
  const initialDist = V.len(relPos);
  const initialUp = V.norm(relPos);
  const initialVerticalSpeed = relVel.x * initialUp.x + relVel.y * initialUp.y;
  if (initialDist <= body.radius * 1.002 && initialVerticalSpeed <= 1) return pts;

  const maxSteps = 420;
  const minDt = 0.35;
  const maxDt = 7;
  let wasClear = initialDist > body.radius * 1.002;

  for (let i = 0; i < maxSteps; i++) {
    const prev = relPos;
    const speed = Math.max(1, V.len(relVel));
    const dt = clamp(body.radius / Math.max(speed * 140, body.radius / maxDt), minDt, maxDt);
    const r = Math.max(V.len(relPos), body.radius * 0.5);
    const accel = V.scale(relPos, -body.GM / (r * r * r));
    relVel = V.add(relVel, V.scale(accel, dt));
    relPos = V.add(relPos, V.scale(relVel, dt));
    const dist = V.len(relPos);

    if (wasClear && dist <= body.radius) {
      const hit = segmentCircleHit(prev, relPos, body.radius);
      pts.push(V.add(body.pos, hit ?? V.scale(V.norm(relPos), body.radius)));
      return pts;
    }

    if (dist > body.radius * 1.002) wasClear = true;
    if (i % 3 === 0) pts.push(V.add(body.pos, relPos));
    if (dist > body.soi * 0.98) return pts;
  }

  return pts;
}

function segmentCircleHit(a: Vec2, b: Vec2, radius: number): Vec2 | null {
  const d = V.sub(b, a);
  const aa = V.len2(d);
  if (aa <= 0) return null;
  const bb = 2 * (a.x * d.x + a.y * d.y);
  const cc = V.len2(a) - radius * radius;
  const disc = bb * bb - 4 * aa * cc;
  if (disc < 0) return null;
  const root = Math.sqrt(disc);
  const t1 = (-bb - root) / (2 * aa);
  const t2 = (-bb + root) / (2 * aa);
  const t = t1 >= 0 && t1 <= 1 ? t1 : t2 >= 0 && t2 <= 1 ? t2 : null;
  return t === null ? null : V.add(a, V.scale(d, t));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
