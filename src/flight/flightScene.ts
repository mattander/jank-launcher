import { Application, Container, Graphics } from "pixi.js";
import { Camera, REF_PPM } from "../camera";
import { Vec2, V } from "../types";
import { Design } from "../build/design";
import { drawPart, WeaponSpec } from "../parts/catalog";
import { World, Body } from "./world";
import { Vessel, assembleVessel, VesselInput } from "./vessel";
import { Combat } from "./weapons";
import { Particles } from "./fx";
import { sketchCircle } from "../sketch";
import { GameAudio } from "../audio";

const WEAPON_KINDS: WeaponSpec["kind"][] = ["cannon", "laser", "missile"];

export class FlightScene {
  app: Application;
  layer = new Container();
  private gSky = new Graphics();
  private gBodies = new Graphics();
  private vesselsLayer = new Container();
  private gTraj = new Graphics();
  private gProj = new Graphics();
  private gParticles = new Graphics();
  private gAim = new Graphics();
  private gMap = new Graphics();
  private partSprites = new Map<string, Graphics>();

  cam = new Camera();
  world = new World();
  combat = new Combat();
  fx = new Particles();
  audio = new GameAudio();
  vessels: Vessel[] = [];
  player: Vessel | null = null;
  onExit: () => void;

  private keys = new Set<string>();
  private throttle = 0;
  private rcs = false;
  private stageEdge = false;
  private firing = false;
  private aimScreen: Vec2 = { x: 0, y: 0 };
  private weaponGroup = 0;
  private mapMode = false;
  private warp = 1;
  private fireCooldown = new Map<string, number>();
  private clock = 0;
  private shake = 0;
  private milestones = new Set<string>();
  private lastBodyId = "terra";

  private hudEl!: HTMLDivElement;
  private toastEl!: HTMLDivElement;
  private helpEl!: HTMLDivElement;

  constructor(app: Application, onExit: () => void) {
    this.app = app;
    this.onExit = onExit;
    this.layer.addChild(this.gSky, this.gBodies, this.gTraj, this.gParticles, this.vesselsLayer, this.gProj, this.gAim, this.gMap);
    this.cam.zoom = 8;
    this.buildDom();
    this.bindEvents();
    if (import.meta.env.DEV) (window as unknown as { __flight: FlightScene }).__flight = this;
  }

  // ---------------- lifecycle ----------------
  start(design: Design) {
    this.vessels = [];
    this.partSprites.forEach((s) => s.destroy());
    this.partSprites.clear();
    this.combat = new Combat();
    this.fx = new Particles();
    this.fx.onBoom = (size) => {
      this.audio.explosion(size);
      this.shake = Math.min(16, this.shake + size * 3);
    };
    this.milestones.clear();
    this.world = new World();
    this.clock = 0;
    this.warp = 1;
    this.throttle = 0;
    this.weaponGroup = 0;

    const v = assembleVessel(design);
    this.player = v;
    this.vessels.push(v);
    this.combat.spawnSport(this.world);

    // place on Terra's surface, pointing up (away from center)
    const terra = this.world.get("terra");
    let lowest = 0;
    for (const p of v.parts) lowest = Math.min(lowest, p.ly - p.def.height / 2);
    v.angle = 0;
    v.pos = { x: terra.pos.x, y: terra.pos.y + terra.radius - lowest + 0.2 };
    v.vel = { ...terra.vel };
    v.angVel = 0;
    this.cam.center = { ...v.pos };
    this.cam.zoom = 10;
    this.lastBodyId = "terra";
    this.toast("🚀 Cleared for launch. Throttle up with W!");
  }

  show() {
    this.layer.visible = true;
    this.setDomVisible(true);
    this.resize();
  }

  hide() {
    this.layer.visible = false;
    this.setDomVisible(false);
    this.keys.clear();
    this.firing = false;
    this.audio.setThrust(0);
    this.audio.setLaser(false);
  }

