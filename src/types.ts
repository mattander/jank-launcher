// Shared types + tiny 2D math. Units: meters, tonnes, seconds, kN.
// World coordinates are y-up. Rendering flips to y-down (see camera.ts).

export interface Vec2 {
  x: number;
  y: number;
}

export const V = {
  add: (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y }),
  sub: (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y }),
  scale: (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s }),
  len: (a: Vec2): number => Math.hypot(a.x, a.y),
  len2: (a: Vec2): number => a.x * a.x + a.y * a.y,
  norm: (a: Vec2): Vec2 => {
    const l = Math.hypot(a.x, a.y) || 1;
    return { x: a.x / l, y: a.y / l };
  },
  // rotate by angle (radians, CCW)
  rot: (a: Vec2, ang: number): Vec2 => {
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
  },
  fromAngle: (ang: number, m = 1): Vec2 => ({ x: Math.cos(ang) * m, y: Math.sin(ang) * m }),
};

export type GameMode = "build" | "flight";
