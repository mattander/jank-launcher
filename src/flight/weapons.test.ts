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
});