  resize() {
    // app.screen is the LOGICAL (CSS-pixel) size; renderer.width is physical
    // (resolution-scaled). The stage and mouse coords are logical, so the camera
    // must use logical size or everything mis-centers on HiDPI/Retina displays.
    this.cam.resize(this.app.screen.width, this.app.screen.height);
  }

  // ---------------- input ----------------
  private bindEvents() {
    window.addEventListener("keydown", (e) => this.onKey(e, true));
    window.addEventListener("keyup", (e) => this.onKey(e, false));
    const c = this.app.canvas;
    c.addEventListener("pointermove", (e) => {
      const rect = c.getBoundingClientRect();
      this.aimScreen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    });
    c.addEventListener("pointerdown", (e) => {
      this.audio.resume();
      if (e.button === 0 && this.layer.visible && !this.mapMode) this.firing = true;
    });
    window.addEventListener("pointerup", () => (this.firing = false));
    c.addEventListener("wheel", (e) => {
      if (!this.layer.visible) return;
      e.preventDefault();
      this.cam.zoom *= e.deltaY < 0 ? 1.15 : 1 / 1.15;
      this.cam.clampZoom(this.mapMode ? 1e-7 : 0.02, 60);
    }, { passive: false });
  }

  private onKey(e: KeyboardEvent, down: boolean) {
    if (!this.layer.visible) return;
    this.audio.resume();
    const k = e.key.toLowerCase();
    if (down) {
      if (k === "escape") return this.onExit();
      if (k === " ") { this.stageEdge = true; this.audio.stage(); e.preventDefault(); }
      if (k === "f") this.firing = true;
      if (k === "tab") { this.cycleWeapon(); e.preventDefault(); }
      if (k === "r") this.rcs = !this.rcs;
      if (k === "m") this.toggleMap();
      if (k === "n") this.toast(this.audio.toggleMute() ? "🔇 Muted" : "🔊 Sound on");
      if (k === ",") this.warp = Math.max(1, this.warp / 2);
      if (k === ".") this.warp = Math.min(64, this.warp * 2);
    } else {
      if (k === "f") this.firing = false;
    }
    if (down) this.keys.add(k);
    else this.keys.delete(k);
  }

  private cycleWeapon() {
    const kinds = this.availableWeaponKinds();
    if (kinds.length === 0) return;
    this.weaponGroup = (this.weaponGroup + 1) % kinds.length;
    this.toast(`Weapon: ${kinds[this.weaponGroup].toUpperCase()}`);
  }

  private availableWeaponKinds(): WeaponSpec["kind"][] {
    if (!this.player) return [];
    const present = new Set<WeaponSpec["kind"]>();
    for (const p of this.player.aliveParts()) if (p.def.weapon) present.add(p.def.weapon.kind);
    return WEAPON_KINDS.filter((k) => present.has(k));
  }

  private toggleMap() {
    this.mapMode = !this.mapMode;
    if (this.mapMode) {
      this.cam.center = { ...this.world.get("sun").pos };
      this.cam.zoom = (this.app.renderer.height * 0.4) / 2.3e10;
    } else {
      if (this.player) this.cam.center = { ...this.player.pos };
      this.cam.zoom = 8;
    }
  }

