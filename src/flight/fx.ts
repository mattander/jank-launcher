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
}

export class Particles implements Fx {
  parts: Particle[] = [];
  onBoom?: (size: number) => void; // optional audio hook

  explosion(pos: Vec2, size: number) {
    this.onBoom?.(size);
    const n = Math.round(10 + size * 10);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (40 + Math.random() * 120) * size;
      this.parts.push({
        pos: { ...pos },
        vel: V.fromAngle(a, sp),
        life: 0.4 + Math.random() * 0.5,
        maxLife: 0.9,
        size: (4 + Math.random() * 8) * size,
        color: Math.random() < 0.5 ? 0xff8a3d : 0xc84b31,
        ring: false,
      });
    }
    // shockwave ring
    this.parts.push({
      pos: { ...pos },
      vel: { x: 0, y: 0 },
      life: 0.35,
      maxLife: 0.35,
      size: size * 8,
      color: 0xfff2c8,
      ring: true,
    });
  }

  puff(pos: Vec2, vel: Vec2, color: number) {
    this.parts.push({
      pos: { ...pos },
      vel: { ...vel },
      life: 0.3 + Math.random() * 0.4,
      maxLife: 0.7,
      size: 3 + Math.random() * 5,
      color,
      ring: false,
    });
  }

  update(dt: number) {
    for (const p of this.parts) {
      p.life -= dt;
      p.pos = V.add(p.pos, V.scale(p.vel, dt));
      p.vel = V.scale(p.vel, 1 - Math.min(1, dt * 1.5));
      if (p.ring) p.size += dt * 400;
    }
    this.parts = this.parts.filter((p) => p.life > 0);
    if (this.parts.length > 1200) this.parts.splice(0, this.parts.length - 1200);
  }

  draw(g: Graphics, cam: Camera) {
    for (const p of this.parts) {
      const s = cam.worldToScreen(p.pos);
      const alpha = Math.max(0, p.life / p.maxLife);
      const r = p.size * (cam.zoom / 12);
      if (p.ring) {
        g.circle(s.x, s.y, r);
        g.stroke({ color: p.color, width: 2, alpha: alpha * 0.8 });
      } else {
        g.circle(s.x, s.y, Math.max(0.5, r));
        g.fill({ color: p.color, alpha });
      }
    }
  }
}
