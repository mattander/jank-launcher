import { Graphics } from "pixi.js";
import { sketchPoly, sketchLine, sketchCircle, sketchBox, makeRng } from "../sketch";

export type PartCategory =
  | "command"
  | "fuel"
  | "engine"
  | "aero"
  | "structural"
  | "utility"
  | "weapon";

export type NodeType = "stack" | "radial";

export interface AttachNode {
  x: number; // local meters, origin at part center
  y: number;
  type: NodeType;
}

export interface WeaponSpec {
  kind: "cannon" | "laser" | "missile";
  damage: number;
  rate: number; // shots per second
  speed: number; // projectile speed m/s (ignored for laser)
  range: number;
  festive?: boolean; // detonates into a harmless colourful firework
}

export interface PartDef {
  id: string;
  name: string;
  category: PartCategory;
  blurb: string;
  width: number; // meters
  height: number;
  mass: number; // dry mass, tonnes
  color: number;
  shape: string;
  nodes: AttachNode[];
  // capabilities
  fuel?: number; // fuel units stored
  thrust?: number; // kN at full throttle
  fuelBurn?: number; // units/sec at full throttle
  gimbal?: boolean; // engine can steer
  solid?: boolean; // SRB: ignite once, no throttle/shutdown
  torque?: number; // reaction-wheel torque kN*m
  decoupler?: boolean;
  parachute?: number; // drag area when deployed
  landingLeg?: boolean;
  rcs?: boolean;
  solarPower?: number; // electricity/sec in sunlight
  battery?: number; // electricity capacity
  weapon?: WeaponSpec;
  strengthMul?: number; // multiplies joint strength of attachments to this part
}

export const FUEL_MASS_PER_UNIT = 0.005; // tonnes per fuel unit

const INK = 0x2a2118;

// Palette (muted, papery)
const C = {
  steel: 0xb9b2a0,
  white: 0xefe7d2,
  orange: 0xd98a3d,
  red: 0xc84b31,
  teal: 0x3a7d8c,
  copper: 0xa9663b,
  gold: 0xd8b24a,
  blue: 0x4a6d9c,
  dark: 0x554b3a,
  green: 0x5b8c4a,
};

