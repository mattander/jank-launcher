import { Application, Container, Graphics } from "pixi.js";
import { Camera, REF_PPM } from "../camera";
import { Vec2 } from "../types";
import { PARTS, PartDef, drawPart, getPart, PartCategory } from "../parts/catalog";
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
    this.cam.resize(this.app.renderer.width, this.app.renderer.height);
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
    // staging stack (right side, below actions)
    this.stagingEl = div("panel");
    this.stagingEl.style.right = "12px";
    this.stagingEl.style.top = "112px";
    this.stagingEl.style.width = "210px";
    this.stagingEl.style.fontSize = "13px";
    document.body.appendChild(this.stagingEl);
    // hint (top-center)
    this.hintEl = div("panel");
    this.hintEl.style.left = "50%";
    this.hintEl.style.top = "12px";
    this.hintEl.style.transform = "translateX(-50%)";
    this.hintEl.style.fontSize = "13px";
    this.hintEl.textContent =
      "Click a part, then click in the hangar to place. Drag to move · Right-click to delete · Wheel to zoom";
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

  private flashHint(msg: string) {
    this.hintEl.textContent = msg;
    setTimeout(() => {
      this.hintEl.textContent =
        "Click a part, then click in the hangar to place. Drag to move · Right-click to delete · Wheel to zoom";
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

  private isRadial(def: PartDef): boolean {
    return !def.nodes.some((n) => n.type === "stack");
  }

  private nodeWorld(p: PlacedPart, n: { x: number; y: number }): Vec2 {
    return { x: p.x + (p.flip ? -n.x : n.x), y: p.y + n.y };
  }

  // Compute a snapped placement for `def` near the cursor.
  private computeSnap(def: PartDef, ignoreUid?: string): NonNullable<typeof this.ghost> {
    const cur = this.cursorWorld;
    const others = this.design.parts.filter((p) => p.uid !== ignoreUid);
    if (others.length === 0) return { x: cur.x, y: cur.y, flip: false };

    if (this.isRadial(def)) {
      // attach the radial node onto the nearest host part's side
      let host: PlacedPart | null = null;
      let bestD = Infinity;
      for (const e of others) {
        const ed = getPart(e.defId);
        const dx = Math.abs(cur.x - e.x) - ed.width / 2;
        const dy = Math.abs(cur.y - e.y) - ed.height / 2;
        const d = Math.hypot(Math.max(0, dx), Math.max(0, dy));
        if (d < bestD) {
          bestD = d;
          host = e;
        }
      }
      if (!host || bestD > 3) return { x: cur.x, y: cur.y, flip: false };
      const hd = getPart(host.defId);
      const side = cur.x < host.x ? -1 : 1; // -1 = host's left edge
      const edgeX = host.x + (side * hd.width) / 2;
      const ay = clamp(cur.y, host.y - hd.height * 0.45, host.y + hd.height * 0.45);
      const n = def.nodes[0]; // radial node, n.x < 0 (body extends +x)
      // attach to host's right side (side=1): body extends right, no flip
      // attach to host's left side (side=-1): flip so body extends left
      const flip = side < 0;
      const nx = flip ? -n.x : n.x;
      return { x: edgeX - nx, y: ay - n.y, flip, parentUid: host.uid };
    }

    // stack part: align one of our stack nodes to any host node
    let best: NonNullable<typeof this.ghost> | null = null;
    let bestD = 1.8; // snap threshold (m)
    const myStackNodes = def.nodes.filter((n) => n.type === "stack");
    for (const e of others) {
      const ed = getPart(e.defId);
      for (const hn of ed.nodes) {
        const target = this.nodeWorld(e, hn);
        for (const gn of myStackNodes) {
          const pos = { x: target.x - gn.x, y: target.y - gn.y };
          const d = Math.hypot(pos.x - cur.x, pos.y - cur.y);
          if (d < bestD) {
            bestD = d;
            best = { x: pos.x, y: pos.y, flip: false, parentUid: e.uid };
          }
        }
      }
    }
    return best ?? { x: cur.x, y: cur.y, flip: false };
  }

  // ---------------- events ----------------
  private bindEvents() {
    const c = this.app.canvas;
    c.addEventListener("pointermove", (e) => this.onMove(e));
    c.addEventListener("pointerdown", (e) => this.onDown(e));
    window.addEventListener("pointerup", () => this.onUp());
    c.addEventListener("contextmenu", (e) => this.onContext(e));
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

  render() {
    this.drawGuides();
    this.partsLayer.removeChildren();
    for (const p of this.design.parts) {
      const def = getPart(p.defId);
      const g = new Graphics();
      drawPart(g, def, REF_PPM);
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