  // ---------------- update ----------------
  update(frameDt: number) {
    if (!this.layer.visible || !this.player) return;
    // throttle from held keys
    if (this.keys.has("w")) this.throttle = Math.min(1, this.throttle + frameDt * 0.8);
    if (this.keys.has("s")) this.throttle = Math.max(0, this.throttle - frameDt * 0.8);
    if (this.keys.has("shift")) this.throttle = 1;
    if (this.keys.has("control")) this.throttle = 0;
    const rotate = (this.keys.has("a") ? 1 : 0) - (this.keys.has("d") ? 1 : 0);

    // physics substepping (also drives time warp)
    const subDt = 1 / 120;
    const total = frameDt * this.warp;
    const steps = Math.min(240, Math.max(1, Math.ceil(total / subDt)));
    const dt = total / steps;

    for (let i = 0; i < steps; i++) {
      this.clock += dt;
      this.world.update(dt);
      const newDebris: Vessel[] = [];
      for (const v of this.vessels) {
        const input: VesselInput | null =
          v === this.player
            ? { rotate, throttleTarget: this.throttle, rcs: this.rcs, stage: this.stageEdge && i === 0 }
            : null;
        const spawned = v.update(dt, this.world, input, this.fx);
        newDebris.push(...spawned);
      }
      this.vessels.push(...newDebris);
      this.combat.update(dt, this.world, this.vessels, this.fx);
      this.fx.update(dt);
    }
    this.stageEdge = false;

    // weapons firing (mouse/F), respects per-part cooldown
    if (this.firing && !this.mapMode) this.fireWeapons();

    // continuous audio: engine rumble + laser tone
    const kinds = this.availableWeaponKinds();
    const activeKind = kinds.length ? kinds[this.weaponGroup % kinds.length] : null;
    let thrustLevel = this.player.liquidFuel > 0 ? this.throttle : 0;
    if (this.player.srbsLit && this.player.aliveParts().some((p) => p.def.solid && p.fuel > 0))
      thrustLevel = Math.max(thrustLevel, 0.8);
    this.audio.setThrust(thrustLevel);
    this.audio.setLaser(this.firing && !this.mapMode && activeKind === "laser");

    // cull dead/empty vessels (keep player even if sad)
    this.vessels = this.vessels.filter((v) => v === this.player || v.aliveParts().length > 0);
    if (this.player.aliveParts().length === 0) {
      this.toastOnce("rip", "💀 Your craft is gone. Esc to head back to the hangar.");
    }

    // camera follow — hard-follow the craft. The whole world moves at orbital
    // speed (~8.8 km/s), so smoothing on absolute position can't keep up and the
    // craft flies off-screen; track it exactly instead.
    if (!this.mapMode) this.cam.center = { ...this.player.pos };
    this.shake *= Math.exp(-frameDt * 7); // decay screen shake

    this.checkMilestones();
    this.render();
    this.updateHud();
  }

  private fireWeapons() {
    if (!this.player) return;
    const kinds = this.availableWeaponKinds();
    if (kinds.length === 0) return;
    const kind = kinds[this.weaponGroup % kinds.length];
    const aim = this.cam.screenToWorld(this.aimScreen);
    for (const p of this.player.aliveParts()) {
      const spec = p.def.weapon;
      if (!spec || spec.kind !== kind) continue;
      // lasers are continuous beams; ballistic weapons respect their fire rate
      if (spec.kind !== "laser") {
        const last = this.fireCooldown.get(p.uid) ?? -999;
        if (this.clock - last < 1 / spec.rate) continue;
        this.fireCooldown.set(p.uid, this.clock);
      }
      const origin = this.player.partWorld(p);
      const dir = V.norm(V.sub(aim, origin));
      if (spec.kind === "laser") {
        this.combat.fireLaser(origin, dir, spec, this.player.id, this.fx, this.world, this.vessels, aim);
      } else {
        this.combat.fire(origin, dir, spec, this.player.vel, this.player.id, this.fx, aim, this.world);
        this.fx.flash(origin, dir, spec.kind === "cannon" ? 0xffd27f : 0xff8a3d);
        if (spec.kind === "cannon") { this.audio.cannon(); this.shake = Math.min(16, this.shake + 1.4); }
        else { this.audio.missile(); this.shake = Math.min(16, this.shake + 2.2); }
      }
    }
  }

