import { Design, PlacedPart } from "./design";
import { getPart } from "../parts/catalog";

// Author stock craft with a tiny layout helper so node alignment is automatic.
let uid = 0;
const id = () => `s${uid++}`;

interface Item {
  defId: string;
  x?: number;
}

// Stack items top-to-bottom from `topY`, aligning each part's top stack node to
// the previous part's bottom stack node. Returns the placed parts (root first).
function vstack(items: Item[], topY: number): PlacedPart[] {
  const parts: PlacedPart[] = [];
  let y = topY;
  let prev: string | undefined;
  for (const it of items) {
    const def = getPart(it.defId);
    const top = def.nodes.find((n) => n.type === "stack" && n.y > 0);
    const bot = def.nodes.find((n) => n.type === "stack" && n.y < 0);
    const cy = y - (top ? top.y : def.height / 2);
    const uidStr = id();
    parts.push({ uid: uidStr, defId: it.defId, x: it.x ?? 0, y: cy, flip: false, parentUid: prev });
    y = cy + (bot ? bot.y : -def.height / 2);
    prev = uidStr;
  }
  return parts;
}

function radial(defId: string, x: number, y: number, flip: boolean, parentUid: string): PlacedPart {
  return { uid: id(), defId, x, y, flip, parentUid };
}

function build(name: string, fn: (parts: PlacedPart[]) => void): Design {
  const parts: PlacedPart[] = [];
  fn(parts);
  return { name, parts };
}

export function stockDesigns(): Design[] {
  return [
    // --- sounding rocket: pops straight up, chute down ---
    build("Lil' Hopper", (p) => {
      const s = vstack([{ defId: "pod-mk1" }, { defId: "tank-small" }, { defId: "engine-main" }], 6);
      p.push(...s);
      const pod = s[0], tank = s[1];
      p.push(radial("parachute", 0, pod.y + 1.5, false, pod.uid));
      p.push(radial("fin", -1.0, tank.y - 0.5, false, tank.uid));
      p.push(radial("fin", 1.0, tank.y - 0.5, true, tank.uid));
    }),

    // --- single-stack orbiter: ~4 km/s dv, comfortably reaches Terra orbit ---
    build("Orbit Express", (p) => {
      const s = vstack([{ defId: "pod-mk1" }, { defId: "tank-large" }, { defId: "engine-main" }], 7);
      p.push(...s);
      const pod = s[0], tank = s[1];
      p.push(radial("parachute", 0, pod.y + 1.5, false, pod.uid));
      p.push(radial("fin", -1.15, tank.y - 1.6, false, tank.uid));
      p.push(radial("fin", 1.15, tank.y - 1.6, true, tank.uid));
    }),

    // --- two-stage Moon craft: drop the booster, finish on the efficient upper ---
    build("Luna Runner", (p) => {
      const s = vstack(
        [
          { defId: "pod-mk1" },
          { defId: "tank-small" },
          { defId: "engine-small" },
          { defId: "decoupler" },
          { defId: "tank-large" },
          { defId: "engine-main" },
        ],
        7,
      );
      p.push(...s);
      const pod = s[0], upperTank = s[1], lowerTank = s[4];
      p.push(radial("parachute", 0, pod.y + 1.5, false, pod.uid));
      p.push(radial("landing-leg", -1.1, upperTank.y - 0.9, false, upperTank.uid));
      p.push(radial("landing-leg", 1.1, upperTank.y - 0.9, true, upperTank.uid));
      p.push(radial("fin", -1.15, lowerTank.y - 1.7, false, lowerTank.uid));
      p.push(radial("fin", 1.15, lowerTank.y - 1.7, true, lowerTank.uid));
    }),

    // --- gunship: orbit-capable with cannon, laser and missiles ---
    build("Bug Zapper", (p) => {
      const s = vstack([{ defId: "pod-mk1" }, { defId: "tank-large" }, { defId: "engine-main" }], 7);
      p.push(...s);
      const pod = s[0], tank = s[1];
      p.push(radial("parachute", 0, pod.y + 1.5, false, pod.uid));
      p.push(radial("cannon", -1.6, tank.y + 1.4, false, tank.uid));
      p.push(radial("cannon", 1.6, tank.y + 1.4, true, tank.uid));
      p.push(radial("laser", -1.6, tank.y, false, tank.uid));
      p.push(radial("laser", 1.6, tank.y, true, tank.uid));
      p.push(radial("missile-rack", -1.7, tank.y - 1.4, false, tank.uid));
      p.push(radial("missile-rack", 1.7, tank.y - 1.4, true, tank.uid));
      p.push(radial("fin", -1.15, tank.y - 1.9, false, tank.uid));
      p.push(radial("fin", 1.15, tank.y - 1.9, true, tank.uid));
    }),
  ];
}
