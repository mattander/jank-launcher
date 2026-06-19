import { Vec2, V } from "../types";
import { Design } from "../build/design";
import { getPart, PartDef, FUEL_MASS_PER_UNIT } from "../parts/catalog";
import { World, Body } from "./world";

export interface PartInstance {
  uid: string;
  def: PartDef;
  lx: number; // local position in vessel frame (m, y-up), origin = COM
  ly: number;
  flip: boolean;
  fuel: number; // current fuel (for tanks and SRBs)
  ignited: boolean; // SRBs latch on
  deployed: boolean; // chutes / legs
  hp: number;
  alive: boolean;
  flame: number; // 0..1 current exhaust intensity (for rendering plumes)
}

export interface VesselInput {
  rotate: number; // -1..1
  throttleTarget: number; // 0..1
  rcs: boolean;
  stage: boolean; // edge: true for one frame
}

export interface Fx {
  explosion(pos: Vec2, size: number): void;
  puff(pos: Vec2, vel: Vec2, color: number): void;
  smoke(pos: Vec2, vel: Vec2): void;
  ember(pos: Vec2, vel: Vec2, color: number, size?: number): void;
  fireworks(pos: Vec2, size: number): void;
}

const BASE_STRENGTH = 1400; // kN per meter of joint, tuned so flight is stable
const PART_HP = 60;

let vesselSeq = 0;

export class Vessel {
  id: number;
  parts: PartInstance[];
  // undirected adjacency uid->Set(uid), with joint strengths
  adj: Map<string, Set<string>>;
  strength: Map<string, number>; // "a|b" sorted -> kN

  pos: Vec2; // world position of COM
  vel: Vec2;
  angle: number; // rad, CCW, 0 = nose toward +y
  angVel: number;

  throttle = 0;
  rcsOn = false;
  charge: number;
  controllable: boolean;
  landed = false;
  srbsLit = false;

  // cached this-frame
  mass = 1;
  inertia = 1;
  liquidFuel = 0;
  liquidFuelMax = 0;

  constructor(parts: PartInstance[], adj: Map<string, Set<string>>, strength: Map<string, number>) {
    this.id = vesselSeq++;
    this.parts = parts;
    this.adj = adj;
    this.strength = strength;
    this.pos = { x: 0, y: 0 };
    this.vel = { x: 0, y: 0 };
    this.angle = 0;
    this.angVel = 0;
    this.charge = this.batteryMax();
    this.controllable = parts.some((p) => p.def.torque);
    this.recompute();
    this.recenter();
  }

  // -------- mass properties --------
  partMass(p: PartInstance): number {
    let m = p.def.mass;
    if (p.def.fuel || p.def.solid) m += p.fuel * FUEL_MASS_PER_UNIT;
    return m;
  }

  recompute() {
    let lf = 0;
    let lfMax = 0;
    for (const p of this.parts) {
      if (!p.alive) continue;
      if (p.def.fuel && !p.def.solid) {
        lf += p.fuel;
        lfMax += p.def.fuel!;
      }
    }
    this.liquidFuel = lf;
    this.liquidFuelMax = lfMax;
  }

  batteryMax(): number {
    return this.parts.reduce((s, p) => s + (p.def.battery ?? 0), 0);
  }

  recenter() {
    let m = 0;
    let cx = 0;
    let cy = 0;
    for (const p of this.parts) {
      if (!p.alive) continue;
      const pm = this.partMass(p);
      m += pm;
      cx += pm * p.lx;
      cy += pm * p.ly;
    }
    if (m <= 0) m = 0.0001;
    cx /= m;
    cy /= m;
    // shift local frame so COM is at origin, keep world positions fixed
    const worldShift = V.rot({ x: cx, y: cy }, this.angle);
    this.pos = V.add(this.pos, worldShift);
    let inertia = 0;
    for (const p of this.parts) {
      if (!p.alive) continue;
      p.lx -= cx;
      p.ly -= cy;
      const pm = this.partMass(p);
      inertia += pm * (p.lx * p.lx + p.ly * p.ly);
      inertia += (pm * (p.def.width ** 2 + p.def.height ** 2)) / 12;
    }
    this.mass = m;
    this.inertia = Math.max(inertia, 0.5);
  }

