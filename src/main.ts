import { Application } from "pixi.js";
import { Game } from "./game";

async function boot() {
  const app = new Application();
  await app.init({
    background: 0xf3ead6,
    antialias: true,
    resizeTo: window,
    resolution: Math.min(2, window.devicePixelRatio || 1),
    autoDensity: true,
  });
  document.getElementById("app")!.appendChild(app.canvas);
  // make canvas focusable target for wheel/pointer
  app.canvas.style.touchAction = "none";

  new Game(app);
}

boot();
