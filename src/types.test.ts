import { describe, it, expect } from "vitest";
import { V } from "./types";

describe("V (2D vector math)", () => {
  it("adds, subtracts and scales", () => {
    expect(V.add({ x: 1, y: 2 }, { x: 3, y: 4 })).toEqual({ x: 4, y: 6 });
    expect(V.sub({ x: 3, y: 4 }, { x: 1, y: 2 })).toEqual({ x: 2, y: 2 });
    expect(V.scale({ x: 2, y: -3 }, 2)).toEqual({ x: 4, y: -6 });
  });

  it("computes length and length squared", () => {
    expect(V.len({ x: 3, y: 4 })).toBe(5);
    expect(V.len2({ x: 3, y: 4 })).toBe(25);
  });

  it("normalises to unit length (and is safe at zero)", () => {
    expect(V.len(V.norm({ x: 0, y: 5 }))).toBeCloseTo(1);
    expect(V.norm({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });

  it("rotates by 90 degrees", () => {
    const r = V.rot({ x: 1, y: 0 }, Math.PI / 2);
    expect(r.x).toBeCloseTo(0);
    expect(r.y).toBeCloseTo(1);
  });

  it("builds a vector from an angle and magnitude", () => {
    const v = V.fromAngle(0, 3);
    expect(v.x).toBeCloseTo(3);
    expect(v.y).toBeCloseTo(0);
  });
});