export const PARTS: PartDef[] = [
  // ---------- COMMAND ----------
  {
    id: "pod-mk1",
    name: "Mk1 Pod",
    category: "command",
    blurb: "A cozy command capsule. Steers via reaction wheel.",
    width: 2.2, height: 2.0, mass: 0.84, color: C.white, shape: "pod",
    torque: 14, battery: 50,
    nodes: [{ x: 0, y: -1.0, type: "stack" }],
  },
  {
    id: "probe-core",
    name: "Probe Core",
    category: "command",
    blurb: "Tiny unmanned brain. Light, weak torque.",
    width: 1.4, height: 0.8, mass: 0.12, color: C.steel, shape: "probe",
    torque: 5, battery: 20,
    nodes: [{ x: 0, y: -0.4, type: "stack" }, { x: 0, y: 0.4, type: "stack" }],
  },

  // ---------- FUEL ----------
  {
    id: "tank-small",
    name: "Small Tank",
    category: "fuel",
    blurb: "Holds a modest splash of go-juice.",
    width: 2.0, height: 2.4, mass: 0.18, color: C.orange, shape: "tank",
    fuel: 240,
    nodes: [{ x: 0, y: 1.2, type: "stack" }, { x: 0, y: -1.2, type: "stack" }],
  },
  {
    id: "tank-large",
    name: "Big Tank",
    category: "fuel",
    blurb: "A lot of go-juice. Heavy when full.",
    width: 2.2, height: 4.6, mass: 0.4, color: C.orange, shape: "tank",
    fuel: 720,
    nodes: [{ x: 0, y: 2.3, type: "stack" }, { x: 0, y: -2.3, type: "stack" }],
  },
  {
    id: "tank-radial",
    name: "Radial Tank",
    category: "fuel",
    blurb: "Strap-on fuel for the sides.",
    width: 1.2, height: 3.0, mass: 0.12, color: C.copper, shape: "tank",
    fuel: 170,
    nodes: [{ x: -0.6, y: 0, type: "radial" }],
  },

  // ---------- ENGINES ----------
  {
    id: "engine-main",
    name: "Bonfire Engine",
    category: "engine",
    blurb: "Big dumb thrust. Gimbals for steering.",
    width: 2.2, height: 1.8, mass: 0.6, color: C.dark, shape: "engine",
    thrust: 190, fuelBurn: 9, gimbal: true,
    // bottom node lets you stack a decoupler + lower stage below it (interstage)
    nodes: [{ x: 0, y: 0.9, type: "stack" }, { x: 0, y: -0.9, type: "stack" }],
  },
  {
    id: "engine-small",
    name: "Pip Engine",
    category: "engine",
    blurb: "Efficient little vacuum poker.",
    width: 1.3, height: 1.3, mass: 0.25, color: C.dark, shape: "engine",
    thrust: 70, fuelBurn: 3.4, gimbal: true,
    nodes: [{ x: 0, y: 0.65, type: "stack" }, { x: 0, y: -0.65, type: "stack" }],
  },
  {
    id: "engine-radial",
    name: "Radial Thruster",
    category: "engine",
    blurb: "Bolts to the side, points down.",
    width: 1.0, height: 1.4, mass: 0.2, color: C.dark, shape: "engine",
    thrust: 70, fuelBurn: 4.4,
    nodes: [{ x: -0.5, y: 0.4, type: "radial" }],
  },
  {
    id: "srb",
    name: "Solid Booster",
    category: "engine",
    blurb: "Light it and pray. No off switch.",
    width: 1.6, height: 4.4, mass: 0.45, color: C.white, shape: "srb",
    thrust: 240, fuelBurn: 22, solid: true, fuel: 360,
    nodes: [{ x: 0, y: 2.2, type: "stack" }, { x: -0.8, y: 0.6, type: "radial" }],
  },
  {
    id: "engine-vac",
    name: "Vac Nozzle",
    category: "engine",
    blurb: "Sips fuel, sips thrust. Wildly efficient in vacuum.",
    width: 1.6, height: 1.6, mass: 0.3, color: C.dark, shape: "engine",
    thrust: 95, fuelBurn: 3, gimbal: true,
    nodes: [{ x: 0, y: 0.8, type: "stack" }, { x: 0, y: -0.8, type: "stack" }],
  },
  {
    id: "srb-big",
    name: "Thumper SRB",
    category: "engine",
    blurb: "An enormous tube of go. Hold on tight.",
    width: 1.8, height: 5.6, mass: 0.7, color: C.white, shape: "srb",
    thrust: 380, fuelBurn: 30, solid: true, fuel: 620,
    nodes: [{ x: 0, y: 2.8, type: "stack" }, { x: -0.9, y: 0.8, type: "radial" }],
  },

  // ---------- AERO ----------
  {
    id: "nosecone",
    name: "Nose Cone",
    category: "aero",
    blurb: "Pointy. Looks fast. Slightly is.",
    width: 2.0, height: 2.0, mass: 0.08, color: C.red, shape: "nose",
    nodes: [{ x: 0, y: -1.0, type: "stack" }],
  },
  {
    id: "fin",
    name: "Tail Fin",
    category: "aero",
    blurb: "Keeps the pointy end up. Mostly.",
    width: 1.6, height: 1.8, mass: 0.05, color: C.red, shape: "fin",
    nodes: [{ x: -0.2, y: 0.6, type: "radial" }],
  },
  {
    id: "winglet",
    name: "Winglet",
    category: "aero",
    blurb: "Small fin for fine swooshing.",
    width: 1.1, height: 1.0, mass: 0.03, color: C.teal, shape: "fin",
    nodes: [{ x: -0.15, y: 0.3, type: "radial" }],
  },
  {
    id: "heatshield",
    name: "Heat Shield",
    category: "aero",
    blurb: "Wide dish for the toasty side of re-entry. Adds drag.",
    width: 2.8, height: 0.9, mass: 0.25, color: C.copper, shape: "shield",
    nodes: [{ x: 0, y: 0.45, type: "stack" }],
  },

  // ---------- STRUCTURAL ----------
  {
    id: "decoupler",
    name: "Decoupler",
    category: "structural",
    blurb: "Stages go boom-apart here. Springy.",
    width: 2.0, height: 0.7, mass: 0.05, color: C.gold, shape: "decoupler",
    decoupler: true,
    nodes: [{ x: 0, y: 0.35, type: "stack" }, { x: 0, y: -0.35, type: "stack" }],
  },
  {
    id: "decoupler-radial",
    name: "Radial Decoupler",
    category: "structural",
    blurb: "Drop side boosters on cue.",
    width: 0.8, height: 1.2, mass: 0.04, color: C.gold, shape: "decoupler",
    decoupler: true,
    nodes: [{ x: -0.4, y: 0, type: "radial" }, { x: 0.4, y: 0, type: "radial" }],
  },
  {
    id: "girder",
    name: "Girder",
    category: "structural",
    blurb: "Sturdy lattice. Hold it together.",
    width: 1.0, height: 2.6, mass: 0.12, color: C.steel, shape: "girder",
    strengthMul: 2.2,
    nodes: [{ x: 0, y: 1.3, type: "stack" }, { x: 0, y: -1.3, type: "stack" }],
  },
  {
    id: "adapter",
    name: "Adapter",
    category: "structural",
    blurb: "Tapers a fat stack to a skinny one.",
    width: 2.2, height: 1.4, mass: 0.1, color: C.steel, shape: "adapter",
    nodes: [{ x: 0, y: 0.7, type: "stack" }, { x: 0, y: -0.7, type: "stack" }],
  },
  {
    id: "landing-leg",
    name: "Landing Leg",
    category: "structural",
    blurb: "For arrivals you'd like to survive.",
    width: 0.6, height: 2.0, mass: 0.06, color: C.steel, shape: "leg",
    landingLeg: true,
    nodes: [{ x: -0.3, y: 0.6, type: "radial" }],
  },
  {
    id: "strut",
    name: "Strut",
    category: "structural",
    blurb: "A reassuring stick. Reinforces joints.",
    width: 0.5, height: 1.8, mass: 0.03, color: C.copper, shape: "girder",
    strengthMul: 1.6,
    nodes: [{ x: -0.25, y: 0, type: "radial" }],
  },

  // ---------- UTILITY ----------
  {
    id: "parachute",
    name: "Parachute",
    category: "utility",
    blurb: "Big polka-dot lifesaver. Stage to pop.",
    width: 1.4, height: 1.0, mass: 0.08, color: C.red, shape: "chute",
    parachute: 60,
    nodes: [{ x: 0, y: -0.5, type: "stack" }],
  },
  {
    id: "rcs",
    name: "RCS Block",
    category: "utility",
    blurb: "Puffs of control. Costs a little power.",
    width: 0.7, height: 0.7, mass: 0.04, color: C.steel, shape: "rcs",
    rcs: true,
    nodes: [{ x: -0.35, y: 0, type: "radial" }],
  },
  {
    id: "solar",
    name: "Solar Panel",
    category: "utility",
    blurb: "Sips sunlight into the batteries.",
    width: 2.2, height: 0.5, mass: 0.05, color: C.blue, shape: "solar",
    solarPower: 8,
    nodes: [{ x: -0.4, y: 0, type: "radial" }],
  },
  {
    id: "battery",
    name: "Battery",
    category: "utility",
    blurb: "Stores zaps for night-side steering.",
    width: 1.0, height: 0.8, mass: 0.06, color: C.green, shape: "box",
    battery: 120,
    nodes: [{ x: 0, y: 0.4, type: "stack" }, { x: 0, y: -0.4, type: "stack" }],
  },

  // ---------- WEAPONS ----------
  {
    id: "cannon",
    name: "Kaboom Cannon",
    category: "weapon",
    blurb: "Lobs explosive slugs. Punchy but short-ranged — gravity pulls them down.",
    width: 1.0, height: 1.4, mass: 0.18, color: C.dark, shape: "cannon",
    weapon: { kind: "cannon", damage: 45, rate: 2.5, speed: 750, range: 3000 },
    nodes: [{ x: -0.5, y: 0, type: "radial" }],
  },
  {
    id: "laser",
    name: "Zap Laser",
    category: "weapon",
    blurb: "Continuous beam of regret. Instant, gravity-proof, long range.",
    width: 0.9, height: 1.2, mass: 0.15, color: C.red, shape: "laser",
    weapon: { kind: "laser", damage: 60, rate: 1, speed: 0, range: 7000 },
    nodes: [{ x: -0.45, y: 0, type: "radial" }],
  },
  {
    id: "missile-rack",
    name: "Missile Rack",
    category: "weapon",
    blurb: "Guided rockets that thrust toward the cursor. Long range.",
    width: 1.2, height: 1.6, mass: 0.22, color: C.teal, shape: "missiles",
    weapon: { kind: "missile", damage: 90, rate: 1.2, speed: 160, range: 6500 },
    nodes: [{ x: -0.6, y: 0, type: "radial" }],
  },
  {
    id: "railgun",
    name: "Rail Driver",
    category: "weapon",
    blurb: "Hypervelocity slug. Long range, big punch, slow to recharge.",
    width: 0.8, height: 2.0, mass: 0.3, color: C.steel, shape: "railgun",
    weapon: { kind: "cannon", damage: 140, rate: 0.6, speed: 2200, range: 9000 },
    nodes: [{ x: -0.4, y: 0, type: "radial" }],
  },
  {
    id: "firework",
    name: "Firework Launcher",
    category: "weapon",
    blurb: "Pure celebration. Bursts into colour. Harmless. Mostly.",
    width: 1.0, height: 1.3, mass: 0.1, color: C.gold, shape: "missiles",
    weapon: { kind: "cannon", damage: 8, rate: 3, speed: 420, range: 3000, festive: true },
    nodes: [{ x: -0.5, y: 0, type: "radial" }],
  },
];

