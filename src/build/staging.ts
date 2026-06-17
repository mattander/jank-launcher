import { Design } from "./design";
import { getPart } from "../parts/catalog";

export interface StageStep {
  action: "separate" | "deploy";
  label: string;
  partIds: string[]; // part def ids involved (for icons/summary)
}

function edgeKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

// Order matches the runtime: Space fires the lowest decoupler each press, then
// finally deploys parachutes/legs. This computes that ordered list for display.
export function computeStages(design: Design): StageStep[] {
  const parts = design.parts;
  if (parts.length === 0) return [];

  const adj = new Map<string, Set<string>>();
  for (const p of parts) adj.set(p.uid, new Set());
  for (const p of parts) {
    if (!p.parentUid || !adj.has(p.parentUid)) continue;
    adj.get(p.uid)!.add(p.parentUid);
    adj.get(p.parentUid)!.add(p.uid);
  }

  const root =
    parts.find((p) => getPart(p.defId).torque)?.uid ?? parts[0].uid;

  const componentFrom = (start: string, cut: Set<string>): Set<string> => {
    const seen = new Set([start]);
    const stack = [start];
    while (stack.length) {
      const u = stack.pop()!;
      for (const n of adj.get(u) ?? []) {
        if (cut.has(edgeKey(u, n)) || seen.has(n)) continue;
        seen.add(n);
        stack.push(n);
      }
    }
    return seen;
  };

  const nameOf = (uid: string) => getPart(parts.find((p) => p.uid === uid)!.defId).name;
  const defOf = (uid: string) => parts.find((p) => p.uid === uid)!.defId;

  const steps: StageStep[] = [];
  const decouplers = parts
    .filter((p) => getPart(p.defId).decoupler)
    .sort((a, b) => a.y - b.y); // lowest first

  for (const d of decouplers) {
    const dropped = new Set<string>();
    for (const n of adj.get(d.uid) ?? []) {
      const comp = componentFrom(root, new Set([edgeKey(d.uid, n)]));
      if (!comp.has(n)) for (const x of componentFrom(n, new Set([edgeKey(d.uid, n)]))) dropped.add(x);
    }
    if (dropped.size === 0) continue;
    const names = [...new Set([...dropped].map(nameOf))];
    steps.push({
      action: "separate",
      label: `Drop ${names.slice(0, 3).join(", ")}${names.length > 3 ? "…" : ""}`,
      partIds: [...new Set([...dropped].map(defOf))],
    });
  }

  const deployables = parts.filter((p) => {
    const def = getPart(p.defId);
    return def.parachute || def.landingLeg;
  });
  if (deployables.length > 0) {
    const names = [...new Set(deployables.map((p) => nameOf(p.uid)))];
    steps.push({
      action: "deploy",
      label: `Deploy ${names.slice(0, 3).join(", ")}`,
      partIds: [...new Set(deployables.map((p) => defOf(p.uid)))],
    });
  }

  return steps;
}
