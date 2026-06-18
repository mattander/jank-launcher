import { describe, it, expect } from "vitest";
import { World } from "./world";
import { V } from "../types";

describe("World", () => {
  const world = new World();
  const terra = world.get("terra");

  it("has the expected bodies", () => {
    expect(world.bodies.map((b) => b.id).sort()).toEqual(["frost", "luna", "rusty", "sun", "terra"]);
  });

  it("gives ~9.8 m/s^2 surface gravity pointing at Terra's centre", () => {
    const surface = { x: terra.pos.x, y: terra.pos.y + terra.radius };
    const g = world.gravityAt(surface, terra);
    expect(V.len(g)).toBeCloseTo(9.8, 1);
    expect(g.y).toBeLessThan(0); // points down, toward the centre
    expect(Math.abs(g.x)).toBeLessThan(1e-3);
  });

  it("picks the dominant body by SOI", () => {
    const surface = { x: terra.pos.x, y: terra.pos.y + terra.radius + 1000 };
    expect(world.dominantBody(surface).id).toBe("terra");
    // far out near the sun's centre but outside any planet SOI -> sun
    expect(world.dominantBody({ x: 1e8, y: 0 }).id).toBe("sun");
  });

  it("derives a sensible orbital angular speed for Terra", () => {
    const sun = world.get("sun");
    expect(terra.omega).toBeCloseTo(Math.sqrt(sun.GM / terra.orbitR ** 3), 12);
  });

  it("gives zero frame acceleration for the sun and centripetal for Terra", () => {
    expect(V.len(world.bodyFrameAccel(world.get("sun")))).toBe(0);
    const a = world.bodyFrameAccel(terra);
    // points toward the sun (-x at phase 0) with magnitude omega^2 * orbitR
    expect(a.x).toBeLessThan(0);
    expect(Math.abs(a.y)).toBeLessThan(1e-6);
    expect(V.len(a)).toBeCloseTo(terra.omega ** 2 * terra.orbitR, 6);
  });

  it("advances body positions over time", () => {
    const w2 = new World();
    const before = { ...w2.get("luna").pos };
    w2.update(1000);
    const after = w2.get("luna").pos;
    expect(after.x !== before.x || after.y !== before.y).toBe(true);
  });
});
