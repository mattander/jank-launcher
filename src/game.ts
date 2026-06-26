import { Application } from "pixi.js";
import { Builder } from "./build/builder";
import { FlightScene } from "./flight/flightScene";
import { Design } from "./build/design";
import { GameMode } from "./types";
import { applyTheme, GameSettings, saveSettings, ThemeMode, resolveTheme } from "./settings";

export class Game {
  app: Application;
  builder: Builder;
  flight: FlightScene;
  mode: GameMode = "build";
  private settings: GameSettings;
  private settingsButton: HTMLButtonElement;
  private settingsModal: HTMLDivElement | null = null;

  constructor(app: Application, settings: GameSettings) {
    this.app = app;
    this.settings = settings;
    this.builder = new Builder(app, (d) => this.launch(d));
    this.flight = new FlightScene(app, () => this.toBuild(), () => this.restartFlight());
    this.flight.setSettings(this.settings);
    this.settingsButton = this.buildSettingsButton();
    this.applySettings();

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
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if (this.settings.theme === "system") this.applySettings();
    });
  }

  private launch(d: Design) {
    this.mode = "flight";
    this.builder.hide();
    this.flight.show();
    this.flight.start(d);
  }

  private restartFlight() {
    if (this.mode !== "flight") return;
    this.flight.restart();
  }

  private toBuild() {
    this.mode = "build";
    this.flight.hide();
    this.builder.show();
  }

  private buildSettingsButton(): HTMLButtonElement {
    const button = document.createElement("button");
    button.className = "settings-button";
    button.type = "button";
    button.textContent = "⚙";
    button.title = "Settings";
    button.onclick = () => this.openSettings();
    document.body.appendChild(button);
    return button;
  }

  private openSettings() {
    this.settingsModal?.remove();
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop settings-backdrop";
    const modal = document.createElement("div");
    modal.className = "modal settings-modal";
    backdrop.appendChild(modal);

    const head = document.createElement("div");
    head.className = "modal-head";
    const title = document.createElement("h2");
    title.textContent = "Settings";
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "Close";
    close.onclick = () => this.closeSettings();
    head.append(title, close);
    modal.appendChild(head);

    modal.appendChild(this.settingGroup("Theme", [
      this.choiceButton("System", this.settings.theme === "system", () => this.updateTheme("system")),
      this.choiceButton("Light", this.settings.theme === "light", () => this.updateTheme("light")),
      this.choiceButton("Dark", this.settings.theme === "dark", () => this.updateTheme("dark")),
    ]));

    modal.appendChild(this.settingGroup("Presentation", [
      this.toggleButton("Scenery", this.settings.scenery, () => this.updateSettings({ scenery: !this.settings.scenery })),
      this.toggleButton("Motion", this.settings.motion, () => this.updateSettings({ motion: !this.settings.motion })),
    ]));

    const note = document.createElement("p");
    note.className = "muted settings-note";
    note.textContent = "System follows your device theme. Motion affects transitions and camera shake; scenery controls decorative terrain details.";
    modal.appendChild(note);

    backdrop.onclick = (event) => {
      if (event.target === backdrop) this.closeSettings();
    };
    backdrop.onkeydown = (event) => {
      if (event.key === "Escape") this.closeSettings();
    };
    backdrop.tabIndex = -1;
    document.body.appendChild(backdrop);
    backdrop.focus();
    this.settingsModal = backdrop;
  }

  private closeSettings() {
    this.settingsModal?.remove();
    this.settingsModal = null;
  }

  private settingGroup(label: string, controls: HTMLButtonElement[]): HTMLDivElement {
    const group = document.createElement("div");
    group.className = "settings-group";
    const heading = document.createElement("div");
    heading.className = "section-label";
    heading.textContent = label;
    const row = document.createElement("div");
    row.className = "settings-row";
    row.append(...controls);
    group.append(heading, row);
    return group;
  }

  private choiceButton(label: string, active: boolean, onClick: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = active ? "toggled" : "";
    button.textContent = label;
    button.setAttribute("aria-pressed", active ? "true" : "false");
    button.onclick = onClick;
    return button;
  }

  private toggleButton(label: string, active: boolean, onClick: () => void): HTMLButtonElement {
    const button = this.choiceButton(`${label}: ${active ? "On" : "Off"}`, active, onClick);
    return button;
  }

  private updateTheme(theme: ThemeMode) {
    this.updateSettings({ theme });
  }

  private updateSettings(next: Partial<GameSettings>) {
    this.settings = { ...this.settings, ...next };
    saveSettings(this.settings);
    this.applySettings();
    this.openSettings();
  }

  private applySettings() {
    applyTheme(this.settings.theme);
    this.flight.setSettings(this.settings);
    document.documentElement.classList.toggle("motion-off", !this.settings.motion);
    const dark = resolveTheme(this.settings.theme) === "dark";
    this.app.renderer.background.color = dark ? 0x111827 : 0xf3ead6;
    this.settingsButton.classList.toggle("active", this.settings.theme !== "system" || !this.settings.scenery || !this.settings.motion);
  }
}
