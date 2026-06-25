import { describe, it, expect } from "vitest";
import { World } from "./world";
import { assembleVessel, Fx } from "./vessel";
import { Design } from "../build/design";
import { getPart, partWetMass } from "../parts/catalog";

const noFx: Fx = { explosion() {}, crash() {}, puff() {}, smoke() {}, ember() {}, fireworks() {} };

const twoStage: Design = {
  name: "T",
  parts: [
    { uid: "pod", defId: "pod-mk1", x: 0, y: 12, flip: false },
    { uid: "t1", defId: "tank-small", x: 0, y: 9.8, flip: false, parentUid: "pod" },
    { uid: "e1", defId: "engine-main", x: 0, y: 7.7, flip: false, parentUid: "t1" },
    { uid: "dc", defId: "decoupler", x: 0, y: 6.45, flip: false, parentUid: "e1" },
    { uid: "t2", defId: "tank-large", x: 0, y: 3.8, flip: false, parentUid: "dc" },
    { uid: "e2", defId: "engine-main", x: 0, y: 0.6, flip: false, parentUid: "t2" },
  ],
};

describe("assembleVessel", () => {
  it("totals wet mass of all parts", () => {
    const v = assembleVessel(twoStage);
    const expected = twoStage.parts.reduce((s, p) => s + partWetMass(getPart(p.defId)), 0);
    expect(v.mass).toBeCloseTo(expected, 3);
  });

  it("recenters so the centre of mass is at the local origin", () => {
    const v = assembleVessel(twoStage);
    let m = 0, cx = 0, cy = 0;
    for (const p of v.parts) {
      const pm = v.partMass(p);
      m += pm; cx += pm * p.lx; cy += pm * p.ly;
    }
    expect(Math.hypot(cx / m, cy / m)).toBeLessThan(1e-6);
  });

  it("is controllable with a command pod and reports the next stage", () => {
    const v = assembleVessel(twoStage);
    expect(v.controllable).toBe(true);
    expect(v.nextStageLabel()).toMatch(/Drop/);
  });

  it("fairings the interstage engine but not the bottom engine", () => {
    const fair = assembleVessel(twoStage).fairingUids();
    expect(fair.has("e1")).toBe(true);
    expect(fair.has("e2")).toBe(false);
  });

  it("staging drops the lower stage as a separate debris vessel", () => {
    const world = new World();
    const v = assembleVessel(twoStage);
    v.pos = { x: 5e9, y: 0 }; // deep space, clear of every body
    v.vel = { x: 0, y: 0 };
    const before = v.aliveParts().length;
    const debris = v.update(0.01, world, { rotate: 0, throttleTarget: 0, rcs: false, stage: true }, noFx);
    expect(debris.length).toBe(1);
    expect(debris[0].aliveParts().length).toBe(2); // tank-large + engine
    expect(v.aliveParts().length).toBe(before - 2);
  });
});
