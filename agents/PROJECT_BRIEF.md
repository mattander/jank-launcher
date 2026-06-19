# Jank Launcher — Project Brief & Agent Context

This file is the durable context for the project so any agent (or human) can pick
up if a session is interrupted. Keep it current as the design evolves.

## What this is

A hand-drawn, 2D, **KSP-esque** rocket sandbox that runs in the browser. The
fantasy: doodle a badass rocket out of a big pile of parts, then fly it across a
small solar system — and shoot lasers/cannons/missiles at stuff for fun. The
explicit tone is **fun > simulator**. Jank is a feature.

Owner: Matt (matt.anderson@customer.io / github `mattander`).
Repo: https://github.com/mattander/jank-launcher (private).

## Decisions locked during /grill-me (do not relitigate without reason)

1. **Renderer: PixiJS** (NOT three.js, despite the original ask — 2D-native is a
   better fit for sketchy line art). Vite + TypeScript.
2. **Art: procedural "rough.js style" sketch** — everything drawn at runtime with
   jittered, double-stroked lines. No image assets. Papery palette. See
   `src/sketch.ts`.
3. **Builder: KSP-lite** — parts snap to stack (top/bottom) and radial (side)
   attachment nodes. Live mass/thrust/TWR/Δv readout.
4. **Physics: multi-body 2D solar system**, computed with **patched conics**
   (only the dominant SOI body pulls on you at a time — KSP's trick).
5. **World: home planet + moon + 2 more planets**, all orbiting a sun.
   (Sol, Terra [home], Luna [Terra's moon], Rusty, Frost.)
6. **Goals: sandbox + soft milestones** (toasts for "reached orbit", "landed on
   Luna", etc.). No fail states, no contracts.
7. **Jank: breakable structure, NOT punishing.** Springy/breakable joints that
   are stiff enough for normal flight but snap under high-G or hard impacts —
   comedy, not a soft-body simulator. Implemented as a **break-on-stress** model
   (custom), not planck.js. Fallback was rigid-body + explosions if it proved
   fiddly; the break-on-stress model is the chosen path.
8. **Parts: all categories** — command, fuel, engines (incl. SRB), aero,
   structural (decouplers, girders, legs, struts, adapters), utility (chutes,
   RCS, solar, battery), weapons (cannon, laser, missile rack). ~25 parts.
9. **Weapons: destroy anything** — terrain, debris, other craft, floating
   targets/asteroids. Spawn targets for sport.
10. **Controls: KSP keyboard** — A/D rotate, W/S throttle, Space stage, plus
    **mouse-aim + click to fire**, **Tab to cycle weapon groups** (later
    refinement from Matt), F as alt fire. Esc back to hangar. M map view.
11. **Resources: fuel matters; electricity/RCS lightweight** (never hard-blocks
    control — reduced authority at zero charge, not zero).
12. **Setup: Vite + TypeScript**, new folder `jank-launcher` under `~/code`.
13. **Persistence: localStorage + JSON import/export** of designs (and intended
    save files) so rockets/games can be shared.

## Key engineering choices

- **Custom physics, not a Box2D port.** Box2D-scale engines lose float precision
  across solar-system distances; the break-on-stress model gives the "stuff snaps
  off" comedy without a soft-body sim fighting the orbital integrator.
- **Units:** meters, tonnes, seconds, kN. Accel = kN/tonne = m/s². Fuel mass =
  `FUEL_MASS_PER_UNIT` (0.005 t/unit).
- **Coordinates:** world is y-up; screen is y-down. `Camera` maps between them.
  Geometry is authored at `REF_PPM` px/m and containers are scaled by
  `zoom/REF_PPM`. Container rotation = `-worldAngle`.
- **Vessel model:** a rigid assembly of `PartInstance`s with COM-centered local
  coords (recentered every frame after fuel burn/part loss). Thrust applied
  through COM along the up axis (avoids uncontrollable spins). Steering via
  reaction-wheel/RCS torque from A/D input. Adjacency is a graph derived from
  coincident attach nodes; staging and stress-breaks **cut edges** and spin off
  the disconnected component as a new debris `Vessel`.

## Status / progress

**v1 is complete and playable end to end.** All modules built, typecheck +
production build clean, and verified in Chrome via Playwright (build → launch →
ascent → orbit/HUD → weapons → solar-system map, no console errors).

Built:
- Scaffolding (package.json, tsconfig, vite, index.html shell, favicon).
- `src/sketch.ts` — hand-drawn drawing helpers.
- `src/types.ts` — Vec2 math.
- `src/parts/catalog.ts` — full part catalog + `drawPart`.
- `src/camera.ts` — camera + REF_PPM.
- `src/flight/world.ts` — solar system + patched-conic gravity/atmosphere.
- `src/build/design.ts` — design model + stats.
- `src/flight/vessel.ts` — vessel physics, staging, break-on-stress, collision.
- `src/flight/weapons.ts` — projectiles, lasers, targets/asteroids, damage.
- `src/build/builder.ts` — build-mode editor.
- `src/flight/fx.ts` — particle/explosion system.
- `src/flight/flightScene.ts` — flight controller (input, camera, map, HUD,
  milestones, weapons wiring).
- `src/storage.ts` — localStorage + JSON import/export.
- `src/main.ts` + `src/game.ts` — bootstrap + build<->flight state machine.

### Gotchas learned (important for future work)
- All velocity-dependent forces (drag, parachutes, collision response) MUST be
  computed relative to the dominant body's velocity, because bodies carry large
  orbital velocities in the sun frame. Using absolute velocity caused a phantom
  ~60,000 m/s² drag and a numerical runaway. See the fix commit.
- The camera hard-follows the craft (no positional smoothing). The world moves
  at orbital speed (~8.8 km/s), so smoothing on absolute position lags the craft
  off-screen.
- Orbital integration uses `World.bodyFrameAccel(body)`: the craft gets the
  dominant body's gravity PLUS that body's own (kinematic) frame acceleration.
  This makes the SOI body frame locally inertial in absolute coordinates, so a
  landed craft co-moves with its planet and orbits stay Keplerian relative to it
  (verified rock-solid: 100 km circular orbit holds apo/peri within ~0.3 km and
  ecc < 5e-4 over multiple orbits). Asteroids get the same term.
- `import.meta.env.DEV` exposes `window.__flight` for debugging the live scene.

### Done since v1
- Aim reticle + dotted aim line; ballistic rounds converge on the cursor and
  airburst there with AoE; laser beam ends at the cursor.
- Trajectory prediction line (Keplerian conic) in flight + on the map, with
  apo/peri markers (`conicPath` in flightScene).
- Balance pass: efficient engines (Bonfire ve ~4200), bigger tanks, much lighter
  drag + steeper atmosphere falloff. A simple Big-Tank rocket reads ~4320 m/s dv
  at TWR 3.45 and comfortably orbits Terra.
- Staging UI: `computeStages()` (build/staging.ts) drives a builder stage stack;
  flight HUD shows the next Space action (`Vessel.nextStageLabel`).
- Weapon feel: muzzle flash, screen shake, pulsing reticle, procedural audio.
- Weapons fly to target: missiles are guided rockets, cannons ballistic+short,
  lasers instant/long. Aim point stored relative to the dominant body.
- HiDPI fix: camera uses `app.screen` (logical px), not renderer.width.
- Build QOL: unified stack-or-surface attachment (tanks/SRBs side-mount and go on
  radial decouplers); 2x symmetry (X key); engines have bottom nodes so vertical
  multi-stage stacks work; auto-fairing shroud on interstage engines.
- Builder layout is a CSS-grid overlay (pointer-events:none container, panels in
  named areas; clicks pass through empty cells to the canvas).
- Map view: steer/throttle/stage while it frames the orbit around the dominant
  body; oriented craft + prograde markers; trajectory line.
- Stock rockets: `src/build/stock.ts` (📦 Stock button), deep-cloned on load.
- Orbital math lives in `src/flight/orbit.ts` (pure, no pixi) for testability.
- Tests: Vitest (`npm test`). pixi.js is stubbed via `test/pixi-stub.ts` aliased
  in `vitest.config.ts` so logic modules import cleanly under Node. Suites cover
  types/world/orbit/design/staging/vessel.
- Flight HUD: grid overlay (nav/status/gauges/help/toasts) + Pixi navball; nav
  shows time-to-apo/peri; SAS hold (T: off/prograde/retrograde/hold) via PD
  controller in flightScene.sasRotate().
- FX: layered engine flame plumes (gFlame), exhaust smoke/embers, re-entry plasma
  (Vessel.emitReentry); Particles has glow + grow + fireworks().
- Combat sandbox: UFOs + enemy bolts + score/combo (Combat.onScore →
  flightScene.addScore). 30 parts incl. vac engine, Thumper SRB, heat shield,
  railgun, firework (WeaponSpec.festive).
- Exploration: plant-a-flag on landing + visited log persisted via storage
  loadLog/saveLog (key jank-launcher:log); flags drawn on the dominant body.

### Possible next steps / ideas (not yet done)
- The builder Δv readout is single-stack (whole-rocket rocket equation); it
  UNDERcounts a staged rocket's real dv. Compute per-stage dv using
  computeStages() segments for an accurate number.
- Maneuver nodes; SAS/prograde hold; predict SOI-transition patched conics.
- Procedural surface detail / biomes; landing-site flags.
- More parts, target variety, scoring.
- A real favicon/app icon and a title screen.

## How to run / verify

```bash
npm install
npm run dev        # play
npm run typecheck  # tsc --noEmit (keep clean)
npm run build      # tsc + vite build
```

Verify in a browser (the project is browser-only). Use the `browser-verification`
/ `verify` skills when checking that flight actually works.

## Conventions

- Conventional commits, signed-off with the Claude co-author trailer.
- Keep `npm run typecheck` clean (strict TS, noUnusedLocals/Parameters on).
- Match the existing sketchy/papery aesthetic for any new UI.