  // ---------------- milestones ----------------
  private checkMilestones() {
    if (!this.player) return;
    const body = this.world.dominantBody(this.player.pos);
    const alt = this.world.altitudeAbove(this.player.pos, body);

    if (body.id !== this.lastBodyId) {
      this.lastBodyId = body.id;
      this.toast(`🪐 Entered ${body.name}'s sphere of influence`);
    }
    if (alt > 150) this.toastOnce("liftoff", "🔥 Liftoff!");
    if (body.atmoHeight > 0 && alt > body.atmoHeight)
      this.toastOnce(`space-${body.id}`, `✨ Reached space above ${body.name}`);

    const orb = orbit(this.player.pos, this.player.vel, body);
    if (orb.bound && orb.peri - body.radius > Math.max(body.atmoHeight, body.radius * 0.02)) {
      this.toastOnce(`orbit-${body.id}`, `🛰 Orbit achieved around ${body.name}!`);
    }
    if (this.player.landed && body.id !== "terra") {
      this.toastOnce(`land-${body.id}`, `🏁 Touchdown on ${body.name}! Nicely done.`);
    }
    if (this.player.landed && body.id === "terra" && this.clock > 20) {
      this.toastOnce("home", "🏠 Back on solid ground.");
    }
  }

  // ---------------- rendering ----------------
  render() {
    if (this.mapMode) {
      this.renderMap();
      this.gSky.clear();
      this.gBodies.clear();
      this.gProj.clear();
      this.gParticles.clear();
      this.gAim.clear();
      this.gTraj.clear();
      this.hideAllSprites();
      this.layer.position.set(0, 0);
      return;
    }
    // screen shake offset (world layers only; HUD is DOM and stays put)
    if (this.shake > 0.1) {
      this.layer.position.set((Math.random() - 0.5) * this.shake * 2, (Math.random() - 0.5) * this.shake * 2);
    } else {
      this.layer.position.set(0, 0);
    }
    this.gMap.clear();
    this.drawSky();
    this.drawBodies();
    this.drawTrajectory(this.gTraj, 0.4);
    this.drawVessels();
    this.drawProjectiles();
    this.gParticles.clear();
    this.fx.draw(this.gParticles, this.cam);
    this.drawAim();
  }

  private drawSky() {
    const g = this.gSky;
    g.clear();
    g.rect(0, 0, this.cam.screenW, this.cam.screenH);
    // tint by altitude: low = sky blue, high = space dark
    const body = this.player ? this.world.dominantBody(this.player.pos) : this.world.get("terra");
    const alt = this.player ? this.world.altitudeAbove(this.player.pos, body) : 0;
    const atmo = body.atmoHeight || 1;
    const t = Math.max(0, Math.min(1, alt / atmo));
    const col = lerpColor(0x9ec7e0, 0x0d1020, t);
    g.fill({ color: col });
    // stars when high
    if (t > 0.4) {
      let s = 1234;
      for (let i = 0; i < 120; i++) {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        const x = (s % this.cam.screenW);
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        const y = (s % this.cam.screenH);
        g.circle(x, y, 1.2);
      }
      g.fill({ color: 0xfff2c8, alpha: (t - 0.4) * 1.6 });
    }
  }

  private drawBodies() {
    const g = this.gBodies;
    g.clear();
    for (const b of this.world.bodies) {
      const s = this.cam.worldToScreen(b.pos);
      const r = b.radius * this.cam.zoom;
      if (r < 0.5) continue;
      // Use fixed-segment polygons, NOT g.circle(): Pixi tessellates a circle
      // with more segments the larger the radius, and a planet's on-screen radius
      // can be millions of px — rebuilding that every frame drops us to <1 fps.
      if (b.atmoHeight > 0) {
        g.poly(circlePoints(s.x, s.y, (b.radius + b.atmoHeight) * this.cam.zoom));
        g.fill({ color: b.atmoColor, alpha: 0.25 });
      }
      g.poly(circlePoints(s.x, s.y, r));
      g.fill({ color: b.color });
      g.stroke({ color: 0x2a2118, width: 2, alpha: 0.5 });
    }
    // floating targets
    const W = this.cam.screenW;
    const H = this.cam.screenH;
    for (const t of this.combat.targets) {
      const s = this.cam.worldToScreen(t.pos);
      const r = t.radius * this.cam.zoom;
      if (r < 1) continue;
      if (s.x + r < 0 || s.x - r > W || s.y + r < 0 || s.y - r > H) continue; // off-screen
      sketchCircle(g, s.x, s.y, r, {
        fill: t.kind === "asteroid" ? 0x8a7b63 : 0xc84b31,
        stroke: 0x2a2118,
        lineWidth: 2,
        seed: Math.round(t.bob * 10) + 1,
        jitter: Math.min(6, r * 0.1),
      });
    }
  }

