import { Application, Container, Graphics } from "pixi.js";
import { Camera, REF_PPM } from "../camera";
import { Vec2, V } from "../types";
import { Design } from "../build/design";
import { drawPart, drawFairingShroud, WeaponSpec } from "../parts/catalog";
import { World } from "./world";
import { orbit, conicPath, orbitTiming } from "./orbit";
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
  private fairingSprites = new Map<string, Graphics>();

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
  private sas: "off" | "prograde" | "retrograde" | "hold" = "off";
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

  private gridEl!: HTMLDivElement;
  private navEl!: HTMLDivElement;
  private gaugesEl!: HTMLDivElement;
  private statusEl!: HTMLDivElement;
  private toastEl!: HTMLDivElement;
  private helpEl!: HTMLDivElement;
  private gNav = new Graphics();

  constructor(app: Application, onExit: () => void) {
    this.app = app;
    this.onExit = onExit;
    this.layer.addChild(this.gSky, this.gBodies, this.gTraj, this.gParticles, this.vesselsLayer, this.gProj, this.gAim, this.gNav, this.gMap);
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
    this.fairingSprites.forEach((s) => s.destroy());
    this.fairingSprites.clear();
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
    this.sas = "off";

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
      if (k === "t") this.cycleSas();
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

  private cycleSas() {
    const order = ["off", "prograde", "retrograde", "hold"] as const;
    this.sas = order[(order.indexOf(this.sas) + 1) % order.length];
    this.toast(`SAS: ${this.sas === "off" ? "off" : this.sas}`);
  }

  // Autopilot rotation input toward the held attitude, or null if SAS is off /
  // has nothing to point at. Manual A/D always overrides this.
  private sasRotate(): number | null {
    if (this.sas === "off" || !this.player) return null;
    const p = this.player;
    if (this.sas === "hold") {
      // kill rotation / hold current heading
      return clamp(-p.angVel * 4, -1, 1);
    }
    const body = this.world.dominantBody(p.pos);
    const vRel = V.sub(p.vel, body.vel);
    if (V.len(vRel) < 1) return null; // no prograde defined
    let dir = V.norm(vRel);
    if (this.sas === "retrograde") dir = V.scale(dir, -1);
    const desired = Math.atan2(-dir.x, dir.y); // angle whose upDir == dir
    let err = desired - p.angle;
    while (err > Math.PI) err -= Math.PI * 2;
    while (err < -Math.PI) err += Math.PI * 2;
    return clamp(err * 3 - p.angVel * 1.5, -1, 1); // PD controller
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
      // frame the craft's orbit around its dominant body so you can steer & watch it
      const body = this.player ? this.world.dominantBody(this.player.pos) : this.world.get("terra");
      const orb = this.player ? orbit(this.player.pos, this.player.vel, body) : null;
      const span = orb && orb.bound && isFinite(orb.apo)
        ? Math.max(orb.apo, body.radius * 2) * 2.4
        : body.radius * 6;
      this.cam.center = { ...body.pos };
      this.cam.zoom = (this.app.screen.height * 0.85) / span;
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
    let rotate = (this.keys.has("a") ? 1 : 0) - (this.keys.has("d") ? 1 : 0);
    if (rotate === 0) {
      const sasInput = this.sasRotate(); // SAS holds attitude when not steering by hand
      if (sasInput !== null) rotate = sasInput;
    }

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
    if (!this.mapMode) {
      this.cam.center = { ...this.player.pos };
    } else {
      // keep the orbit framed: follow the dominant body (it drifts through space)
      this.cam.center = { ...this.world.dominantBody(this.player.pos).pos };
    }
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
      this.gNav.clear();
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
    this.drawNavball();
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
    this.fairingSprites.forEach((s) => (s.visible = false));
  }

  private drawVessels() {
    const used = new Set<string>();
    const usedFairings = new Set<string>();
    const k = this.cam.zoom / REF_PPM;
    for (const v of this.vessels) {
      const fairings = v.fairingUids();
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
        sp.scale.set(p.flip ? -k : k, k);
        sp.visible = true;
        used.add(p.uid);

        if (fairings.has(p.uid)) {
          let fs = this.fairingSprites.get(p.uid);
          if (!fs) {
            fs = new Graphics();
            drawFairingShroud(fs, p.def, REF_PPM);
            this.vesselsLayer.addChild(fs);
            this.fairingSprites.set(p.uid, fs);
          }
          fs.position.set(s.x, s.y);
          fs.rotation = -v.angle;
          fs.scale.set(p.flip ? -k : k, k);
          fs.visible = true;
          usedFairings.add(p.uid);
        }
      }
    }
    for (const [uid, sp] of this.partSprites) {
      if (!used.has(uid)) {
        sp.destroy();
        this.partSprites.delete(uid);
      }
    }
    for (const [uid, fs] of this.fairingSprites) {
      if (!usedFairings.has(uid)) {
        fs.destroy();
        this.fairingSprites.delete(uid);
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
    // player marker: a triangle pointing the craft's heading, plus a prograde tick
    if (this.player) {
      const s = this.cam.worldToScreen(this.player.pos);
      const up = this.player.upDir(); // craft facing (world, y-up)
      const hx = up.x, hy = -up.y; // same direction in screen space (y-down)
      const px = -hy, py = hx; // perpendicular
      g.poly([
        s.x + hx * 12, s.y + hy * 12, // tip (heading)
        s.x - hx * 7 + px * 6, s.y - hy * 7 + py * 6,
        s.x - hx * 7 - px * 6, s.y - hy * 7 - py * 6,
      ]);
      g.fill({ color: 0xffffff });
      g.stroke({ color: 0x2a2118, width: 1.5 });
      // prograde marker (velocity relative to dominant body)
      const body = this.world.dominantBody(this.player.pos);
      const vRel = V.sub(this.player.vel, body.vel);
      if (V.len(vRel) > 1) {
        const d = V.norm(vRel);
        const pg = { x: s.x + d.x * 24, y: s.y - d.y * 24 };
        g.circle(pg.x, pg.y, 4);
        g.stroke({ color: 0xffd27f, width: 2 });
        g.circle(pg.x, pg.y, 1.2);
        g.fill({ color: 0xffd27f });
      }
    }
  }

  // ---------------- HUD / DOM ----------------
  // Full-screen CSS-grid overlay (like the builder): nav top-left, status
  // top-right, gauges bottom-left, help bottom-right, toasts top-centre, and a
  // Pixi navball drawn in the empty bottom-centre.
  private buildDom() {
    this.gridEl = document.createElement("div");
    Object.assign(this.gridEl.style, {
      position: "fixed",
      inset: "0",
      display: "grid",
      padding: "12px",
      gap: "10px",
      gridTemplateColumns: "auto 1fr auto",
      gridTemplateRows: "auto 1fr auto",
      gridTemplateAreas: `"nav toast status" "nav . status" "gauges . help"`,
      pointerEvents: "none",
    } satisfies Partial<CSSStyleDeclaration>);
    document.body.appendChild(this.gridEl);

    const inGrid = (el: HTMLDivElement, area: string, justify: string, align: string) => {
      el.style.gridArea = area;
      el.style.justifySelf = justify;
      el.style.alignSelf = align;
      el.style.pointerEvents = "auto";
      this.gridEl.appendChild(el);
    };

    this.navEl = mkPanel();
    this.navEl.style.minWidth = "190px";
    inGrid(this.navEl, "nav", "start", "start");

    this.statusEl = mkPanel();
    this.statusEl.style.minWidth = "150px";
    inGrid(this.statusEl, "status", "end", "start");

    this.gaugesEl = mkPanel();
    this.gaugesEl.style.width = "230px";
    inGrid(this.gaugesEl, "gauges", "start", "end");

    this.helpEl = mkPanel();
    this.helpEl.style.fontSize = "11px";
    this.helpEl.style.width = "270px";
    this.helpEl.style.lineHeight = "1.6";
    this.helpEl.innerHTML =
      "<b>A/D</b> rotate · <b>W/S</b> throttle · <b>Shift/Ctrl</b> full/cut · " +
      "<b>T</b> SAS · <b>Space</b> stage · <b>R</b> RCS · <b>Mouse</b> aim · <b>Click/F</b> fire · " +
      "<b>Tab</b> weapon · <b>M</b> map · <b>,/.</b> warp · <b>N</b> mute · <b>Esc</b> hangar";
    inGrid(this.helpEl, "help", "end", "end");

    this.toastEl = document.createElement("div");
    Object.assign(this.toastEl.style, {
      gridArea: "toast",
      justifySelf: "center",
      alignSelf: "start",
      display: "flex",
      flexDirection: "column",
      gap: "6px",
      alignItems: "center",
      pointerEvents: "none",
    } satisfies Partial<CSSStyleDeclaration>);
    this.gridEl.appendChild(this.toastEl);
  }

  private setDomVisible(v: boolean) {
    this.gridEl.style.display = v ? "grid" : "none";
  }

  private bar(label: string, pct: number, color: string): string {
    const w = Math.max(0, Math.min(100, pct));
    return `<div style="margin-top:4px">${label}
      <div style="height:10px;border:2px solid #2a2118;border-radius:5px;background:#e9dcbf;overflow:hidden;margin-top:2px">
        <div style="height:100%;width:${w}%;background:${color}"></div>
      </div></div>`;
  }

  private updateHud() {
    if (!this.player) return;
    const body = this.world.dominantBody(this.player.pos);
    const alt = this.world.altitudeAbove(this.player.pos, body);
    const relVel = V.sub(this.player.vel, body.vel);
    const speed = V.len(relVel);
    const up = V.norm(V.sub(this.player.pos, body.pos));
    const vSpeed = relVel.x * up.x + relVel.y * up.y; // +up / -down
    const orb = orbit(this.player.pos, this.player.vel, body);
    const fuelPct = this.player.liquidFuelMax > 0
      ? (this.player.liquidFuel / this.player.liquidFuelMax) * 100
      : 0;
    const apo = orb.bound && isFinite(orb.apo) ? fmt(orb.apo - body.radius) : "—";
    const peri = isFinite(orb.peri) ? fmt(orb.peri - body.radius) : "—";
    const t = orbitTiming(this.player.pos, this.player.vel, body);
    const tApo = t.toApo != null ? ` <span style="opacity:0.7">T-${fmtTime(t.toApo)}</span>` : "";
    const tPeri = t.toPeri != null ? ` <span style="opacity:0.7">T-${fmtTime(t.toPeri)}</span>` : "";

    this.navEl.innerHTML = `
      <h3>🛰 ${body.name}${this.player.landed ? " · landed" : ""}</h3>
      <div>Altitude: <b>${fmt(alt)}</b></div>
      <div>Speed: <b>${speed.toFixed(0)} m/s</b></div>
      <div>Vertical: <b>${vSpeed >= 0 ? "▲" : "▼"} ${Math.abs(vSpeed).toFixed(0)} m/s</b></div>
      <div>Apoapsis: <b>${apo}</b>${tApo}</div>
      <div>Periapsis: <b>${peri}</b>${tPeri}</div>`;

    // gauges (throttle + fuel bars, RCS, next stage)
    const nextStage = this.player.nextStageLabel();
    const fuelColor = fuelPct < 15 ? "#c84b31" : "#d98a3d";
    this.gaugesEl.innerHTML =
      this.bar(`Throttle <b>${Math.round(this.throttle * 100)}%</b>`, this.throttle * 100, "#c84b31") +
      this.bar(`Fuel <b>${Math.round(fuelPct)}%</b>`, fuelPct, fuelColor) +
      `<div style="margin-top:6px">RCS: <b>${this.rcs ? "on" : "off"}</b></div>` +
      `<div>Next stage ⎵: <b>${nextStage ? escapeHtmlF(nextStage) : "—"}</b></div>`;

    // status (warp + weapon group chips)
    const kinds = this.availableWeaponKinds();
    const chips = kinds.length
      ? kinds.map((k, i) => {
          const on = i === this.weaponGroup % kinds.length;
          return `<span data-wg="${i}" style="cursor:pointer;display:inline-block;margin:2px 3px 0 0;padding:2px 6px;border:2px solid #2a2118;border-radius:6px;background:${on ? "#3a7d8c" : "#e9dcbf"};color:${on ? "#fff7e6" : "#2a2118"}">${k}</span>`;
        }).join("")
      : "<span style='opacity:0.6'>none</span>";
    const sasModes: (typeof this.sas)[] = ["off", "prograde", "retrograde", "hold"];
    const sasLabel: Record<typeof this.sas, string> = {
      off: "off", prograde: "prograde", retrograde: "retrograde", hold: "hold",
    };
    const sasChips = sasModes
      .map((m) => {
        const on = m === this.sas;
        return `<span data-sas="${m}" style="cursor:pointer;display:inline-block;margin:2px 3px 0 0;padding:2px 6px;border:2px solid #2a2118;border-radius:6px;background:${on ? "#3a7d8c" : "#e9dcbf"};color:${on ? "#fff7e6" : "#2a2118"}">${sasLabel[m]}</span>`;
      })
      .join("");
    this.statusEl.innerHTML = `
      <h3>⚙ Status</h3>
      <div>Warp: <b>${this.warp}×</b></div>
      <div style="margin-top:4px">SAS (T):</div>
      <div>${sasChips}</div>
      <div style="margin-top:4px">Weapon (Tab):</div>
      <div>${chips}</div>`;
    // wire chip clicks
    this.statusEl.querySelectorAll<HTMLSpanElement>("span[data-wg]").forEach((el) => {
      el.onclick = () => { this.weaponGroup = Number(el.dataset.wg); };
    });
    this.statusEl.querySelectorAll<HTMLSpanElement>("span[data-sas]").forEach((el) => {
      el.onclick = () => { this.sas = el.dataset.sas as typeof this.sas; };
    });
  }

  // Compact attitude indicator: top of the ball is "up" (away from the body);
  // shows the craft heading and the prograde marker so you can fly a gravity turn.
  private drawNavball() {
    const g = this.gNav;
    g.clear();
    if (!this.player || this.mapMode) return;
    const cx = this.cam.screenW / 2;
    const cy = this.cam.screenH - 58;
    const R = 38;
    const body = this.world.dominantBody(this.player.pos);
    const up = V.norm(V.sub(this.player.pos, body.pos)); // radial out (world)
    const baseAng = Math.atan2(up.y, up.x);
    // ball: sky top, ground bottom
    g.poly(circlePoints(cx, cy, R));
    g.fill({ color: 0x7fb6e0 });
    g.stroke({ color: 0x2a2118, width: 2 });
    // ground half (toward the body = bottom of the ball)
    const ground: number[] = [cx - R, cy, cx + R, cy];
    for (let i = 0; i <= 16; i++) { const a = Math.PI * (i / 16); ground.push(cx + Math.cos(a) * R, cy + Math.sin(a) * R); }
    g.poly(ground);
    g.fill({ color: 0x5b8c4a, alpha: 0.9 });
    g.poly(circlePoints(cx, cy, R));
    g.stroke({ color: 0x2a2118, width: 2 });

    const marker = (worldDir: Vec2) => {
      const rel = Math.atan2(worldDir.y, worldDir.x) - baseAng;
      return { x: cx - Math.sin(rel) * R, y: cy - Math.cos(rel) * R };
    };
    // prograde
    const vRel = V.sub(this.player.vel, body.vel);
    if (V.len(vRel) > 1) {
      const m = marker(V.norm(vRel));
      g.circle(m.x, m.y, 4.5);
      g.stroke({ color: 0xd98a3d, width: 2.5 });
    }
    // craft heading arrow (from centre)
    const cf = this.player.upDir();
    const m = marker(cf);
    g.moveTo(cx, cy);
    g.lineTo(m.x, m.y);
    g.stroke({ color: 0xc84b31, width: 3, cap: "round" });
    g.circle(m.x, m.y, 3);
    g.fill({ color: 0xc84b31 });
    // centre hub
    g.circle(cx, cy, 2.5);
    g.fill({ color: 0x2a2118 });
  }

  private toastOnce(key: string, msg: string) {
    if (this.milestones.has(key)) return;
    this.milestones.add(key);
    this.toast(msg);
  }

  private toast(msg: string) {
    const el = mkPanel();
    el.style.position = "relative"; // flow inside the toast flex column
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

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function fmtTime(s: number): string {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m${String(sec).padStart(2, "0")}s`;
  return `${sec}s`;
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

function mkPanel(): HTMLDivElement {
  const d = document.createElement("div");
  d.className = "panel";
  d.style.position = "absolute";
  return d;
}
