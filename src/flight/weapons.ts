import { Vec2, V } from "../types";
import { World } from "./world";
import { Vessel, Fx, PartInstance } from "./vessel";
import { WeaponSpec } from "../parts/catalog";

export interface Projectile {
  pos: Vec2;
  vel: Vec2;
  life: number;
  damage: number;
  kind: "cannon" | "missile";
  ownerId: number;
  alive: boolean;
  festive?: boolean; // bursts into a harmless firework
  // aim point stored relative to a body so it converges on the cursor on-screen
  // even as everything moves at orbital speed; detonates on arrival.
  targetRel?: Vec2;
  targetBody?: string;
}

const BLAST: Record<Projectile["kind"], number> = { cannon: 130, missile: 300 };

export interface Target {
  pos: Vec2;
  vel: Vec2;
  radius: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  kind: "asteroid" | "blimp";
  bob: number;
}

export interface Beam {
  a: Vec2;
  b: Vec2;
  life: number;
  maxLife: number;
  hit: boolean;
  frameBodyId: string;
}

export interface Ufo {
  pos: Vec2;
  wvel: Vec2; // wander velocity relative to the home body
  home: Vec2; // home offset from Terra
  radius: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  wob: number;
  seed: number;
  fireCd: number;
  flash: number; // hit flash 0..1
}

export interface Bolt {
  pos: Vec2;
  vel: Vec2;
  life: number;
  damage: number;
  alive: boolean;
}

type Hit =
  | { kind: "target"; target?: Target; point: Vec2 }
  | { kind: "ufo"; ufo: Ufo; point: Vec2 }
  | { kind: "vessel"; vessel: Vessel; part: PartInstance; point: Vec2 };

const SCORE: Record<Target["kind"] | "ufo", number> = { asteroid: 100, blimp: 60, ufo: 300 };

export class Combat {
  projectiles: Projectile[] = [];
  targets: Target[] = [];
  beams: Beam[] = [];
  ufos: Ufo[] = [];
  bolts: Bolt[] = []; // enemy fire
  onScore?: (points: number, pos: Vec2) => void;

