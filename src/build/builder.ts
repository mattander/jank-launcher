import { Application, Container, Graphics } from "pixi.js";
import { Camera, REF_PPM } from "../camera";
import { Vec2 } from "../types";
import { PARTS, PartDef, drawPart, drawFairingShroud, getPart, PartCategory } from "../parts/catalog";
import {
  Design,
  PlacedPart,
  emptyDesign,
  newUid,
  computeStats,
} from "./design";
import { computeStages } from "./staging";
import * as storage from "../storage";

const CATEGORY_ORDER: PartCategory[] = [
  "command", "fuel", "engine", "aero", "structural", "utility", "weapon",
];
const CATEGORY_LABEL: Record<PartCategory, string> = {
  command: "🧠 Command",
  fuel: "⛽ Fuel",
  engine: "🔥 Engines",
  aero: "✈ Aero",
  structural: "🔩 Structural",
  utility: "🪂 Utility",
  weapon: "💥 Weapons",
};

export class Builder {
  app: Application;
  layer = new Container();
  partsLayer = new Container();
  ghostLayer = new Container();
  guideLayer = new Container();
  cam = new Camera();
  design: Design;
  onLaunch: (d: Design) => void;

  private placing: PartDef | null = null;
  private ghost: { x: number; y: number; flip: boolean; parentUid?: string } | null = null;
  private dragUid: string | null = null;
  private panning = false;
  private lastPointer: Vec2 = { x: 0, y: 0 };
  private cursorWorld: Vec2 = { x: 0, y: 0 };
  private symmetry = 1; // 1 = off, 2 = mirror

  // DOM
  private paletteEl!: HTMLDivElement;
  private statsEl!: HTMLDivElement;
  private actionsEl!: HTMLDivElement;
  private hintEl!: HTMLDivElement;
  private stagingEl!: HTMLDivElement;

  constructor(app: Application, onLaunch: (d: Design) => void) {
    this.app = app;
    this.onLaunch = onLaunch;
    this.design = emptyDesign();
    this.layer.addChild(this.guideLayer, this.partsLayer, this.ghostLayer);
    this.cam.center = { x: 0, y: 5 };
    this.cam.zoom = 16;
    this.buildDom();
    this.bindEvents();
    if (import.meta.env.DEV) {
      const w = window as unknown as { __builder: Builder; __PARTS: typeof PARTS };
      w.__builder = this;
      w.__PARTS = PARTS;
    }
  }

  // ---------------- lifecycle ----------------
  show() {
    this.layer.visible = true;
    this.setDomVisible(true);
    this.resize();
    this.render();
  }

  hide() {
    this.layer.visible = false;
    this.setDomVisible(false);
    this.cancelPlacing();
  }

  resize() {
    // logical size, not renderer.width (physical) — see FlightScene.resize
    this.cam.resize(this.app.screen.width, this.app.screen.height);
    this.render();
  }

  // ---------------- DOM ----------------
  private buildDom() {
    // palette (left)
    this.paletteScaffold();
    // stats (bottom-left)
    this.statsEl = div("panel");
    this.statsEl.style.left = "12px";
    this.statsEl.style.bottom = "12px";
    this.statsEl.style.minWidth = "230px";
    document.body.appendChild(this.statsEl);
    // actions (top-right)
    this.actionsEl = div("panel");
    this.actionsEl.style.right = "12px";
    this.actionsEl.style.top = "12px";
    this.actionsEl.style.display = "flex";
    this.actionsEl.style.flexWrap = "wrap";
    this.actionsEl.style.gap = "6px";
    this.actionsEl.style.maxWidth = "320px";
    document.body.appendChild(this.actionsEl);
    this.renderActions();
    // staging stack (bottom-right, clear of the top-right actions)
    this.stagingEl = div("panel");
    this.stagingEl.style.right = "12px";
    this.stagingEl.style.bottom = "12px";
    this.stagingEl.style.width = "230px";
    this.stagingEl.style.maxHeight = "42vh";
    this.stagingEl.style.overflowY = "auto";
    this.stagingEl.style.fontSize = "13px";
    document.body.appendChild(this.stagingEl);
    // hint (top-center)
    this.hintEl = div("panel");
    this.hintEl.style.left = "calc(252px + (100vw - 252px - 340px) / 2)"; // centred in the open area between palette and actions
    this.hintEl.style.top = "12px";
    this.hintEl.style.transform = "translateX(-50%)";
    this.hintEl.style.fontSize = "12px";
    this.hintEl.style.maxWidth = "440px";
    this.hintEl.style.textAlign = "center";
    this.hintEl.textContent = Builder.HINT;
    document.body.appendChild(this.hintEl);
  }