  private hideAllSprites() {
    this.partSprites.forEach((s) => (s.visible = false));
  }

  private drawVessels() {
    const used = new Set<string>();
    for (const v of this.vessels) {
      for (const p of v.aliveParts()) {
        let sp = this.partSprites.get(p.uid);
        if (!sp) {
          sp = new Graphics();
          drawPart(sp, p.def, REF_PPM);
          this.vesselsLayer.addChild(sp);
          this.partSprites.set(p.uid, sp);
        }
        const w = v.partWorld(p);
        const s = this.cam.worldToScreen(w);
        sp.position.set(s.x, s.y);
        sp.rotation = -v.angle;
        const k = this.cam.zoom / REF_PPM;
        sp.scale.set(p.flip ? -k : k, k);
        sp.visible = true;
        used.add(p.uid);
      }
    }
    for (const [uid, sp] of this.partSprites) {
      if (!used.has(uid)) {
        sp.destroy();
        this.partSprites.delete(uid);
      }
    }
  }

  private drawProjectiles() {
    const g = this.gProj;
    g.clear();
    for (const pr of this.combat.projectiles) {
      const s = this.cam.worldToScreen(pr.pos);
      // tracer drawn from velocity relative to the planet so it points the way
      // the shot actually travels on screen (not along the orbital velocity)
      const body = this.world.dominantBody(pr.pos);
      const vRel = V.sub(pr.vel, body.vel);
      const dir = V.norm(vRel);
      const tailLen = pr.kind === "missile" ? 22 : 16;
      const head = pr.kind === "missile" ? 4 : 3;
      const tail = { x: s.x - dir.x * tailLen, y: s.y - dir.y * tailLen };
      g.moveTo(tail.x, tail.y);
      g.lineTo(s.x, s.y);
      g.stroke({ color: pr.kind === "missile" ? 0xff8a3d : 0xffd27f, width: head, cap: "round" });
      // bright head so it's always visible regardless of speed/orientation
      g.circle(s.x, s.y, head);
      g.fill({ color: pr.kind === "missile" ? 0xffd27f : 0xfff2c8 });
    }
    for (const b of this.combat.beams) {
      const a = this.cam.worldToScreen(b.a);
      const e = this.cam.worldToScreen(b.b);
      g.moveTo(a.x, a.y);
      g.lineTo(e.x, e.y);
      g.stroke({ color: 0xff3b3b, width: 3, alpha: Math.min(1, b.life / 0.1) });
      g.moveTo(a.x, a.y);
      g.lineTo(e.x, e.y);
      g.stroke({ color: 0xffd2d2, width: 1, alpha: Math.min(1, b.life / 0.1) });
    }
  }

