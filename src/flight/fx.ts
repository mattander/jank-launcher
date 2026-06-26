import { Graphics } from "pixi.js";
import { Vec2, V } from "../types";
import { Camera } from "../camera";
import { Fx } from "./vessel";

interface Particle {
  pos: Vec2;
  vel: Vec2;
  life: number;
  maxLife: number;
  size: number;
  color: number;
  ring: boolean;
  glow: boolean; // hot particles get a soft halo
  grow: number; // size growth per second (smoke billows, embers shrink)
}

const MAX_PARTICLES = 2400;
const FIRE_COLORS = [0xfff2c8, 0xffd24a, 0xff8a3d, 0xc84b31];
const SMOKE_COLORS = [0x4f4840, 0x6b6256, 0x8a8175];

function pickColor(colors: number[]): number {
  return colors[Math.floor(Math.random() * colors.length)] ?? colors[0] ?? 0xffffff;
}

export class Particles implements Fx {
  parts: Particle[] = [];
  onBoom?: (size: number) => void; // optional audio hook
  onCrash?: (speed: number, destroyedParts: number) => void;

  private push(p: Partial<Particle> & Pick<Particle, "pos" | "vel" | "life" | "size" | "color">) {
    this.parts.push({
      maxLife: p.life,
      ring: false,
      glow: false,
      grow: 0,
      ...p,
      pos: { ...p.pos },
      vel: { ...p.vel },
    });
  }

