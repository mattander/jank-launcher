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

Done:
- Scaffolding (package.json, tsconfig, vite, index.html shell).
- `src/sketch.ts` — hand-drawn drawing helpers.
- `src/types.ts` — Vec2 math.
- `src/parts/catalog.ts` — full part catalog + `drawPart`.
- `src/camera.ts` — camera + REF_PPM.
- `src/flight/world.ts` — solar system + gravity/atmosphere.
- `src/build/design.ts` — design model + stats.
- `src/flight/vessel.ts` — vessel physics, staging, break-on-stress, collision.

TODO (remaining build order):
- `src/flight/weapons.ts` — projectiles, lasers, targets/asteroids, damage.
- `src/build/builder.ts` — build-mode editor (palette, placement, snapping,
  drag/delete, stats HUD, save/load/export/import, Launch).
- `src/flight/flightScene.ts` — flight controller: input, camera follow + zoom +
  map view, render vessels/bodies/FX, milestones, weapons wiring (mouse-aim,
  click fire, Tab groups).
- `src/storage.ts` — localStorage + JSON import/export.
- `src/ui/*` — palette, HUD, toasts (may be folded into builder/flightScene).
- `src/main.ts` + `src/game.ts` — app bootstrap + build<->flight state machine.

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
