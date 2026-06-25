import { Application, Container, Graphics } from "pixi.js";
import { Camera, REF_PPM } from "../camera";
import { Vec2, V } from "../types";
import { Design } from "../build/design";
import { drawPart, drawFairingShroud, WeaponSpec } from "../parts/catalog";
import { Body, Landmark, World } from "./world";
import { orbit, conicPath, impactPreview, orbitTiming } from "./orbit";
import { Vessel, assembleVessel, VesselInput } from "./vessel";
import { Combat } from "./weapons";
import { Particles } from "./fx";
import { sketchCircle } from "../sketch";
import { GameAudio } from "../audio";
import { loadLog, saveLog, GameLog } from "../storage";

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
  onRestart: () => void;
  private currentDesign: Design | null = null;

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
  private score = 0;
  private combo = 1;
  private comboTimer = 0;
  private milestones = new Set<string>();
  private lastBodyId = "terra";
  private log: GameLog = loadLog();
  private wasLanded = false;
  private lastCrashToast = -999;
  private hudTimer = 1;

  private gridEl!: HTMLDivElement;
  private navEl!: HTMLDivElement;
  private gaugesEl!: HTMLDivElement;
  private statusEl!: HTMLDivElement;
  private toastEl!: HTMLDivElement;
  private helpEl!: HTMLDivElement;
  private mapBadgeEl!: HTMLDivElement;
  private gNav = new Graphics();
  private gFlame = new Graphics();
  private stars: Vec2[] = [];

  constructor(app: Application, onExit: () => void, onRestart: () => void) {
    this.app = app;
    this.onExit = onExit;
    this.onRestart = onRestart;
    this.layer.addChild(this.gSky, this.gBodies, this.gTraj, this.gParticles, this.gFlame, this.vesselsLayer, this.gProj, this.gAim, this.gNav, this.gMap);
    this.cam.zoom = 8;
    this.buildDom();
    this.bindEvents();
    if (import.meta.env.DEV) (window as unknown as { __flight: FlightScene }).__flight = this;
  }

  // ---------------- lifecycle ----------------
  start(design: Design) {
    this.currentDesign = cloneDesign(design);
    this.vessels = [];
    this.partSprites.forEach((s) => s.destroy());
    this.partSprites.clear();
    this.fairingSprites.forEach((s) => s.destroy());
    this.fairingSprites.clear();
    this.combat = new Combat();
    this.combat.onScore = (pts, pos) => this.addScore(pts, pos);
    this.fx = new Particles();
    this.fx.onBoom = (size) => {
      this.audio.explosion(size);
      this.shake = Math.min(16, this.shake + size * 3);
    };
    this.fx.onCrash = (speed, destroyedParts) => this.reportCrash(speed, destroyedParts);
    this.milestones.clear();
    this.world = new World();
    this.clock = 0;
    this.warp = 1;
    this.throttle = 0;
    this.weaponGroup = 0;
    this.sas = "off";
    this.score = 0;
    this.combo = 1;
    this.comboTimer = 0;
    this.wasLanded = false;
    this.lastCrashToast = -999;
    this.hudTimer = 1;

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

  restart() {
    if (!this.currentDesign) return;
    this.start(this.currentDesign);
    this.toast("↻ Launch restarted");
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
    this.rebuildStars();
  }

  // ---------------- input ----------------
  private bindEvents() {
    window.addEventListener("keydown", (e) => this.onKey(e, true));
    window.addEventListener("keyup", (e) => this.onKey(e, false));
    const c = this.app.canvas;
    c.addEventListener("pointermove", (e) => {
      this.aimScreen = this.canvasPoint(e);
    });
    c.addEventListener("pointerdown", (e) => {
      this.audio.resume();
      this.aimScreen = this.canvasPoint(e);
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

  private canvasPoint(e: PointerEvent): Vec2 {
    const rect = this.app.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private onKey(e: KeyboardEvent, down: boolean) {
    if (!this.layer.visible) return;
    this.audio.resume();
    const k = e.key.toLowerCase();
    if (down) {
      if (k === "escape") return this.onExit();
      if (k === "backspace") { this.onRestart(); e.preventDefault(); }
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

  private addScore(points: number, pos: Vec2) {
    this.combo = this.comboTimer > 0 ? Math.min(8, this.combo + 1) : 1;
    this.comboTimer = 3.5; // window to keep the combo going
    this.score += points * this.combo;
    this.shake = Math.min(16, this.shake + 1.5);
    if (this.combo >= 3) this.toast(`💥 ${this.combo}× combo!`);
    void pos;
  }

  private reportCrash(speed: number, destroyedParts: number) {
    if (this.clock - this.lastCrashToast < 1.2) return;
    this.lastCrashToast = this.clock;
    const flavor = speed > 55
      ? "catastrophic lithobraking"
      : speed > 30
        ? "enthusiastic terrain sample"
        : "unplanned structural audit";
    const parts = destroyedParts === 1 ? "1 part lost" : `${destroyedParts} parts lost`;
    this.toast(`💥 ${flavor}: ${speed.toFixed(0)} m/s, ${parts}`);
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
    this.mapBadgeEl.style.display = this.layer.visible && this.mapMode ? "block" : "none";
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
    if (this.comboTimer > 0) {
      this.comboTimer -= frameDt;
      if (this.comboTimer <= 0) this.combo = 1;
    }

    this.checkMilestones();
    this.checkDiscoveries();
    this.render();
    this.hudTimer += frameDt;
    if (this.hudTimer >= 1 / 12) {
      this.hudTimer = 0;
      this.updateHud();
    }
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
      const rangedAim = V.add(origin, V.scale(dir, spec.range));
      if (spec.kind === "laser") {
        this.combat.fireLaser(origin, dir, spec, this.player.id, this.fx, this.world, this.vessels, rangedAim);
      } else {
        this.combat.fire(origin, dir, spec, this.player.vel, this.player.id, this.fx, rangedAim, this.world);
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

    // plant a flag on a fresh touchdown (ignore the launch pad)
    if (this.player.landed && !this.wasLanded && !(body.id === "terra" && this.clock < 8)) {
      this.plantFlag(body);
    }
    this.wasLanded = this.player.landed;
  }

  private checkDiscoveries() {
    if (!this.player) return;
    const body = this.world.dominantBody(this.player.pos);
    if (body.id === "sun") return;
    const alt = this.world.altitudeAbove(this.player.pos, body);
    if (alt > Math.max(2600, body.radius * 0.02)) return;

    const craftAngle = Math.atan2(this.player.pos.y - body.pos.y, this.player.pos.x - body.pos.x);
    for (const landmark of this.world.landmarksFor(body.id)) {
      if (this.log.discoveries.includes(landmark.id)) continue;
      const arc = angularDistance(craftAngle, landmark.angle) * body.radius;
      if (arc > landmark.radius) continue;

      this.log.discoveries.push(landmark.id);
      saveLog(this.log);
      this.score += 250;

      const surface = this.world.landmarkPosition(landmark);
      const up = V.norm(V.sub(surface, body.pos));
      this.fx.fireworks(V.add(surface, V.scale(up, 28)), 1.2);
      this.toast(`🔎 ${landmark.name}: ${landmark.description}`);
    }
  }

  private plantFlag(body: { id: string; name: string; pos: Vec2 }) {
    const angle = Math.atan2(this.player!.pos.y - body.pos.y, this.player!.pos.x - body.pos.x);
    const near = this.log.flags.some(
      (f) => f.body === body.id && Math.abs(((f.angle - angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.03,
    );
    if (!near) this.log.flags.push({ body: body.id, angle });
    if (!this.log.visited.includes(body.id)) {
      this.log.visited.push(body.id);
      this.toast(`🚩 First landing on ${body.name}!`);
    } else if (!near) {
      this.toast(`🚩 Flag planted on ${body.name}`);
    }
    saveLog(this.log);
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
      this.gFlame.clear();
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
    this.drawFlames();
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
      if (this.stars.length === 0) this.rebuildStars();
      for (const star of this.stars) {
        g.circle(star.x, star.y, 1.2);
      }
      g.fill({ color: 0xfff2c8, alpha: (t - 0.4) * 1.6 });
    }
  }

  private rebuildStars() {
    this.stars = [];
    let seed = 1234;
    const count = 140;
    for (let i = 0; i < count; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const x = seed % Math.max(1, this.cam.screenW);
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const y = seed % Math.max(1, this.cam.screenH);
      this.stars.push({ x, y });
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
    // UFOs (flying saucers)
    for (const u of this.combat.ufos) {
      const s = this.cam.worldToScreen(u.pos);
      const rw = u.radius * this.cam.zoom;
      const r = Math.max(6, rw);
      if (s.x + r < 0 || s.x - r > W || s.y + r < 0 || s.y - r > H) continue;
      const bob = Math.sin(u.wob * 2) * r * 0.06;
      // saucer body (squashed) + dome
      g.ellipse(s.x, s.y + bob, r, r * 0.42);
      g.fill({ color: u.flash > 0 ? 0xfff2c8 : 0x9aa6b0 });
      g.stroke({ color: 0x2a2118, width: 2 });
      g.ellipse(s.x, s.y + bob - r * 0.22, r * 0.5, r * 0.32);
      g.fill({ color: 0x7fb6e0 });
      g.stroke({ color: 0x2a2118, width: 2 });
      // running lights
      for (let i = -1; i <= 1; i++) {
        g.circle(s.x + i * r * 0.55, s.y + bob + r * 0.12, Math.max(1, r * 0.08));
        g.fill({ color: i === 0 ? 0xff5b5b : 0xffd24a });
      }
    }

    // planted flags on the surface of the body we're near
    if (this.player) {
      const db = this.world.dominantBody(this.player.pos);
      this.drawLandmarks(g, db.id, W, H);
      const poleLen = 9 * this.cam.zoom; // 9 m pole
      if (poleLen >= 3) {
        for (const f of this.log.flags) {
          if (f.body !== db.id) continue;
          const up = { x: Math.cos(f.angle), y: Math.sin(f.angle) }; // radial out
          const base = this.cam.worldToScreen(V.add(db.pos, V.scale(up, db.radius)));
          if (base.x < -50 || base.x > W + 50 || base.y < -50 || base.y > H + 50) continue;
          const ups = { x: up.x, y: -up.y }; // screen radial-out
          const perp = { x: -ups.y, y: ups.x };
          const top = { x: base.x + ups.x * poleLen, y: base.y + ups.y * poleLen };
          g.moveTo(base.x, base.y);
          g.lineTo(top.x, top.y);
          g.stroke({ color: 0x2a2118, width: 2, cap: "round" });
          const fw = poleLen * 0.7;
          const fd = poleLen * 0.3;
          g.poly([
            top.x, top.y,
            top.x + perp.x * fw - ups.x * fd, top.y + perp.y * fw - ups.y * fd,
            top.x - ups.x * fd * 1.5, top.y - ups.y * fd * 1.5,
          ]);
          g.fill({ color: 0xc84b31 });
          g.stroke({ color: 0x2a2118, width: 1.5 });
        }
      }
    }
  }

  private drawLandmarks(g: Graphics, bodyId: string, screenW: number, screenH: number) {
    const body = this.world.get(bodyId);
    const screenScale = this.cam.zoom;
    if (screenScale < 0.05) return;

    for (const landmark of this.world.landmarksFor(bodyId)) {
      const discovered = this.log.discoveries.includes(landmark.id);
      const up = V.fromAngle(landmark.angle);
      const base = this.cam.worldToScreen(V.add(body.pos, V.scale(up, body.radius)));
      const ups = { x: up.x, y: -up.y };
      const perp = { x: -ups.y, y: ups.x };
      const h = Math.max(7, Math.min(40, landmark.radius * 0.18 * screenScale));
      const w = h * 0.9;
      if (base.x < -h || base.x > screenW + h || base.y < -h || base.y > screenH + h) continue;

      if (discovered) {
        this.drawDiscoveredLandmark(g, landmark, base, ups, perp, h, w);
      } else {
        this.drawMysteryLandmark(g, landmark, base, ups, perp, h, w);
      }
    }
  }

  private drawDiscoveredLandmark(
    g: Graphics,
    landmark: Landmark,
    base: Vec2,
    ups: Vec2,
    perp: Vec2,
    height: number,
    width: number,
  ) {
    g.poly([
      base.x + ups.x * height,
      base.y + ups.y * height,
      base.x + perp.x * width * 0.65,
      base.y + perp.y * width * 0.65,
      base.x - ups.x * height * 0.15,
      base.y - ups.y * height * 0.15,
      base.x - perp.x * width * 0.65,
      base.y - perp.y * width * 0.65,
    ]);
    g.fill({ color: landmark.color, alpha: 0.95 });
    g.stroke({ color: 0x2a2118, width: 2 });
    g.circle(base.x + ups.x * height * 0.45, base.y + ups.y * height * 0.45, Math.max(2, height * 0.18));
    g.fill({ color: landmark.accent, alpha: 0.95 });
  }

  private drawMysteryLandmark(
    g: Graphics,
    landmark: Landmark,
    base: Vec2,
    ups: Vec2,
    perp: Vec2,
    height: number,
    width: number,
  ) {
    g.moveTo(base.x - perp.x * width * 0.55, base.y - perp.y * width * 0.55);
    g.lineTo(base.x + ups.x * height, base.y + ups.y * height);
    g.lineTo(base.x + perp.x * width * 0.55, base.y + perp.y * width * 0.55);
    g.stroke({ color: landmark.accent, width: 2, alpha: 0.65 });
    g.circle(base.x, base.y, Math.max(2, height * 0.16));
    g.fill({ color: 0xfff2c8, alpha: 0.75 });
  }

  private hideAllSprites() {
    this.partSprites.forEach((s) => (s.visible = false));
    this.fairingSprites.forEach((s) => (s.visible = false));
  }

  // Flickering layered flame plume out of each firing engine.
  private drawFlames() {
    const g = this.gFlame;
    g.clear();
    const k = this.cam.zoom;
    for (const v of this.vessels) {
      const down = V.scale(v.upDir(), -1); // exhaust direction (world)
      for (const p of v.aliveParts()) {
        if (!p.def.thrust || p.flame < 0.02) continue;
        const nozzle = V.add(v.partWorld(p), V.scale(down, p.def.height * 0.5));
        const ns = this.cam.worldToScreen(nozzle);
        const ds = { x: down.x, y: -down.y }; // screen-space exhaust dir
        const perp = { x: -ds.y, y: ds.x };
        const flick = 0.75 + Math.random() * 0.4;
        const baseW = p.def.width * 0.42 * k;
        const len = (1.3 + p.flame * 2.6) * p.def.width * k * flick;
        // layered cones: outer red -> orange -> yellow core
        const cone = (wMul: number, lMul: number, color: number, alpha: number) => {
          const bw = baseW * wMul;
          const tip = { x: ns.x + ds.x * len * lMul, y: ns.y + ds.y * len * lMul };
          g.poly([
            ns.x + perp.x * bw, ns.y + perp.y * bw,
            ns.x - perp.x * bw, ns.y - perp.y * bw,
            tip.x, tip.y,
          ]);
          g.fill({ color, alpha });
        };
        cone(1.25, 1.0, 0xc84b31, 0.55);
        cone(1.0, 0.8, 0xff8a3d, 0.8);
        cone(0.55, 0.6, 0xffe79a, 0.95);
      }
    }
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
      const tail = { x: s.x - dir.x * tailLen, y: s.y + dir.y * tailLen };
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
    // enemy bolts (UFO fire)
    for (const b of this.combat.bolts) {
      const s = this.cam.worldToScreen(b.pos);
      const body = this.world.dominantBody(b.pos);
      const d = V.norm(V.sub(b.vel, body.vel));
      g.moveTo(s.x - d.x * 10, s.y + d.y * 10);
      g.lineTo(s.x, s.y);
      g.stroke({ color: 0x9bff6b, width: 3, cap: "round" });
      g.circle(s.x, s.y, 3);
      g.fill({ color: 0xe6ffd6 });
    }
  }

  // Draw the predicted Keplerian path of the player relative to the dominant body.
  private drawTrajectory(g: Graphics, alpha: number, clear = true) {
    if (clear) g.clear();
    if (!this.player) return;
    const body = this.world.dominantBody(this.player.pos);
    const currentOrbit = orbit(this.player.pos, this.player.vel, body);
    if (!currentOrbit.bound || currentOrbit.peri < body.radius * 1.003) {
      this.drawImpactTrajectory(g, body, alpha);
      return;
    }

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

  private drawImpactTrajectory(g: Graphics, body: Body, alpha: number) {
    if (!this.player) return;
    const pts = impactPreview(this.player.pos, this.player.vel, body);
    if (pts.length < 2) return;

    const first = this.cam.worldToScreen(pts[0]);
    g.moveTo(first.x, first.y);
    for (let i = 1; i < pts.length; i++) {
      const s = this.cam.worldToScreen(pts[i]);
      g.lineTo(s.x, s.y);
    }
    g.stroke({ color: 0xffd27f, width: 2, alpha });

    const impact = pts[pts.length - 1];
    const isSurfaceHit = Math.abs(V.len(V.sub(impact, body.pos)) - body.radius) < body.radius * 0.01;
    if (!isSurfaceHit) return;
    const s = this.cam.worldToScreen(impact);
    const r = Math.max(4, Math.min(10, body.radius * this.cam.zoom * 0.015));
    g.moveTo(s.x - r, s.y - r);
    g.lineTo(s.x + r, s.y + r);
    g.moveTo(s.x + r, s.y - r);
    g.lineTo(s.x - r, s.y + r);
    g.stroke({ color: 0xff8a3d, width: 2, alpha: Math.min(1, alpha + 0.15), cap: "round" });
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
      for (const landmark of this.world.landmarksFor(b.id)) {
        const pos = this.cam.worldToScreen(this.world.landmarkPosition(landmark));
        const discovered = this.log.discoveries.includes(landmark.id);
        g.circle(pos.x, pos.y, discovered ? 3.5 : 2.5);
        g.fill({ color: discovered ? landmark.accent : 0xfff2c8, alpha: discovered ? 0.95 : 0.5 });
      }
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
    this.navEl.classList.add("compact");
    inGrid(this.navEl, "nav", "start", "start");

    this.statusEl = mkPanel();
    this.statusEl.style.minWidth = "150px";
    this.statusEl.classList.add("compact");
    inGrid(this.statusEl, "status", "end", "start");

    this.gaugesEl = mkPanel();
    this.gaugesEl.style.width = "230px";
    this.gaugesEl.classList.add("compact");
    inGrid(this.gaugesEl, "gauges", "start", "end");

    this.helpEl = mkPanel();
    this.helpEl.classList.add("compact");
    this.helpEl.style.fontSize = "11px";
    this.helpEl.style.width = "270px";
    this.helpEl.style.lineHeight = "1.6";
    this.helpEl.innerHTML =
      "<b>A/D</b> rotate · <b>W/S</b> throttle · <b>Shift/Ctrl</b> full/cut · " +
      "<b>T</b> SAS · <b>Space</b> stage · <b>R</b> RCS · <b>Mouse</b> aim · <b>Click/F</b> fire · " +
      "<b>Tab</b> weapon · <b>M</b> map · <b>,/.</b> warp · <b>N</b> mute · <b>Backspace</b> restart · <b>Esc</b> hangar";
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

    this.mapBadgeEl = document.createElement("div");
    this.mapBadgeEl.className = "map-badge";
    this.mapBadgeEl.textContent = "MAP VIEW";
    this.mapBadgeEl.style.display = "none";
    document.body.appendChild(this.mapBadgeEl);
  }

  private setDomVisible(v: boolean) {
    this.gridEl.style.display = v ? "grid" : "none";
    this.mapBadgeEl.style.display = v && this.mapMode ? "block" : "none";
  }

  private bar(label: string, pct: number, color: string): string {
    const w = Math.max(0, Math.min(100, pct));
    return `<div class="meter">
      <div class="meter-head"><span>${label}</span><b>${Math.round(w)}%</b></div>
      <div class="meter-track"><div class="meter-fill" style="width:${w}%;background:${color}"></div></div>
    </div>`;
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
      <div class="readout">
        <span>Altitude</span><b>${fmt(alt)}</b>
        <span>Speed</span><b>${speed.toFixed(0)} m/s</b>
        <span>Vertical</span><b>${vSpeed >= 0 ? "▲" : "▼"} ${Math.abs(vSpeed).toFixed(0)} m/s</b>
        <span>Apoapsis</span><b>${apo}${tApo}</b>
        <span>Periapsis</span><b>${peri}${tPeri}</b>
      </div>`;

    // gauges (throttle + fuel bars, RCS, next stage)
    const nextStage = this.player.nextStageLabel();
    const fuelColor = fuelPct < 15 ? "#c84b31" : "#d98a3d";
    this.gaugesEl.innerHTML =
      this.bar("Throttle", this.throttle * 100, "#c84b31") +
      this.bar("Fuel", fuelPct, fuelColor) +
      `<div class="readout" style="margin-top:7px">
        <span>RCS</span><b>${this.rcs ? "on" : "off"}</b>
        <span>Next ⎵</span><b>${nextStage ? escapeHtmlF(nextStage) : "—"}</b>
      </div>`;
    const restartButton = document.createElement("button");
    restartButton.textContent = "↻ Restart Launch";
    restartButton.style.marginTop = "8px";
    restartButton.onclick = () => this.onRestart();
    this.gaugesEl.appendChild(restartButton);

    // status (warp + weapon group chips)
    const kinds = this.availableWeaponKinds();
    const chips = kinds.length
      ? kinds.map((k, i) => {
          const on = i === this.weaponGroup % kinds.length;
          return `<span class="chip${on ? " on" : ""}" data-wg="${i}">${k}</span>`;
        }).join("")
      : "<span class='muted'>none</span>";
    const sasModes: (typeof this.sas)[] = ["off", "prograde", "retrograde", "hold"];
    const sasLabel: Record<typeof this.sas, string> = {
      off: "off", prograde: "prograde", retrograde: "retrograde", hold: "hold",
    };
    const sasChips = sasModes
      .map((m) => {
        const on = m === this.sas;
        return `<span class="chip${on ? " on" : ""}" data-sas="${m}">${sasLabel[m]}</span>`;
      })
      .join("");
    const comboStr = this.combo > 1 ? ` <span style="color:#c84b31">${this.combo}×</span>` : "";
    const found = this.log.discoveries.length;
    const total = this.world.landmarks.length;
    this.statusEl.innerHTML = `
      <h3>⚙ Status</h3>
      <div class="readout">
        <span>Score</span><b>${this.score}${comboStr}</b>
        <span>Discoveries</span><b>${found}/${total}</b>
        <span>Warp</span><b>${this.warp}×</b>
      </div>
      <div class="section-label">SAS (T)</div>
      <div>${sasChips}</div>
      <div class="section-label">Weapon (Tab)</div>
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
    el.classList.add("toast");
    el.textContent = msg;
    this.toastEl.appendChild(el);
    setTimeout(() => {
      el.classList.add("exit");
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

function angularDistance(a: number, b: number): number {
  return Math.abs(((a - b + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
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

function cloneDesign(design: Design): Design {
  return {
    name: design.name,
    parts: design.parts.map((part) => ({
      uid: part.uid,
      defId: part.defId,
      x: part.x,
      y: part.y,
      flip: part.flip,
      parentUid: part.parentUid,
    })),
  };
}
