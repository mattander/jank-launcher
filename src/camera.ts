import { Container } from "pixi.js";
import { Vec2 } from "./types";

// Reference pixels-per-meter at which all geometry is authored/drawn.
// Objects are drawn once at this scale, then containers are scaled by
// (zoom / REF_PPM) to display at the camera's current zoom.
export const REF_PPM = 12;

// World coords are y-up. Screen is y-down. Camera maps between them.
export class Camera {
  center: Vec2 = { x: 0, y: 0 }; // world position at screen center
  zoom = 8; // pixels per meter
  screenW = 800;
  screenH = 600;

  resize(w: number, h: number) {
    this.screenW = w;
    this.screenH = h;
  }

  worldToScreen(w: Vec2): Vec2 {
    return {
      x: (w.x - this.center.x) * this.zoom + this.screenW / 2,
      y: -(w.y - this.center.y) * this.zoom + this.screenH / 2,
    };
  }

  screenToWorld(s: Vec2): Vec2 {
    return {
      x: (s.x - this.screenW / 2) / this.zoom + this.center.x,
      y: -(s.y - this.screenH / 2) / this.zoom + this.center.y,
    };
  }

  // Position/scale a container that holds geometry authored at REF_PPM,
  // anchored at world position `pos` and rotated by world `angle` (CCW, rad).
  place(c: Container, pos: Vec2, angle = 0) {
    const s = this.worldToScreen(pos);
    c.position.set(s.x, s.y);
    c.rotation = -angle; // screen is y-flipped, so CCW world -> CW screen
    const k = this.zoom / REF_PPM;
    c.scale.set(k, k);
  }

  clampZoom(min: number, max: number) {
    this.zoom = Math.max(min, Math.min(max, this.zoom));
  }
}
