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

## Develop

```bash
npm run dev        # play with hot reload
npm test           # run the unit tests (Vitest)
npm run typecheck  # tsc --noEmit
npm run build      # typecheck + production bundle
```

Tests cover the pure logic (vector math, world gravity/frame-acceleration,
Keplerian orbit/conic math, design stats, staging, vessel assembly/staging/
fairings). `pixi.js` is stubbed for those so they run headless under Node.

**Working on the code?** Start with [`agents/PROJECT_BRIEF.md`](agents/PROJECT_BRIEF.md)
(architecture, module map, conventions, physics gotchas) and
[`agents/VERIFY.md`](agents/VERIFY.md) (how to verify changes in a real browser).

## How to play

### Build mode

- **Click a part** in the left palette, then **click in the hangar** to place it.
- Parts attach two ways: **stack** (top/bottom nodes — sticky, for building up)
  and **surface** (sides — fins, weapons, radial decouplers, side boosters).
- **Drag** placed parts to move them, **right-click** to delete a sub-assembly.
- Press **X** to toggle 2× **symmetry** (mirrors side-mounted parts).
- The readout shows mass, thrust, TWR and Δv; the **Staging** panel shows what
  each Space press will do.
- **Save / Load** designs to your browser, **Export / Import** them as JSON, or
  grab a ready-to-fly **📦 Stock** rocket.
- Hit **Launch** when you're ready.

### Flight mode

| Key | Action |
| --- | --- |
| `A` / `D` | Rotate left / right |
| `W` / `S` | Throttle up / down |
| `Shift` / `Ctrl` | Full / cut throttle |
| `T` | SAS: cycle off / prograde / retrograde / hold |
| `Space` | Stage (drop a decoupler / pop chutes) |
| `Mouse` / `Click` / `F` | Aim / fire weapons |
| `Tab` | Cycle weapon group (cannon / laser / missile / railgun / firework) |
| `R` | RCS toggle |
| `M` | Toggle map view |
| `,` / `.` | Time warp down / up |
| `N` | Mute / unmute sound |
| `Mouse wheel` | Zoom |
| `Esc` | Back to the hangar |

Build velocity to reach orbit, coast to the Moon or the other planets, and try
to land (gently — bring landing legs and parachutes). Hit things too hard and
parts snap off and explode. That's the whole point.

The HUD shows your orbit (apoapsis/periapsis with time-to), a **navball**, and
gauges; **SAS** can hold prograde/retrograde so you don't have to hand-fly burns.
Open the **map** (`M`) to watch your orbit reshape as you burn. Out in the world
there are asteroids, blimps, and roaming **UFOs** that shoot back — blast them
for **score** (rapid kills build a combo). Land somewhere new and you'll plant a
**flag** and log the visit.

## Design notes

The flight model uses a custom 2D integrator with patched-conic gravity (only
the dominant body pulls on you at a time, like KSP). Rocket structure uses a
break-on-stress joint model: joints are stiff enough for normal flight but snap
under high-G or hard impacts — comedy, not a soft-body simulator.
