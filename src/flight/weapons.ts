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
}

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
  hit: boolean;
}

export class Combat {
  projectiles: Projectile[] = [];
  targets: Target[] = [];
  beams: Beam[] = [];

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
  }

  // Fire one weapon. `origin` world pos, `dir` unit aim direction.
  fire(origin: Vec2, dir: Vec2, spec: WeaponSpec, ownerVel: Vec2, ownerId: number, fx: Fx) {
    if (spec.kind === "laser") {
      // resolved against the world in update() so it can damage what it touches
      this._pendingLaser.push({ origin, dir, spec, ownerId });
      return;
    }
    if (spec.kind === "cannon") {
      this.projectiles.push({
        pos: { ...origin },
        vel: V.add(ownerVel, V.scale(dir, spec.speed)),
        life: 6,
        damage: spec.damage,
        kind: "cannon",
        ownerId,
        alive: true,
      });
      fx.puff(origin, V.scale(dir, 60), 0xffd27f);
    } else {
      // missile: dumb-fire, accelerates along dir
      this.projectiles.push({
        pos: { ...origin },
        vel: V.add(ownerVel, V.scale(dir, spec.speed * 0.4)),
        life: 8,
        damage: spec.damage,
        kind: "missile",
        ownerId,
        alive: true,
      });
      fx.puff(origin, V.scale(dir, 30), 0xff8a3d);
    }
  }

  private _pendingLaser: { origin: Vec2; dir: Vec2; spec: WeaponSpec; ownerId: number }[] = [];

  update(dt: number, world: World, vessels: Vessel[], fx: Fx) {
    // resolve lasers (instant ray), then draw a beam to the contact point
    for (const l of this._pendingLaser) {
      const hit = this.rayHit(l.origin, l.dir, l.spec.range, world, vessels, l.ownerId);
      const end = hit ? hit.point : V.add(l.origin, V.scale(l.dir, l.spec.range));
      this.beams.push({ a: l.origin, b: end, life: 0.1, hit: !!hit });
      if (hit) {
        this.applyDamage(hit, l.spec.damage * dt * 12, fx);
        fx.explosion(hit.point, 0.5);
      }
    }
    this._pendingLaser = [];

    // beams fade
    for (const b of this.beams) b.life -= dt;
    this.beams = this.beams.filter((b) => b.life > 0);

    // targets drift / bob
    for (const t of this.targets) {
      if (!t.alive) continue;
      t.bob += dt;
      if (t.kind === "asteroid") {
        const g = world.gravityAt(t.pos);
        t.vel = V.add(t.vel, V.scale(g, dt));
      }
      t.pos = V.add(t.pos, V.scale(t.vel, dt));
      if (t.kind === "blimp") {
        t.pos = V.add(t.pos, { x: Math.sin(t.bob) * 6 * dt, y: Math.cos(t.bob * 0.7) * 4 * dt });
      }
    }
    this.targets = this.targets.filter((t) => t.alive);

    // projectiles
    for (const pr of this.projectiles) {
      if (!pr.alive) continue;
      pr.life -= dt;
      if (pr.life <= 0) {
        pr.alive = false;
        continue;
      }
      if (pr.kind === "cannon") {
        pr.vel = V.add(pr.vel, V.scale(world.gravityAt(pr.pos), dt));
      } else {
        // missile keeps accelerating along its facing
        const dir = V.norm(pr.vel);
        pr.vel = V.add(pr.vel, V.scale(dir, 120 * dt));
        if (Math.random() < 0.6) fx.puff(pr.pos, V.scale(dir, -20), 0xff8a3d);
      }
      const step = V.scale(pr.vel, dt);
      const next = V.add(pr.pos, step);

      // terrain hit
      const body = world.dominantBody(next);
      if (V.len(V.sub(next, body.pos)) < body.radius) {
        fx.explosion(next, pr.kind === "missile" ? 2 : 1.2);
        pr.alive = false;
        continue;
      }
      // target hit
      let consumed = false;
      for (const t of this.targets) {
        if (!t.alive) continue;
        if (V.len(V.sub(next, t.pos)) < t.radius) {
          this.hurtTarget(t, pr.damage, fx);
          fx.explosion(next, pr.kind === "missile" ? 2 : 1.2);
          pr.alive = false;
          consumed = true;
          break;
        }
      }
      if (consumed) continue;
      // vessel hit
      for (const v of vessels) {
        if (v.id === pr.ownerId) continue;
        for (const p of v.aliveParts()) {
          const w = v.partWorld(p);
          const r = Math.max(p.def.width, p.def.height) * 0.6;
          if (V.len(V.sub(next, w)) < r) {
            v.damagePart(p, pr.damage, fx);
            fx.explosion(next, pr.kind === "missile" ? 2 : 1.2);
            pr.alive = false;
            consumed = true;
            break;
          }
        }
        if (consumed) break;
      }
      if (consumed) continue;
      pr.pos = next;
    }
    this.projectiles = this.projectiles.filter((p) => p.alive);
  }

  private hurtTarget(t: Target, dmg: number, fx: Fx) {
    t.hp -= dmg;
    if (t.hp <= 0) {
      t.alive = false;
      fx.explosion(t.pos, Math.min(4, t.radius / 250));
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
    hit: { kind: "target" | "vessel"; target?: Target; vessel?: Vessel; part?: PartInstance; point: Vec2 },
    dmg: number,
    fx: Fx,
  ) {
    if (hit.kind === "target" && hit.target) this.hurtTarget(hit.target, dmg, fx);
    if (hit.kind === "vessel" && hit.vessel && hit.part) hit.vessel.damagePart(hit.part, dmg, fx);
  }

  // Simple ray march to find the first thing hit (for lasers).
  private rayHit(origin: Vec2, dir: Vec2, range: number, world: World, vessels: Vessel[], ownerId: number) {
    const steps = 60;
    const dl = range / steps;
    for (let i = 1; i <= steps; i++) {
      const point = V.add(origin, V.scale(dir, dl * i));
      const body = world.dominantBody(point);
      if (V.len(V.sub(point, body.pos)) < body.radius) {
        return { kind: "target" as const, point }; // terrain: treated as a hit (no damage object)
      }
      for (const t of this.targets) {
        if (t.alive && V.len(V.sub(point, t.pos)) < t.radius)
          return { kind: "target" as const, target: t, point };
      }
      for (const v of vessels) {
        if (v.id === ownerId) continue;
        for (const p of v.aliveParts()) {
          const w = v.partWorld(p);
          const r = Math.max(p.def.width, p.def.height) * 0.6;
          if (V.len(V.sub(point, w)) < r) return { kind: "vessel" as const, vessel: v, part: p, point };
        }
      }
    }
    return null;
  }
}