  private paletteScaffold() {
    this.paletteEl = div("panel");
    this.paletteEl.style.left = "12px";
    this.paletteEl.style.top = "12px";
    this.paletteEl.style.width = "240px";
    this.paletteEl.style.maxHeight = "calc(100vh - 220px)";
    this.paletteEl.style.overflowY = "auto";
    const title = document.createElement("h3");
    title.textContent = "🚀 Parts Bin";
    this.paletteEl.appendChild(title);

    for (const cat of CATEGORY_ORDER) {
      const header = document.createElement("div");
      header.textContent = CATEGORY_LABEL[cat];
      header.style.margin = "8px 0 4px";
      header.style.fontWeight = "bold";
      this.paletteEl.appendChild(header);
      const grid = document.createElement("div");
      grid.style.display = "flex";
      grid.style.flexWrap = "wrap";
      grid.style.gap = "5px";
      for (const def of PARTS.filter((p) => p.category === cat)) {
        const b = document.createElement("button");
        b.textContent = def.name;
        b.title = def.blurb;
        b.style.fontSize = "12px";
        b.onclick = () => this.startPlacing(def);
        grid.appendChild(b);
      }
      this.paletteEl.appendChild(grid);
    }
    document.body.appendChild(this.paletteEl);
  }

  private renderActions() {
    this.actionsEl.innerHTML = "";
    const mk = (label: string, cls: string, fn: () => void) => {
      const b = document.createElement("button");
      b.textContent = label;
      if (cls) b.className = cls;
      b.onclick = fn;
      this.actionsEl.appendChild(b);
    };
    mk("🚀 Launch", "primary", () => this.launch());
    mk("💾 Save", "", () => this.save());
    mk("📂 Load", "", () => this.openLoad());
    mk("⬇ Export", "", () => storage.exportDesign(this.design));
    mk("⬆ Import", "", async () => {
      const d = await storage.importDesign();
      if (d) {
        this.design = d;
        this.render();
      }
    });
    mk("🧹 Clear", "", () => {
      this.design = emptyDesign();
      this.render();
    });
    const symBtn = document.createElement("button");
    symBtn.textContent = this.symmetry === 2 ? "⧉ 2×" : "⧉ 1×";
    if (this.symmetry === 2) symBtn.className = "toggled";
    symBtn.title = "Symmetry: mirror side-mounted parts (X)";
    symBtn.onclick = () => this.toggleSymmetry();
    this.actionsEl.appendChild(symBtn);
  }

  private toggleSymmetry() {
    this.symmetry = this.symmetry === 2 ? 1 : 2;
    this.renderActions();
    this.flashHint(this.symmetry === 2 ? "Symmetry ON — side parts mirror" : "Symmetry off");
  }

  private save() {
    const name = prompt("Name this rocket:", this.design.name);
    if (!name) return;
    this.design.name = name;
    storage.saveDesign(this.design);
    this.flashHint(`Saved "${name}"`);
  }

  private openLoad() {
    const names = storage.listSaved();
    if (names.length === 0) {
      this.flashHint("No saved rockets yet.");
      return;
    }
    const pick = prompt(`Load which rocket?\n\n${names.join("\n")}`, names[0]);
    if (!pick) return;
    const d = storage.loadDesign(pick);
    if (d) {
      this.design = d;
      this.render();
      this.flashHint(`Loaded "${pick}"`);
    }
  }

  private launch() {
    const stats = computeStats(this.design);
    if (this.design.parts.length === 0) return this.flashHint("Build something first!");
    if (!stats.hasCommand) return this.flashHint("Needs a command pod or probe core.");
    if (!stats.hasEngine) return this.flashHint("Needs at least one engine.");
    this.onLaunch(this.design);
  }

  private static readonly HINT =
    "Click a part, then click to place · Drag to move · Right-click to delete · Wheel to zoom · X for symmetry";

  private flashHint(msg: string) {
    this.hintEl.textContent = msg;
    setTimeout(() => {
      this.hintEl.textContent = Builder.HINT;
    }, 2200);
  }

  private setDomVisible(v: boolean) {
    const d = v ? "block" : "none";
    this.paletteEl.style.display = d;
    this.statsEl.style.display = d;
    this.actionsEl.style.display = v ? "flex" : "none";
    this.hintEl.style.display = d;
    this.stagingEl.style.display = d;
  }