  // world position of a part's local origin
  partWorld(p: PartInstance): Vec2 {
    return V.add(this.pos, V.rot({ x: p.lx, y: p.ly }, this.angle));
  }

  upDir(): Vec2 {
    return { x: -Math.sin(this.angle), y: Math.cos(this.angle) };
  }

  hasCommand(): boolean {
    return this.parts.some((p) => p.alive && p.def.torque);
  }

  // -------- per-step simulation --------
  // Returns any debris vessels spun off this step.
  update(dt: number, world: World, input: VesselInput | null, fx: Fx): Vessel[] {
    if (this.aliveParts().length === 0) return []; // nothing left: freeze
    const body = world.dominantBody(this.pos);

    // throttle easing
    if (input) {
      this.throttle += (input.throttleTarget - this.throttle) * Math.min(1, dt * 6);
      this.rcsOn = input.rcs;
    }

    // electricity (lightweight): trickle recharge, small drain when steering
    const solar = this.parts.reduce((s, p) => s + (p.def.solarPower ?? 0), 0);
    this.charge = Math.min(this.batteryMax(), this.charge + solar * dt);

    // ---- thrust ----
    let thrust = 0; // kN
    if (this.throttle > 0.001) this.srbsLit = true;
    for (const p of this.parts) {
      if (!p.alive || !p.def.thrust) continue;
      let firing = 0;
      if (p.def.solid) {
        // SRB: latch lit, burns full until empty
        if (this.srbsLit && p.fuel > 0) {
          const burn = Math.min(p.fuel, p.def.fuelBurn! * dt);
          p.fuel -= burn;
          thrust += p.def.thrust;
          firing = 1;
        }
      } else {
        // liquid: draw from shared pool
        if (this.throttle > 0 && this.liquidFuel > 0) {
          const got = this.drainLiquid(p.def.fuelBurn! * this.throttle * dt);
          if (got > 0) {
            thrust += p.def.thrust * this.throttle;
            firing = this.throttle;
          }
        }
      }
      // ease the flame level toward the firing level for smooth plumes
      p.flame += (firing - p.flame) * Math.min(1, dt * 12);
      if (firing > 0) this.emitExhaust(p, fx, firing);
    }

    const up = this.upDir();
    const grav = world.gravityAt(this.pos, body);
    // Patched-conic: dominant body's gravity + that body's own frame acceleration,
    // so the body frame is locally inertial (no drift relative to the planet).
    let accel = V.add(grav, world.bodyFrameAccel(body));
    accel = V.add(accel, V.scale(up, thrust / this.mass));

    // ---- aero drag (light) ---- relative to the body's atmosphere, not the sun
    const rho = world.airDensity(this.pos, body);
    if (rho > 0) {
      const vRelAir = V.sub(this.vel, body.vel);
      const speed = V.len(vRelAir);
      if (speed > 0.1) {
        const area = this.dragArea();
        const dragK = 0.00018;
        const fDrag = dragK * rho * speed * speed * area;
        accel = V.add(accel, V.scale(V.norm(vRelAir), -fDrag / this.mass));
      }
    }
    this.emitReentry(world, body, fx);

    // ---- steering torque ----
    if (input && this.controllable) {
      const chargeFactor = this.charge > 0 ? 1 : 0.35;
      let torque = 0;
      for (const p of this.parts) {
        if (!p.alive) continue;
        if (p.def.torque) torque += p.def.torque;
        if (this.rcsOn && p.def.rcs && this.charge > 0) torque += 6;
      }
      torque *= chargeFactor;
      const angAccel = (input.rotate * torque) / this.inertia;
      this.angVel += angAccel * dt;
      this.charge = Math.max(0, this.charge - Math.abs(input.rotate) * 1.5 * dt);
      // mild damping for controllability when not commanding
      if (Math.abs(input.rotate) < 0.01) this.angVel *= 1 - Math.min(1, dt * 0.8);
    }

    // ---- integrate (semi-implicit Euler) ----
    this.vel = V.add(this.vel, V.scale(accel, dt));
    this.pos = V.add(this.pos, V.scale(this.vel, dt));
    this.angle += this.angVel * dt;

    // recompute mass after fuel burn
    this.recompute();
    this.recenter();

    // ---- parachutes (drag toward the body's frame in atmosphere) ----
    if (rho > 0.02) {
      let chuteArea = 0;
      for (const p of this.parts) if (p.alive && p.deployed && p.def.parachute) chuteArea += p.def.parachute;
      if (chuteArea > 0) {
        const vRelAir = V.sub(this.vel, body.vel);
        const speed = V.len(vRelAir);
        const slow = Math.min(1, dt * 0.6 * rho * chuteArea * 0.02);
        this.vel = V.add(body.vel, V.scale(vRelAir, 1 - slow));
        if (speed > 1) this.angVel *= 1 - Math.min(1, dt * 2); // chutes stabilize
      }
    }

    // ---- staging ----
    const debris: Vessel[] = [];
    if (input?.stage) {
      const staged = this.doStage(fx);
      debris.push(...staged);
    }

    // ---- structural stress (break-on-overstress) ----
    const stressDebris = this.checkStress(V.len(accel), fx);
    debris.push(...stressDebris);

    // ---- ground collision ----
    const collDebris = this.collide(body, fx);
    debris.push(...collDebris);

    return debris;
  }