  explosion(pos: Vec2, size: number) {
    this.onBoom?.(size);
    const n = Math.round(10 + size * 10);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (40 + Math.random() * 120) * size;
      this.push({
        pos, vel: V.fromAngle(a, sp),
        life: 0.4 + Math.random() * 0.5,
        size: (4 + Math.random() * 8) * size,
        color: Math.random() < 0.5 ? 0xff8a3d : 0xc84b31,
        glow: true, grow: -6,
      });
    }
    // smoke
    for (let i = 0; i < n / 2; i++) {
      const a = Math.random() * Math.PI * 2;
      this.push({
        pos, vel: V.fromAngle(a, 20 * size),
        life: 0.8 + Math.random() * 0.8,
        size: (5 + Math.random() * 8) * size,
        color: 0x6b6256, grow: 14,
      });
    }
    this.push({ pos, vel: { x: 0, y: 0 }, life: 0.35, size: size * 8, color: 0xfff2c8, ring: true });
  }

  crash(pos: Vec2, speed: number, destroyedParts: number, normal: Vec2 = { x: 0, y: 1 }, impactVel: Vec2 = { x: 0, y: -1 }) {
    this.onCrash?.(speed, destroyedParts);
    const severity = Math.min(8, Math.max(1.4, speed / 11 + destroyedParts * 0.35));
    const tangent = { x: -normal.y, y: normal.x };
    const incoming = V.len(impactVel) > 0.1 ? V.norm(impactVel) : V.scale(normal, -1);
    const blastCore = Math.min(7.5, 2 + severity * 0.55);
    this.explosion(pos, blastCore);
    this.push({ pos, vel: { x: 0, y: 0 }, life: 0.5, size: 28 + severity * 14, color: 0xfff2c8, ring: true });
    this.push({ pos, vel: { x: 0, y: 0 }, life: 0.75, size: 42 + severity * 22, color: 0xff8a3d, ring: true });

    const sparks = Math.round(48 + severity * 22 + destroyedParts * 12);
    for (let i = 0; i < sparks; i++) {
      const alongSurface = V.scale(tangent, (Math.random() - 0.5) * (180 + severity * 80));
      const upward = V.scale(normal, 60 + Math.random() * (130 + severity * 55));
      const backwash = V.scale(incoming, -(20 + Math.random() * 80));
      const vel = V.add(V.add(alongSurface, upward), backwash);
      this.push({
        pos,
        vel,
        life: 0.35 + Math.random() * 0.55,
        size: 3 + Math.random() * (4 + severity * 0.5),
        color: pickColor(FIRE_COLORS),
        glow: true,
        grow: -7,
      });
    }

    const smoke = Math.round(28 + severity * 12 + destroyedParts * 5);
    for (let i = 0; i < smoke; i++) {
      const alongSurface = V.scale(tangent, (Math.random() - 0.5) * (40 + severity * 24));
      const billow = V.scale(normal, 15 + Math.random() * (55 + severity * 18));
      const drift = V.scale(incoming, -(8 + Math.random() * 30));
      this.push({
        pos,
        vel: V.add(V.add(alongSurface, billow), drift),
        life: 1.1 + Math.random() * 1.8,
        size: 12 + Math.random() * (18 + severity * 3),
        color: pickColor(SMOKE_COLORS),
        grow: 20 + severity * 3,
      });
    }

    const chunks = Math.round(8 + destroyedParts * 4 + severity * 2);
    for (let i = 0; i < chunks; i++) {
      const spray = V.rot(normal, (Math.random() - 0.5) * Math.PI * 1.7);
      this.push({
        pos,
        vel: V.add(V.scale(spray, 70 + Math.random() * (120 + severity * 45)), V.scale(tangent, (Math.random() - 0.5) * 120)),
        life: 0.8 + Math.random() * 1.1,
        size: 5 + Math.random() * 9,
        color: Math.random() < 0.5 ? 0x554b3a : 0xb9b2a0,
        grow: -2,
      });
    }
  }

  // celebratory multi-colour burst (fireworks)
  fireworks(pos: Vec2, size: number) {
    const palette = [0xff5b5b, 0xffd24a, 0x5bd1ff, 0x7bff7b, 0xff7bf0, 0xfff2c8];
    const n = Math.round(28 + size * 14);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.2;
      const sp = (120 + Math.random() * 160) * size;
      this.push({
        pos, vel: V.fromAngle(a, sp),
        life: 0.7 + Math.random() * 0.7,
        size: 3 + Math.random() * 4,
        color: pickColor(palette),
        glow: true, grow: -2,
      });
    }
  }

  // bright muzzle flash: a short cone of sparks along `dir`
  flash(pos: Vec2, dir: Vec2, color: number) {
    this.push({
      pos,
      vel: V.scale(dir, 24),
      life: 0.1,
      size: 15,
      color: 0xfff2c8,
      ring: true,
      glow: true,
      grow: 28,
    });
    for (let i = 0; i < 12; i++) {
      const d = V.rot(dir, (Math.random() - 0.5) * 0.7);
      this.push({
        pos, vel: V.scale(d, 120 + Math.random() * 160),
        life: 0.14 + Math.random() * 0.16,
        size: 4 + Math.random() * 7,
        color: Math.random() < 0.4 ? 0xfff2c8 : color,
        glow: true,
        grow: -8,
      });
    }
  }

  impact(pos: Vec2, normal: Vec2, strength: number) {
    const severity = Math.max(0.4, Math.min(3.5, strength));
    const tangent = { x: -normal.y, y: normal.x };
    this.push({ pos, vel: { x: 0, y: 0 }, life: 0.22, size: 8 + severity * 6, color: 0xfff2c8, ring: true });
    for (let i = 0; i < 10 + severity * 10; i++) {
      const alongSurface = V.scale(tangent, (Math.random() - 0.5) * (90 + severity * 60));
      const away = V.scale(normal, 30 + Math.random() * (80 + severity * 35));
      this.push({
        pos,
        vel: V.add(alongSurface, away),
        life: 0.2 + Math.random() * 0.35,
        size: 2.2 + Math.random() * (3.5 + severity),
        color: pickColor(FIRE_COLORS),
        glow: true,
        grow: -5,
      });
    }
  }

  puff(pos: Vec2, vel: Vec2, color: number) {
    this.push({ pos, vel, life: 0.3 + Math.random() * 0.4, size: 3 + Math.random() * 5, color });
  }

  // lingering smoke for exhaust contrails
  smoke(pos: Vec2, vel: Vec2) {
    this.push({
      pos, vel,
      life: 0.7 + Math.random() * 0.8,
      size: 3 + Math.random() * 4,
      color: 0x8a8175,
      grow: 12,
    });
  }

  // hot glowing bit (exhaust sparks, re-entry plasma)
  ember(pos: Vec2, vel: Vec2, color: number, size = 3) {
    this.push({ pos, vel, life: 0.25 + Math.random() * 0.35, size, color, glow: true, grow: -4 });
  }

  update(dt: number) {
    for (const p of this.parts) {
      p.life -= dt;
      p.pos = V.add(p.pos, V.scale(p.vel, dt));
      p.vel = V.scale(p.vel, 1 - Math.min(1, dt * 1.5));
      if (p.ring) p.size += dt * 400;
      else p.size = Math.max(0.5, p.size + p.grow * dt);
    }
    this.parts = this.parts.filter((p) => p.life > 0);
    if (this.parts.length > MAX_PARTICLES) this.parts.splice(0, this.parts.length - MAX_PARTICLES);
  }

  draw(g: Graphics, cam: Camera) {
    const k = cam.zoom / 12;
    for (const p of this.parts) {
      const s = cam.worldToScreen(p.pos);
      const alpha = Math.max(0, p.life / p.maxLife);
      const r = p.size * k;
      if (p.ring) {
        g.circle(s.x, s.y, r);
        g.stroke({ color: p.color, width: 2, alpha: alpha * 0.8 });
        continue;
      }
      if (p.glow) {
        g.circle(s.x, s.y, Math.max(1, r * 2));
        g.fill({ color: p.color, alpha: alpha * 0.25 });
      }
      g.circle(s.x, s.y, Math.max(0.5, r));
      g.fill({ color: p.color, alpha });
    }
  }
}
