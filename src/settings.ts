export type ThemeMode = "system" | "light" | "dark";

export interface GameSettings {
  theme: ThemeMode;
  scenery: boolean;
  motion: boolean;
}

const SETTINGS_KEY = "jank-launcher:settings";

export const DEFAULT_SETTINGS: GameSettings = {
  theme: "system",
  scenery: true,
  motion: true,
};

export function loadSettings(): GameSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return parseSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: GameSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  applyTheme(settings.theme);
}

export function applyTheme(theme: ThemeMode) {
  const resolved = resolveTheme(theme);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themeChoice = theme;
}

export function resolveTheme(theme: ThemeMode): "light" | "dark" {
  if (theme !== "system") return theme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function parseSettings(value: unknown): GameSettings {
  if (!isRecord(value)) return { ...DEFAULT_SETTINGS };
  return {
    theme: parseTheme(value.theme),
    scenery: typeof value.scenery === "boolean" ? value.scenery : DEFAULT_SETTINGS.scenery,
    motion: typeof value.motion === "boolean" ? value.motion : DEFAULT_SETTINGS.motion,
  };
}

function parseTheme(value: unknown): ThemeMode {
  if (value === "light" || value === "dark" || value === "system") return value;
  return DEFAULT_SETTINGS.theme;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
