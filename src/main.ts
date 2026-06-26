import { Application } from "pixi.js";
import { Game } from "./game";
import { applyTheme, loadSettings, resolveTheme } from "./settings";

async function boot() {
  const settings = loadSettings();
  applyTheme(settings.theme);
  const app = new Application();
  await app.init({
    background: resolveTheme(settings.theme) === "dark" ? 0x111827 : 0xf3ead6,
    antialias: true,
    resizeTo: window,
    resolution: Math.min(2, window.devicePixelRatio || 1),
    autoDensity: true,
  });
  const mount = document.getElementById("app");
  if (!mount) return;
  mount.appendChild(app.canvas);
  // make canvas focusable target for wheel/pointer
  app.canvas.style.touchAction = "none";

  new Game(app, settings);
}

boot();
