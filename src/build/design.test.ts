import { describe, it, expect } from "vitest";
import { Design, computeStats, HOME_G0 } from "./design";

const orbiter: Design = {
  name: "T",
  parts: [
    { uid: "pod", defId: "pod-mk1", x: 0, y: 7, flip: false },
    { uid: "tank", defId: "tank-large", x: 0, y: 3, flip: false, parentUid: "pod" },
    { uid: "eng", defId: "engine-main", x: 0, y: 0, flip: false, parentUid: "tank" },
  ],
};

describe("computeStats", () => {
  it("sums thrust and flags command + engine", () => {
    const s = computeStats(orbiter);
    expect(s.partCount).toBe(3);
    expect(s.thrust).toBe(190); // one Bonfire engine
    expect(s.hasCommand).toBe(true);
    expect(s.hasEngine).toBe(true);
  });

  it("computes wet > dry mass and a positive dv", () => {
    const s = computeStats(orbiter);
    expect(s.wetMass).toBeGreaterThan(s.dryMass);
    expect(s.deltaV).toBeGreaterThan(3000); // comfortably orbit-capable
  });

  it("derives TWR consistent with thrust / (wet mass * g0)", () => {
    const s = computeStats(orbiter);
    expect(s.twr).toBeCloseTo(s.thrust / (s.wetMass * HOME_G0), 5);
    expect(s.twr).toBeGreaterThan(1); // can lift off
  });

  it("reports no engine/command for an empty or payload-only craft", () => {
    const s = computeStats({ name: "x", parts: [{ uid: "a", defId: "tank-small", x: 0, y: 0, flip: false }] });
    expect(s.hasEngine).toBe(false);
    expect(s.hasCommand).toBe(false);
    expect(s.deltaV).toBe(0);
  });
});
