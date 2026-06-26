import { describe, expect, it } from "vitest";
import { WeaponSpec } from "../parts/catalog";
import { V } from "../types";
import { Fx } from "./vessel";
import { Combat } from "./weapons";
import { World } from "./world";

const noFx: Fx = { explosion() {}, crash() {}, puff() {}, smoke() {}, ember() {}, fireworks() {} };

describe("Combat weapons", () => {
  it("keeps ranged cannon shots alive past the old cursor-pop window", () => {
    const world = new World();
    const combat = new Combat();
    const spec: WeaponSpec = { kind: "cannon", damage: 45, rate: 2.5, speed: 750, range: 3000 };
    const origin = { x: 5e9, y: 0 };
    const dir = V.norm({ x: 1, y: 0.4 });
    const endpoint = V.add(origin, V.scale(dir, spec.range));

    combat.fire(origin, dir, spec, { x: 0, y: 0 }, 1, noFx, endpoint, world);
    combat.update(0.2, world, [], noFx);

    expect(combat.projectiles.length).toBe(1);
    const shot = combat.projectiles[0];
    expect(shot.alive).toBe(true);
    expect(shot.life).toBeGreaterThan(3.7);
    expect(V.len(V.sub(shot.pos, origin))).toBeGreaterThan(100);
    expect(V.norm(V.sub(shot.pos, origin)).x).toBeGreaterThan(0.8);
  });

  it("keeps laser afterimages in the local body frame", () => {
    const world = new World();
    const combat = new Combat();
    const terra = world.get("terra");
    const spec: WeaponSpec = { kind: "laser", damage: 60, rate: 1, speed: 0, range: 7000 };
    const origin = V.add(terra.pos, { x: 0, y: terra.radius + 200 });
    const dir = V.norm({ x: 1, y: 0.1 });
    const aim = V.add(origin, V.scale(dir, 1600));

    combat.fireLaser(origin, dir, spec, 1, noFx, world, [], aim);
    const beam = combat.beams[0];
    const startRel = V.sub(beam.a, terra.pos);

    const dt = 0.03;
    world.update(dt);
    combat.update(dt, world, [], noFx);

    expect(combat.beams.length).toBe(1);
    const movedBeam = combat.beams[0];
    const movedTerra = world.get("terra");
    const movedRel = V.sub(movedBeam.a, movedTerra.pos);

    expect(V.len(V.sub(movedRel, startRel))).toBeLessThan(2);
  });
});