  // ---------------- placing / snapping ----------------
  private startPlacing(def: PartDef) {
    this.placing = def;
    this.dragUid = null;
    this.ghost = { x: this.cursorWorld.x, y: this.cursorWorld.y, flip: false };
    this.render();
  }

  private cancelPlacing() {
    this.placing = null;
    this.ghost = null;
  }

  private nodeWorld(p: PlacedPart, n: { x: number; y: number }): Vec2 {
    return { x: p.x + (p.flip ? -n.x : n.x), y: p.y + n.y };
  }

  // Compute a snapped placement for `def` near the cursor. Any part can attach
  // two ways; we pick whichever attach point is closest to the cursor:
  //   • stack  — align one of the part's stack nodes to a host node
  //   • surface — mount the part to the side of a host (by its radial node if it
  //     has one, otherwise by its own side edge — so tanks/SRBs work as boosters)
  private computeSnap(def: PartDef, ignoreUid?: string): NonNullable<typeof this.ghost> {
    const cur = this.cursorWorld;
    const others = this.design.parts.filter((p) => p.uid !== ignoreUid);
    if (others.length === 0) return { x: cur.x, y: cur.y, flip: false };

    type Cand = { x: number; y: number; flip: boolean; parentUid: string; dist: number };
    const cands: Cand[] = [];
    const offer = (attach: Vec2, gate: number, c: Omit<Cand, "dist">) => {
      const dist = Math.hypot(attach.x - cur.x, attach.y - cur.y);
      if (dist < gate) cands.push({ ...c, dist });
    };

    const myStack = def.nodes.filter((n) => n.type === "stack");
    const myRadial = def.nodes.find((n) => n.type === "radial");

    for (const e of others) {
      const ed = getPart(e.defId);

      // --- stack attach: my stack node -> any host node ---
      for (const hn of ed.nodes) {
        const target = this.nodeWorld(e, hn);
        for (const gn of myStack) {
          offer(target, 2.0, { x: target.x - gn.x, y: target.y - gn.y, flip: false, parentUid: e.uid });
        }
      }

      // --- surface attach: mount to the nearest side of this host ---
      const side = cur.x < e.x ? -1 : 1; // -1 = host's left edge
      const edgeX = e.x + (side * ed.width) / 2;
      const ay = clamp(cur.y, e.y - ed.height * 0.45, e.y + ed.height * 0.45);
      const attach = { x: edgeX, y: ay };
      if (myRadial) {
        const flip = side < 0;
        const nx = flip ? -myRadial.x : myRadial.x;
        offer(attach, 3.0, { x: edgeX - nx, y: ay - myRadial.y, flip, parentUid: e.uid });
      } else {
        // no radial node: butt the part's near side against the host edge
        offer(attach, 3.0, { x: edgeX + (side * def.width) / 2, y: ay, flip: false, parentUid: e.uid });
      }
    }

    if (cands.length === 0) return { x: cur.x, y: cur.y, flip: false };
    cands.sort((a, b) => a.dist - b.dist);
    const best = cands[0];
    return { x: best.x, y: best.y, flip: best.flip, parentUid: best.parentUid };
  }

  // ---------------- events ----------------
  private bindEvents() {
    const c = this.app.canvas;
    c.addEventListener("pointermove", (e) => this.onMove(e));
    c.addEventListener("pointerdown", (e) => this.onDown(e));
    window.addEventListener("pointerup", () => this.onUp());
    c.addEventListener("contextmenu", (e) => this.onContext(e));
    window.addEventListener("keydown", (e) => {
      if (!this.layer.visible) return;
      if (e.key.toLowerCase() === "x") this.toggleSymmetry();
      if (e.key === "Escape" && this.placing) { this.cancelPlacing(); this.render(); }
    });
    c.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
  }

