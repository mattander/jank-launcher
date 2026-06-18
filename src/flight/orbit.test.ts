import { describe, it, expect } from "vitest";
import { World } from "./world";
import { orbit, conicPath } from "./orbit";

describe("orbit (Keplerian elements)", () => {
  const world = new World();
  const terra = world.get("terra");
  const r = terra.radius + 100000;
  const vc = Math.sqrt(terra.GM / r);

  it("recognises a circular orbit", () => {
    const pos = { x: terra.pos.x, y: terra.pos.y + r };
    const vel = { x: terra.vel.x + vc, y: terra.vel.y }; // tangential
    const o = orbit(pos, vel, terra);
    expect(o.bound).toBe(true);
    expect(o.ecc).toBeLessThan(0.01);
    expect(o.apo).toBeCloseTo(r, -3); // within ~1 km
    expect(o.peri).toBeCloseTo(r, -3);
  });

  it("recognises an eccentric orbit (apo > peri)", () => {
    const pos = { x: terra.pos.x, y: terra.pos.y + r };
    const vel = { x: terra.vel.x + vc * 1.2, y: terra.vel.y }; // faster than circular at periapsis
    const o = orbit(pos, vel, terra);
    expect(o.bound).toBe(true);
    expect(o.ecc).toBeGreaterThan(0.1);
    expect(o.apo).toBeGreaterThan(o.peri);
    expect(o.peri).toBeCloseTo(r, -4); // periapsis stays at the burn point
  });

  it("recognises an escape trajectory", () => {
    const vesc = Math.sqrt(2) * vc;
    const pos = { x: terra.pos.x, y: terra.pos.y + r };
    const vel = { x: terra.vel.x + vesc * 1.05, y: terra.vel.y };
    const o = orbit(pos, vel, terra);
    expect(o.bound).toBe(false);
    expect(o.apo).toBe(Infinity);
  });

  it("samples a closed conic path for a circular orbit", () => {
    const pos = { x: terra.pos.x, y: terra.pos.y + r };
    const vel = { x: terra.vel.x + vc, y: terra.vel.y };
    const path = conicPath(pos, vel, terra);
    expect(path).not.toBeNull();
    expect(path!.pts.length).toBeGreaterThan(50);
    // every sampled point sits ~r from the body for a circular orbit
    for (const p of path!.pts) {
      const d = Math.hypot(p.x - terra.pos.x, p.y - terra.pos.y);
      expect(d).toBeGreaterThan(r * 0.9);
      expect(d).toBeLessThan(r * 1.1);
    }
  });

  it("returns null for a purely radial (degenerate) state", () => {
    const pos = { x: terra.pos.x, y: terra.pos.y + r };
    const vel = { x: terra.vel.x, y: terra.vel.y }; // no tangential velocity
    expect(conicPath(pos, vel, terra)).toBeNull();
  });
});
