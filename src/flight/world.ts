import { Vec2, V } from "../types";

export interface Body {
  id: string;
  name: string;
  color: number;
  GM: number; // gravitational parameter (m^3/s^2)
  radius: number; // surface radius (m)
  atmoHeight: number; // 0 if airless
  atmoColor: number;
  // orbit (circular) around parent; null for the sun
  parent: string | null;
  orbitR: number;
  omega: number; // angular speed rad/s
  phase: number; // initial angle
  // computed each tick
  pos: Vec2;
  vel: Vec2;
  soi: number; // sphere of influence radius (Infinity for sun)
}

function mkBody(b: Partial<Body> & Pick<Body, "id" | "name" | "color" | "GM" | "radius">): Body {
  return {
    atmoHeight: 0,
    atmoColor: 0x9ec7e0,
    parent: null,
    orbitR: 0,
    omega: 0,
    phase: 0,
    pos: { x: 0, y: 0 },
    vel: { x: 0, y: 0 },
    soi: Infinity,
    ...b,
  };
}

export class World {
  bodies: Body[];
  byId: Map<string, Body>;
  time = 0;

  constructor() {
    const sun = mkBody({
      id: "sun", name: "Sol", color: 0xe8c452, GM: 1.0e18, radius: 2.0e9,
      atmoHeight: 6e8, atmoColor: 0xf0d98a,
    });

    const terra = mkBody({
      id: "terra", name: "Terra", color: 0x5b8c4a, GM: 8.82e11, radius: 3.0e5,
      atmoHeight: 7.0e4, atmoColor: 0x7fb6e0,
      parent: "sun", orbitR: 1.3e10, phase: 0,
    });
    const luna = mkBody({
      id: "luna", name: "Luna", color: 0xb9b2a0, GM: 1.024e10, radius: 8.0e4,
      parent: "terra", orbitR: 2.4e6, phase: 0.6,
    });
    const rusty = mkBody({
      id: "rusty", name: "Rusty", color: 0xc06a3a, GM: 2.4e11, radius: 2.0e5,
      atmoHeight: 3.0e4, atmoColor: 0xd99a6a,
      parent: "sun", orbitR: 8.0e9, phase: 2.1,
    });
    const frost = mkBody({
      id: "frost", name: "Frost", color: 0xa9cbe0, GM: 4.7e11, radius: 2.6e5,
      atmoHeight: 4.0e4, atmoColor: 0xcfe6f2,
      parent: "sun", orbitR: 2.2e10, phase: 4.0,
    });

    this.bodies = [sun, terra, luna, rusty, frost];
    this.byId = new Map(this.bodies.map((b) => [b.id, b]));

    // derive omega and SOI from parents
    for (const b of this.bodies) {
      if (b.parent) {
        const p = this.byId.get(b.parent)!;
        b.omega = Math.sqrt(p.GM / b.orbitR ** 3);
        b.soi = b.orbitR * Math.pow(b.GM / p.GM, 0.4);
      }
    }
    this.update(0);
  }

  get(id: string): Body {
    return this.byId.get(id)!;
  }

  update(dt: number) {
    this.time += dt;
    // positions: parents first (sun has no parent)
    for (const b of this.bodies) {
      if (!b.parent) {
        b.pos = { x: 0, y: 0 };
        b.vel = { x: 0, y: 0 };
      }
    }
    // resolve up to 3 levels deep (sun -> planet -> moon)
    for (let pass = 0; pass < 3; pass++) {
      for (const b of this.bodies) {
        if (!b.parent) continue;
        const p = this.byId.get(b.parent)!;
        const theta = b.phase + b.omega * this.time;
        b.pos = V.add(p.pos, { x: Math.cos(theta) * b.orbitR, y: Math.sin(theta) * b.orbitR });
        const vt = b.omega * b.orbitR;
        b.vel = V.add(p.vel, { x: -Math.sin(theta) * vt, y: Math.cos(theta) * vt });
      }
    }
  }

  // The body whose SOI currently contains `pos` (deepest/smallest SOI wins).
  dominantBody(pos: Vec2): Body {
    let best: Body = this.get("sun");
    let bestSoi = Infinity;
    for (const b of this.bodies) {
      const d = V.len(V.sub(pos, b.pos));
      if (d < b.soi && b.soi <= bestSoi) {
        best = b;
        bestSoi = b.soi;
      }
    }
    return best;
  }

  // The acceleration of a body's own (kinematic) motion through the world frame.
  // For a body on a fixed circular orbit this is exact: centripetal toward its
  // parent, plus the parent's own frame acceleration (recursively). Adding this
  // to a craft inside the body's SOI makes the body frame behave as inertial, so
  // a landed craft co-moves with its planet and orbits stay Keplerian relative to
  // it — without storing state in a moving frame.
  bodyFrameAccel(body: Body): Vec2 {
    if (!body.parent) return { x: 0, y: 0 };
    const parent = this.byId.get(body.parent)!;
    const d = V.sub(body.pos, parent.pos); // outward from parent
    const centripetal = V.scale(d, -body.omega * body.omega); // toward parent
    return V.add(centripetal, this.bodyFrameAccel(parent));
  }

  // Gravity acceleration at a point, from the dominant body only (patched conic).
  gravityAt(pos: Vec2, body?: Body): Vec2 {
    const b = body ?? this.dominantBody(pos);
    const d = V.sub(b.pos, pos);
    const r = Math.max(V.len(d), b.radius * 0.5);
    const a = b.GM / (r * r);
    return V.scale(V.norm(d), a);
  }

  // Atmospheric density at a point (0 outside atmosphere). Relative units.
  airDensity(pos: Vec2, body?: Body): number {
    const b = body ?? this.dominantBody(pos);
    if (b.atmoHeight <= 0) return 0;
    const alt = V.len(V.sub(pos, b.pos)) - b.radius;
    if (alt < 0 || alt > b.atmoHeight) return 0;
    return Math.exp(-alt / (b.atmoHeight * 0.18));
  }

  altitudeAbove(pos: Vec2, body: Body): number {
    return V.len(V.sub(pos, body.pos)) - body.radius;
  }
}
