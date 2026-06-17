import { getPart, partWetMass, FUEL_MASS_PER_UNIT, PartDef } from "../parts/catalog";

// A part placed in the editor. Position is in rocket-local meters, y-up,
// origin = wherever the player started building. flip mirrors radial parts.
export interface PlacedPart {
  uid: string;
  defId: string;
  x: number;
  y: number;
  flip: boolean;
  parentUid?: string; // the part this one is attached to (undefined for the root)
}

export interface Design {
  name: string;
  parts: PlacedPart[];
}

let uidCounter = 0;
export function newUid(): string {
  uidCounter++;
  return `p${Date.now().toString(36)}_${uidCounter}`;
}

export function emptyDesign(): Design {
  return { name: "Untitled Rocket", parts: [] };
}

export const HOME_G0 = 9.8; // m/s^2, for TWR readout

export interface DesignStats {
  partCount: number;
  dryMass: number;
  wetMass: number;
  thrust: number; // total kN (non-solid + solid)
  twr: number; // at launch, vs home gravity
  deltaV: number; // crude estimate, m/s
  hasCommand: boolean;
  hasEngine: boolean;
}

export function computeStats(design: Design): DesignStats {
  let dryMass = 0;
  let wetMass = 0;
  let thrust = 0;
  let massFlow = 0; // tonnes/sec at full throttle
  let fuelMass = 0;
  let hasCommand = false;
  let hasEngine = false;

  for (const p of design.parts) {
    const def = getPart(p.defId);
    dryMass += def.mass;
    wetMass += partWetMass(def);
    if (def.fuel) fuelMass += def.fuel * FUEL_MASS_PER_UNIT;
    if (def.thrust && def.fuelBurn) {
      thrust += def.thrust;
      massFlow += def.fuelBurn * FUEL_MASS_PER_UNIT;
      hasEngine = true;
    }
    if (def.torque) hasCommand = true;
  }

  const ve = massFlow > 0 ? thrust / massFlow : 0; // effective exhaust velocity m/s
  const deltaV = ve > 0 && wetMass > dryMass ? ve * Math.log(wetMass / (wetMass - fuelMass)) : 0;
  const twr = wetMass > 0 ? thrust / (wetMass * HOME_G0) : 0;

  return {
    partCount: design.parts.length,
    dryMass,
    wetMass,
    thrust,
    twr,
    deltaV,
    hasCommand,
    hasEngine,
  };
}

// Resolve part defs once (handy for iteration)
export function partsWithDefs(design: Design): { p: PlacedPart; def: PartDef }[] {
  return design.parts.map((p) => ({ p, def: getPart(p.defId) }));
}