  private drainLiquid(want: number): number {
    if (this.liquidFuel <= 0) return 0;
    const got = Math.min(want, this.liquidFuel);
    // proportionally drain tanks so COM shifts realistically
    let remaining = got;
    for (const p of this.parts) {
      if (!p.alive || !p.def.fuel || p.def.solid || p.fuel <= 0) continue;
      const share = (p.fuel / this.liquidFuel) * got;
      const take = Math.min(p.fuel, share, remaining);
      p.fuel -= take;
      remaining -= take;
      if (remaining <= 1e-9) break;
    }
    this.liquidFuel -= got;
    return got;
  }

  private dragArea(): number {
    // crude: widest part as frontal area proxy
    let a = 1;
    for (const p of this.parts) if (p.alive) a = Math.max(a, p.def.width);
    return a + this.parts.length * 0.05;
  }

  private emitExhaust(p: PartInstance, fx: Fx, power: number) {
    const down = V.scale(this.upDir(), -1);
    const nozzle = V.add(this.partWorld(p), V.scale(down, p.def.height * 0.5));
    // exhaust tip is below the nozzle, where smoke/contrail forms
    const tip = V.add(nozzle, V.scale(down, p.def.width * (1 + power)));
    if (Math.random() < 0.5 * power + 0.2) {
      const ev = V.add(this.vel, V.scale(down, 30 + Math.random() * 50));
      fx.smoke(V.add(tip, { x: (Math.random() - 0.5) * 2, y: (Math.random() - 0.5) * 2 }), ev);
    }
    if (Math.random() < 0.4 * power) {
      const spread = V.rot(down, (Math.random() - 0.5) * 0.5);
      const ev = V.add(this.vel, V.scale(spread, 60 + Math.random() * 60));
      fx.ember(nozzle, ev, Math.random() < 0.5 ? 0xffd24a : 0xff8a3d, 2 + Math.random() * 2);
    }
  }

  // glowing plasma sheath when tearing through atmosphere at speed
  private emitReentry(world: World, body: Body, fx: Fx) {
    const rho = world.airDensity(this.pos, body);
    if (rho < 0.04) return;
    const vRel = V.sub(this.vel, body.vel);
    const speed = V.len(vRel);
    if (speed < 1100) return;
    const intensity = Math.min(1, ((speed - 1000) / 1400) * (rho / 0.35));
    if (intensity <= 0) return;
    const dir = V.norm(vRel); // leading edge faces the direction of travel
    const perp = { x: -dir.y, y: dir.x };
    const reach = this.dragArea() * 0.9 + 2;
    const lead = V.add(this.pos, V.scale(dir, reach));
    const n = 1 + Math.floor(intensity * 3);
    for (let i = 0; i < n; i++) {
      const off = (Math.random() - 0.5) * reach * 1.6;
      const at = V.add(lead, V.scale(perp, off));
      const ev = V.add(this.vel, V.add(V.scale(dir, -(60 + Math.random() * 140)), V.scale(perp, off * 3)));
      fx.ember(at, ev, Math.random() < 0.5 ? 0xfff2c8 : Math.random() < 0.6 ? 0xff8a3d : 0xc84b31, 3 + Math.random() * 4);
    }
  }