  // Draw the predicted Keplerian path of the player relative to the dominant body.
  private drawTrajectory(g: Graphics, alpha: number, clear = true) {
    if (clear) g.clear();
    if (!this.player) return;
    const body = this.world.dominantBody(this.player.pos);
    const path = conicPath(this.player.pos, this.player.vel, body);
    if (!path) return;

    // draw as segments, skipping any part below the surface
    let drawing = false;
    for (let i = 0; i < path.pts.length; i++) {
      const p = path.pts[i];
      const above = V.len(V.sub(p, body.pos)) >= body.radius * 0.999;
      const s = this.cam.worldToScreen(p);
      if (above) {
        if (!drawing) { g.moveTo(s.x, s.y); drawing = true; }
        else g.lineTo(s.x, s.y);
      } else {
        drawing = false;
      }
    }
    g.stroke({ color: 0x9ec7e0, width: 2, alpha });

    const mark = (pt: Vec2 | null, color: number) => {
      if (!pt) return;
      const s = this.cam.worldToScreen(pt);
      g.circle(s.x, s.y, 4);
      g.fill({ color, alpha: Math.min(1, alpha + 0.5) });
    };
    mark(path.apo, 0x7fb6e0); // apoapsis
    mark(path.peri, 0xd98a3d); // periapsis
  }

  private drawAim() {
    const g = this.gAim;
    g.clear();
    if (!this.player) return;
    const kinds = this.availableWeaponKinds();
    if (kinds.length === 0) return; // only show aim when armed
    const kind = kinds[this.weaponGroup % kinds.length];
    const color =
      kind === "laser" ? 0xc84b31 : kind === "missile" ? 0x3a7d8c : 0xd98a3d;

    const from = this.cam.worldToScreen(this.player.pos);
    const to = this.aimScreen;

    // dotted line from craft to cursor
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const dash = 9;
    const gap = 7;
    for (let d = 18; d < len - 22; d += dash + gap) {
      const x0 = from.x + ux * d;
      const y0 = from.y + uy * d;
      const x1 = from.x + ux * Math.min(d + dash, len - 22);
      const y1 = from.y + uy * Math.min(d + dash, len - 22);
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
    }
    g.stroke({ color, width: 2, alpha: 0.5 });

    // reticle at the cursor (pulses while firing)
    const firing = this.firing;
    const r = firing ? 16 + Math.sin(this.clock * 30) * 1.5 : 13;
    if (firing) {
      g.poly(circlePoints(to.x, to.y, r + 4, 20));
      g.stroke({ color, width: 2, alpha: 0.35 });
    }
    g.poly(circlePoints(to.x, to.y, r, 20));
    g.stroke({ color, width: firing ? 3 : 2, alpha: 0.95 });
    const tick = 6;
    for (const [tx, ty] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      g.moveTo(to.x + tx * (r - tick), to.y + ty * (r - tick));
      g.lineTo(to.x + tx * (r + tick), to.y + ty * (r + tick));
    }
    g.stroke({ color, width: 2, alpha: 0.9 });
    g.circle(to.x, to.y, 1.5);
    g.fill({ color });
  }

  private renderMap() {
    const g = this.gMap;
    g.clear();
    g.rect(0, 0, this.cam.screenW, this.cam.screenH);
    g.fill({ color: 0x0d1020 });
    for (const b of this.world.bodies) {
      const s = this.cam.worldToScreen(b.pos);
      // orbit path
      if (b.parent) {
        const p = this.world.get(b.parent);
        const ps = this.cam.worldToScreen(p.pos);
        g.poly(circlePoints(ps.x, ps.y, b.orbitR * this.cam.zoom, 96));
        g.stroke({ color: 0x445, width: 1, alpha: 0.7 });
      }
      const r = Math.max(3, b.radius * this.cam.zoom);
      g.poly(circlePoints(s.x, s.y, r));
      g.fill({ color: b.color });
    }
    // predicted trajectory (drawn into the same map graphics)
    this.drawTrajectory(g, 0.85, false);
    // player marker
    if (this.player) {
      const s = this.cam.worldToScreen(this.player.pos);
      g.circle(s.x, s.y, 5);
      g.fill({ color: 0xffffff });
      g.circle(s.x, s.y, 9);
      g.stroke({ color: 0xffffff, width: 1.5, alpha: 0.8 });
    }
  }