export const PART_BY_ID = new Map(PARTS.map((p) => [p.id, p]));

export function getPart(id: string): PartDef {
  const p = PART_BY_ID.get(id);
  if (!p) throw new Error(`Unknown part: ${id}`);
  return p;
}

// Total mass including fuel
export function partWetMass(def: PartDef): number {
  return def.mass + (def.fuel ?? 0) * FUEL_MASS_PER_UNIT;
}

// ---------------------------------------------------------------------------
// Drawing. mPerPx scales meters -> pixels so parts render at the right size.
// Draws into the given Graphics, centered at local origin, +y = up (nose).
// We draw in pixel space (y-down) so callers position via container transform.
// ---------------------------------------------------------------------------
export function drawPart(g: Graphics, def: PartDef, pxPerM: number) {
  const w = def.width * pxPerM;
  const h = def.height * pxPerM;
  const hw = w / 2;
  const hh = h / 2;
  const seed = hashId(def.id);
  const lw = Math.max(1.5, pxPerM * 0.12);
  const base = { stroke: INK, lineWidth: lw, seed, jitter: Math.min(2.2, pxPerM * 0.12) };

  switch (def.shape) {
    case "pod":
      // capsule: trapezoid narrow at top
      sketchPoly(g, [
        [-hw * 0.45, -hh],
        [hw * 0.45, -hh],
        [hw, hh],
        [-hw, hh],
      ], { ...base, fill: def.color });
      sketchLine(g, [[-hw * 0.2, -hh * 0.2], [hw * 0.2, -hh * 0.2]], { ...base, seed: seed + 7 });
      break;
    case "probe":
      sketchBox(g, hw, hh, { ...base, fill: def.color });
      sketchCircle(g, 0, 0, hh * 0.4, { ...base, fill: 0x222, fillAlpha: 0.2, seed: seed + 2 });
      break;
    case "tank":
      sketchBox(g, hw, hh, { ...base, fill: def.color });
      // hoop lines
      for (let i = 1; i <= 3; i++) {
        const yy = -hh + (h * i) / 4;
        sketchLine(g, [[-hw, yy], [hw, yy]], { ...base, lineWidth: lw * 0.7, seed: seed + i * 13 });
      }
      break;
    case "engine": {
      // body fills from the top node down; flared nozzle at the bottom
      const midY = hh * 0.2;
      sketchPoly(g, [
        [-hw * 0.72, -hh],
        [hw * 0.72, -hh],
        [hw * 0.72, midY],
        [-hw * 0.72, midY],
      ], { ...base, fill: def.color });
      sketchPoly(g, [
        [-hw * 0.6, midY],
        [hw * 0.6, midY],
        [hw, hh],
        [-hw, hh],
      ], { ...base, fill: 0x3a3228, seed: seed + 5 });
      break;
    }
    case "srb":
      sketchBox(g, hw, hh, { ...base, fill: def.color });
      sketchPoly(g, [
        [-hw, hh * 0.7],
        [hw, hh * 0.7],
        [hw * 0.5, hh],
        [-hw * 0.5, hh],
      ], { ...base, fill: 0x3a3228, seed: seed + 3 });
      // nose taper
      sketchPoly(g, [
        [-hw, -hh * 0.7],
        [hw, -hh * 0.7],
        [hw * 0.4, -hh],
        [-hw * 0.4, -hh],
      ], { ...base, fill: C.red, seed: seed + 8 });
      break;
    case "nose":
      sketchPoly(g, [[0, -hh], [hw, hh], [-hw, hh]], { ...base, fill: def.color });
      break;
    case "fin":
      sketchPoly(g, [[-hw, hh], [hw * 0.2, hh], [-hw, -hh]], { ...base, fill: def.color });
      break;
    case "decoupler":
      sketchBox(g, hw, hh, { ...base, fill: def.color });
      sketchLine(g, [[-hw, 0], [hw, 0]], { ...base, lineWidth: lw * 1.4, seed: seed + 4 });
      break;
    case "girder": {
      sketchBox(g, hw, hh, { ...base, fill: def.color, fillAlpha: 0.4 });
      // X lattice
      const n = Math.max(2, Math.round(def.height / 0.9));
      for (let i = 0; i < n; i++) {
        const y0 = -hh + (h * i) / n;
        const y1 = -hh + (h * (i + 1)) / n;
        sketchLine(g, [[-hw, y0], [hw, y1]], { ...base, lineWidth: lw * 0.6, seed: seed + i });
        sketchLine(g, [[hw, y0], [-hw, y1]], { ...base, lineWidth: lw * 0.6, seed: seed + i + 50 });
      }
      break;
    }
    case "adapter":
      sketchPoly(g, [
        [-hw, hh],
        [hw, hh],
        [hw * 0.5, -hh],
        [-hw * 0.5, -hh],
      ], { ...base, fill: def.color });
      break;
    case "leg":
      sketchLine(g, [[hw, -hh], [-hw * 0.6, hh * 0.4], [hw, hh]], { ...base, lineWidth: lw * 1.4 });
      break;
    case "chute":
      sketchBox(g, hw * 0.5, hh, { ...base, fill: def.color });
      break;
    case "rcs":
      sketchBox(g, hw, hh, { ...base, fill: def.color });
      sketchLine(g, [[hw, -hh * 0.5], [hw * 1.5, -hh * 0.8]], { ...base, seed: seed + 1 });
      sketchLine(g, [[hw, hh * 0.5], [hw * 1.5, hh * 0.8]], { ...base, seed: seed + 2 });
      break;
    case "solar":
      sketchBox(g, hw, hh, { ...base, fill: def.color });
      for (let i = 1; i < 5; i++) {
        const xx = -hw + (w * i) / 5;
        sketchLine(g, [[xx, -hh], [xx, hh]], { ...base, lineWidth: lw * 0.5, seed: seed + i });
      }
      break;
    case "box":
      sketchBox(g, hw, hh, { ...base, fill: def.color });
      break;
    case "cannon":
      sketchBox(g, hw * 0.7, hh * 0.7, { ...base, fill: def.color });
      sketchBox(g, hw * 1.4, hh * 0.22, { ...base, fill: 0x3a3228, seed: seed + 3 });
      break;
    case "laser":
      sketchBox(g, hw * 0.7, hh * 0.7, { ...base, fill: def.color });
      sketchLine(g, [[0, 0], [hw * 2, 0]], { ...base, lineWidth: lw * 1.2, seed: seed + 4 });
      break;
    case "missiles":
      sketchBox(g, hw, hh, { ...base, fill: def.color });
      for (let i = 0; i < 3; i++) {
        const yy = -hh + (h * (i + 0.5)) / 3;
        sketchPoly(g, [[hw, yy - h * 0.1], [hw * 1.7, yy], [hw, yy + h * 0.1]], {
          ...base, fill: C.red, lineWidth: lw * 0.6, seed: seed + i * 9,
        });
      }
      break;
    case "railgun":
      // mounting block + long twin rails
      sketchBox(g, hw * 0.6, hh * 0.5, { ...base, fill: def.color });
      sketchLine(g, [[0, -hh * 0.25], [hw * 2.2, -hh * 0.25]], { ...base, lineWidth: lw, seed: seed + 1 });
      sketchLine(g, [[0, hh * 0.25], [hw * 2.2, hh * 0.25]], { ...base, lineWidth: lw, seed: seed + 2 });
      break;
    case "shield":
      // shallow dish: flat top, rounded underside
      sketchPoly(g, [
        [-hw, -hh],
        [hw, -hh],
        [hw * 0.7, hh],
        [-hw * 0.7, hh],
      ], { ...base, fill: def.color });
      sketchLine(g, [[-hw, -hh], [hw, -hh]], { ...base, lineWidth: lw * 1.3, seed: seed + 5 });
      break;
    default:
      sketchBox(g, hw, hh, { ...base, fill: def.color });
  }
}