  // ---- split helpers ----
  private buildSubVessel(uids: Set<string>): Vessel {
    const subParts = this.parts.filter((p) => uids.has(p.uid) && p.alive);
    const subAdj = new Map<string, Set<string>>();
    const subStr = new Map<string, number>();
    for (const u of uids) {
      const ns = this.adj.get(u);
      if (!ns) continue;
      const keep = new Set<string>();
      for (const n of ns) if (uids.has(n)) keep.add(n);
      subAdj.set(u, keep);
    }
    for (const [k, v] of this.strength) {
      const [a, b] = k.split("|");
      if (uids.has(a) && uids.has(b)) subStr.set(k, v);
    }
    const v = new Vessel(subParts, subAdj, subStr);
    v.pos = { ...this.pos };
    v.vel = { ...this.vel };
    v.angle = this.angle;
    v.angVel = this.angVel;
    v.recenter();
    return v;
  }

  // Find the connected component containing `root`, excluding cut edges.
  private componentFrom(root: string, cut: Set<string>): Set<string> {
    const seen = new Set<string>([root]);
    const stack = [root];
    while (stack.length) {
      const u = stack.pop()!;
      for (const n of this.adj.get(u) ?? []) {
        const key = edgeKey(u, n);
        if (cut.has(key) || seen.has(n)) continue;
        seen.add(n);
        stack.push(n);
      }
    }
    return seen;
  }

  private commandUid(): string | null {
    const c = this.parts.find((p) => p.alive && p.def.torque);
    return c ? c.uid : this.parts.find((p) => p.alive)?.uid ?? null;
  }

  // Split off everything not connected to command after cutting `edges`.
  // Returns spawned debris vessels and prunes them from this vessel.
  private splitByCutting(edges: Set<string>, fx: Fx): Vessel[] {
    const root = this.commandUid();
    if (!root) return [];
    const keep = this.componentFrom(root, edges);
    const dropped = new Set<string>();
    for (const p of this.parts) if (p.alive && !keep.has(p.uid)) dropped.add(p.uid);
    if (dropped.size === 0) return [];

    // group dropped parts into their own connected components
    const debris: Vessel[] = [];
    const visited = new Set<string>();
    for (const u of dropped) {
      if (visited.has(u)) continue;
      const comp = this.componentFrom(u, edges);
      const compDropped = new Set<string>([...comp].filter((x) => dropped.has(x)));
      for (const x of compDropped) visited.add(x);
      const v = this.buildSubVessel(compDropped);
      // little separation kick
      const sep = V.rot({ x: 0, y: -1 }, this.angle);
      v.vel = V.add(v.vel, V.scale(sep, 4));
      v.angVel += (Math.random() - 0.5) * 0.6;
      debris.push(v);
      fx.puff(v.pos, { x: 0, y: 0 }, 0xd8b24a);
    }
    // remove dropped from this vessel
    this.parts = this.parts.filter((p) => keep.has(p.uid) || !p.alive);
    this.recompute();
    this.recenter();
    this.controllable = this.hasCommand();
    return debris;
  }