  // ---------------- HUD / DOM ----------------
  private buildDom() {
    this.hudEl = mkPanel();
    this.hudEl.style.left = "12px";
    this.hudEl.style.bottom = "12px";
    this.hudEl.style.minWidth = "240px";
    document.body.appendChild(this.hudEl);

    this.helpEl = mkPanel();
    this.helpEl.style.right = "12px";
    this.helpEl.style.bottom = "12px";
    this.helpEl.style.fontSize = "12px";
    this.helpEl.style.maxWidth = "220px";
    this.helpEl.innerHTML =
      "<b>A/D</b> rotate · <b>W/S</b> throttle<br><b>Shift/Ctrl</b> full/cut<br>" +
      "<b>Space</b> stage · <b>R</b> RCS<br><b>Mouse</b> aim · <b>Click/F</b> fire<br>" +
      "<b>Tab</b> weapon · <b>M</b> map<br><b>,/.</b> warp · <b>N</b> mute · <b>Esc</b> hangar";
    document.body.appendChild(this.helpEl);

    this.toastEl = document.createElement("div");
    this.toastEl.style.position = "absolute";
    this.toastEl.style.top = "16px";
    this.toastEl.style.left = "50%";
    this.toastEl.style.transform = "translateX(-50%)";
    this.toastEl.style.display = "flex";
    this.toastEl.style.flexDirection = "column";
    this.toastEl.style.gap = "6px";
    this.toastEl.style.alignItems = "center";
    this.toastEl.style.pointerEvents = "none";
    document.body.appendChild(this.toastEl);
  }

  private setDomVisible(v: boolean) {
    const d = v ? "block" : "none";
    this.hudEl.style.display = d;
    this.helpEl.style.display = d;
    this.toastEl.style.display = v ? "flex" : "none";
  }

  private updateHud() {
    if (!this.player) return;
    const body = this.world.dominantBody(this.player.pos);
    const alt = this.world.altitudeAbove(this.player.pos, body);
    const relV = V.len(V.sub(this.player.vel, body.vel));
    const orb = orbit(this.player.pos, this.player.vel, body);
    const fuelPct = this.player.liquidFuelMax > 0
      ? (this.player.liquidFuel / this.player.liquidFuelMax) * 100
      : 0;
    const kinds = this.availableWeaponKinds();
    const weapon = kinds.length ? kinds[this.weaponGroup % kinds.length].toUpperCase() : "—";
    const apo = orb.bound && isFinite(orb.apo) ? fmt(orb.apo - body.radius) : "—";
    const peri = isFinite(orb.peri) ? fmt(orb.peri - body.radius) : "—";
    const nextStage = this.player.nextStageLabel();
    this.hudEl.innerHTML = `
      <h3>🛰 ${body.name}</h3>
      <div>Altitude: <b>${fmt(alt)}</b></div>
      <div>Speed: <b>${relV.toFixed(0)} m/s</b></div>
      <div>Apo/Peri: <b>${apo}</b> / <b>${peri}</b></div>
      <div>Throttle: <b>${(this.throttle * 100).toFixed(0)}%</b> · Fuel: <b>${fuelPct.toFixed(0)}%</b></div>
      <div>Weapon: <b>${weapon}</b> · RCS: <b>${this.rcs ? "on" : "off"}</b> · Warp: <b>${this.warp}×</b></div>
      <div>Stage ⎵: <b>${nextStage ? escapeHtmlF(nextStage) : "—"}</b></div>
    `;
  }

  private toastOnce(key: string, msg: string) {
    if (this.milestones.has(key)) return;
    this.milestones.add(key);
    this.toast(msg);
  }

  private toast(msg: string) {
    const el = mkPanel();
    el.style.fontSize = "15px";
    el.style.opacity = "1";
    el.style.transition = "opacity 0.6s, transform 0.6s";
    el.textContent = msg;
    this.toastEl.appendChild(el);
    setTimeout(() => {
      el.style.opacity = "0";
      el.style.transform = "translateY(-12px)";
    }, 2600);
    setTimeout(() => el.remove(), 3300);
  }
}

