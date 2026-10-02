import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// UX-11C.5 — source of truth of a guided session: the execution → ITS final
// prescription → the results of that execution. No app file of the
// guided-session feature may read planned prescriptions, planned sessions,
// legacy dose targets, the plan dose policy, or import an engine to
// recompute a session.
const ROOT = join(__dirname);
function appFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return appFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}
const strip = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("guided session — source-of-truth boundaries", () => {
  const files = appFiles(ROOT);

  it("covers every module (shell, Force, DH, endurance, results)", () => {
    const names = files.map((f) => f.slice(ROOT.length + 1).replace(/\\/g, "/"));
    for (const expected of ["guidedSessionLoader.ts", "executionRepo.ts", "strength/strengthSets.ts", "dh/dhPasses.ts", "endurance/enduranceActivity.ts", "results/activeResults.ts"]) expect(names).toContain(expected);
  });

  it("never reads planned prescriptions, planned sessions, dose targets or the plan dose policy", () => {
    for (const f of files) expect(strip(readFileSync(f, "utf8")), f).not.toMatch(/training_plan_planned_prescriptions|planned_sessions|planningRepo|doseTarget|planDosePolicy|plan_dose_policy/);
  });

  it("never imports an engine (no recomputation of the session on the client)", () => {
    for (const f of files) expect(readFileSync(f, "utf8"), f).not.toMatch(/from\s+"[./]*(planning-engine|head-coach-engine|prescription-engine)/);
  });

  it("reads only executions (with their events and results) and final prescriptions by id", () => {
    const tables = new Set(files.flatMap((f) => [...readFileSync(f, "utf8").matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1])));
    expect([...tables].sort()).toEqual(["decision_final_prescriptions", "session_executions"]);
  });
});