  // Stage: fire the lowest decoupler, else deploy chutes/legs.
  private doStage(fx: Fx): Vessel[] {
    // lowest (most -y) un-fired decoupler
    let target: PartInstance | null = null;
    for (const p of this.parts) {
      if (!p.alive || !p.def.decoupler || p.deployed) continue;
      if (!target || p.ly < target.ly) target = p;
    }
    if (target) {
      target.deployed = true;
      // cut all edges from the decoupler to neighbors not toward command
      const root = this.commandUid();
      const cut = new Set<string>();
      const keepSide = root ? this.componentFrom(root, new Set([])) : new Set<string>();
      for (const n of this.adj.get(target.uid) ?? []) {
        // cut edge toward the side that does NOT contain command via this edge
        const probe = new Set([edgeKey(target.uid, n)]);
        const comp = this.componentFrom(root!, probe);
        if (!comp.has(n)) cut.add(edgeKey(target.uid, n));
      }
      if (keepSide) void keepSide;
      return this.splitByCutting(cut, fx);
    }
    // otherwise: deploy parachutes and legs
    let any = false;
    for (const p of this.parts) {
      if (!p.alive) continue;
      if ((p.def.parachute || p.def.landingLeg) && !p.deployed) {
        p.deployed = true;
        any = true;
      }
    }
    if (any) fx.puff(this.pos, { x: 0, y: 0 }, 0xc84b31);
    return [];
  }

  private checkStress(accelMag: number, fx: Fx): Vessel[] {
    if (this.parts.length < 2) return [];
    const cut = new Set<string>();
    for (const [key, str] of this.strength) {
      const [a, b] = key.split("|");
      const pa = this.parts.find((p) => p.uid === a && p.alive);
      const pb = this.parts.find((p) => p.uid === b && p.alive);
      if (!pa || !pb) continue;
      // Cut this edge and measure the two resulting sides. If they're still
      // connected by another path (redundant strut), no single-joint stress.
      const sideA = this.componentFrom(a, new Set([key]));
      if (sideA.has(b)) continue;
      const sideB = this.componentFrom(b, new Set([key]));
      // the smaller side is what "hangs" off this joint
      const massBeyond = Math.min(this.massOf(sideA), this.massOf(sideB));
      const stress = massBeyond * accelMag;
      if (stress > str) cut.add(key);
    }
    if (cut.size === 0) return [];
    for (const k of cut) {
      const [a] = k.split("|");
      const p = this.parts.find((x) => x.uid === a);
      if (p) fx.puff(this.partWorld(p), { x: 0, y: 0 }, 0x888888);
    }
    return this.splitByCutting(cut, fx);
  }

  private massOf(uids: Set<string>): number {
    let m = 0;
    for (const p of this.parts) if (p.alive && uids.has(p.uid)) m += this.partMass(p);
    return m;
  }

  private collide(body: Body, fx: Fx): Vessel[] {
    let deepest: { p: PartInstance; pen: number } | null = null;
    for (const p of this.parts) {
      if (!p.alive) continue;
      const w = this.partWorld(p);
      const r = V.len(V.sub(w, body.pos));
      const partR = Math.max(p.def.width, p.def.height) * 0.5;
      const pen = body.radius + partR - r;
      if (pen > 0 && (!deepest || pen > deepest.pen)) deepest = { p, pen };
    }
    if (!deepest) {
      this.landed = false;
      return [];
    }

    const normal = V.norm(V.sub(this.pos, body.pos)); // outward
    // Work in the body's frame so a landed craft co-moves with its planet.
    const vRel = V.sub(this.vel, body.vel);
    const radialSpeed = -(vRel.x * normal.x + vRel.y * normal.y); // closing speed
    const hasLegs = this.parts.some((p) => p.alive && p.def.landingLeg && p.deployed);
    const chutesOut = this.parts.some((p) => p.alive && p.def.parachute && p.deployed);
    const gentle = radialSpeed < (hasLegs ? 12 : 6) || chutesOut;

    // push out of the ground
    this.pos = V.add(this.pos, V.scale(normal, deepest.pen));

    // Moving outward (lifting off / bouncing up): never damp — let it fly.
    if (radialSpeed <= 0.05) {
      this.landed = false;
      return [];
    }

    if (gentle && radialSpeed < 20) {
      // settle: kill inward radial velocity, damp tangential & spin (body frame)
      const vn = vRel.x * normal.x + vRel.y * normal.y;
      let v = V.sub(vRel, V.scale(normal, vn));
      v = V.scale(v, 0.6);
      this.vel = V.add(body.vel, v);
      this.angVel *= 0.5;
      this.landed = true;
      return [];
    }

    // hard hit: bounce a bit, damage, and break joints (jank!)
    this.landed = false;
    const vn = vRel.x * normal.x + vRel.y * normal.y;
    let v = V.sub(vRel, V.scale(normal, vn * 1.3));
    v = V.scale(v, 0.4);
    this.vel = V.add(body.vel, v);
    const impactAccel = radialSpeed * 220; // large effective accel for the frame
    fx.explosion(this.partWorld(deepest.p), Math.min(3, 0.6 + radialSpeed * 0.04));
    deepest.p.hp -= radialSpeed * 4;
    if (deepest.p.hp <= 0) deepest.p.alive = false;
    return this.checkStress(impactAccel, fx);
  }

