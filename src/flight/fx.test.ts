import { describe, expect, it } from "vitest";
import { Particles } from "./fx";

describe("Particles", () => {
  it("makes high-speed crashes large and lingering", () => {
    const fx = new Particles();

    fx.crash({ x: 0, y: 0 }, 70, 4, { x: 0, y: 1 }, { x: 0, y: -70 });

    expect(fx.parts.length).toBeGreaterThan(180);
    expect(fx.parts.some((p) => p.ring && p.size > 100)).toBe(true);
    expect(fx.parts.some((p) => p.life > 2)).toBe(true);
    expect(fx.parts.some((p) => p.glow)).toBe(true);
  });
});
