import { Design } from "./build/design";
import { getPart } from "./parts/catalog";

const KEY = "jank-launcher:designs";
const LOG_KEY = "jank-launcher:log";

// Persistent exploration log: bodies landed on + planted flags.
export interface Flag {
  body: string;
  angle: number; // surface angle (radians) where the flag stands
}
export interface GameLog {
  visited: string[];
  flags: Flag[];
  discoveries: string[];
}

export function loadLog(): GameLog {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      return parseLog(parsed);
    }
  } catch {
    /* ignore */
  }
  return emptyLog();
}

export function saveLog(log: GameLog) {
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(log));
  } catch {
    /* ignore */
  }
}

function emptyLog(): GameLog {
  return { visited: [], flags: [], discoveries: [] };
}

function parseLog(value: unknown): GameLog {
  if (!isRecord(value)) return emptyLog();
  return {
    visited: stringArray(value.visited),
    flags: flagArray(value.flags),
    discoveries: stringArray(value.discoveries),
  };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function flagArray(value: unknown): Flag[] {
  if (!Array.isArray(value)) return [];
  const flags: Flag[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    if (typeof item.body !== "string" || typeof item.angle !== "number") continue;
    flags.push({ body: item.body, angle: item.angle });
  }
  return flags;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export interface SaveFile {
  app: "jank-launcher";
  version: 1;
  design: Design;
}

export function listSaved(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const map = JSON.parse(raw) as Record<string, Design>;
    return Object.keys(map).sort();
  } catch {
    return [];
  }
}

function readAll(): Record<string, Design> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}

export function saveDesign(design: Design) {
  const all = readAll();
  all[design.name] = design;
  localStorage.setItem(KEY, JSON.stringify(all));
}

export function loadDesign(name: string): Design | null {
  const all = readAll();
  const d = all[name];
  return d ? sanitize(d) : null;
}

export function deleteDesign(name: string) {
  const all = readAll();
  delete all[name];
  localStorage.setItem(KEY, JSON.stringify(all));
}

// ---- JSON file import/export ----

export function exportDesign(design: Design) {
  const file: SaveFile = { app: "jank-launcher", version: 1, design };
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${slug(design.name)}.rocket.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function importDesign(): Promise<Design | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      try {
        const text = await file.text();
        const parsed = JSON.parse(text) as SaveFile | Design;
        const design = "design" in parsed ? parsed.design : (parsed as Design);
        resolve(sanitize(design));
      } catch {
        resolve(null);
      }
    };
    input.click();
  });
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "rocket";
}

// Drop any parts that reference unknown ids (forward/backward compat safety).
function sanitize(d: Design): Design {
  return {
    name: typeof d.name === "string" ? d.name : "Imported Rocket",
    parts: (d.parts ?? []).filter((p) => {
      try {
        getPart(p.defId);
        return true;
      } catch {
        return false;
      }
    }),
  };
}