// ---------------- helpers ----------------
function escapeHtmlF(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
}

function fmt(m: number): string {
  const a = Math.abs(m);
  if (a >= 1e6) return (m / 1e6).toFixed(2) + " Mm";
  if (a >= 1000) return (m / 1000).toFixed(2) + " km";
  return m.toFixed(0) + " m";
}

// Fixed-segment circle as a flat point array. Bounded cost regardless of radius
// (a planet filling the screen needs only a few segments to look round).
function circlePoints(cx: number, cy: number, r: number, segs = 64): number[] {
  const pts: number[] = [];
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    pts.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  return pts;
}

function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

interface Orbit { apo: number; peri: number; ecc: number; bound: boolean; }

function orbit(pos: Vec2, vel: Vec2, body: Body): Orbit {
  const r = V.sub(pos, body.pos);
  const v = V.sub(vel, body.vel);
  const rl = V.len(r) || 1;
  const vl2 = V.len2(v);
  const GM = body.GM;
  const energy = vl2 / 2 - GM / rl;
  const h = r.x * v.y - r.y * v.x; // 2D specific angular momentum
  const ecc = Math.sqrt(Math.max(0, 1 + (2 * energy * h * h) / (GM * GM)));
  if (energy < 0) {
    const a = -GM / (2 * energy);
    return { apo: a * (1 + ecc), peri: a * (1 - ecc), ecc, bound: true };
  }
  const peri = (h * h) / GM / (1 + ecc);
  return { apo: Infinity, peri, ecc, bound: false };
}

// Sample the Keplerian conic (relative to `body`) into world-space points, plus
// apoapsis/periapsis markers. Returns null for degenerate/near-radial orbits.
function conicPath(pos: Vec2, vel: Vec2, body: Body): { pts: Vec2[]; apo: Vec2 | null; peri: Vec2 | null } | null {
  const r = V.sub(pos, body.pos);
  const v = V.sub(vel, body.vel);
  const rl = V.len(r) || 1;
  const GM = body.GM;
  const h = r.x * v.y - r.y * v.x;
  if (Math.abs(h) < 1) return null; // radial / degenerate
  const energy = V.len2(v) / 2 - GM / rl;
  const p = (h * h) / GM; // semi-latus rectum
  // eccentricity vector
  const rv = r.x * v.x + r.y * v.y;
  const c = V.len2(v) - GM / rl;
  const ex = (c * r.x - rv * v.x) / GM;
  const ey = (c * r.y - rv * v.y) / GM;
  const ecc = Math.hypot(ex, ey);
  const omega = Math.atan2(ey, ex); // argument of periapsis
  const point = (theta: number): Vec2 => {
    const rr = p / (1 + ecc * Math.cos(theta));
    return { x: body.pos.x + rr * Math.cos(omega + theta), y: body.pos.y + rr * Math.sin(omega + theta) };
  };

  const pts: Vec2[] = [];
  const N = 160;
  if (energy < 0 && ecc < 1) {
    for (let i = 0; i <= N; i++) pts.push(point((i / N) * Math.PI * 2));
    const peri = point(0);
    const apo = point(Math.PI);
    return { pts, apo: V.len(V.sub(apo, body.pos)) < body.soi ? apo : null, peri };
  }
  // hyperbola/parabola: sweep the true-anomaly range that stays within the SOI
  const thetaMax = ecc > 1 ? Math.acos(Math.max(-0.999, -1 / ecc)) - 0.01 : Math.PI / 2;
  for (let i = -N; i <= N; i++) {
    const th = (i / N) * thetaMax;
    const pt = point(th);
    if (V.len(V.sub(pt, body.pos)) <= body.soi) pts.push(pt);
  }
  return { pts, apo: null, peri: point(0) };
}

function mkPanel(): HTMLDivElement {
  const d = document.createElement("div");
  d.className = "panel";
  d.style.position = "absolute";
  return d;
}