  damagePart(p: PartInstance, dmg: number, fx: Fx) {
    if (!p.alive) return;
    p.hp -= dmg;
    if (p.hp <= 0) {
      p.alive = false;
      fx.explosion(this.partWorld(p), 1.2);
    }
  }

  aliveParts(): PartInstance[] {
    return this.parts.filter((p) => p.alive);
  }

  // Engines with an adjacent decoupler above them (toward +ly) — get a fairing.
  fairingUids(): Set<string> {
    const set = new Set<string>();
    for (const p of this.parts) {
      if (!p.alive || !p.def.thrust || p.def.solid || !p.def.nodes.some((n) => n.type === "stack")) continue;
      for (const n of this.adj.get(p.uid) ?? []) {
        const q = this.parts.find((x) => x.uid === n && x.alive);
        if (q && q.def.decoupler && q.def.nodes.some((nn) => nn.type === "stack") && Math.abs(q.lx - p.lx) < 0.6) {
          set.add(p.uid);
          break;
        }
      }
    }
    return set;
  }

  // What the next Space press will do (mirrors doStage), for the HUD.
  nextStageLabel(): string | null {
    let target: PartInstance | null = null;
    for (const p of this.parts) {
      if (!p.alive || !p.def.decoupler || p.deployed) continue;
      if (!target || p.ly < target.ly) target = p;
    }
    if (target) {
      const root = this.commandUid();
      const dropped = new Set<string>();
      if (root) {
        for (const n of this.adj.get(target.uid) ?? []) {
          const comp = this.componentFrom(root, new Set([edgeKey(target.uid, n)]));
          if (!comp.has(n)) for (const x of this.componentFrom(n, new Set([edgeKey(target.uid, n)]))) dropped.add(x);
        }
      }
      const names = [...new Set([...dropped].map((u) => this.parts.find((p) => p.uid === u)?.def.name).filter(Boolean))];
      return names.length ? `Drop ${names.slice(0, 2).join(", ")}${names.length > 2 ? "…" : ""}` : "Separate stage";
    }
    if (this.parts.some((p) => p.alive && (p.def.parachute || p.def.landingLeg) && !p.deployed)) {
      return "Deploy chutes/legs";
    }
    return null;
  }
}

function edgeKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

// Build the player's vessel from a saved design.
export function assembleVessel(design: Design): Vessel {
  const parts: PartInstance[] = design.parts.map((pp) => {
    const def = getPart(pp.defId);
    return {
      uid: pp.uid,
      def,
      lx: pp.x,
      ly: pp.y,
      flip: pp.flip,
      fuel: def.fuel ?? 0,
      ignited: false,
      deployed: false,
      hp: PART_HP,
      alive: true,
      flame: 0,
    };
  });

  // adjacency comes from explicit parent links recorded by the builder
  const adj = new Map<string, Set<string>>();
  const strength = new Map<string, number>();
  const byUid = new Map(parts.map((p) => [p.uid, p]));
  for (const p of parts) adj.set(p.uid, new Set());

  for (const pp of design.parts) {
    if (!pp.parentUid) continue;
    const a = byUid.get(pp.uid);
    const b = byUid.get(pp.parentUid);
    if (!a || !b) continue;
    adj.get(a.uid)!.add(b.uid);
    adj.get(b.uid)!.add(a.uid);
    const sm = Math.min(a.def.strengthMul ?? 1, b.def.strengthMul ?? 1);
    const width = (a.def.width + b.def.width) / 2;
    strength.set(edgeKey(a.uid, b.uid), BASE_STRENGTH * width * sm);
  }

  return new Vessel(parts, adj, strength);
}
