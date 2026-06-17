# 🚀 Jank Launcher

A hand-drawn, 2D, KSP-esque rocket sandbox that runs in the browser. Doodle a
badass rocket out of a pile of parts, then fly it across a little solar system —
and shoot lasers and missiles at stuff, because everyone loves that.

Built with **Vite + TypeScript + PixiJS**. Art is procedurally "sketched" at
runtime (no image assets), so everything has a wobbly, drawn-by-hand look.

## Play

```bash
npm install
npm run dev
```

Then open the local URL Vite prints.

## How to play

### Build mode

- **Click a part** in the left palette, then **click in the hangar** to place it.
- Parts snap to attachment nodes: stack (top/bottom) and radial (sides).
- **Drag** placed parts to move them, **right-click** to delete.
- The readout shows mass, thrust, TWR and Δv as you build.
- **Save / Load** designs to your browser, or **Export / Import** them as JSON
  files to share rockets and save games.
- Hit **Launch** when you're ready.

### Flight mode

| Key | Action |
| --- | --- |
| `A` / `D` | Rotate left / right |
| `W` / `S` | Throttle up / down |
| `Shift` / `Ctrl` | Full / cut throttle |
| `Space` | Stage (drop a decoupler / pop chutes) |
| `F` | Fire weapons |
| `R` | RCS toggle |
| `M` | Toggle map view |
| `Mouse wheel` | Zoom |
| `Esc` | Back to the hangar |

Build velocity to reach orbit, coast to the Moon or the other planets, and try
to land (gently — bring landing legs and parachutes). Hit things too hard and
parts snap off and explode. That's the whole point.

## Design notes

The flight model uses a custom 2D integrator with patched-conic gravity (only
the dominant body pulls on you at a time, like KSP). Rocket structure uses a
break-on-stress joint model: joints are stiff enough for normal flight but snap
under high-G or hard impacts — comedy, not a soft-body simulator.
