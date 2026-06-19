# Jank Launcher — Project Brief & Agent Context

Durable context so any agent (or human) can pick up the project quickly. **Keep
this current as the design evolves** — it's the first thing a fresh agent should
read. See also `agents/VERIFY.md` for the in-browser verification workflow.

## What this is

A hand-drawn, 2D, **KSP-esque** rocket sandbox that runs in the browser. The
fantasy: doodle a badass rocket from a big pile of parts, fly it across a small
solar system, land on things, and shoot lasers/cannons/missiles/fireworks at
stuff. Tone is explicitly **fun > simulator** — jank is a feature.

- Owner: Matt (matt.anderson@customer.io / github `mattander`).
- Repo: https://github.com/mattander/jank-launcher (private).
- Stack: **Vite + TypeScript + PixiJS v8**. No backend. No art assets — all
  graphics are drawn procedurally in a wobbly "sketch" style.

## Locked design decisions (from the initial /grill-me — don't relitigate without reason)

1. **Renderer: PixiJS** (NOT three.js, despite the original ask — 2D-native fits
   sketchy line art better).
2. **Art: procedural rough/sketch style** — jittered, double-stroked lines drawn
   at runtime. No image files. Papery palette. See `src/sketch.ts`.
3. **Builder: KSP-lite** — parts attach at stack (top/bottom) and surface (side)
   points; live mass/thrust/TWR/Δv readout.
4. **Physics: multi-body 2D solar system** via **patched conics** (only the
   dominant SOI body pulls on you at a time).
