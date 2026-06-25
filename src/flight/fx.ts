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

  crash(pos: Vec2, speed: number, destroyedParts: number) {
    this.onCrash?.(speed, destroyedParts);
    const severity = Math.min(4, Math.max(1, speed / 18));
    const sparks = Math.round(18 + severity * 16 + destroyedParts * 6);
    for (let i = 0; i < sparks; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.4;
      const sp = (60 + Math.random() * 180) * severity;
      this.push({
        pos,
        vel: V.fromAngle(a, sp),
        life: 0.25 + Math.random() * 0.35,
        size: 2 + Math.random() * 4,
        color: Math.random() < 0.65 ? 0xffd24a : 0xfff2c8,
        glow: true,
        grow: -5,
      });
    }
    for (let i = 0; i < 10 + severity * 6; i++) {
      const a = Math.random() * Math.PI * 2;
      this.push({
        pos,
        vel: V.fromAngle(a, 10 + Math.random() * 55),
        life: 1 + Math.random() * 1.2,
        size: 8 + Math.random() * 14,
        color: Math.random() < 0.5 ? 0x6b6256 : 0x8a8175,
        grow: 18,
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
        color: palette[(Math.random() * palette.length) | 0],
        glow: true, grow: -2,
      });
    }
  }

  // bright muzzle flash: a short cone of sparks along `dir`
  flash(pos: Vec2, dir: Vec2, color: number) {
    for (let i = 0; i < 7; i++) {
      const d = V.rot(dir, (Math.random() - 0.5) * 0.7);
      this.push({
        pos, vel: V.scale(d, 120 + Math.random() * 160),
        life: 0.12 + Math.random() * 0.12,
        size: 4 + Math.random() * 5,
        color: Math.random() < 0.4 ? 0xfff2c8 : color,
        glow: true,
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