  spawnSport(world: World) {
    const terra = world.get("terra");
    // asteroids drifting just outside the atmosphere
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2 + 0.3;
      const r = terra.radius + terra.atmoHeight + 30000 + Math.random() * 80000;
      const pos = V.add(terra.pos, V.fromAngle(ang, r));
      // roughly circular-ish orbit velocity, tangential
      const speed = Math.sqrt(terra.GM / r) * (0.7 + Math.random() * 0.3);
      const tang = { x: -Math.sin(ang), y: Math.cos(ang) };
      this.targets.push({
        pos,
        vel: V.add(terra.vel, V.scale(tang, speed)),
        radius: 400 + Math.random() * 900,
        hp: 120,
        maxHp: 120,
        alive: true,
        kind: "asteroid",
        bob: Math.random() * 10,
      });
    }
    // blimps bobbing in the lower atmosphere near the launch site
    for (let i = 0; i < 5; i++) {
      const ang = Math.PI / 2 + (i - 2) * 0.05;
      const r = terra.radius + 6000 + i * 3000;
      this.targets.push({
        pos: V.add(terra.pos, V.fromAngle(ang, r)),
        vel: { x: 0, y: 0 },
        radius: 300,
        hp: 50,
        maxHp: 50,
        alive: true,
        kind: "blimp",
        bob: Math.random() * Math.PI * 2,
      });
    }
    // roaming UFOs to dogfight, scattered around Terra
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2 + 0.9;
      const r = terra.radius + 20000 + Math.random() * 120000;
      const off = V.fromAngle(ang, r);
      this.ufos.push({
        pos: V.add(terra.pos, off),
        wvel: { x: 0, y: 0 },
        home: off,
        radius: 140,
        hp: 70,
        maxHp: 70,
        alive: true,
        wob: Math.random() * 10,
        seed: Math.random() * 6,
        fireCd: 2 + Math.random() * 3,
        flash: 0,
      });
    }
  }

  // Fire a ballistic weapon. `origin` is the muzzle world position, `dir` is a
  // unit aim direction, and `aim` is a range endpoint along that direction.
  fire(origin: Vec2, dir: Vec2, spec: WeaponSpec, ownerVel: Vec2, ownerId: number, fx: Fx, aim: Vec2, world: World) {
    const aimBody = world.dominantBody(aim);
    const targetRel = V.sub(aim, aimBody.pos);
    const cannon = spec.kind === "cannon";
    this.projectiles.push({
      pos: { ...origin },
      vel: V.add(ownerVel, V.scale(dir, cannon ? spec.speed : spec.speed * 0.5)),
      life: cannon ? Math.max(0.8, spec.range / spec.speed) : Math.max(4, spec.range / 480),
      damage: spec.damage,
      kind: cannon ? "cannon" : "missile",
      ownerId,
      alive: true,
      festive: spec.festive,
      targetRel,
      targetBody: aimBody.id,
    });
    fx.puff(origin, V.scale(dir, cannon ? 60 : 30), cannon ? 0xffd27f : 0xff8a3d);
  }

  // Continuous laser: instant ray, drawn and applied immediately so the beam is
  // in sync with rendering. Called once per frame per laser while firing.
  fireLaser(origin: Vec2, dir: Vec2, spec: WeaponSpec, ownerId: number, fx: Fx, world: World, vessels: Vessel[], aim: Vec2) {
    // the beam reaches the cursor (or the first thing it hits before then)
    const range = Math.min(spec.range, Math.max(60, V.len(V.sub(aim, origin))));
    const hit = this.rayHit(origin, dir, range, world, vessels, ownerId);
    const end = hit ? hit.point : V.add(origin, V.scale(dir, range));
    const frameBody = world.dominantBody(origin);
    this.beams.push({ a: { ...origin }, b: end, life: 0.07, maxLife: 0.07, hit: !!hit, frameBodyId: frameBody.id });
    if (hit) {
      this.applyDamage(hit, spec.damage * 0.05, fx);
      fx.impact?.(hit.point, V.scale(dir, -1), 0.9);
      if (Math.random() < 0.18) fx.explosion(hit.point, 0.45);
    }
  }

  update(dt: number, world: World, vessels: Vessel[], fx: Fx) {
    // Laser beams are visual afterimages. Keep them in the local body frame so
    // they do not smear backward at orbital speed while the camera follows the craft.
    for (const b of this.beams) {
      const frameBody = world.get(b.frameBodyId);
      const drift = V.scale(frameBody.vel, dt);
      b.a = V.add(b.a, drift);
      b.b = V.add(b.b, drift);
      b.life -= dt;
    }
    this.beams = this.beams.filter((b) => b.life > 0);

    // targets drift / bob
    for (const t of this.targets) {
      if (!t.alive) continue;
      t.bob += dt;
      if (t.kind === "asteroid") {
        const b = world.dominantBody(t.pos);
        const g = V.add(world.gravityAt(t.pos, b), world.bodyFrameAccel(b));
        t.vel = V.add(t.vel, V.scale(g, dt));
      }
      t.pos = V.add(t.pos, V.scale(t.vel, dt));
      if (t.kind === "blimp") {
        t.pos = V.add(t.pos, { x: Math.sin(t.bob) * 6 * dt, y: Math.cos(t.bob * 0.7) * 4 * dt });
      }
    }
    this.targets = this.targets.filter((t) => t.alive);

    // UFOs: wander near Terra (co-moving) and pot-shot the player
    const terra = world.get("terra");
    const player = vessels.find((v) => v.controllable);
    for (const u of this.ufos) {
      if (!u.alive) continue;
      u.wob += dt;
      u.flash = Math.max(0, u.flash - dt * 3);
      const homeWorld = V.add(terra.pos, u.home);
      let acc = V.scale(V.sub(homeWorld, u.pos), 0.02); // soft tether
      acc = V.add(acc, { x: Math.sin(u.wob * 1.7 + u.seed) * 16, y: Math.cos(u.wob * 1.1 + u.seed) * 16 });
      u.wvel = V.scale(V.add(u.wvel, V.scale(acc, dt)), 1 - dt * 0.4);
      const sp = V.len(u.wvel);
      if (sp > 150) u.wvel = V.scale(u.wvel, 150 / sp);
      u.pos = V.add(u.pos, V.scale(V.add(terra.vel, u.wvel), dt));
      u.fireCd -= dt;
      if (player && u.fireCd <= 0) {
        const d = V.sub(player.pos, u.pos);
        if (V.len(d) < 8000) {
          const dir = V.norm(d);
          this.bolts.push({
            pos: { ...u.pos },
            vel: V.add(V.add(terra.vel, u.wvel), V.scale(dir, 340)),
            life: 7,
            damage: 7,
            alive: true,
          });
          fx.flash?.(u.pos, dir, 0x9bff6b);
          u.fireCd = 2.4 + Math.random() * 2.6;
        } else {
          u.fireCd = 1;
        }
      }
    }
    this.ufos = this.ufos.filter((u) => u.alive);

    // enemy bolts: travel and damage the player on contact
    for (const b of this.bolts) {
      if (!b.alive) continue;
      b.life -= dt;
      if (b.life <= 0) { b.alive = false; continue; }
      const next = V.add(b.pos, V.scale(b.vel, dt));
      const body = world.dominantBody(next);
      if (V.len(V.sub(next, body.pos)) < body.radius) {
        fx.impact?.(next, V.norm(V.sub(next, body.pos)), 0.8);
        fx.explosion(next, 0.5);
        b.alive = false;
        continue;
      }
      let hit = false;
      for (const v of vessels) {
        for (const p of v.aliveParts()) {
          if (V.len(V.sub(next, v.partWorld(p))) < Math.max(p.def.width, p.def.height) * 0.6) {
            v.damagePart(p, b.damage, fx);
            fx.impact?.(next, V.norm(V.sub(next, v.partWorld(p))), 1);
            fx.explosion(next, 0.7);
            b.alive = false;
            hit = true;
            break;
          }
        }
        if (hit) break;
      }
      if (!hit) b.pos = next;
    }
    this.bolts = this.bolts.filter((b) => b.alive);

    // projectiles
    for (const pr of this.projectiles) {
      if (!pr.alive) continue;
      pr.life -= dt;
      if (pr.life <= 0) {
        pr.alive = false;
        continue;
      }
      const pbody = world.dominantBody(pr.pos);
      if (pr.kind === "cannon") {
        // ballistic: gravity + the body's frame accel so it arcs correctly in
        // the planet's frame (co-moving), like a real lobbed shell
        pr.vel = V.add(pr.vel, V.scale(V.add(world.gravityAt(pr.pos, pbody), world.bodyFrameAccel(pbody)), dt));
      } else {
        // missile: guided rocket. Thrust hard toward the target so it flies
        // there regardless of gravity (steered relative to the planet).
        let desired: Vec2;
        if (pr.targetRel && pr.targetBody) {
          const tb = world.get(pr.targetBody);
          desired = V.norm(V.sub(V.add(tb.pos, pr.targetRel), pr.pos));
        } else {
          desired = V.norm(V.sub(pr.vel, pbody.vel));
        }
        pr.vel = V.add(pr.vel, V.scale(desired, 420 * dt));
        // cap speed relative to the planet so it stays controllable
        const vRel = V.sub(pr.vel, pbody.vel);
        const sp = V.len(vRel);
        if (sp > 480) pr.vel = V.add(pbody.vel, V.scale(vRel, 480 / sp));
        if (Math.random() < 0.7) fx.puff(pr.pos, V.scale(desired, -45), 0xff8a3d);
      }
      const step = V.scale(pr.vel, dt);
      const next = V.add(pr.pos, step);

      // terrain hit
      const body = world.dominantBody(next);
      if (V.len(V.sub(next, body.pos)) < body.radius) {
        this.detonate(pr, next, fx, vessels);
        continue;
      }
      // direct hit on a target or UFO
      let consumed = false;
      for (const t of this.targets) {
        if (t.alive && V.len(V.sub(next, t.pos)) < t.radius) {
          this.detonate(pr, next, fx, vessels);
          consumed = true;
          break;
        }
      }
      if (consumed) continue;
      for (const u of this.ufos) {
        if (u.alive && V.len(V.sub(next, u.pos)) < u.radius) {
          this.detonate(pr, next, fx, vessels);
          consumed = true;
          break;
        }
      }
      if (consumed) continue;
      // direct hit on another vessel
      for (const v of vessels) {
        if (v.id === pr.ownerId) continue;
        for (const p of v.aliveParts()) {
          const r = Math.max(p.def.width, p.def.height) * 0.6;
          if (V.len(V.sub(next, v.partWorld(p))) < r) {
            this.detonate(pr, next, fx, vessels);
            consumed = true;
            break;
          }
        }
        if (consumed) break;
      }
      if (consumed) continue;

      // reached the aim point? airburst there.
      if (pr.targetRel && pr.targetBody) {
        const tb = world.get(pr.targetBody);
        const target = V.add(tb.pos, pr.targetRel);
        const toTarget = V.sub(target, next);
        const vRel = V.sub(pr.vel, tb.vel);
        // arrived (close) or passed the target plane along travel direction
        if (V.len(toTarget) < 25 || (toTarget.x * vRel.x + toTarget.y * vRel.y) < 0) {
          this.detonate(pr, next, fx, vessels);
          continue;
        }
      }
      pr.pos = next;
    }
    this.projectiles = this.projectiles.filter((p) => p.alive);
  }

  // Explode at `at`: visual blast + area damage to nearby targets and vessels.
  private detonate(pr: Projectile, at: Vec2, fx: Fx, vessels: Vessel[]) {
    pr.alive = false;
    if (pr.festive) {
      fx.fireworks(at, 1 + Math.random());
      return; // celebration only — no real blast
    }
    const blast = BLAST[pr.kind];
    fx.impact?.(at, V.norm(V.scale(pr.vel, -1)), pr.kind === "missile" ? 2.2 : 1.4);
    fx.explosion(at, pr.kind === "missile" ? 2.2 : 1.4);
    for (const t of this.targets) {
      if (t.alive && V.len(V.sub(at, t.pos)) < blast + t.radius) this.hurtTarget(t, pr.damage, fx);
    }
    for (const u of this.ufos) {
      if (u.alive && V.len(V.sub(at, u.pos)) < blast + u.radius) this.hurtUfo(u, pr.damage, fx);
    }
    for (const v of vessels) {
      if (v.id === pr.ownerId) continue;
      for (const p of v.aliveParts()) {
        const d = V.len(V.sub(at, v.partWorld(p)));
        if (d < blast) v.damagePart(p, pr.damage * (1 - d / blast), fx);
      }
    }
  }

  private hurtUfo(u: Ufo, dmg: number, fx: Fx) {
    if (!u.alive) return;
    u.hp -= dmg;
    u.flash = 1;
    if (u.hp <= 0) {
      u.alive = false;
      fx.explosion(u.pos, 2.4);
      fx.fireworks(u.pos, 1.2);
      this.onScore?.(SCORE.ufo, u.pos);
    }
  }

  private hurtTarget(t: Target, dmg: number, fx: Fx) {
    t.hp -= dmg;
    if (t.hp <= 0) {
      t.alive = false;
      fx.explosion(t.pos, Math.min(4, t.radius / 250));
      this.onScore?.(SCORE[t.kind], t.pos);
      // chunk into smaller asteroids occasionally
      if (t.kind === "asteroid" && t.radius > 600) {
        for (let i = 0; i < 2; i++) {
          this.targets.push({
            pos: V.add(t.pos, { x: (Math.random() - 0.5) * t.radius, y: (Math.random() - 0.5) * t.radius }),
            vel: V.add(t.vel, { x: (Math.random() - 0.5) * 200, y: (Math.random() - 0.5) * 200 }),
            radius: t.radius * 0.5,
            hp: 60,
            maxHp: 60,
            alive: true,
            kind: "asteroid",
            bob: 0,
          });
        }
      }
    }
  }

  private applyDamage(
    hit: Hit,
    dmg: number,
    fx: Fx,
  ) {
    if (hit.kind === "target" && hit.target) this.hurtTarget(hit.target, dmg, fx);
    if (hit.kind === "ufo" && hit.ufo) this.hurtUfo(hit.ufo, dmg, fx);
    if (hit.kind === "vessel" && hit.vessel && hit.part) hit.vessel.damagePart(hit.part, dmg, fx);
  }

  // Simple ray march to find the first thing hit (for lasers).
  private rayHit(origin: Vec2, dir: Vec2, range: number, world: World, vessels: Vessel[], ownerId: number): Hit | null {
    const steps = 60;
    const dl = range / steps;
    for (let i = 1; i <= steps; i++) {
      const point = V.add(origin, V.scale(dir, dl * i));
      const body = world.dominantBody(point);
      if (V.len(V.sub(point, body.pos)) < body.radius) {
        return { kind: "target", point }; // terrain: treated as a hit (no damage object)
      }
      for (const t of this.targets) {
        if (t.alive && V.len(V.sub(point, t.pos)) < t.radius)
          return { kind: "target", target: t, point };
      }
      for (const u of this.ufos) {
        if (u.alive && V.len(V.sub(point, u.pos)) < u.radius)
          return { kind: "ufo", ufo: u, point };
      }
      for (const v of vessels) {
        if (v.id === ownerId) continue;
        for (const p of v.aliveParts()) {
          const w = v.partWorld(p);
          const r = Math.max(p.def.width, p.def.height) * 0.6;
          if (V.len(V.sub(point, w)) < r) return { kind: "vessel", vessel: v, part: p, point };
        }
      }
    }
    return null;
  }
}
