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
import { StockDesign, stockCatalog } from "./stock";
import * as storage from "../storage";

const BODY_NAMES: Record<string, string> = {
  sun: "Sol", terra: "Terra", luna: "Luna", rusty: "Rusty", frost: "Frost",
};

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

interface ChecklistItem {
  ok: boolean;
  text: string;
}

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
  private undoStack: Design[] = [];
  private redoStack: Design[] = [];
  private dragStartDesign: Design | null = null;

  // DOM
  private gridEl!: HTMLDivElement;
  private leftRailEl!: HTMLDivElement;
  private rightRailEl!: HTMLDivElement;
  private paletteEl!: HTMLDivElement;
  private statsEl!: HTMLDivElement;
  private actionsEl!: HTMLDivElement;
  private hintEl!: HTMLDivElement;
  private stagingEl!: HTMLDivElement;
  private modalEl: HTMLDivElement | null = null;

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
    this.closeModal();
  }

  resize() {
    // logical size, not renderer.width (physical) — see FlightScene.resize
    this.cam.resize(this.app.screen.width, this.app.screen.height);
    this.render();
  }

  // ---------------- DOM ----------------
  // A full-screen frame keeps builder panels in scrollable rails so narrow
  // screens do not let independent cards overlap each other.
  private buildDom() {
    this.gridEl = document.createElement("div");
    this.gridEl.className = "builder-frame";
    document.body.appendChild(this.gridEl);

    this.leftRailEl = div("builder-rail builder-left");
    this.rightRailEl = div("builder-rail builder-right");
    this.gridEl.append(this.leftRailEl, this.rightRailEl);

    this.paletteScaffold();
    this.paletteEl.classList.add("builder-palette");
    this.leftRailEl.appendChild(this.paletteEl);

    this.statsEl = div("panel builder-stats");
    this.leftRailEl.appendChild(this.statsEl);

    this.actionsEl = div("panel builder-actions");
    this.rightRailEl.appendChild(this.actionsEl);
    this.renderActions();

    this.stagingEl = div("panel builder-staging");
    this.rightRailEl.appendChild(this.stagingEl);

    this.hintEl = div("panel hint builder-hint");
    this.hintEl.textContent = Builder.HINT;
    this.gridEl.appendChild(this.hintEl);
  }

  private paletteScaffold() {
    this.paletteEl = div("panel");
    const title = document.createElement("h3");
    title.textContent = "🚀 Parts Bin";
    this.paletteEl.appendChild(title);

    for (const cat of CATEGORY_ORDER) {
      const header = document.createElement("div");
      header.className = "section-label";
      header.textContent = CATEGORY_LABEL[cat];
      this.paletteEl.appendChild(header);
      const grid = document.createElement("div");
      grid.className = "parts-grid";
      for (const def of PARTS.filter((p) => p.category === cat)) {
        const b = document.createElement("button");
        b.textContent = def.name;
        b.title = def.blurb;
        b.onclick = () => this.startPlacing(def);
        grid.appendChild(b);
      }
      this.paletteEl.appendChild(grid);
    }
  }

  private renderActions() {
    this.actionsEl.innerHTML = "";
    const mk = (label: string, cls: string, fn: () => void, disabled = false) => {
      const b = document.createElement("button");
      b.textContent = label;
      if (cls) b.className = cls;
      b.onclick = fn;
      b.disabled = disabled;
      this.actionsEl.appendChild(b);
    };
    mk("🚀 Launch", "primary", () => this.launch());
    mk("↶ Undo", "", () => this.undo(), this.undoStack.length === 0);
    mk("↷ Redo", "", () => this.redo(), this.redoStack.length === 0);
    mk("📦 Stock", "", () => this.openStock());
    mk("💾 Save", "", () => this.save());
    mk("📂 Load", "", () => this.openLoad());
    mk("⬇ Export", "", () => storage.exportDesign(this.design));
    mk("⬆ Import", "", async () => {
      const d = await storage.importDesign();
      if (d) {
        this.remember();
        this.replaceDesign(d, `Imported "${d.name}"`);
      }
    });
    mk("🧹 Clear", "", () => {
      if (this.design.parts.length === 0) return;
      this.remember();
      this.design = emptyDesign();
      this.render();
      this.flashHint("Cleared rocket");
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

  private remember() {
    this.undoStack.push(cloneDesign(this.design));
    if (this.undoStack.length > 80) this.undoStack.shift();
    this.redoStack = [];
    this.renderActions();
  }

  private replaceDesign(design: Design, message: string) {
    this.design = cloneDesign(design);
    this.cancelPlacing();
    this.render();
    this.renderActions();
    this.flashHint(message);
  }

  private undo() {
    const previous = this.undoStack.pop();
    if (!previous) return;
    this.redoStack.push(cloneDesign(this.design));
    this.replaceDesign(previous, "Undid last edit");
  }

  private redo() {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(cloneDesign(this.design));
    this.replaceDesign(next, "Redid edit");
  }

  private commitDragIfChanged() {
    if (!this.dragStartDesign) return;
    if (!sameDesign(this.dragStartDesign, this.design)) {
      this.undoStack.push(this.dragStartDesign);
      if (this.undoStack.length > 80) this.undoStack.shift();
      this.redoStack = [];
      this.renderActions();
    }
    this.dragStartDesign = null;
  }

  private save() {
    const name = prompt("Name this rocket:", this.design.name);
    if (!name) return;
    if (name !== this.design.name) this.remember();
    this.design.name = name;
    storage.saveDesign(this.design);
    this.render();
    this.flashHint(`Saved "${name}"`);
  }

  private openStock() {
    this.openStockPicker(stockCatalog());
  }

  private openStockPicker(items: StockDesign[]) {
    this.closeModal();
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.onclick = (event) => {
      if (event.target === backdrop) this.closeModal();
    };

    const modal = document.createElement("div");
    modal.className = "modal";
    backdrop.appendChild(modal);

    const head = document.createElement("div");
    head.className = "modal-head";
    head.innerHTML = "<div><h2>📦 Stock Rockets</h2><div class='muted'>Pick a ready-made craft and start iterating.</div></div>";
    const close = document.createElement("button");
    close.textContent = "Close";
    close.onclick = () => this.closeModal();
    head.appendChild(close);
    modal.appendChild(head);

    const list = document.createElement("div");
    list.className = "stock-list";
    for (const item of items) list.appendChild(this.stockCard(item));
    modal.appendChild(list);

    document.body.appendChild(backdrop);
    this.modalEl = backdrop;
  }

  private stockCard(item: StockDesign): HTMLDivElement {
    const card = document.createElement("div");
    card.className = "stock-card";
    const stats = computeStats(item.design);
    const tags = item.tags.map((tag) => `<span class="mini-pill">${escapeHtml(tag)}</span>`).join("");
    card.innerHTML = `
      <h3>${escapeHtml(item.design.name)}</h3>
      <div class="muted">${escapeHtml(item.purpose)}</div>
      <div class="stock-meta">
        <span class="mini-pill">${item.difficulty}</span>
        <span class="mini-pill">${item.design.parts.length} parts</span>
        <span class="mini-pill">TWR ${stats.twr.toFixed(2)}</span>
        <span class="mini-pill">${stats.deltaV.toFixed(0)} m/s Δv</span>
        ${tags}
      </div>`;
    const load = document.createElement("button");
    load.className = "primary";
    load.textContent = "Load";
    load.onclick = () => {
      this.remember();
      this.design = cloneDesign(item.design);
      this.closeModal();
      this.render();
      this.flashHint(`Loaded stock "${item.design.name}"`);
    };
    card.appendChild(load);
    return card;
  }

  private closeModal() {
    this.modalEl?.remove();
    this.modalEl = null;
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
      this.remember();
      this.replaceDesign(d, `Loaded "${pick}"`);
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
    this.hintEl.classList.add("flash");
    setTimeout(() => {
      this.hintEl.textContent = Builder.HINT;
      this.hintEl.classList.remove("flash");
    }, 2200);
  }

  private setDomVisible(v: boolean) {
    this.gridEl.style.display = v ? "grid" : "none";
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

  // Compute a snapped placement for `def` near the cursor. A part can attach two
  // ways. Stack nodes are "sticky": if a stack node is within reach we always
  // prefer it, and only fall back to surface (side) attachment when no stack
  // node is nearby — otherwise the side point (often closer to the cursor) snaps
  // far too eagerly.
  private computeSnap(def: PartDef, ignoreUid?: string): NonNullable<typeof this.ghost> {
    const cur = this.cursorWorld;
    const others = this.design.parts.filter((p) => p.uid !== ignoreUid);
    if (others.length === 0) return { x: cur.x, y: cur.y, flip: false };

    type Cand = { x: number; y: number; flip: boolean; parentUid: string; dist: number };
    const STACK_GATE = 2.6; // generous, so top/bottom nodes are easy to hit
    const SURF_GATE = 1.4; // tight, so sides only grab when you're right on them
    const stackCands: Cand[] = [];
    const surfCands: Cand[] = [];

    const myStack = def.nodes.filter((n) => n.type === "stack");
    const myRadial = def.nodes.find((n) => n.type === "radial");

    for (const e of others) {
      const ed = getPart(e.defId);

      // --- stack attach: my stack node -> any host stack node ---
      for (const hn of ed.nodes) {
        if (hn.type !== "stack") continue; // stack-to-stack only
        const target = this.nodeWorld(e, hn);
        const dist = Math.hypot(target.x - cur.x, target.y - cur.y);
        if (dist >= STACK_GATE) continue;
        for (const gn of myStack) {
          // pair opposite-end nodes only (my top to a bottom node, etc.) so the
          // part sits beyond the host instead of overlapping it
          if (Math.sign(hn.y) === Math.sign(gn.y)) continue;
          stackCands.push({ x: target.x - gn.x, y: target.y - gn.y, flip: false, parentUid: e.uid, dist });
        }
      }

      // --- surface attach: mount to the nearest side of this host ---
      const side = cur.x < e.x ? -1 : 1; // -1 = host's left edge
      const edgeX = e.x + (side * ed.width) / 2;
      const ay = clamp(cur.y, e.y - ed.height * 0.45, e.y + ed.height * 0.45);
      const dist = Math.hypot(edgeX - cur.x, ay - cur.y);
      if (dist < SURF_GATE) {
        if (myRadial) {
          const flip = side < 0;
          const nx = flip ? -myRadial.x : myRadial.x;
          surfCands.push({ x: edgeX - nx, y: ay - myRadial.y, flip, parentUid: e.uid, dist });
        } else {
          // no radial node: butt the part's near side against the host edge
          surfCands.push({ x: edgeX + (side * def.width) / 2, y: ay, flip: false, parentUid: e.uid, dist });
        }
      }
    }

    // stack always wins when available; surface only as a fallback
    const pool = stackCands.length ? stackCands : surfCands;
    if (pool.length === 0) return { x: cur.x, y: cur.y, flip: false };
    pool.sort((a, b) => a.dist - b.dist);
    const best = pool[0];
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
      const key = e.key.toLowerCase();
      const mod = e.metaKey || e.ctrlKey;
      if (mod && key === "z" && !e.shiftKey) {
        e.preventDefault();
        this.undo();
        return;
      }
      if ((mod && key === "y") || (mod && key === "z" && e.shiftKey)) {
        e.preventDefault();
        this.redo();
        return;
      }
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
      this.remember();
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
      this.dragStartDesign = cloneDesign(this.design);
    } else {
      this.panning = true;
      const rect = this.app.canvas.getBoundingClientRect();
      this.lastPointer = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }
  }

  private onUp() {
    this.commitDragIfChanged();
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
      this.remember();
      this.deleteSubtree(hit.uid);
      this.render();
      this.flashHint("Deleted part group");
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
      this.drawSnapCue(this.ghost);
    }
    this.updateStats();
    this.updateStaging();
  }

  private drawSnapCue(ghost: NonNullable<typeof this.ghost>) {
    if (!ghost.parentUid) return;
    const parent = this.design.parts.find((p) => p.uid === ghost.parentUid);
    if (!parent) return;
    const g = new Graphics();
    const from = this.cam.worldToScreen({ x: parent.x, y: parent.y });
    const to = this.cam.worldToScreen({ x: ghost.x, y: ghost.y });
    g.moveTo(from.x, from.y);
    g.lineTo(to.x, to.y);
    g.stroke({ color: 0x3a7d8c, width: 2, alpha: 0.55, cap: "round" });
    g.circle(to.x, to.y, 5);
    g.stroke({ color: 0x3a7d8c, width: 2, alpha: 0.8 });
    this.ghostLayer.addChild(g);
  }

  private updateStaging() {
    const stages = computeStages(this.design);
    if (stages.length === 0) {
      this.stagingEl.innerHTML = "<h3>🪜 Staging</h3><div class='muted'>No stages — add decouplers or parachutes. Space stages in flight.</div>";
      return;
    }
    // show in firing order, numbered from 1 (first Space press)
    const rows = stages
      .map((s, i) => {
        const icon = s.action === "deploy" ? "🪂" : "✂️";
        return `<div class="stage-row"><b>${i + 1}</b><span>${icon}</span><span>${escapeHtml(s.label)}</span></div>`;
      })
      .join("");
    this.stagingEl.innerHTML = `<h3>🪜 Staging</h3>
      <div class="muted" style="margin-bottom:2px">Space fires these in order:</div>${rows}`;
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
      <div class="readout">
        <span>Parts</span><b>${s.partCount}</b>
        <span>Mass</span><b>${s.wetMass.toFixed(1)} t <span class="muted">(dry ${s.dryMass.toFixed(1)} t)</span></b>
        <span>Thrust</span><b>${s.thrust.toFixed(0)} kN</b>
        <span>Launch TWR</span><b style="color:${twrColor}">${s.twr.toFixed(2)}</b>
        <span>Δv est.</span><b>${s.deltaV.toFixed(0)} m/s</b>
      </div>
      ${s.twr > 0 && s.twr < 1 ? '<div style="color:#c84b31">⚠ TWR &lt; 1 — won\'t lift off!</div>' : ""}
      ${this.preflightChecklist()}
      ${this.exploredLine()}
    `;
  }

  private preflightChecklist(): string {
    const stats = computeStats(this.design);
    const parts = this.design.parts.map((p) => getPart(p.defId));
    const checks: ChecklistItem[] = [
      { ok: stats.hasCommand, text: "Command pod or probe core" },
      { ok: stats.hasEngine, text: "Engine installed" },
      { ok: stats.twr >= 1.05, text: "Launch TWR above 1.05" },
      { ok: parts.some((p) => p.parachute), text: "Recovery parachute" },
      { ok: parts.some((p) => p.decoupler), text: "Stage separator" },
      { ok: parts.some((p) => p.landingLeg), text: "Landing legs for off-world touchdowns" },
    ];
    const rows = checks
      .map((item) => `<div class="check-item ${item.ok ? "ok" : "warn"}"><span>${item.ok ? "✓" : "!"}</span><span>${item.text}</span></div>`)
      .join("");
    return `<div class="section-label">Pre-launch</div><div class="checklist">${rows}</div>`;
  }

  private exploredLine(): string {
    const visited = storage.loadLog().visited;
    if (visited.length === 0) return "";
    const names = visited.map((id) => BODY_NAMES[id] ?? id);
    return `<div class="muted" style="margin-top:6px">🚩 Explored: ${escapeHtml(names.join(", "))}</div>`;
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

function sameDesign(a: Design, b: Design): boolean {
  if (a.name !== b.name || a.parts.length !== b.parts.length) return false;
  for (let i = 0; i < a.parts.length; i++) {
    const ap = a.parts[i];
    const bp = b.parts[i];
    if (
      ap.uid !== bp.uid ||
      ap.defId !== bp.defId ||
      ap.x !== bp.x ||
      ap.y !== bp.y ||
      ap.flip !== bp.flip ||
      ap.parentUid !== bp.parentUid
    ) {
      return false;
    }
  }
  return true;
}