// A smooth interstage shroud that covers an engine sitting under a decoupler.
// Drawn in the same local pixel space as the engine (nose toward -y).
export function drawFairingShroud(g: Graphics, def: PartDef, pxPerM: number) {
  const w = def.width * pxPerM;
  const h = def.height * pxPerM;
  const hw = w / 2;
  const hh = h / 2;
  const lw = Math.max(1.5, pxPerM * 0.12);
  const seed = hashId(def.id) + 99;
  // tapers inward toward the bottom, hiding the engine bell inside a smooth cone
  sketchPoly(
    g,
    [
      [-hw * 0.82, -hh],
      [hw * 0.82, -hh],
      [hw * 0.42, hh],
      [-hw * 0.42, hh],
    ],
    { fill: 0xcabfa3, stroke: INK, lineWidth: lw, seed, jitter: Math.min(2, pxPerM * 0.1) },
  );
  // a couple of seam lines so it reads as a shroud, not a bigger engine
  sketchLine(g, [[-hw * 0.62, -hh * 0.4], [-hw * 0.42, hh]], { stroke: INK, lineWidth: lw * 0.5, seed: seed + 1 });
  sketchLine(g, [[hw * 0.62, -hh * 0.4], [hw * 0.42, hh]], { stroke: INK, lineWidth: lw * 0.5, seed: seed + 2 });
}

function hashId(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export { makeRng };