  private pointerWorld(e: PointerEvent | MouseEvent): Vec2 {
    const rect = this.app.canvas.getBoundingClientRect();
    return this.cam.screenToWorld({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  }

  private onMove(e: PointerEvent) {
    if (!this.layer.visible) return;
    this.cursorWorld = this.pointerWorld(e);
    if (this.panning) {
      const rect = this.app.canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      this.cam.center.x -= (sx - this.lastPointer.x) / this.cam.zoom;
      this.cam.center.y += (sy - this.lastPointer.y) / this.cam.zoom;
      this.lastPointer = { x: sx, y: sy };
      this.render();
      return;
    }
    if (this.placing) {
      this.ghost = this.computeSnap(this.placing);
      this.render();
    } else if (this.dragUid) {
      const def = getPart(this.design.parts.find((p) => p.uid === this.dragUid)!.defId);
      const snap = this.computeSnap(def, this.dragUid);
      const p = this.design.parts.find((pp) => pp.uid === this.dragUid)!;
      p.x = snap.x;
      p.y = snap.y;
      p.flip = snap.flip;
      p.parentUid = snap.parentUid;
      this.render();
    }
  }

  // With symmetry on, mirror a side-mounted part across the rocket centreline.
  // The mirror attaches to the host's own mirror when one exists (so a booster
  // on a radial decoupler mirrors onto the decoupler on the far side).
  private addMirror(part: PlacedPart) {
    if (this.symmetry < 2 || !part.parentUid) return;
    const host = this.design.parts.find((p) => p.uid === part.parentUid);
    if (!host) return;
    const root = this.design.parts.find((p) => getPart(p.defId).torque) ?? this.design.parts[0];
    const axis = root ? root.x : 0;
    if (Math.abs(part.x - axis) < 0.05) return; // on the centreline: nothing to mirror

    // does the host have a mirror image already placed? attach to it if so
    const hostMirror = this.design.parts.find(
      (p) =>
        p.uid !== host.uid &&
        p.defId === host.defId &&
        Math.abs(p.x - (2 * axis - host.x)) < 0.3 &&
        Math.abs(p.y - host.y) < 0.3,
    );
    this.design.parts.push({
      uid: newUid(),
      defId: part.defId,
      x: 2 * axis - part.x,
      y: part.y,
      flip: !part.flip,
      parentUid: hostMirror ? hostMirror.uid : host.uid,
    });
  }

  private onDown(e: PointerEvent) {
    if (!this.layer.visible || e.button !== 0) return;
    this.cursorWorld = this.pointerWorld(e);
    if (this.placing && this.ghost) {
      const part: PlacedPart = {
        uid: newUid(),
        defId: this.placing.id,
        x: this.ghost.x,
        y: this.ghost.y,
        flip: this.ghost.flip,
        parentUid: this.ghost.parentUid,
      };
      this.design.parts.push(part);
      this.addMirror(part);
      this.render();
      return;
    }
    const hit = this.hitTest(this.cursorWorld);
    if (hit) {
      this.dragUid = hit.uid;
    } else {
      this.panning = true;
      const rect = this.app.canvas.getBoundingClientRect();
      this.lastPointer = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }
  }

  private onUp() {
    this.dragUid = null;
    this.panning = false;
  }

  private onContext(e: MouseEvent) {
    e.preventDefault();
    if (this.placing) {
      this.cancelPlacing();
      this.render();
      return;
    }
    const hit = this.hitTest(this.pointerWorld(e));
    if (hit) {
      this.deleteSubtree(hit.uid);
      this.render();
    }
  }

  private onWheel(e: WheelEvent) {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    this.cam.zoom *= factor;
    this.cam.clampZoom(4, 80);
    this.render();
  }

  private hitTest(world: Vec2): PlacedPart | null {
    for (let i = this.design.parts.length - 1; i >= 0; i--) {
      const p = this.design.parts[i];
      const def = getPart(p.defId);
      if (
        Math.abs(world.x - p.x) <= def.width / 2 + 0.2 &&
        Math.abs(world.y - p.y) <= def.height / 2 + 0.2
      ) {
        return p;
      }
    }
    return null;
  }

  private deleteSubtree(uid: string) {
    const toRemove = new Set<string>([uid]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const p of this.design.parts) {
        if (p.parentUid && toRemove.has(p.parentUid) && !toRemove.has(p.uid)) {
          toRemove.add(p.uid);
          changed = true;
        }
      }
    }
    this.design.parts = this.design.parts.filter((p) => !toRemove.has(p.uid));
  }

  // ---------------- rendering ----------------
  private placePartContainer(c: Container, x: number, y: number, flip: boolean) {
    const s = this.cam.worldToScreen({ x, y });
    c.position.set(s.x, s.y);
    const k = this.cam.zoom / REF_PPM;
    c.scale.set(flip ? -k : k, k);
  }

  // Engines that sit directly under an adjacent decoupler get an auto-fairing.
  private fairingEngines(): Set<string> {
    const set = new Set<string>();
    const parts = this.design.parts;
    for (const p of parts) {
      const def = getPart(p.defId);
      if (!def.thrust || def.solid || !def.nodes.some((n) => n.type === "stack")) continue;
      const covered = parts.some((q) => {
        const qd = getPart(q.defId);
        if (!qd.decoupler || !qd.nodes.some((n) => n.type === "stack")) return false; // stack decoupler only
        const adjacent = q.parentUid === p.uid || p.parentUid === q.uid;
        return adjacent && Math.abs(q.x - p.x) < 0.6; // stacked in line with the engine
      });
      if (covered) set.add(p.uid);
    }
    return set;
  }

  render() {
    this.drawGuides();
    this.partsLayer.removeChildren();
    const fairings = this.fairingEngines();
    for (const p of this.design.parts) {
      const def = getPart(p.defId);
      const g = new Graphics();
      drawPart(g, def, REF_PPM);
      if (fairings.has(p.uid)) drawFairingShroud(g, def, REF_PPM);
      this.placePartContainer(g, p.x, p.y, p.flip);
      this.partsLayer.addChild(g);
    }
    this.ghostLayer.removeChildren();
    if (this.placing && this.ghost) {
      const g = new Graphics();
      drawPart(g, this.placing, REF_PPM);
      g.alpha = 0.55;
      this.placePartContainer(g, this.ghost.x, this.ghost.y, this.ghost.flip);
      this.ghostLayer.addChild(g);
    }
    this.updateStats();
    this.updateStaging();
  }

  private updateStaging() {
    const stages = computeStages(this.design);
    if (stages.length === 0) {
      this.stagingEl.innerHTML = "<h3>🪜 Staging</h3><div style='opacity:0.7'>No stages — add decouplers or parachutes. Space stages in flight.</div>";
      return;
    }
    // show in firing order, numbered from 1 (first Space press)
    const rows = stages
      .map((s, i) => {
        const icon = s.action === "deploy" ? "🪂" : "✂️";
        return `<div style="display:flex;gap:6px;padding:3px 0;border-top:1px dashed #b3a684">
          <b>${i + 1}</b> <span>${icon}</span> <span>${escapeHtml(s.label)}</span></div>`;
      })
      .join("");
    this.stagingEl.innerHTML = `<h3>🪜 Staging</h3>
      <div style="opacity:0.7;margin-bottom:2px">Space fires these in order:</div>${rows}`;
  }

  private drawGuides() {
    this.guideLayer.removeChildren();
    const g = new Graphics();
    // ground line at y=0
    const left = this.cam.screenToWorld({ x: 0, y: 0 }).x;
    const right = this.cam.screenToWorld({ x: this.cam.screenW, y: 0 }).x;
    const gy = this.cam.worldToScreen({ x: 0, y: 0 }).y;
    g.moveTo(0, gy);
    g.lineTo(this.cam.screenW, gy);
    g.stroke({ color: 0x9b8c6a, width: 3, alpha: 0.6 });
    // faint vertical centerline
    const cx = this.cam.worldToScreen({ x: 0, y: 0 }).x;
    g.moveTo(cx, 0);
    g.lineTo(cx, this.cam.screenH);
    g.stroke({ color: 0x9b8c6a, width: 1, alpha: 0.25 });
    void left;
    void right;
    this.guideLayer.addChild(g);
  }

  private updateStats() {
    const s = computeStats(this.design);
    const twrColor = s.twr >= 1.2 ? "#3a7d8c" : s.twr > 0 ? "#c84b31" : "#777";
    this.statsEl.innerHTML = `
      <h3>📋 ${escapeHtml(this.design.name)}</h3>
      <div>Parts: <b>${s.partCount}</b></div>
      <div>Mass: <b>${s.wetMass.toFixed(1)} t</b> (dry ${s.dryMass.toFixed(1)} t)</div>
      <div>Thrust: <b>${s.thrust.toFixed(0)} kN</b></div>
      <div>Launch TWR: <b style="color:${twrColor}">${s.twr.toFixed(2)}</b></div>
      <div>Δv (est): <b>${s.deltaV.toFixed(0)} m/s</b></div>
      ${s.twr > 0 && s.twr < 1 ? '<div style="color:#c84b31">⚠ TWR &lt; 1 — won\'t lift off!</div>' : ""}
    `;
  }
}

function div(cls: string): HTMLDivElement {
  const d = document.createElement("div");
  d.className = cls;
  return d;
}
function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
function escapeHtml(s: string) {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
}
