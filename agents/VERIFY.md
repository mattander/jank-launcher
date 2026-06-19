# Verifying changes in a real browser

This is a **browser-only** game: `npm run build` passing does **not** mean it
works. Render bugs, input bugs, and physics bugs only show at runtime. Verify
visually + functionally in a browser before claiming something works.

## Why not just node_repl / playwright MCP?

In this sandbox the Node-REPL kernel **cannot write to disk**, so Playwright
(which extracts/needs browser artifacts) fails there with `EPERM`. Drive
Playwright from the **Bash tool** instead, using the **system Chrome**.

## The workflow that works

1. **Start the dev server** (background):
   ```bash
   npx vite --port 5188 --strictPort   # run_in_background: true
   ```
2. **Ensure Playwright is installed** (it's a `--no-save` dep and gets pruned by
   other `npm install`s, so reinstall when a script errors `Cannot find package
   'playwright'`):
   ```bash
   npm i playwright --no-save
   ```
3. **Write a throwaway script** `./.pwSOMETHING.mjs`, run it with `node`, and
   `Read` any screenshots it writes. Launch with the **system Chrome + swiftshader**
   (headless WebGL):
   ```js
   const browser = await chromium.launch({
     channel: "chrome",
     args: ["--enable-unsafe-swiftshader"],
   });
   ```
4. **Clean up**: delete the `.pw*.mjs` script and `shot-*.png` when done, and
   `pkill -f "vite --port 5188"`. (Both globs are gitignored, but don't leave
   clutter.)

## Dev hooks (only in `import.meta.env.DEV`)

These let you set state and step the simulation **deterministically**, bypassing
`requestAnimationFrame` (headless rAF is throttled/unreliable):

- `window.__flight` — the live `FlightScene`. Key fields/methods:
  `player` (the `Vessel`), `world`, `combat`, `cam`, `score`, `sas`, `warp`,
  `throttle`, `keys` (a `Set`), `aimScreen`, `update(dt)`, `fireWeapons()`,
  `availableWeaponKinds()`.
- `window.__builder` — the live `Builder`: `design`, `cam`, `symmetry`,
  `computeSnap(def)`, `addMirror(part)`, `render()`, `fairingEngines()`.
- `window.__PARTS` — the `PARTS` catalog array (look up defs by `id`).

**Step the sim** by calling `f.update(0.05)` in a loop inside `page.evaluate`
(this advances the world + physics together). Set `f.warp` to fast-forward.
Set `f.player.pos/vel/angle` directly to place the craft anywhere. Remember
`update()` re-derives `liquidFuel` from tanks, so set tank fuel, not the cached
total. Manual `f.keys.add("w")` simulates held keys (clear them after!).

## Common recipes

**Load a design and launch:**
```js
await page.evaluate((d) => localStorage.setItem(
  "jank-launcher:designs", JSON.stringify({ [d.name]: d })), design);
await page.reload({ waitUntil: "networkidle" });
page.on("dialog", (dlg) => dlg.accept(design.name)); // Load uses prompt()
await page.getByText("📂 Load").click();
await page.getByText("🚀 Launch").click();
```

**Put the craft in a circular orbit** (relative to a body, co-moving):
```js
const b = f.world.get("terra"); const r = b.radius + 100000;
const vc = Math.sqrt(b.GM / r);
f.player.pos = { x: b.pos.x, y: b.pos.y + r };
f.player.vel = { x: b.vel.x + vc, y: b.vel.y }; // tangential
```

**Test HiDPI/Retina** (caught a real centering+aim bug): create the page with
`deviceScaleFactor: 2` and assert the craft renders centered
(`worldToScreen(player.pos)` ≈ screen center) and aim points where you click.

**Real click-to-build** (exercises the snap/placement flow): click a palette
button by text, then `page.mouse.click(...)` at a screen point computed from
`builder.cam.worldToScreen(...)` via `page.evaluate`.

## What to actually check

Console/page errors, the target visual state (Read the screenshot), and the
functional outcome (read back numbers from `window.__flight`, e.g. score went up,
apoapsis changed, a part detached). Don't trust build success for runtime claims.
