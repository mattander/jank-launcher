import { Application } from "pixi.js";
import { Builder } from "./build/builder";
import { FlightScene } from "./flight/flightScene";
import { Design } from "./build/design";
import { GameMode } from "./types";

export class Game {
  app: Application;
  builder: Builder;
  flight: FlightScene;
  mode: GameMode = "build";

  constructor(app: Application) {
    this.app = app;
    this.builder = new Builder(app, (d) => this.launch(d));
    this.flight = new FlightScene(app, () => this.toBuild());

    app.stage.addChild(this.builder.layer);
    app.stage.addChild(this.flight.layer);

    this.toBuild();

    app.ticker.add((ticker) => {
      const dt = Math.min(0.05, ticker.deltaMS / 1000);
      if (this.mode === "flight") this.flight.update(dt);
    });

    window.addEventListener("resize", () => {
      if (this.mode === "build") this.builder.resize();
      else this.flight.resize();
    });
  }

  private launch(d: Design) {
    this.mode = "flight";
    this.builder.hide();
    this.flight.show();
    this.flight.start(d);
  }

  private toBuild() {
    this.mode = "build";
    this.flight.hide();
    this.builder.show();
  }
}
