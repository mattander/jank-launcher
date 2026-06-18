import { describe, it, expect } from "vitest";
import { Design } from "./design";
import { computeStages } from "./staging";

// pod - tank - engine - decoupler - tank2 - engine2, plus a parachute
const twoStage: Design = {
  name: "T",
  parts: [
    { uid: "pod", defId: "pod-mk1", x: 0, y: 12, flip: false },
    { uid: "pc", defId: "parachute", x: 0, y: 13.4, flip: false, parentUid: "pod" },
    { uid: "t1", defId: "tank-small", x: 0, y: 9.8, flip: false, parentUid: "pod" },
    { uid: "e1", defId: "engine-main", x: 0, y: 7.7, flip: false, parentUid: "t1" },
    { uid: "dc", defId: "decoupler", x: 0, y: 6.45, flip: false, parentUid: "e1" },
    { uid: "t2", defId: "tank-large", x: 0, y: 3.8, flip: false, parentUid: "dc" },
    { uid: "e2", defId: "engine-main", x: 0, y: 0.6, flip: false, parentUid: "t2" },
  ],
};

describe("computeStages", () => {
  it("returns a separate step then a deploy step, in order", () => {
    const stages = computeStages(twoStage);
    expect(stages.length).toBe(2);
    expect(stages[0].action).toBe("separate");
    expect(stages[1].action).toBe("deploy");
  });

  it("the separation drops the lower stage (tank-large + engine)", () => {
    const stages = computeStages(twoStage);
    expect(stages[0].partIds).toContain("tank-large");
    expect(stages[0].partIds).toContain("engine-main");
    expect(stages[1].partIds).toContain("parachute");
  });

  it("returns no stages for a single stack with no decoupler or chute", () => {
    const single: Design = {
      name: "s",
      parts: [
        { uid: "pod", defId: "pod-mk1", x: 0, y: 2, flip: false },
        { uid: "t", defId: "tank-small", x: 0, y: 0, flip: false, parentUid: "pod" },
        { uid: "e", defId: "engine-main", x: 0, y: -2, flip: false, parentUid: "t" },
      ],
    };
    expect(computeStages(single).length).toBe(0);
  });
});