5. **World:** Sol, Terra (home), Luna (Terra's moon), Rusty, Frost.
6. **Goals: sandbox + soft milestones** (toasts; no fail states / contracts).
7. **Jank: breakable-but-not-punishing** — stiff joints that snap under high-G /
   hard impacts (break-on-stress model, custom; NOT planck.js/Box2D).
8. **All part categories**; **weapons destroy anything**; **fun > sim**.
9. **Controls: KSP keyboard** + mouse-aim/click-to-fire + Tab weapon groups.
10. **Resources: fuel matters; electricity/RCS lightweight** (never hard-blocks
    control).
11. **Persistence: localStorage + JSON import/export** of designs.

## Architecture & core conventions

- **Units:** meters, tonnes, seconds, kN. Accel = kN/tonne = m/s². Fuel mass per
  unit = `FUEL_MASS_PER_UNIT` (0.005 t/unit, in `parts/catalog.ts`).
- **Coordinates:** world is **y-up**, screen is **y-down**. `Camera`
  (`src/camera.ts`) maps between them. Geometry is authored at `REF_PPM` px/m and
  containers scale by `zoom/REF_PPM`; container rotation = `-worldAngle`.
- **Camera uses logical pixels** (`app.screen.width/height`), NOT
  `renderer.width` (physical) — otherwise everything mis-centers on HiDPI/Retina.
- **Two scenes, one app.** `Game` (`src/game.ts`) owns a `Builder` and a
  `FlightScene`, each a Pixi `Container` added to the stage, toggled by a
  build↔flight state machine. The Pixi ticker drives `flight.update(dt)`.
- **DOM HUD over canvas.** Both scenes lay their panels out with a full-screen
  **CSS-grid overlay** (`pointer-events:none` container; panels `auto`; empty
  cells pass clicks through to the canvas). Match this pattern for new panels.
- **Design model** (`src/build/design.ts`): a `Design` is `{ name, parts:
  PlacedPart[] }`. Each `PlacedPart` has `{ uid, defId, x, y, flip, parentUid? }`
  in rocket-local meters (y-up). **Adjacency comes from explicit `parentUid`
  edges**, recorded by the builder at placement — not from node coincidence.
- **Vessel model** (`src/flight/vessel.ts`): a rigid assembly of `PartInstance`s
  with COM-centered local coords (recentered every frame after fuel burn / part
  loss). Thrust applies through the COM along the up axis (avoids spins); steering
  is reaction-wheel/RCS torque. Adjacency is a graph from `parentUid`; **staging
  and stress-breaks cut edges and spin the disconnected component off as a new
  debris `Vessel`**. `assembleVessel(design)` builds the player vessel.

### CRITICAL physics gotchas (read before touching flight)
- **All velocity-dependent forces must use velocity relative to the dominant
  body** (drag, parachutes, collisions, tracers). Bodies carry huge orbital
  velocity (~8.8 km/s) in the sun frame; using absolute velocity once caused a
  phantom ~60,000 m/s² drag and a numeric runaway.
- **Orbital integration adds `World.bodyFrameAccel(body)`** to the craft (the
  dominant body's own kinematic frame acceleration) on top of its gravity. This
  makes the SOI frame locally inertial so a landed craft co-moves with its planet
  and orbits stay Keplerian. Targets/asteroids/projectiles get the same term.
- **Camera hard-follows the craft** (no positional smoothing) — smoothing can't
  keep up with orbital speed and the craft slides off-screen.

## Module map

| File | Responsibility |
| --- | --- |
| `src/main.ts` | Pixi `Application` bootstrap (async init), mounts `Game`. |
| `src/game.ts` | Build↔flight state machine; ticker. |
| `src/types.ts` | `Vec2` + `V` math helpers. |
| `src/camera.ts` | `Camera` (world↔screen), `REF_PPM`. |
| `src/sketch.ts` | Hand-drawn drawing primitives (jittered polys/lines/circles). |
| `src/storage.ts` | localStorage save/load + JSON export/import; exploration log. |
| `src/audio.ts` | `GameAudio` — procedural Web Audio (engine, weapons, booms). |
| `src/parts/catalog.ts` | `PARTS` (30 part defs), `PartDef`/`WeaponSpec`, `drawPart`, `drawFairingShroud`, `getPart`. |
| `src/build/design.ts` | `Design`/`PlacedPart`, `computeStats` (mass/TWR/Δv). |
| `src/build/staging.ts` | `computeStages(design)` — ordered staging steps. |
| `src/build/stock.ts` | `stockDesigns()` — ready-to-fly example craft. |
| `src/build/builder.ts` | Build-mode editor: palette, snapping, symmetry, staging panel, save/load/stock, CSS-grid HUD. |
| `src/flight/world.ts` | `World`: bodies, orbits, gravity, `bodyFrameAccel`, atmosphere, SOI. |
| `src/flight/orbit.ts` | Pure Keplerian math: `orbit`, `orbitTiming`, `conicPath` (no pixi → unit-tested). |
| `src/flight/vessel.ts` | `Vessel` physics, staging, break-on-stress, collision, fairings, exhaust/re-entry FX hooks, `Fx` interface. |
| `src/flight/weapons.ts` | `Combat`: projectiles/lasers/missiles, targets, UFOs + enemy bolts, score callback. |
| `src/flight/fx.ts` | `Particles` (implements `Fx`): explosions, smoke, embers, fireworks, flame draw inputs. |
| `src/flight/flightScene.ts` | Flight controller: input, camera, map view, HUD + navball, milestones, weapons wiring, score/combo, SAS, flags, flame/re-entry rendering. |
| `src/*.test.ts`, `src/**/*.test.ts` | Vitest suites (39 tests). |
| `test/pixi-stub.ts` | pixi.js stub so logic modules import under Node. |

## Current feature set (all built & verified)

- **Builder:** ~30 parts across 7 categories; stack + surface attachment (stack
  nodes are sticky, surface is the fallback); 2× symmetry (`X`); decouplers →
  staging; engines have top+bottom nodes for vertical multi-stage; auto-fairing
  shroud on interstage engines; live stats + staging panel; Save/Load
  (localStorage), Export/Import (JSON), 📦 Stock craft.
- **Flight:** patched-conic gravity across Sol/Terra/Luna/Rusty/Frost; fuel burn;
  staging; parachutes; landing legs; break-on-stress; gentle-landing settle.
- **HUD (grid + navball):** body/altitude/speed/vertical-speed; apo/peri with
  **time-to-apo/peri**; throttle & fuel gauges; weapon-group chips; **SAS**
  (`T`: off/prograde/retrograde/hold); time-warp; **score + combo**; trajectory
  line in flight and on the **map view** (steer while watching your orbit).
- **Weapons:** cannon (ballistic, short), laser (instant hitscan), missile
  (guided), railgun (hypervelocity sniper), firework (festive). Aim with mouse,
  click/`F` to fire, `Tab`/chips to switch. Rounds converge & airburst at the
  cursor with AoE.
- **Combat sandbox:** asteroids, blimps, and roaming **UFOs** that shoot back;
  destroying things scores points × a combo multiplier.
- **FX/feel:** layered engine flame plumes, exhaust contrails, **re-entry
  plasma**, muzzle flash, screen shake, procedural audio (`N` mutes).
- **Exploration:** land gently on a body → plant a persistent **flag** + log the
  visit; flags drawn on the surface; "Explored: …" in the hangar.

## Controls (flight)

`A/D` rotate · `W/S` throttle · `Shift/Ctrl` full/cut · `T` SAS · `Space` stage ·
`R` RCS · mouse aim · click/`F` fire · `Tab` weapon group · `M` map · `,`/`.`
time-warp · `N` mute · `Esc` hangar. Builder: click palette then click to place,
drag to move, right-click to delete (subtree), wheel zoom, `X` symmetry.

## localStorage keys

- `jank-launcher:designs` — saved rocket designs (name → `Design`).
- `jank-launcher:log` — exploration log `{ visited: string[], flags: Flag[] }`.

## Commands

```bash
npm install
npm run dev        # play with hot reload (Vite)
npm test           # Vitest (run once); npm run test:watch to watch
npm run typecheck  # tsc --noEmit — keep clean (strict, noUnused* on)
npm run build      # typecheck + production bundle
```

## Conventions

- **Conventional commits**, ending with the Claude co-author trailer. Branch off
  before committing if on the default branch; commit/push only when asked.
- Keep `npm run typecheck` and `npm test` green before committing.
- Match the **sketchy/papery aesthetic** and the **CSS-grid HUD pattern** for any
  new UI. Reuse `sketch.ts` helpers and the palette colors in `catalog.ts` (`C`).
- New pure logic should live in a pixi-free module (like `orbit.ts`) so it can be
  unit-tested; add a `*.test.ts` beside it.
- Don't commit the throwaway `.pw*.mjs` verification scripts or `shot-*.png` (see
  VERIFY.md) — they're temporary.

## Possible next steps / ideas (not yet done)

- Builder Δv readout is single-stack (whole-rocket rocket equation) and
  **undercounts staged rockets**; compute per-stage Δv from `computeStages()`.
- Maneuver nodes / planned-burn preview; predict SOI-transition patched conics
  (the trajectory line currently only draws the conic within the current SOI).
- Radial/normal SAS hold; map focus-switching between bodies + map panning.
- Procedural surface detail / biomes; a title screen; persistent high score.
- Possible UI refactor: unify the two scenes' CSS-grid HUD scaffolding.
